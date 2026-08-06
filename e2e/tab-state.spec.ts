import type { Page } from '@playwright/test';
import { bootApp, clickTab, getMockState } from './support/app';
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
	await clickTab(page, label);
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
	// Settled on the reader's configured size before zooming, so what follows measures the zoom
	// rather than a race with the setting that seeds it.
	await expect.poll(() => fontSize(page)).toBe('14px');

	await page.keyboard.press('Control+Equal');
	await page.keyboard.press('Control+Equal');
	await expect.poll(() => fontSize(page)).toBe('16px');

	await focusTab(page, 'other');
	await expect.poll(() => fontSize(page)).toBe('14px');
	await focusTab(page, 'hello');
	expect(await fontSize(page)).toBe('16px');
});

interface SettleWindow {
	__propsAtEditorInsert?: boolean;
}

/**
 * Whether the properties panel is already inside the editor when the editor enters the DOM. A
 * panel that loads late grows the header after the tab's scroll has been restored — the collision
 * below. A fixture whose panel arrived with the editor would pass every assertion pinning nothing.
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

/**
 * A block whose height settles after the editor has painted; display math and a resolving image
 * behave the same. Placement decides what can be asserted: growth ABOVE the reader legitimately
 * moves `scrollTop`, so the remembered-position scenario puts the diagram last (below a reader
 * 600px in, where honest movement is none) and the opens-at-the-top scenario puts it first.
 */
const DIAGRAM = '```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```';
const DIAGRAM_LAST = `${LONG}\n\n${DIAGRAM}\n`;
const DIAGRAM_FIRST = `${DIAGRAM}\n\n${LONG}\n`;

/** The origin the tab's scroll is persisted against, measured the way the editor measures it. */
const blocksTop = (page: Page) =>
	page.locator('.editor').evaluate((el) => {
		const list = el.querySelector(':scope > .block-list')!;
		return list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
	});

/** Resolves once the diagram has actually rendered, so the late growth the pin needs has happened. */
async function waitForDiagram(page: Page) {
	await expect(page.locator('.editor .mermaid-block')).toBeVisible();
	// The drawn picture, never the block's height: a diagram still rendering is a small box, not
	// an absent one. The wait is long because the first diagram on a page loads the drawing tool.
	await expect(page.locator('.editor .mermaid-block svg')).toBeVisible({ timeout: 15_000 });
}

test('a diagram that renders late leaves the remembered scroll where it was', async ({ page }) => {
	await bootApp(page, {
		docs: { [NOTE]: DIAGRAM_LAST, [OTHER]: DOCS[OTHER] },
		tabState: { [NOTE]: { scrollTopBlocks: 600 } }
	});
	await expect(page.locator('.editor')).toBeVisible();

	await waitForDiagram(page);

	expect(Math.abs((await scrollTop(page)) - (await blocksTop(page)) - 600)).toBeLessThanOrEqual(2);
});

test('a document with a diagram opens showing its own title', async ({ page }) => {
	await bootApp(page, { docs: { [NOTE]: DIAGRAM_FIRST, [OTHER]: DOCS[OTHER] } });
	await expect(page.locator('.editor')).toBeVisible();

	await waitForDiagram(page);

	// A document with nothing remembered opens at the top. The caret goes in the first block,
	// which is not a reason to scroll the reader past the header it sits under.
	expect(await scrollTop(page)).toBe(0);
	await expect(page.locator('.editor .title-input')).toBeInViewport();
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
