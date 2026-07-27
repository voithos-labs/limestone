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

test('Mod+E steps through the three modes and comes back round', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();
	await editor.locator('.text-editable-block', { hasText: 'Body text here.' }).click();
	expect(await mode(page)).toBe('preview-inline');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('source');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('preview-inline');
});

test('the step follows the mode the reader is in, however they got there', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	// Reading mode reached by the button, not the chord: the step out of it is the same one
	// either way, where a chord that undid its own last trip would go back to live preview.
	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	expect(await mode(page)).toBe('reading');

	await page.keyboard.press('Control+e');

	expect(await mode(page)).toBe('source');
});

test('a tab keeps its mode over leaving the document, and the cycle goes on from it', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('preview-inline');

	await page.keyboard.press('Control+l');
	await expect(page.locator('.library-page')).toBeVisible();
	await page.locator('.tab', { hasText: 'hello' }).first().click();
	await expect(page.locator('.editor')).toBeVisible();
	expect(await mode(page)).toBe('preview-inline');

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');
});

test('Mod+E keeps the reader where they were reading', async ({ page }) => {
	const long = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1}.`).join('\n\n');
	await bootApp(page, { docs: { [NOTE]: `${long}\n` } });
	const editor = page.locator('.editor');
	await expect(editor).toContainText('Paragraph number 1');

	await editor.locator('.text-editable-block').nth(2).click();
	await editor.evaluate((el) => (el.scrollTop = 900));
	await expect.poll(() => editor.evaluate((el) => el.scrollTop)).toBe(900);

	// Driven by the chord, which is the journal's only mode control and the one route that
	// touches nothing but the mode. Clicking the toggle cannot stand in for it: on a document
	// scrolled this far the toggle is off-screen in the header, so Playwright scrolls it into
	// view before it can click — a reset the app never performed, and the reading that made
	// this look like a defect in the first place.
	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('reading');
	expect(await editor.evaluate((el) => el.scrollTop)).toBe(900);

	await page.keyboard.press('Control+e');
	expect(await mode(page)).toBe('source');
	expect(await editor.evaluate((el) => el.scrollTop)).toBe(900);
});

test('renaming a document does not flip the mode', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const fontSize = () => page.locator('.editor').evaluate((el) => getComputedStyle(el).fontSize);
	await expect.poll(fontSize).toBe('14px');

	await page.locator('.title-input').click();
	await page.keyboard.press('Control+e');
	await page.keyboard.press('Control+Equal');

	expect(await mode(page)).toBe('preview-inline');
	expect(await fontSize()).toBe('14px');
});
