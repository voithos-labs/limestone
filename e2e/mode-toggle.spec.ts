import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: '# Hello\n\nBody text here.\n' };

/** Source mode is reported by the attribute's absence, every other mode by its value. */
async function mode(page: Page): Promise<string> {
	return (await page.locator('.editor').getAttribute('data-presentation')) ?? 'source';
}

/** The whole appearance branch, since seeding one key replaces the group. */
const opensIn = (value: string) => ({
	appearance: { default_editor_mode: value, editor_font_size: 16, max_page_width: 900 }
});

test('a document opens in live preview, showing markers only under the caret', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();
	expect(await mode(page)).toBe('preview-inline');

	// Rendered text throughout, not the DOM's: a collapsed marker is still in `textContent`.
	// Opening places the caret in the first block, and live preview reveals the block it is in.
	await expect(editor).toContainText('# Hello', { useInnerText: true });

	await editor.locator('.text-editable-block', { hasText: 'Body text here.' }).click();

	await expect(editor).not.toContainText('# Hello', { useInnerText: true });
	await expect(editor).toContainText('Hello', { useInnerText: true });
});

test('source mode shows the markers the document is written with', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();

	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();

	await expect(page.locator('.editor')).toContainText('# Hello', { useInnerText: true });
});

test('reading mode hides the markers and takes no typing', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await editor.locator('.text-editable-block', { hasText: 'Body text here.' }).click();

	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	await page.keyboard.type('Not here.');

	await expect(editor).not.toContainText('Not here.');
	await expect(editor).not.toContainText('# Hello', { useInnerText: true });
	expect((await getMockState(page)).writes).toEqual([]);
});

test('a fresh document opens in the mode the reader set as their default', async ({ page }) => {
	await bootApp(page, { docs: DOCS, settings: opensIn('source') });
	await expect(page.locator('.editor')).toBeVisible();

	await expect.poll(() => mode(page)).toBe('source');
	await expect(page.locator('.editor')).toContainText('# Hello', { useInnerText: true });
});

test('a tab that remembers a mode keeps it over the setting', async ({ page }) => {
	await bootApp(page, {
		docs: DOCS,
		settings: opensIn('source'),
		tabState: { [NOTE]: { presentationMode: 'reading' } }
	});
	await expect(page.locator('.editor')).toBeVisible();

	expect(await mode(page)).toBe('reading');
});

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
