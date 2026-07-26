import type { Page } from '@playwright/test';
import { scanWikiEmbeds } from '../src/components/editor/wiki-embed-scan';
import { bootApp } from './support/app';
import { expect, test } from './support/test';

// Vite serves and transforms this path; a string keeps the harness (and aragonite's
// types) out of the e2e type-check program, which knows neither Svelte nor the alias.
const HARNESS_URL = '/src/components/editor/wiki-embed-harness.ts';

interface HarnessOptions {
	source: string;
	resolvable?: string[];
}

/** Boots the app, then mounts a bare editor on the page for the plugin to decorate. */
async function mountEditor(page: Page, options: HarnessOptions): Promise<string[]> {
	const warnings: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'warning') warnings.push(message.text());
	});
	await bootApp(page);
	await page.evaluate(
		async ({ url, options }) => {
			const harness = await import(url);
			harness.mountHarnessEditor(options);
		},
		{ url: HARNESS_URL, options }
	);
	await expect(page.locator('#wiki-embed-harness .editor')).toBeVisible();
	return warnings;
}

const embeds = (page: Page) => page.locator('#wiki-embed-harness .ls-wiki-embed');
const editor = (page: Page) => page.locator('#wiki-embed-harness .editor');
const blocks = (page: Page) => editor(page).locator('.text-editable-block');

/**
 * A block's text exactly as rendered — an assertion the editor's own chrome cannot pad,
 * and which `toHaveText` would whitespace-normalize past.
 */
function blockText(page: Page, index = 0): Promise<string> {
	return blocks(page)
		.nth(index)
		.evaluate((el) => el.textContent ?? '');
}

function editedSource(page: Page): Promise<string> {
	return page.evaluate(() => (window as unknown as HarnessWindow).__wikiEmbedSource());
}

interface HarnessWindow {
	__wikiEmbedSource(): string;
}

// ── The recognizer ──────────────────────────────────────────────────────────

test('claims an embed with its target and size modifier', () => {
	expect(scanWikiEmbeds('a ![[cat.png|300]] b')).toEqual([
		{ start: 2, end: 18, target: 'cat.png', width: 300 }
	]);
});

test('claims every embed in a block, each over its own bytes', () => {
	expect(scanWikiEmbeds('![[a.png]] and ![[b.jpg]]')).toEqual([
		{ start: 0, end: 10, target: 'a.png' },
		{ start: 15, end: 25, target: 'b.jpg' }
	]);
});

test('ignores a size modifier that is not a pixel width', () => {
	expect(scanWikiEmbeds('![[cat.png|abc]]')).toEqual([{ start: 0, end: 16, target: 'cat.png' }]);
});

const declined = [
	['a target with no image extension', '![[notes.md]]'],
	['an empty target', '![[]]'],
	['a size modifier with no target', '![[|300]]'],
	['an embed broken by a line ending', '![[cat\n.png]]'],
	['an unterminated embed', 'text ![[cat.png']
] as const;

for (const [what, raw] of declined) {
	test(`leaves ${what} as literal text`, () => {
		expect(scanWikiEmbeds(raw)).toEqual([]);
	});
}

test('lets a nested opener win over the unterminated one before it', () => {
	expect(scanWikiEmbeds('![[cat.png and ![[dog.png]]')).toEqual([
		{ start: 15, end: 27, target: 'dog.png' }
	]);
});

// ── The rendered decoration ─────────────────────────────────────────────────

test('renders an embed as an image resolved by the host', async ({ page }) => {
	await mountEditor(page, { source: 'Here ![[cat.png]] sits.', resolvable: ['cat.png'] });

	await expect(embeds(page).locator('img')).toHaveAttribute('src', /#cat\.png$/);
	expect(await blockText(page)).toBe('Here  sits.');
});

test('renders the size modifier as the image width', async ({ page }) => {
	await mountEditor(page, { source: '![[cat.png|300]]', resolvable: ['cat.png'] });

	await expect(embeds(page).locator('img')).toHaveAttribute('width', '300');
});

test('covers the embed bytes a heading marker has already shifted', async ({ page }) => {
	await mountEditor(page, { source: '## Look ![[cat.png]]', resolvable: ['cat.png'] });

	// The island's span is the offsets the recognizer reported. `## ` counts: these are
	// offsets into the block's own source, markers and all.
	await expect(embeds(page)).toHaveAttribute('data-source-start', '8');
	await expect(embeds(page)).toHaveAttribute('data-source-end', '20');
	expect(await blockText(page)).toBe('## Look ');
});

test('leaves a target the host declines as literal text', async ({ page }) => {
	await mountEditor(page, { source: 'Here ![[cat.png]] sits.', resolvable: [] });

	await expect(embeds(page)).toHaveCount(0);
	expect(await blockText(page)).toBe('Here ![[cat.png]] sits.');
});

test('leaves an embed inside a code fence as literal text', async ({ page }) => {
	await mountEditor(page, {
		source: '```\n![[cat.png]]\n```',
		resolvable: ['cat.png']
	});

	await expect(embeds(page)).toHaveCount(0);
	await expect(editor(page)).toContainText('![[cat.png]]');
});

test('leaves the inline constructs beside it standing', async ({ page }) => {
	await mountEditor(page, { source: 'text **bold** ![[cat.png]] more', resolvable: ['cat.png'] });

	await expect(blocks(page).locator('strong')).toHaveText('bold');
	expect(await blockText(page)).toBe('text **bold**  more');
});

test('follows the embed when an edit before it moves the bytes', async ({ page }) => {
	await mountEditor(page, { source: 'ab ![[cat.png]]', resolvable: ['cat.png'] });

	await blocks(page).first().click();
	await page.keyboard.press('Home');
	await page.keyboard.type('X');

	await expect.poll(() => editedSource(page)).toContain('Xab ![[cat.png]]');
	await expect(embeds(page)).toHaveAttribute('data-source-start', '4');
});

test("claims none of a GFM image's bytes", async ({ page }) => {
	await mountEditor(page, { source: '![alt](cat.png)', resolvable: ['cat.png'] });

	await expect(embeds(page)).toHaveCount(0);
	await expect(page.locator('#wiki-embed-harness .md-image-widget')).toHaveCount(1);
});

test('keeps the embed bytes through an edit elsewhere', async ({ page }) => {
	const warnings = await mountEditor(page, {
		source: 'Notes\n\n![[cat.png]]\n',
		resolvable: ['cat.png']
	});

	await blocks(page).first().click();
	await page.keyboard.press('End');
	await page.keyboard.type(' typed');

	await expect.poll(() => editedSource(page)).toContain('Notes typed');
	expect(await editedSource(page)).toContain('![[cat.png]]');
	// The editor complains here when an island's span is not the bytes it displaced.
	expect(warnings.filter((warning) => warning.includes('decoration'))).toEqual([]);
	await expect(embeds(page)).toHaveCount(1);
});
