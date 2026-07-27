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
