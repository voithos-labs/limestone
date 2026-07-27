import type { Page } from '@playwright/test';
import { recognizeWikiImageEmbed } from '../src/components/editor/wiki-image-embeds-scan';
import { bootApp } from './support/app';
import { expect, test } from './support/test';

// Vite serves and transforms this path; a string keeps the harness (and aragonite's
// types) out of the e2e type-check program, which knows neither Svelte nor the alias.
const HARNESS_URL = '/src/components/editor/wiki-image-embeds-harness.ts';

/** The fields of an inline node these scenarios turn on. */
interface InlineSummary {
	kind: string;
	start: number;
	end: number;
	alt?: string;
	url?: string;
	width?: number;
}

/** Inline nodes of the document's block at `index`, parsed with the plugins installed. */
async function inlineNodes(page: Page, source: string, index = 0): Promise<InlineSummary[]> {
	await bootApp(page);
	return page.evaluate(
		async ({ harnessUrl, source, index }) => {
			const harness = await import(harnessUrl);
			return harness.inlineNodesAt(source, index).map((node: Record<string, unknown>) => ({
				kind: node.kind,
				start: node.start,
				end: node.end,
				...(node.alt !== undefined ? { alt: node.alt } : {}),
				...(node.url !== undefined ? { url: node.url } : {}),
				...(node.width !== undefined ? { width: node.width } : {})
			}));
		},
		{ harnessUrl: HARNESS_URL, source, index }
	);
}

async function imageNodes(page: Page, source: string, index = 0): Promise<InlineSummary[]> {
	return (await inlineNodes(page, source, index)).filter((node) => node.kind === 'image');
}

async function mountEditor(page: Page, source: string): Promise<void> {
	await bootApp(page);
	await page.evaluate(
		async ({ harnessUrl, source }) => {
			const harness = await import(harnessUrl);
			harness.mountHarnessEditor(source);
		},
		{ harnessUrl: HARNESS_URL, source }
	);
	await expect(page.locator('#wiki-image-embeds-harness .editor')).toBeVisible();
}

const images = (page: Page) => page.locator('#wiki-image-embeds-harness [data-image-widget]');
const editor = (page: Page) => page.locator('#wiki-image-embeds-harness .editor');

function editedSource(page: Page): Promise<string> {
	return page.evaluate(() => (window as unknown as HarnessWindow).__wikiImageEmbedSource());
}

interface HarnessWindow {
	__wikiImageEmbedSource(): string;
}

// ── The recognizer ──────────────────────────────────────────────────────────

test('claims an embed with its target and size modifier', () => {
	const raw = 'a ![[cat.png|300]] b';
	expect(recognizeWikiImageEmbed(raw, 2, raw.length)).toEqual({
		start: 2,
		end: 18,
		target: 'cat.png',
		width: 300
	});
});

test('ignores a size modifier that is not a pixel width', () => {
	const raw = '![[cat.png|abc]]';
	expect(recognizeWikiImageEmbed(raw, 0, raw.length)).toEqual({
		start: 0,
		end: 16,
		target: 'cat.png'
	});
});

test('declines an embed whose close lies past the scan window', () => {
	expect(recognizeWikiImageEmbed('![[cat.png]] tail', 0, 8)).toBeNull();
});

const declined = [
	['a target with no image extension', '![[notes.md]]'],
	['an empty target', '![[]]'],
	['a target that is bare extension, with no stem', '![[.png]]'],
	['a size modifier with no target', '![[|300]]'],
	['an embed broken by a line ending', '![[cat\n.png]]'],
	['an unterminated embed', '![[cat.png'],
	['an opener the embed after it closes', '![[cat.png and ![[dog.png]]'],
	['bytes a built-in image tail claims', '![[a.png]](u)']
] as const;

for (const [what, raw] of declined) {
	test(`declines ${what}`, () => {
		expect(recognizeWikiImageEmbed(raw, 0, raw.length)).toBeNull();
	});
}

// ── Parsed with the plugin installed ────────────────────────────────────────

test('parses an embed as a built-in image node', async ({ page }) => {
	expect(await inlineNodes(page, '![[cat.png]]')).toEqual([
		{ kind: 'image', start: 0, end: 12, alt: 'cat.png', url: 'cat.png' }
	]);
});

test("carries the size modifier as the node's width", async ({ page }) => {
	expect(await imageNodes(page, '![[cat.png|300]]')).toEqual([
		{ kind: 'image', start: 0, end: 16, alt: 'cat.png', url: 'cat.png', width: 300 }
	]);
});

// The grammars overlap: both of these are legal built-in images whose alt text happens
// to be bracketed. The plugin's rung is consulted first, so a recognizer that failed to
// decline would swallow them — silently, since the bytes still serialize.
test('leaves a bracketed image alt to the built-in scanner', async ({ page }) => {
	expect(await imageNodes(page, '![[a]](u)')).toEqual([
		{ kind: 'image', start: 0, end: 9, alt: '[a]', url: 'u' }
	]);
});

test('leaves one to the built-in scanner even when it names an image', async ({ page }) => {
	expect(await imageNodes(page, '![[a.png]](u)')).toEqual([
		{ kind: 'image', start: 0, end: 13, alt: '[a.png]', url: 'u' }
	]);
});

test('parses a GFM image exactly as it did before', async ({ page }) => {
	expect(await imageNodes(page, '![alt](cat.png)')).toEqual([
		{ kind: 'image', start: 0, end: 15, alt: 'alt', url: 'cat.png' }
	]);
});

test('leaves a non-image target as text', async ({ page }) => {
	expect(await imageNodes(page, '![[notes.md]]')).toEqual([]);
});

// The declining half of this is a recognizer case; what matters to a reader of a note is
// that one unterminated opener does not eat the rest of the paragraph.
test('parses the embed that follows an unterminated opener', async ({ page }) => {
	expect(await imageNodes(page, '![[cat.png and ![[dog.png]]')).toEqual([
		{ kind: 'image', start: 15, end: 27, alt: 'dog.png', url: 'dog.png' }
	]);
});

test('parses every embed in a block over its own bytes', async ({ page }) => {
	expect(await imageNodes(page, '![[a.png]] and ![[b.jpg]]')).toEqual([
		{ kind: 'image', start: 0, end: 10, alt: 'a.png', url: 'a.png' },
		{ kind: 'image', start: 15, end: 25, alt: 'b.jpg', url: 'b.jpg' }
	]);
});

test("counts a heading's marker in the offsets it reports", async ({ page }) => {
	expect(await imageNodes(page, '## Look ![[cat.png]]')).toEqual([
		{ kind: 'image', start: 8, end: 20, alt: 'cat.png', url: 'cat.png' }
	]);
});

test('leaves the inline constructs beside it standing', async ({ page }) => {
	const kinds = (await inlineNodes(page, 'text **bold** ![[cat.png]] more')).map((n) => n.kind);
	expect(kinds).toEqual(['text', 'strong', 'text', 'image', 'text']);
});

// ── Rendered by the editor ──────────────────────────────────────────────────

test("renders an embed through the editor's own image widget", async ({ page }) => {
	await mountEditor(page, 'Here ![[cat.png]] sits.');

	await expect(images(page).locator('img')).toHaveAttribute('src', /#cat\.png$/);
	await expect(images(page)).toHaveAttribute('data-source-start', '5');
	await expect(images(page)).toHaveAttribute('data-source-end', '17');
});

test('leaves an embed inside a code fence as literal text', async ({ page }) => {
	await mountEditor(page, '```\n![[cat.png]]\n```');

	await expect(images(page)).toHaveCount(0);
	await expect(editor(page)).toContainText('![[cat.png]]');
});

// A table cell is the one place the editor renders images as alt text instead of widgets,
// and that fallback reconstructs the source from the alt's LENGTH — which for an embed is
// the wrong text, though never the wrong number of characters. So the bytes are what this
// pins; the display is a recorded delta.
test('keeps an embed in a table cell byte-for-byte', async ({ page }) => {
	const source = '| a |\n| --- |\n| ![[cat.png]] |\n';
	await mountEditor(page, source);

	expect(await editedSource(page)).toBe(source);
	await expect(images(page)).toHaveCount(0);
});

test('keeps the embed bytes through an edit elsewhere', async ({ page }) => {
	await mountEditor(page, 'Notes\n\n![[cat.png]]\n');

	await editor(page).locator('.text-editable-block').first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(' typed');

	await expect.poll(() => editedSource(page)).toContain('Notes typed');
	expect(await editedSource(page)).toContain('![[cat.png]]');
	await expect(images(page)).toHaveCount(1);
});
