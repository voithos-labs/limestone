import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE_PATH = 'notes/hello.md';
const NOTE_BODY = '# Hello\n\nSeeded from the mocked filesystem.\n';

test('boots to the library page', async ({ page }) => {
	const boot = await bootApp(page);

	await expect(page.locator('.library-page')).toBeVisible();
	await expect(page.getByPlaceholder('quick search...')).toBeVisible();

	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('opens a seeded document in the focused tab', async ({ page }) => {
	const boot = await bootApp(page, { docs: { [NOTE_PATH]: NOTE_BODY } });

	await expect(page.locator('.tab.active .tab-label')).toHaveText('hello');
	await expect(page.locator('.title-input')).toHaveValue('hello');
	await expect(page.locator('.editor')).toContainText('Seeded from the mocked filesystem.');

	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('an unfetchable document image is not counted as an app error', async ({ page }) => {
	const failures: string[] = [];
	page.on('requestfailed', (request) => failures.push(request.url()));

	const boot = await bootApp(page, { docs: { 'notes/pic.md': 'Look ![[cat.png]] here.\n' } });
	await expect(page.locator('.editor img')).toBeAttached();
	// The browser genuinely cannot serve the asset URL, so the console error is real.
	await expect.poll(() => failures.some((url) => url.includes('asset.localhost'))).toBe(true);

	expect(boot.consoleErrors).toEqual([]);
	expect(boot.pageErrors).toEqual([]);
});

test('writes an edited document back through the IPC layer', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: NOTE_BODY } });

	const paragraph = page.locator('.editor .text-editable-block', {
		hasText: 'Seeded from the mocked filesystem.'
	});
	await expect(paragraph).toBeVisible();
	// Opening a document must not itself count as an edit, or every doc is rewritten on open.
	expect((await getMockState(page)).writes).toEqual([]);

	await paragraph.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Typed by the spec.');

	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain('Typed by the spec.');

	const lastWrite = (await getMockState(page)).writes.at(-1)!;
	expect(lastWrite.path).toBe(NOTE_PATH);
	expect(lastWrite.sourceId).toBe('mock-source');
	expect(lastWrite.create).toBe(false);
});
