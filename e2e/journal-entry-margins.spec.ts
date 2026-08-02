import type { Locator, Page } from '@playwright/test';
import { bootApp } from './support/app';
import { expect, test } from './support/test';

const ENTRY_PATH = 'notes/today.md';
const LINES = ['First line.', 'Second line.', 'Third line.'];
/** Short enough that the page runs on below the entry, which one of these clicks needs. */
const ENTRY = LINES.join('\n\n').concat('\n');

/** Half the blank strip the document keeps between its text and the edge of the page. */
const HALF_STRIP = 12;

/** Opens the journal with its entry on screen, the way a reader arrives at the day. */
async function openEntry(page: Page) {
	await bootApp(page, { docs: { [ENTRY_PATH]: ENTRY }, journal: true });
	await expect(page.locator('.editor .text-editable-block').first()).toBeVisible();
}

const lineOf = (page: Page, text: string) =>
	page.locator('.editor .text-editable-block', { hasText: text });

async function boxOf(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error('element has no box on screen');
	return box;
}

/**
 * Clicks the blank strip beside a line, halfway across it. Aimed off the text rather than off any
 * one element: which element owns the strip is exactly what the reader cannot see.
 */
async function clickStripBeside(page: Page, text: string, side: 'left' | 'right') {
	const line = await boxOf(lineOf(page, text));
	const x = side === 'left' ? line.x - HALF_STRIP : line.x + line.width + HALF_STRIP;
	await page.mouse.click(x, line.y + line.height / 2);
}

test('a click in the strip left of a line starts writing at that line', async ({ page }) => {
	await openEntry(page);

	await clickStripBeside(page, 'Second line.', 'left');
	await page.keyboard.type('X');

	await expect(lineOf(page, 'Second line.')).toHaveText('XSecond line.');
});

test('a click in the strip right of a line carries on from its end', async ({ page }) => {
	await openEntry(page);

	await clickStripBeside(page, 'Second line.', 'right');
	await page.keyboard.type('X');

	await expect(lineOf(page, 'Second line.')).toHaveText('Second line.X');
});

test('a click in the strip drops a selection that ran across blocks', async ({ page }) => {
	await openEntry(page);
	const editor = page.locator('.editor');
	await lineOf(page, 'First line.').click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('Shift+ArrowDown');
	await expect(editor).toHaveAttribute('data-cross-block', '');

	await clickStripBeside(page, 'Second line.', 'left');

	await expect(editor).not.toHaveAttribute('data-cross-block', '');
	await expect(lineOf(page, 'Second line.')).toBeFocused();
});

test('a click below the entry carries on from the end of the document', async ({ page }) => {
	await openEntry(page);
	const editor = await boxOf(page.locator('.editor'));
	const face = await boxOf(page.locator('.doc-face'));
	const lastLine = await boxOf(lineOf(page, 'Third line.'));
	const belowEntry = editor.y + editor.height + 20;
	expect(belowEntry, 'the page runs on below the entry').toBeLessThan(face.y + face.height);

	await page.mouse.click(lastLine.x + 40, belowEntry);
	await page.keyboard.type('X');

	await expect(lineOf(page, 'Third line.')).toHaveText('Third line.X');
});

test('the title and the entry’s first line share a left edge', async ({ page }) => {
	await openEntry(page);

	const title = await boxOf(page.locator('.doc-hero .title-input'));
	const firstLine = await boxOf(lineOf(page, 'First line.'));

	expect(title.x).toBeCloseTo(firstLine.x, 0);
});
