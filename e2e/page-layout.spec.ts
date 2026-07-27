import type { Page } from '@playwright/test';
import { bootApp } from './support/app';
import { expect, test } from './support/test';

const DOCS = { 'notes/hello.md': '# Hello\n\nBody text here.\n' };

/** The block column's width, and how far its centre sits from the editor's. */
async function columnOf(page: Page): Promise<{ width: number; centerOffset: number }> {
	return page.locator('.editor > .block-list').evaluate((list) => {
		const editor = list.parentElement!.getBoundingClientRect();
		const box = list.getBoundingClientRect();
		return {
			width: box.width,
			centerOffset: (box.left + box.right) / 2 - (editor.left + editor.right) / 2
		};
	});
}

/** Where the document's text column ends, and where the mode toggle's last button does. */
async function rightEdges(page: Page): Promise<{ block: number; toggle: number }> {
	const right = async (selector: string) => {
		const box = await page.locator(selector).last().boundingBox();
		if (!box) throw new Error(`${selector} has no box`);
		return box.x + box.width;
	};
	return {
		block: await right('.editor > .block-list > *'),
		toggle: await right('.mode-toggle button')
	};
}

const fontToken = (page: Page) =>
	page
		.locator('.editor')
		.evaluate((el) => getComputedStyle(el).getPropertyValue('--editor-font-size').trim());

/** Sets the app's page width from settings, the way a reader would, and returns to the document. */
async function setPageWidth(page: Page, px: number) {
	await page.keyboard.press('Control+Comma');
	await page.locator('.settings-page .search-input').fill('page width');
	await page.locator('.setting-item', { hasText: 'Max Page Width' }).locator('input').fill(`${px}`);
	await page.keyboard.press('Enter');
	await page.locator('.tab', { hasText: 'hello' }).first().click();
	await expect(page.locator('.editor')).toBeVisible();
}

test('the document sits in the app’s page column, at the app’s width', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor > .block-list')).toBeVisible();

	const seeded = await columnOf(page);
	expect(seeded.width).toBe(1000);
	expect(Math.abs(seeded.centerOffset)).toBeLessThanOrEqual(1);

	await setPageWidth(page, 700);

	const narrowed = await columnOf(page);
	expect(narrowed.width).toBe(700);
	expect(Math.abs(narrowed.centerOffset)).toBeLessThanOrEqual(1);
});

test('the mode toggle ends where the document does', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.mode-toggle button').last()).toBeVisible();

	const seeded = await rightEdges(page);
	expect(seeded.toggle).toBeCloseTo(seeded.block, 0);

	// The column is the app's, not a number of the toggle's own: narrowing the page brings
	// the toggle in with the text.
	await setPageWidth(page, 700);

	const narrowed = await rightEdges(page);
	expect(narrowed.block).toBeLessThan(seeded.block);
	expect(narrowed.toggle).toBeCloseTo(narrowed.block, 0);
});

test('zooming scales the document’s own text, with no click to wake it', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const paragraph = page.locator('.editor .text-editable-block', { hasText: 'Body text here.' });
	// Nobody clicks first: opening the document places the caret in its first block, and the chord
	// is handled on the wrapper around the editor, so it is only ever seen while focus is inside
	// one. Waited for rather than assumed — the placement is asynchronous, and a chord pressed
	// before it lands would be a race rather than the scenario.
	await expect(page.locator('.editor .text-editable-block').first()).toBeFocused();
	// The reader's own font size, read from settings — and not the adapter's hardcoded fallback,
	// which is a different number on purpose, so this assertion can tell the two apart.
	await expect.poll(() => fontToken(page)).toBe('14px');

	await page.keyboard.press('Control+Equal');
	await page.keyboard.press('Control+Equal');

	expect(await fontToken(page)).toBe('16px');
	await expect.poll(() => paragraph.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');

	await page.keyboard.press('Control+Minus');
	await expect.poll(() => paragraph.evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px');
});
