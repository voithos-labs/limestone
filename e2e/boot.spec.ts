import { expect, test } from '@playwright/test';
import { bootApp, getMockState } from './support/app';

const NOTE_PATH = 'notes/hello.md';
const NOTE_BODY = '# Hello\n\nSeeded from the mocked filesystem.\n';

test('boots to the library page', async ({ page }) => {
	const boot = await bootApp(page);

	await expect(page.locator('.library-page')).toBeVisible();
	await expect(page.getByPlaceholder('quick search...')).toBeVisible();

	const { unhandledCommands } = await getMockState(page);
	expect(unhandledCommands).toEqual([]);
	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});

test('opens a seeded document in the focused tab', async ({ page }) => {
	const boot = await bootApp(page, { docs: { [NOTE_PATH]: NOTE_BODY } });

	await expect(page.locator('.tab.active .tab-label')).toHaveText('hello');
	await expect(page.locator('.title-input')).toHaveValue('hello');
	await expect(page.locator('.cm-content')).toContainText('Seeded from the mocked filesystem.');

	const { unhandledCommands } = await getMockState(page);
	expect(unhandledCommands).toEqual([]);
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
		.poll(async () => (await getMockState(page)).writes)
		.toContainEqual({
			path: NOTE_PATH,
			content: expect.stringContaining('Typed by the spec.')
		});
});
