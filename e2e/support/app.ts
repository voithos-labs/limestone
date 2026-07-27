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

/**
 * A subresource the browser could not fetch, not something the app got wrong. The mocked
 * `convertFileSrc` answers with an `asset.localhost` URL that resolves in the webview and
 * nowhere else, so every document image logs one of these. Dropped so the assertion keeps
 * catching what it is for: errors the app itself logged.
 */
function isResourceError(text: string): boolean {
	return text.startsWith('Failed to load resource');
}

/** Loads the app against a fake Tauri backend and waits for its shell to render. */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<BootReport> {
	const report: BootReport = { consoleErrors: [], pageErrors: [] };
	// Attached before navigation, or a failure during boot goes unseen.
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const text = message.text();
		if (!isResourceError(text)) report.consoleErrors.push(text);
	});
	page.on('pageerror', (error) => report.pageErrors.push(error.message));

	await installTauriMocks(page, opts.docs ?? {});
	await page.goto('/');
	await page.locator('.content-area').waitFor();
	return report;
}
