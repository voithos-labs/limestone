import { test as base, expect } from '@playwright/test';
import { getMockState } from './tauri-mocks';

/**
 * Playwright's `test`, plus the IPC-miss oracle. The mock answers an unknown command with `null`
 * rather than rejecting, so a command the layer doesn't answer fails nothing on its own; asserting
 * at teardown makes the guard automatic and reads the tally after the spec's last action.
 */
export const test = base.extend<{ noUnmockedIpc: void }>({
	noUnmockedIpc: [
		async ({ page }, use) => {
			await use();
			// A spec that never booted the app has no mock state to read.
			if (page.isClosed() || page.url() === 'about:blank') return;
			const { unhandledCommands } = await getMockState(page);
			expect(unhandledCommands).toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };
