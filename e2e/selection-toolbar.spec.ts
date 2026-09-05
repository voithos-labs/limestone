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

const TABLE = '| Head | Head |\n| --- | --- |\n| one | two |\n';

// A selection spanning cells addresses the cells' own coordinates, not the highlighted text, so the
// bar has to stay away. A selection endpoint's own flag cannot report this; the block's kind can.
test('a selection spanning table cells floats no bar', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE]: TABLE } });
	await page.locator('.editor .table-cell', { hasText: 'one' }).click();
	// The second Mod+A widens the cell's text selection to the whole table.
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Control+a');

	await expect(bar(page)).toHaveCount(0);
});

// Text inside one cell is ordinary prose to the format commands, so the bar is as useful there as
// in a paragraph.
test('a selection of text inside one cell floats the bar, and Bold wraps that text', async ({
	page
}) => {
	await bootApp(page, { docs: { [NOTE]: TABLE } });
	await page.locator('.editor .table-cell', { hasText: 'one' }).click();
	await page.keyboard.press('Home');
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await expect(bar(page)).toBeVisible();

	await bar(page).locator('button[aria-label="Bold"]').click();

	await expect
		.poll(() => lastWrite(page))
		.toBe('| Head | Head |\n| --- | --- |\n| **one** | two |\n');
});

// A format toggle over a range that crosses blocks marks every block it touches, so the bar stays
// up there. The link card cannot span blocks, and that button alone goes grey rather than dead.
test('a selection across two blocks keeps the bar, greys Link, and Bold wraps both blocks', async ({
	page
}) => {
	await bootApp(page, { docs: { [NOTE]: 'First para here.\n\nSecond para here.\n' } });
	await page.locator('.editor .text-editable-block', { hasText: 'First para here.' }).click();
	await page.keyboard.press('Home');
	// The editor's own extend-to-document-end chord; a plain Shift+End stops at the block edge.
	await page.keyboard.press('Control+Shift+End');

	await expect(bar(page)).toBeVisible();
	await expect(bar(page).locator('button[aria-label="Link"]')).toBeDisabled();
	await expect(bar(page).locator('button[aria-label="Bold"]')).toBeEnabled();

	await bar(page).locator('button[aria-label="Bold"]').click();

	await expect.poll(() => lastWrite(page)).toBe('**First para here.**\n\n**Second para here.**\n');
});

// The pressed paint reads the same bytes the toggle rewrites, so a selection already inside a bold
// run shows Bold down, and the press then lifts the word out of the run rather than nesting a pair.
test('a selection inside bold shows Bold pressed, and pressing it unwraps', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE]: '**Alpha beta gamma.**\n' } });
	await selectBeta(page);

	const bold = bar(page).locator('button[aria-label="Bold"]');
	await expect(bold).toHaveAttribute('aria-pressed', 'true');
	await expect(bar(page).locator('button[aria-label="Italic"]')).toHaveAttribute(
		'aria-pressed',
		'false'
	);

	await bold.click();

	await expect.poll(() => lastWrite(page)).toBe('**Alpha** beta **gamma.**\n');
});

// The journal has no mode control, so its entries sit in live mode and stay editable. That makes
// the bar as useful there as anywhere, and the gate is the mode rather than the surface.
test('a journal entry floats the bar like any other live document', async ({ page }) => {
	await bootApp(page, { docs: { 'notes/today.md': 'Alpha beta gamma.\n' }, journal: true });
	await selectBeta(page);

	await expect(bar(page)).toBeVisible();
});
