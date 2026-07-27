import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: 'First.\n\nSecond.\n' };

/** The body the editor last wrote, waited out past the save debounce. */
async function lastWrite(page: Page): Promise<string> {
	return (await getMockState(page)).writes.at(-1)?.content ?? '';
}

test('hovering a block offers no grip to drag it by', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();

	await editor.locator('.text-editable-block', { hasText: 'Second.' }).hover();

	// Counted, not looked at: the editor's grip is transparent until its block is hovered, so a
	// visibility assertion passes just as well with the handles switched on.
	await expect(editor.locator('.block-drag-handle')).toHaveCount(0);
});

test('Alt+Arrow moves the block the caret is in', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block', { hasText: 'Second.' }).click();

	await page.keyboard.press('Alt+ArrowUp');

	await expect.poll(() => lastWrite(page)).toBe('Second.\n\nFirst.\n');
});
