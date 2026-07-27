import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const LONG = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1} of the note.`).join(
	'\n\n'
);
const DOCS = { [NOTE]: `${LONG}\n` };

const scrollTop = (page: Page) => page.locator('.editor').evaluate((el) => el.scrollTop);

/** Opens the seeded document with `state` on its tab, as an upgraded install would restore it. */
async function openWithTabState(page: Page, state: Record<string, unknown>) {
	const boot = await bootApp(page, { docs: DOCS, tabState: { [NOTE]: state } });
	await expect(page.locator('.editor')).toBeVisible();
	return boot;
}

test('a caret position left by the previous editor is ignored, not restored', async ({ page }) => {
	const boot = await openWithTabState(page, { cursorPos: 4200 });

	// The flat offset means nothing here, so the document opens at the top — typable, as any
	// freshly opened document is.
	expect(await scrollTop(page)).toBe(0);
	await page.keyboard.type('Typed. ');
	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain('Typed. Paragraph number 1');

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
