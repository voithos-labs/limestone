import { bootApp } from './support/app';
import { expect, test } from './support/test';

const DOCS = { 'notes/hello.md': '# Hello\n\nBody text here.\n' };

/** Source mode is reported by the attribute's absence, every other mode by its value. */
async function mode(page: import('@playwright/test').Page): Promise<string> {
	return (await page.locator('.editor').getAttribute('data-presentation')) ?? 'source';
}

test('Mod+E round-trips into reading mode and back', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();
	await editor.locator('.text-editable-block', { hasText: 'Body text here.' }).click();
	expect(await mode(page)).toBe('preview-inline');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('preview-inline');
});

test('Mod+E returns to the editing mode the reader was in', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();
	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	expect(await mode(page)).toBe('source');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('source');
});

test('the mode Mod+E returns to survives leaving the document and coming back', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+l');
	await expect(page.locator('.library-page')).toBeVisible();
	await page.locator('.tab', { hasText: 'hello' }).first().click();
	await expect(page.locator('.editor')).toBeVisible();
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('source');
});

test('entering reading mode from the toggle is remembered too', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();

	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('source');
});

test('renaming a document does not flip the mode', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();

	await page.locator('.title-input').click();
	await page.keyboard.press('Control+e');
	await page.keyboard.press('Control+Equal');

	expect(await mode(page)).toBe('preview-inline');
	expect(await page.locator('.editor').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
		'16px'
	);
});
