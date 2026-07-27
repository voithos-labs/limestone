import type { Page } from '@playwright/test';
import { bootApp } from './support/app';
import { expect, test } from './support/test';

const DOCS = { 'notes/hello.md': '# Hello\n\nBody text here.\n' };

interface WireUpWindow {
	__headerObservers?: string[];
}

/**
 * Records who observes the editor's header slot, and from where. The adapter registers exactly
 * one observer there; a second registration means its wire-up effect ran twice, which also means
 * the run before it was torn down mid-flight and its restore ran alongside the new one.
 *
 * Structural, because there is nothing user-facing to watch: a second pass places the same caret
 * and the same scroll, so only the count can tell. Attributed by stack rather than by count
 * alone — the editor keeps an observer of its own on the same element.
 */
async function watchHeaderObservers(page: Page) {
	await page.addInitScript(() => {
		const scope = window as WireUpWindow;
		scope.__headerObservers = [];
		const observe = ResizeObserver.prototype.observe;
		ResizeObserver.prototype.observe = function (target, options) {
			if (target instanceof HTMLElement && target.classList.contains('editor-header')) {
				scope.__headerObservers?.push(new Error().stack ?? '');
			}
			return observe.call(this, target, options);
		};
	});
}

test('opening a document wires its editor up once', async ({ page }) => {
	await watchHeaderObservers(page);
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	// The scroll listener the effect installs is what proves the wire-up ran at all.
	await expect.poll(() => page.locator('.editor > .block-list').count()).toBe(1);

	const stacks = await page.evaluate(() => (window as WireUpWindow).__headerObservers ?? []);
	expect(stacks.filter((stack) => stack.includes('DocumentEditor'))).toHaveLength(1);
});
