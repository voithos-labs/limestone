import type { Locator, Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: 'Alpha beta gamma.\n' };

const bar = (page: Page) => page.locator('.selection-toolbar');

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

test('a live selection floats the bar, and Bold wraps the selected bytes', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const block = page.locator('.editor .text-editable-block', { hasText: 'Alpha beta gamma.' });
	await selectBeta(page);
	await expect(bar(page)).toBeVisible();
	// Visibility alone passes a bar pinned to a corner of the window, which is the failure a
	// re-rooted `position: fixed` produces. The gap says it is drawn over the line it belongs to.
	expect(await floatAbove(bar(page), block)).toBeGreaterThan(0);
	expect(await floatAbove(bar(page), block)).toBeLessThan(60);

	await bar(page).locator('button[aria-label="Bold"]').click();
	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content)
		.toContain('**beta**');

	await page.keyboard.press('ArrowRight');
	await expect(bar(page)).toHaveCount(0);
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

/**
 * The same two-paragraph range, selected from each end. Two arrow presses are what it takes to
 * leave the first paragraph: the first only reaches that paragraph's own far edge.
 */
const DIRECTIONS = [
	{
		name: 'forward',
		from: 'First para here.',
		keys: ['Home', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+End']
	},
	{
		name: 'backward',
		from: 'Second para here.',
		keys: ['End', 'Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+Home']
	}
] as const;

// Dragged backwards, the end the reader finished on is the earlier one. Only that direction can
// tell a bar that reads document order from one that takes whichever end it was handed first.
for (const { name, from, keys } of DIRECTIONS) {
	test(`a ${name} cross-block selection anchors the bar to the first block`, async ({ page }) => {
		await bootApp(page, { docs: { [NOTE]: 'First para here.\n\nSecond para here.\n' } });
		const first = page.locator('.editor .text-editable-block', { hasText: 'First para here.' });
		await page.locator('.editor .text-editable-block', { hasText: from }).click();
		for (const key of keys) await page.keyboard.press(key);

		await expect(bar(page)).toBeVisible();
		// Anchored to the second paragraph instead, the bar sits a whole block lower and drops out
		// of this bracket.
		const gap = await floatAbove(bar(page), first);
		expect(gap).toBeGreaterThan(20);
		expect(gap).toBeLessThan(60);
	});
}

// The journal has no mode control, so its entries sit in live mode and stay editable. That makes
// the bar as useful there as anywhere, and the gate is the mode rather than the surface.
test('a journal entry floats the bar like any other live document', async ({ page }) => {
	await bootApp(page, { docs: { 'notes/today.md': 'Alpha beta gamma.\n' }, journal: true });
	await selectBeta(page);

	await expect(bar(page)).toBeVisible();
});
