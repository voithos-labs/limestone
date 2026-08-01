import type { Locator, Page } from '@playwright/test';
import { bootApp, clickTab } from './support/app';
import { expect, test } from './support/test';

const DOCS = { 'notes/hello.md': '# Hello\n\nBody text here.\n' };
/** Seeded under the same path, so `chooseTheme` finds the tab by the name it knows. */
const RULE_DOC = { 'notes/hello.md': 'Above the rule.\n\n---\n\nBelow the rule.\n' };

/** Custom properties as the editor resolves them, beside the values the app declares at its root. */
async function tokens(page: Page, names: string[]): Promise<Record<string, [string, string]>> {
	return page.locator('.editor').evaluate((el, names) => {
		const editor = getComputedStyle(el);
		const root = getComputedStyle(document.documentElement);
		return Object.fromEntries(
			names.map((name) => [
				name,
				[editor.getPropertyValue(name).trim(), root.getPropertyValue(name).trim()]
			])
		);
	}, names);
}

const token = async (page: Page, name: string) => (await tokens(page, [name]))[name][0];

/**
 * Colours as the browser resolves them, painted inside the editor so editor-scoped tokens apply.
 * A raw `#d0d0d0` cannot be compared against a computed `rgb(208, 208, 208)` without a paint.
 */
async function resolvedColors(page: Page, expressions: string[]): Promise<string[]> {
	return page.locator('.editor').evaluate((editor, expressions) => {
		const probe = document.createElement('span');
		editor.append(probe);
		const colors = expressions.map((expression) => {
			probe.style.color = expression;
			return getComputedStyle(probe).color;
		});
		probe.remove();
		return colors;
	}, expressions);
}

async function expectRuleTakesTheBorder(page: Page, rule: Locator, mode: string) {
	const [border, separator] = await resolvedColors(page, [
		'var(--color-border)',
		'var(--syntax-separator)'
	]);
	expect(separator, `${mode}: the two colours are told apart`).not.toBe(border);
	await expect(rule, `${mode}: the rule paints the app’s border`).toHaveCSS(
		'border-top-color',
		border
	);
}

interface FirstPaintWindow {
	__firstPaint?: [string, string];
}

/**
 * Captures the editor's surface token against the app's the instant the editor enters the DOM.
 * Installed pre-boot: by the time a locator can see the editor, a frame rendered against the
 * editor's own defaults would already be gone.
 */
async function watchFirstPaint(page: Page) {
	await page.addInitScript(() => {
		new MutationObserver((records, observer) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue;
					const editor = node.matches('.editor') ? node : node.querySelector('.editor');
					if (!editor) continue;
					(window as FirstPaintWindow).__firstPaint = [
						getComputedStyle(editor).getPropertyValue('--color-bg').trim(),
						getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim()
					];
					observer.disconnect();
					return;
				}
			}
		}).observe(document.documentElement, { childList: true, subtree: true });
	});
}

/** Picks a theme the way a reader does — settings, search, the theme menu — and comes back. */
async function chooseTheme(page: Page, name: string) {
	await page.keyboard.press('Control+Comma');
	await page.locator('.settings-page .search-input').fill('theme');
	await page.locator('.setting-item', { hasText: 'Theme' }).locator('.select-trigger').click();
	await page.locator('.menu-item', { hasText: name }).click();
	await clickTab(page, 'hello');
	await expect(page.locator('.editor')).toBeVisible();
}

test('the editor reads the app’s palette, from its first frame on', async ({ page }) => {
	await watchFirstPaint(page);
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();

	const firstPaint = await page.evaluate(() => (window as FirstPaintWindow).__firstPaint);
	expect(firstPaint?.[1], 'the app had a palette before the editor mounted').not.toBe('');
	expect(firstPaint?.[0], 'the editor mounted carrying it').toBe(firstPaint?.[1]);

	const bridged = await tokens(page, [
		'--color-border',
		'--color-text-primary',
		'--color-ui-muted',
		'--color-accent',
		'--syntax-heading',
		'--syntax-link',
		'--syntax-code'
	]);
	for (const [name, [editor, root]] of Object.entries(bridged)) {
		expect(root, `${name} is declared by the app`).not.toBe('');
		expect(editor, `${name} on the editor`).toBe(root);
	}

	// The one name that differs on each side: the editor's surfaces paint on the app's.
	const surface = await tokens(page, ['--color-bg', '--color-surface']);
	expect(surface['--color-bg'][0]).toBe(surface['--color-surface'][1]);
});

test('a theme of the same mode repaints the editor without touching its mode', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const before = await token(page, '--color-bg');
	await expect(page.locator('.editor')).toHaveAttribute('data-editor-theme', 'dark');

	await chooseTheme(page, 'soft-dark');

	expect(await token(page, '--color-bg')).not.toBe(before);
	await expect(page.locator('.editor')).toHaveAttribute('data-editor-theme', 'dark');
});

test('a light theme flips the mode the editor keys its own defaults on', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const dark = await token(page, '--color-bg');

	await chooseTheme(page, 'default-light');

	await expect(page.locator('.editor')).toHaveAttribute('data-editor-theme', 'light');
	const surface = await tokens(page, ['--color-bg', '--color-surface']);
	expect(surface['--color-bg'][0]).not.toBe(dark);
	expect(surface['--color-bg'][0]).toBe(surface['--color-surface'][1]);
});

test('the thematic break paints the app’s border, not the syntax palette', async ({ page }) => {
	await bootApp(page, { docs: RULE_DOC });
	const rule = page.locator('.thematic-break-block > hr');
	await expect(rule).toBeVisible();

	await expectRuleTakesTheBorder(page, rule, 'dark');
	await chooseTheme(page, 'default-light');
	await expectRuleTakesTheBorder(page, rule, 'light');
});

test('the editor’s faint wash takes the app’s menu hover, and follows the mode', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	const names = ['--color-ui-faint', '--menu-item-hover'];

	const dark = await tokens(page, names);
	expect(dark['--color-ui-faint'][0], 'dark').toBe(dark['--menu-item-hover'][1]);

	await chooseTheme(page, 'default-light');

	const light = await tokens(page, names);
	expect(light['--color-ui-faint'][0], 'light').toBe(light['--menu-item-hover'][1]);
	expect(light['--color-ui-faint'][0], 'the wash follows the mode').not.toBe(
		dark['--color-ui-faint'][0]
	);
});

test('a palette missing a bridged variable leaves the token unset, not the editor’s own', async ({
	page
}) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.editor')).toBeVisible();
	expect(await token(page, '--color-danger')).not.toBe('');

	// A theme that declares no error color. The bridge shadows the editor's own `--color-danger`,
	// so the token goes unset rather than silently falling back to the editor's red.
	await page.evaluate(() => document.documentElement.style.removeProperty('--color-error'));

	expect(await token(page, '--color-danger')).toBe('');
});
