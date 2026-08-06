import type { Page } from '@playwright/test';
import { bootApp, clickTab, getMockState } from './support/app';
import { expect, test } from './support/test';

const ENTRY_PATH = 'notes/today.md';
const WORD = 'kestrel';
/** Long enough that the page has somewhere to scroll to, with the word near the top. */
const ENTRY = [`A ${WORD} on the wire.`, ...Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`)]
	.join('\n\n')
	.concat('\n');

const findBar = (page: Page) => page.locator('.find-bar-anchor [role="search"]');

/** Opens the journal with the caret in its entry, the way a reader starts writing in one. */
async function openEntry(page: Page) {
	await bootApp(page, { docs: { [ENTRY_PATH]: ENTRY }, journal: true });
	await page.locator('.editor .text-editable-block').first().click();
}

test('Mod+F opens the find bar in the page’s chrome, not in the entry', async ({ page }) => {
	await openEntry(page);

	await page.keyboard.press('Control+f');

	await expect(findBar(page)).toBeVisible();
	await expect(page.locator('.editor [role="search"]')).toHaveCount(0);
});

test('the bar the page holds is the one searching the entry', async ({ page }) => {
	await openEntry(page);
	await page.keyboard.press('Control+f');

	await findBar(page).locator('.search-input').fill(WORD);

	await expect(page.locator('.editor .match-overlay').first()).toBeVisible();
});

test('scrolling the entry leaves the bar where the reader can see it', async ({ page }) => {
	await openEntry(page);
	await page.keyboard.press('Control+f');
	const before = await findBar(page).boundingBox();

	const scrolled = await page.locator('.view-body').evaluate((el) => {
		el.scrollBy({ top: 600 });
		return el.scrollTop;
	});

	expect(scrolled, 'the page had somewhere to scroll to').toBeGreaterThan(0);
	expect(await findBar(page).boundingBox()).toEqual(before);
});

test('Escape closes the bar and hands the caret back to the entry', async ({ page }) => {
	await openEntry(page);
	await page.keyboard.press('End');
	await page.keyboard.press('Control+f');
	await findBar(page).locator('.search-input').fill(WORD);

	await page.keyboard.press('Escape');
	await page.keyboard.type('!');

	await expect(findBar(page)).toHaveCount(0);
	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain(`A ${WORD} on the wire.!`);
});

test('a theme change repaints the bar, which no longer sits inside the editor', async ({
	page
}) => {
	// The bar's colours come from the scope the editor sends along with it, which is what this
	// attribute rides on. Outside the editor there is nothing else to resolve them against.
	const barScope = page.locator('.find-bar-anchor [data-editor-theme]');
	await openEntry(page);
	await page.keyboard.press('Control+f');
	await expect(barScope).toHaveAttribute('data-editor-theme', 'dark');

	await page.keyboard.press('Control+Comma');
	await page.locator('.settings-page .search-input').fill('theme');
	await page.locator('.setting-item', { hasText: 'Theme' }).locator('.select-trigger').click();
	await page.locator('.menu-item', { hasText: 'default-light' }).click();
	await clickTab(page, 'journal');

	await expect(barScope).toHaveAttribute('data-editor-theme', 'light');
});
