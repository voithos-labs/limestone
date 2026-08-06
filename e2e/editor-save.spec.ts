import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE_PATH = 'notes/hello.md';
const MASK = 'updated_at: <stamped>';

/** The body the editor last wrote, waited out past the save debounce. */
async function lastWrite(page: Page): Promise<string> {
	return (await getMockState(page)).writes.at(-1)?.content ?? '';
}

/** Asks the window to close, as the title bar's button and the OS both do. */
async function requestClose(page: Page) {
	await page.evaluate(() =>
		(
			window as unknown as {
				__TAURI_INTERNALS__: { invoke(cmd: string, args: unknown): Promise<unknown> };
			}
		).__TAURI_INTERNALS__.invoke('plugin:event|emit', {
			event: 'tauri://close-requested',
			payload: {}
		})
	);
}

test('typing into a freshly opened document needs no click first', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: '# Hello\n\nBody text here.\n' } });
	await expect(page.locator('.editor')).toBeVisible();

	await page.keyboard.type('Typed blind. ');

	// The caret lands at the very start of the first block, markers included.
	await expect.poll(() => lastWrite(page)).toBe('Typed blind. # Hello\n\nBody text here.\n');
});

test('an empty document is typable on open', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: '' } });
	await expect(page.locator('.editor')).toBeVisible();

	await page.keyboard.type('First words.');

	await expect.poll(() => lastWrite(page)).toContain('First words.');
});

test('a burst of typing settles on one document, not one save per key', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: 'Body text here.\n' } });
	const typed = 'Every one of these keystrokes.';
	await page.locator('.editor .text-editable-block').click();
	await page.keyboard.press('End');

	await page.keyboard.type(typed);

	await expect.poll(() => lastWrite(page)).toBe(`Body text here.${typed}\n`);
	// The editor commits its first character at once and the rest on a debounce of its own, so a
	// burst crosses more than one save window — but nothing near one per key.
	const { writes } = await getMockState(page);
	expect(writes.length).toBeGreaterThan(0);
	expect(writes.length).toBeLessThan(typed.length / 4);
});

test('closing the window writes the edit no save window has reached yet', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: 'Body text here.\n' } });
	await page.locator('.editor .text-editable-block').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Unsaved.');

	await requestClose(page);

	// The window is destroyed only once the flush has resolved, so reading the tally the moment
	// it is destroyed is what tells a flushed edit from one a debounce got to anyway.
	await expect
		.poll(async () => (await getMockState(page)).calls)
		.toContain('plugin:window|destroy');
	const { writes, calls } = await getMockState(page);
	expect(writes.at(-1)?.content).toBe('Body text here. Unsaved.\n');
	expect(calls.lastIndexOf('write_document')).toBeLessThan(calls.indexOf('plugin:window|destroy'));
});

test('closing a window nobody typed in writes nothing', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: 'Body text here.\n' } });
	await expect(page.locator('.editor')).toBeVisible();

	await requestClose(page);

	await expect
		.poll(async () => (await getMockState(page)).calls)
		.toContain('plugin:window|destroy');
	expect((await getMockState(page)).writes).toEqual([]);
});

test('closing the tab writes the edit too, on the way out', async ({ page }) => {
	const boot = await bootApp(page, { docs: { [NOTE_PATH]: 'Body text here.\n' } });
	await page.locator('.editor .text-editable-block').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Unsaved.');

	// The other way an edit is stranded mid-debounce — and the one that reads the editor while
	// it is being torn down, with nothing left afterwards to save from.
	await page.keyboard.press('Control+w');
	await expect(page.locator('.library-page')).toBeVisible();

	expect((await getMockState(page)).writes.at(-1)?.content).toBe('Body text here. Unsaved.\n');
	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('deleting a document nobody saved yet does not write it back', async ({ page }) => {
	const boot = await bootApp(page, { docs: { [NOTE_PATH]: 'Body text here.\n' } });
	await page.locator('.editor .text-editable-block').click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Doomed.');

	// Deleting closes the tab, and the teardown that follows is a flush like any other — the one
	// that must not put the file back.
	await page.locator('.kebab').click();
	await page.locator('.menu-item', { hasText: 'Delete' }).click();
	await page.locator('.menu-item', { hasText: 'Confirm delete' }).click();
	await expect(page.locator('.library-page')).toBeVisible();

	const { calls, writes } = await getMockState(page);
	expect(calls).toContain('delete_document');
	expect(calls.lastIndexOf('write_document')).toBeLessThan(calls.indexOf('delete_document'));
	expect(writes.at(-1)?.content ?? '').not.toContain('Doomed.');
	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('a save keeps the document frontmatter it never edited', async ({ page }) => {
	const seeded = `---\nid: ${NOTE_PATH}\ntags: []\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\nstatus: draft\n---\nBody text here.\n`;
	await bootApp(page, { docs: { [NOTE_PATH]: seeded }, frontmatter: true });
	const editor = page.locator('.editor');
	await expect(editor).toBeVisible();

	// The editor edits the body alone: the frontmatter never reaches it.
	await expect(editor).not.toContainText('status: draft');

	await editor.locator('.text-editable-block', { hasText: 'Body text here.' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Edited.');

	await expect.poll(() => lastWrite(page)).toContain('Body text here. Edited.');
	// `updated_at` is stamped fresh on every save; masking that one line is what lets the rest be
	// compared byte for byte, so a dropped, added or reordered key fails too.
	const written = (await lastWrite(page)).replace(/^updated_at: .+$/m, MASK);
	expect(written).toBe(seeded.replace(/^updated_at: .+$/m, MASK).replace(/\n$/, ' Edited.\n'));
});
