import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE_PATH = 'notes/hello.md';
const MASK = 'updated_at: <stamped>';

/** The body the editor last wrote, waited out past the save debounce. */
async function lastWrite(page: import('@playwright/test').Page): Promise<string> {
	return (await getMockState(page)).writes.at(-1)?.content ?? '';
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
