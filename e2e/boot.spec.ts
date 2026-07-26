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
	await expect(page.locator('.cm-content')).toContainText('Seeded from the mocked filesystem.');

	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('writes an edited document back through the IPC layer', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE_PATH]: NOTE_BODY } });

	const content = page.locator('.cm-content');
	await expect(content).toContainText('Seeded from the mocked filesystem.');
	await content.click();
	await page.keyboard.type(' Typed by the spec.');

	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain('Typed by the spec.');

	const lastWrite = (await getMockState(page)).writes.at(-1)!;
	expect(lastWrite.path).toBe(NOTE_PATH);
	expect(lastWrite.sourceId).toBe('mock-source');
	expect(lastWrite.create).toBe(false);
});
