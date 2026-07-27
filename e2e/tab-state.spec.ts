import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const OTHER = 'notes/other.md';
const LONG = Array.from({ length: 80 }, (_, i) => `Paragraph number ${i + 1} of the note.`).join(
	'\n\n'
);
const DOCS = { [NOTE]: `${LONG}\n`, [OTHER]: 'The other document.\n' };

/** What the reader sees as their caret: which text it sits in, and where in it. */
async function caret(page: Page) {
	return page.evaluate(() => {
		const selection = window.getSelection();
		if (!selection?.anchorNode) return null;
		return {
			text: selection.anchorNode.textContent ?? '',
			anchor: selection.anchorOffset,
			focus: selection.focusOffset
		};
	});
}

const scrollTop = (page: Page) => page.locator('.editor').evaluate((el) => el.scrollTop);
const fontSize = (page: Page) =>
	page.locator('.editor').evaluate((el) => getComputedStyle(el).fontSize);

async function focusTab(page: Page, label: string) {
	await page.locator('.tab', { hasText: label }).first().click();
	await expect(page.locator('.editor')).toBeVisible();
}

/** Leaves the document for the other tab and comes back, the way a reader switches. */
async function leaveAndReturn(page: Page) {
	await focusTab(page, 'other');
	await expect(page.locator('.editor')).toContainText('The other document.');
	await focusTab(page, 'hello');
	await expect(page.locator('.editor')).toContainText('Paragraph number 1');
}

test('the caret comes back where the reader left it', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block').nth(20).click();
	await page.keyboard.press('End');
	const left = await caret(page);
	expect(left?.text).toContain('Paragraph number 21');

	await leaveAndReturn(page);

	expect(await caret(page)).toEqual(left);
	// A restored caret the reader cannot type from is only a highlighted range.
	await page.keyboard.type(' Continued.');
	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain('Paragraph number 21 of the note. Continued.');
});

test('the scroll position comes back with it', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block').nth(20).click();
	await page.mouse.wheel(0, 600);
	await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
	const left = await scrollTop(page);

	await leaveAndReturn(page);

	expect(Math.abs((await scrollTop(page)) - left)).toBeLessThanOrEqual(2);
});

test('the zoom the reader set is the tab’s, and survives leaving it', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await page.locator('.editor .text-editable-block').first().click();

	await page.keyboard.press('Control+Equal');
	await page.keyboard.press('Control+Equal');
	await expect.poll(() => fontSize(page)).toBe('18px');

	await focusTab(page, 'other');
	expect(await fontSize(page)).toBe('16px');
	await focusTab(page, 'hello');
	expect(await fontSize(page)).toBe('18px');
});

interface MountOrderWindow {
	__mountOrder: string[];
}

/**
 * Records whether the header's properties panel reaches the DOM after the editor itself. The
 * panel's fields load asynchronously, so the header grows once the editor has painted and the
 * tab's scroll has already been restored — the ordering the scenario below turns on. A fixture
 * whose panel happened to arrive first would pass every assertion while pinning nothing.
 */
async function watchMountOrder(page: Page) {
	await page.evaluate(() => {
		const order: string[] = [];
		(window as unknown as MountOrderWindow).__mountOrder = order;
		const note = (name: string) => {
			if (!order.includes(name)) order.push(name);
		};
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue;
					if (node.matches('.editor') || node.querySelector('.editor')) note('editor');
					if (node.matches('.doc-props') || node.querySelector('.doc-props')) note('props');
				}
			}
		}).observe(document.body, { childList: true, subtree: true });
	});
}

test('a header that settles after the editor leaves the reader where they were', async ({
	page
}) => {
	await bootApp(page, {
		docs: DOCS,
		frontmatter: true,
		propertyFields: ['status', 'due'],
		tabState: { [NOTE]: { props_open: true } }
	});
	await expect(page.locator('.doc-props')).toBeVisible();

	await page.locator('.editor .text-editable-block').nth(20).click();
	await page.keyboard.press('End');
	// Scrolled off the top, or the editor's header compensation never runs and the race the
	// scenario exists for cannot happen.
	await page.mouse.wheel(0, 600);
	await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
	const left = await caret(page);
	const leftScroll = await scrollTop(page);

	await focusTab(page, 'other');
	await watchMountOrder(page);
	await focusTab(page, 'hello');
	await expect(page.locator('.doc-props')).toBeVisible();

	expect(await page.evaluate(() => (window as unknown as MountOrderWindow).__mountOrder)).toEqual([
		'editor',
		'props'
	]);
	// And the growth is worth correcting: a panel that rendered empty would make the pin vacuous.
	const panel = await page
		.locator('.doc-props')
		.evaluate((el) => el.getBoundingClientRect().height);
	expect(panel).toBeGreaterThan(10);

	expect(Math.abs((await scrollTop(page)) - leftScroll)).toBeLessThanOrEqual(2);
	expect(await caret(page)).toEqual(left);
});

test('a caret position left by the previous editor is ignored, not restored', async ({ page }) => {
	const boot = await bootApp(page, { docs: DOCS, tabState: { [NOTE]: { cursorPos: 4200 } } });
	await expect(page.locator('.editor')).toBeVisible();

	// The flat offset means nothing here, so the document opens at the top — typable, as any
	// freshly opened document is.
	expect(await scrollTop(page)).toBe(0);
	await page.keyboard.type('Typed. ');
	await expect
		.poll(async () => (await getMockState(page)).writes.at(-1)?.content ?? '')
		.toContain('Typed. Paragraph number 1');

	expect(boot.pageErrors).toEqual([]);
	expect(boot.consoleErrors).toEqual([]);
});
