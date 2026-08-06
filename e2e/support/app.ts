import type { ConsoleMessage, Page } from '@playwright/test';
import { ASSET_HOST, installTauriMocks, type SeededDocs, type Settings } from './tauri-mocks';

export { getMockState } from './tauri-mocks';

export interface BootOptions {
	/** Raw file contents keyed by source-relative path. Each opens as a tab, the first focused. */
	docs?: SeededDocs;
	/** Give the seeded source YAML frontmatter, so saves round-trip document metadata. */
	frontmatter?: boolean;
	/**
	 * Settings the reader changed, e.g. `{ shortcuts: { 'nav.settings': ['mod+b'] } }`. Each key
	 * replaces the whole top-level branch of that name rather than merging into it.
	 */
	settings?: Settings;
	/** What a previous session left on each doc's tab — caret, scroll, zoom — keyed by doc path. */
	tabState?: Record<string, Record<string, unknown>>;
	/** Property names a saved view gives every seeded doc, which grows the document header. */
	propertyFields?: string[];
	/** 1-based asset-import call ordinals the mock backend rejects. */
	failAssetImports?: number[];
	/** Open a journal view showing a seeded note as the day's entry, instead of the notes' tabs. */
	journal?: boolean;
}

/** What the page complained about while booting, so a spec can assert it came up clean. */
export interface BootReport {
	consoleErrors: string[];
	pageErrors: string[];
}

/**
 * A fetch of a mocked asset URL, which only the Tauri webview can serve — dropped so the boot
 * assertion keeps catching errors the app itself logged. Keyed on the resource URL, not the
 * message text, so it can only ever hide this one host.
 */
function isMockedAssetFetch(message: ConsoleMessage): boolean {
	return URL.parse(message.location().url)?.hostname === ASSET_HOST;
}

/**
 * Clicks a tab near its left edge, where the label starts. A center click lands on the
 * hover-revealed close button once compact tabs shrink a short title below ~50px.
 */
export async function clickTab(page: Page, label: string) {
	await page
		.locator('.tab', { hasText: label })
		.first()
		.click({ position: { x: 10, y: 16 } });
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
		frontmatter: opts.frontmatter ?? false,
		settings: opts.settings ?? {},
		tabState: opts.tabState ?? {},
		propertyFields: opts.propertyFields ?? [],
		failAssetImports: opts.failAssetImports ?? [],
		journal: opts.journal ?? false
	});
	await page.goto('/');
	await page.locator('.content-area').waitFor();
	return report;
}
