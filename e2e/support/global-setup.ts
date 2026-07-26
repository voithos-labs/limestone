import { chromium, type FullConfig } from '@playwright/test';

/**
 * Loads the editor harness once, in a throwaway page, before the workers start.
 *
 * The editor is not reachable from the app's entry points yet, so the dev server does not
 * pre-bundle aragonite at startup — it discovers it the first time a spec imports the
 * harness, and reloads every connected page when that pre-bundling lands. Under parallel
 * workers that reload arrives in the middle of some other spec's typing, which failed
 * roughly one cold-cache run in four. Absorbing it here means the only page connected when
 * it happens is this one.
 *
 * Delete this once an app component imports the editor: the dependency is scanned at
 * startup from then on, and there is no reload to absorb.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use?.baseURL;
	if (typeof baseURL !== 'string') return;

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(baseURL);
		await warmHarness(page);
		// A second load proves the pre-bundling settled: were another still pending, this
		// import would race the reload the same way a spec would.
		await warmHarness(page);
	} finally {
		await browser.close();
	}
}

async function warmHarness(page: import('@playwright/test').Page): Promise<void> {
	const load = async (url: string) => {
		await import(url);
	};
	try {
		await page.evaluate(load, '/src/components/editor/wiki-embed-harness.ts');
	} catch {
		// The reload this setup exists to absorb destroys the context mid-import.
		await page.waitForLoadState();
		await page.evaluate(load, '/src/components/editor/wiki-embed-harness.ts');
	}
}
