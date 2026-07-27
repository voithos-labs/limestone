import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE_PATH = 'notes/hello.md';
const BODY = 'Body text here.';
const DOCS = { [NOTE_PATH]: `${BODY}\n` };

/** A shortcuts setting the reader recorded, replacing the default keys for that action. */
const SETTINGS_ON_MOD_B = { shortcuts: { 'nav.settings': ['mod+b'] } };

/** The body the editor last wrote, waited out past the save debounce. */
async function lastWrite(page: Page): Promise<string> {
	return (await getMockState(page)).writes.at(-1)?.content ?? '';
}

/** Opens the seeded document with its one line selected, the way a reader would select it. */
async function selectTheLine(page: Page, opts: Parameters<typeof bootApp>[1] = {}) {
	await bootApp(page, { docs: DOCS, ...opts });
	const block = page.locator('.editor .text-editable-block', { hasText: BODY });
	await block.click();
	await page.keyboard.press('End');
	await page.keyboard.press('Shift+Home');
}

test('Mod+B reaches the editor and bolds the selection', async ({ page }) => {
	await selectTheLine(page);

	await page.keyboard.press('Control+b');

	await expect.poll(() => lastWrite(page)).toBe(`**${BODY}**\n`);
});

test('Mod+I italicizes instead of opening settings', async ({ page }) => {
	await selectTheLine(page);

	await page.keyboard.press('Control+i');

	await expect.poll(() => lastWrite(page)).toBe(`*${BODY}*\n`);
	await expect(page.locator('.settings-page')).toHaveCount(0);
});

test('Mod+, opens settings from a focused document', async ({ page }) => {
	await selectTheLine(page);

	await page.keyboard.press('Control+Comma');

	await expect(page.locator('.settings-page')).toBeVisible();
});

test('Mod+F opens the find bar with the caret in a block', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block', { hasText: BODY }).click();

	await page.keyboard.press('Control+f');

	await expect(page.locator('.editor [role="search"]')).toBeVisible();
});

test('Mod+W still closes the tab while typing', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block', { hasText: BODY }).click();
	await page.keyboard.type(' Mid-sentence.');

	await page.keyboard.press('Control+w');

	await expect(page.locator('.library-page')).toBeVisible();
	await expect(page.locator('.editor')).toHaveCount(0);
});

test('a shortcut rebound onto Mod+B loses to the editor while typing', async ({ page }) => {
	await selectTheLine(page, { settings: SETTINGS_ON_MOD_B });

	await page.keyboard.press('Control+b');

	await expect.poll(() => lastWrite(page)).toBe(`**${BODY}**\n`);
	await expect(page.locator('.settings-page')).toHaveCount(0);
});

test('the same rebinding fires while renaming, which is not editing the document', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS, settings: SETTINGS_ON_MOD_B });
	await page.locator('.title-input').click();

	await page.keyboard.press('Control+b');

	await expect(page.locator('.settings-page')).toBeVisible();
});

test('the same rebinding fires from the library, in a field of the app’s own', async ({ page }) => {
	await bootApp(page, { settings: SETTINGS_ON_MOD_B });
	await expect(page.locator('.library-page')).toBeVisible();
	// The precondition this scenario turns on, asserted rather than assumed: quick search takes
	// focus on open, so the chord is pressed in a text field — the case a guard written against
	// `inEditable` would swallow. Were focus to land nowhere, the scenario would still pass and
	// would stop discriminating that.
	await expect(page.locator('.quick-search-input')).toBeFocused();

	await page.keyboard.press('Control+b');

	await expect(page.locator('.settings-page')).toBeVisible();
});

/**
 * A first paragraph that wraps over several lines, then enough short ones to make the editor
 * overflow. The wrap is what matters: an ArrowDown that crosses into the next block is the
 * editor's own, prevented before the window's fallback ever sees it, so only a caret moving
 * WITHIN a block leaves the fallback free to claim the key and page the document instead.
 */
const WRAPPED_DOC =
	`${'A paragraph long enough to wrap over several lines of the page. '.repeat(6)}\n\n` +
	Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n\n');

test('ArrowDown inside a paragraph moves the caret without paging the document', async ({
	page
}) => {
	await bootApp(page, { docs: { [NOTE_PATH]: `${WRAPPED_DOC}\n` } });
	const editor = page.locator('.editor');
	await editor.locator('.text-editable-block').first().click();
	await page.keyboard.press('Home');

	await page.keyboard.press('ArrowDown');

	expect(await editor.evaluate((el) => el.scrollTop)).toBe(0);
});
