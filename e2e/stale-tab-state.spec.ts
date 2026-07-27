import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const LONG = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1} of the note.`).join(
	'\n\n'
);
const DOCS = { [NOTE]: `${LONG}\n` };
/** Two blocks, so a remembered path into the eighth addresses nothing. */
const SHORT = '# Hello\n\nBody text here.\n';

const scrollTop = (page: Page) => page.locator('.editor').evaluate((el) => el.scrollTop);

/** Opens a seeded document with `state` on its tab, the way a restored session hands it over. */
async function openWithTabState(
	page: Page,
	state: Record<string, unknown>,
	docs: Record<string, string> = DOCS
) {
	const boot = await bootApp(page, { docs, tabState: { [NOTE]: state } });
	await expect(page.locator('.editor')).toBeVisible();
	return boot;
}

const lastWrite = async (page: Page) => (await getMockState(page)).writes.at(-1)?.content ?? '';

test('a caret position left by the previous editor is ignored, not restored', async ({ page }) => {
	const boot = await openWithTabState(page, { cursorPos: 4200 });

	// The flat offset means nothing here, so the document opens at the top — typable, as any
	// freshly opened document is.
	expect(await scrollTop(page)).toBe(0);
	await page.keyboard.type('Typed. ');
	await expect.poll(() => lastWrite(page)).toContain('Typed. Paragraph number 1');

	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('a scroll position left by the previous editor is ignored, not reinterpreted', async ({
	page
}) => {
	const boot = await openWithTabState(page, { scrollTop: 900 });

	// That number measured a scroller the document header sat inside, and this editor's scroll
	// positions are counted from where the blocks begin — so honouring it would drop the reader a
	// header's height below where the number meant. The document opens at the top instead.
	expect(await scrollTop(page)).toBe(0);
	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('a remembered caret the document no longer has leaves it typable all the same', async ({
	page
}) => {
	// This editor's own selection format, gone stale: it addresses a block by path, and the file
	// shrank outside the app between sessions — a sync, a pull, another editor. Placing it fails,
	// and a restore that read that as success would leave the reopened document with no caret at
	// all: not in a block, not on the root, dead to the keyboard until the reader clicks.
	const stale = { anchor: { path: [7], offset: 0 }, focus: { path: [7], offset: 0 } };
	const boot = await openWithTabState(page, { selection: stale }, { [NOTE]: SHORT });

	await page.keyboard.type('Typed. ');

	await expect.poll(() => lastWrite(page)).toBe(`Typed. ${SHORT}`);
	expect(
		await page.evaluate(() => !!document.activeElement?.closest('.editor')),
		'something inside the editor holds focus'
	).toBe(true);
	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});
