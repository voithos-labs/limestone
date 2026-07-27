import type { ConsoleMessage, Page } from '@playwright/test';
import { ASSET_HOST, installTauriMocks, type SeededDocs } from './tauri-mocks';

export { getMockState } from './tauri-mocks';

export interface BootOptions {
	/** Raw file contents keyed by source-relative path. Each opens as a tab, the first focused. */
	docs?: SeededDocs;
	/** Give the seeded source YAML frontmatter, so saves round-trip document metadata. */
	frontmatter?: boolean;
}

/** What the page complained about while booting, so a spec can assert it came up clean. */
export interface BootReport {
	consoleErrors: string[];
	pageErrors: string[];
}

/**
 * A fetch of a mocked asset URL, which the app resolves through `convertFileSrc` and only the
 * Tauri webview can serve. Dropped so the assertion keeps catching what it is for: errors the app
 * itself logged. Keyed on the resource's own URL rather than the message text, so it can only ever
 * hide this one host — a broken app fetch to anywhere else still fails the assertion.
 */
function isMockedAssetFetch(message: ConsoleMessage): boolean {
	return URL.parse(message.location().url)?.hostname === ASSET_HOST;
}

/** Loads the app against a fake Tauri backend and waits for its shell to render. */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<BootReport> {
	const report: BootReport = { consoleErrors: [], pageErrors: [] };
	// Attached before navigation, or a failure during boot goes unseen.
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		if (!isMockedAssetFetch(message)) report.consoleErrors.push(message.text());
	});
	page.on('pageerror', (error) => report.pageErrors.push(error.message));

	await installTauriMocks(page, {
		docs: opts.docs ?? {},
		frontmatter: opts.frontmatter ?? false
	});
	await page.goto('/');
	await page.locator('.content-area').waitFor();
	return report;
}
