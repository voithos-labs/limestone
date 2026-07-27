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

interface SettleWindow {
	__propsAtEditorInsert?: boolean;
}

/**
 * Records whether the header's properties panel is already inside the editor at the moment the
 * editor enters the DOM. The panel renders in the header slot once its fields have loaded, so a
 * late one is absent there and present later — which is what makes the header grow after the
 * tab's scroll has been restored, the collision the scenario below exists for. A fixture whose
 * panel arrived with the editor would satisfy every other assertion while pinning nothing.
 */
async function watchHeaderSettle(page: Page) {
	await page.evaluate(() => {
		new MutationObserver((records, observer) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) continue;
					const editor = node.matches('.editor') ? node : node.querySelector('.editor');
					if (!editor) continue;
					(window as SettleWindow).__propsAtEditorInsert = !!editor.querySelector('.doc-props');
					observer.disconnect();
					return;
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
	await watchHeaderSettle(page);
	await focusTab(page, 'hello');
	await expect(page.locator('.doc-props')).toBeVisible();

	// The header did settle after the editor painted: no panel inside it when it was inserted,
	// one there now.
	expect(await page.evaluate(() => (window as SettleWindow).__propsAtEditorInsert)).toBe(false);
	// And the growth is worth correcting: a panel that rendered empty would make the pin vacuous.
	const panel = await page
		.locator('.doc-props')
		.evaluate((el) => el.getBoundingClientRect().height);
	expect(panel).toBeGreaterThan(10);

	expect(Math.abs((await scrollTop(page)) - leftScroll)).toBeLessThanOrEqual(2);
	expect(await caret(page)).toEqual(left);
});

test('a properties panel the reader opened is still open on return', async ({ page }) => {
	await bootApp(page, { docs: DOCS, frontmatter: true, propertyFields: ['status'] });
	await expect(page.locator('.props-chip')).toBeVisible();
	await expect(page.locator('.doc-props')).toHaveCount(0);

	await page.locator('.props-chip').click();
	await expect(page.locator('.doc-props')).toBeVisible();

	await leaveAndReturn(page);

	await expect(page.locator('.doc-props')).toBeVisible();
});
