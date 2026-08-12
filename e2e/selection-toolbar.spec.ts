import type { Locator, Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: 'Alpha beta gamma.\n' };

const bar = (page: Page) => page.locator('.selection-toolbar');
const lastWrite = async (page: Page) => (await getMockState(page)).writes.at(-1)?.content;

/**
 * Selects the word `beta` by hand. The click only buys focus — where in the word it lands depends
 * on font metrics, so the caret is walked to a known offset from the line start before extending.
 */
async function selectBeta(page: Page) {
	const block = page.locator('.editor .text-editable-block', { hasText: 'Alpha beta gamma.' });
	await block.click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
	for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
}

/** How far the bar floats above a box, in px. Negative means it is drawn below it. */
async function floatAbove(toolbar: Locator, anchor: Locator): Promise<number> {
	const [toolbarBox, anchorBox] = await Promise.all([toolbar.boundingBox(), anchor.boundingBox()]);
	if (!toolbarBox || !anchorBox) throw new Error('toolbar or anchor is not on screen');
	return anchorBox.y - toolbarBox.y;
}

test('a live selection floats the bar over its own line, and collapsing takes it away', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS });
	const block = page.locator('.editor .text-editable-block', { hasText: 'Alpha beta gamma.' });
	await selectBeta(page);

	await expect(bar(page)).toBeVisible();
	// Visibility alone passes a bar pinned to a corner of the window, which is the failure a
	// re-rooted `position: fixed` produces. The gap says it is drawn over the line it belongs to.
	expect(await floatAbove(bar(page), block)).toBeGreaterThan(0);
	expect(await floatAbove(bar(page), block)).toBeLessThan(60);

	await page.keyboard.press('ArrowRight');
	await expect(bar(page)).toHaveCount(0);
});

/** Every wrapping button, beside the bytes its toggle writes around the selected word. */
const TOGGLES = [
	{ label: 'Bold', wrapped: '**beta**' },
	{ label: 'Italic', wrapped: '*beta*' },
	{ label: 'Strikethrough', wrapped: '~~beta~~' },
	{ label: 'Code', wrapped: '`beta`' }
];

// The document is the proof, not the button's own state: a toggle that lights up and writes the
// wrong marker still looks like it worked to anyone reading the bar.
for (const { label, wrapped } of TOGGLES) {
	test(`${label} wraps the selection in the bytes the save writes`, async ({ page }) => {
		await bootApp(page, { docs: DOCS });
		await selectBeta(page);

		await bar(page).locator(`button[aria-label="${label}"]`).click();

		await expect.poll(() => lastWrite(page)).toBe(`Alpha ${wrapped} gamma.\n`);
	});
}

// Link writes nothing on its own: it hands the range to the editor's card, which is where the URL
// comes from. Reaching the card is the whole contract this button owes.
test("Link opens the editor's own link card over the selection", async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const card = page.locator('.md-link-card-anchor');
	await selectBeta(page);

	await bar(page).locator('button[aria-label="Link"]').click();

	await expect(card).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(card).toHaveCount(0);
});

test('source and reading modes never float the bar', async ({ page }) => {
	await bootApp(page, { docs: DOCS });

	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	await selectBeta(page);
	await expect(bar(page)).toHaveCount(0);

	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	await selectBeta(page);
	await expect(bar(page)).toHaveCount(0);
});

// The commands address a cell's own coordinates here, not the highlighted text, so the bar has to
// stay away. A selection endpoint's own flag cannot report this, which is why it is worth a test.
test('a selection inside a table cell floats no bar', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE]: '| Head | Head |\n| --- | --- |\n| one | two |\n' } });
	const cell = page.locator('.editor .table-cell', { hasText: 'one' });
	await cell.click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');

	await expect(bar(page)).toHaveCount(0);
});

// Every format command declines a range that crosses blocks, so a bar there is dead buttons. The
// bar is pinned before the crossing, so the absence cannot pass on a selection that never crossed.
test('a selection across two blocks floats no bar', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE]: 'First para here.\n\nSecond para here.\n' } });
	await page.locator('.editor .text-editable-block', { hasText: 'First para here.' }).click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+ArrowDown');
	await expect(bar(page)).toBeVisible();

	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('Shift+End');

	await expect(bar(page)).toHaveCount(0);
});

// The journal has no mode control, so its entries sit in live mode and stay editable. That makes
// the bar as useful there as anywhere, and the gate is the mode rather than the surface.
test('a journal entry floats the bar like any other live document', async ({ page }) => {
	await bootApp(page, { docs: { 'notes/today.md': 'Alpha beta gamma.\n' }, journal: true });
	await selectBeta(page);

	await expect(bar(page)).toBeVisible();
});
