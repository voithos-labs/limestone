import type { Page } from '@playwright/test';
import { installTauriMocks, type SeededDocs } from './tauri-mocks';

export { getMockState } from './tauri-mocks';

export interface BootOptions {
	/** Markdown bodies keyed by source-relative path. Each opens as a tab, the first focused. */
	docs?: SeededDocs;
}

/** What the page complained about while booting, so a spec can assert it came up clean. */
export interface BootReport {
	consoleErrors: string[];
	pageErrors: string[];
}

/** Loads the app against a fake Tauri backend and waits for its shell to render. */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<BootReport> {
	const report: BootReport = { consoleErrors: [], pageErrors: [] };
	// Attached before navigation, or a failure during boot goes unseen.
	page.on('console', (message) => {
		if (message.type() === 'error') report.consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => report.pageErrors.push(error.message));

	await installTauriMocks(page, opts.docs ?? {});
	await page.goto('/');
	await page.locator('.content-area').waitFor();
	return report;
}
