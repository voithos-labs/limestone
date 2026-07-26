import { test as base, expect } from '@playwright/test';
import { getMockState } from './tauri-mocks';

/**
 * The project's `test`: Playwright's, plus the IPC-miss oracle.
 *
 * The mock answers an unknown command with `null` rather than rejecting, so nothing fails
 * on its own when the app reaches for a command the layer doesn't answer. Asserting that at
 * teardown makes the guard automatic for every spec, and reads the tally after the last
 * action rather than wherever a spec happened to call `getMockState`.
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
