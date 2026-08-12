import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: 'Alpha.\n' };

const lastWrite = async (page: Page) => (await getMockState(page)).writes.at(-1)?.content;

/** Puts the caret at the end of the one paragraph, the way a reader about to insert would. */
async function caretAtEnd(page: Page) {
	await page.locator('.editor .text-editable-block', { hasText: 'Alpha.' }).click();
	await page.keyboard.press('End');
}

async function insert(page: Page, label: string) {
	await page.locator('.insert-menu-button').click();
	await page.locator('.ctx-menu .ctx-item', { hasText: label }).click();
}

test('the + menu inserts a table at the caret as one undo step', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await caretAtEnd(page);

	await insert(page, 'Table');

	await expect(editor.locator('.table-block').first()).toBeVisible();
	// Waited out, not raced: an undo inside the save debounce leaves the file untouched, and the
	// restoration worth pinning is the one that reaches disk.
	await expect
		.poll(() => lastWrite(page))
		.toBe('Alpha.\n\n| Column | Column |\n| --- | --- |\n|  |  |\n');

	await page.keyboard.press('Control+z');

	await expect(editor.locator('.table-block')).toHaveCount(0);
	await expect.poll(() => lastWrite(page)).toBe('Alpha.\n');
});

// Details is the one entry written as HTML rather than a fence or a directive, so it is the one
// whose snippet could parse into a lookalike box instead of the kind the editor registered.
test('the details entry inserts the disclosure the editor parses', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await caretAtEnd(page);

	await insert(page, 'Details');

	await expect(page.locator('.editor .details-block')).toBeVisible();
});

test('source and reading modes carry no insert menu', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.insert-menu-button')).toBeVisible();

	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	await expect(page.locator('.insert-menu-button')).toHaveCount(0);

	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	await expect(page.locator('.insert-menu-button')).toHaveCount(0);
});
