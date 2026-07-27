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
	expect(seeded.width).toBe(900);
	expect(Math.abs(seeded.centerOffset)).toBeLessThanOrEqual(1);

	await setPageWidth(page, 700);

	const narrowed = await columnOf(page);
	expect(narrowed.width).toBe(700);
	expect(Math.abs(narrowed.centerOffset)).toBeLessThanOrEqual(1);
});

test('zooming scales the document’s own text', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const paragraph = page.locator('.editor .text-editable-block', { hasText: 'Body text here.' });
	await paragraph.click();

	await page.keyboard.press('Control+Equal');
	await page.keyboard.press('Control+Equal');

	expect(await fontToken(page)).toBe('18px');
	await expect.poll(() => paragraph.evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');

	await page.keyboard.press('Control+Minus');
	await expect.poll(() => paragraph.evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px');
});
