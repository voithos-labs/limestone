import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/hello.md';
const DOCS = { [NOTE]: 'Alpha.\n' };

const lastWrite = async (page: Page) => (await getMockState(page)).writes.at(-1)?.content;

/** Puts the caret at the end of the one paragraph, the way a reader about to insert would. */
async function caretAtEnd(page: Page) {
	await page.locator('.editor .text-editable-block', { hasText: 'Alpha.' }).click();
	await page.keyboard.press('End');
}

async function insert(page: Page, label: string) {
	await page.locator('.insert-menu-button').click();
	await page.locator('.ctx-menu .ctx-item', { hasText: label }).click();
}

test('the + menu inserts a table at the caret as one undo step', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	const editor = page.locator('.editor');
	await caretAtEnd(page);

	await insert(page, 'Table');

	await expect(editor.locator('.table-block').first()).toBeVisible();
	// Waited out, not raced: an undo inside the save debounce leaves the file untouched, and the
	// restoration worth pinning is the one that reaches disk.
	await expect
		.poll(() => lastWrite(page))
		.toBe('Alpha.\n\n| Column | Column |\n| --- | --- |\n|  |  |\n');

	await page.keyboard.press('Control+z');

	await expect(editor.locator('.table-block')).toHaveCount(0);
	await expect.poll(() => lastWrite(page)).toBe('Alpha.\n');
});

/** Every menu entry, beside the class its block renders under and the bytes the file gets. */
const ENTRIES: readonly { label: string; block: string; md: string }[] = [
	{ label: 'Table', block: '.table-block', md: '| Column | Column |\n| --- | --- |\n|  |  |\n' },
	{ label: 'Code block', block: '.code-block', md: '```\n\n```\n' },
	{ label: 'Callout', block: '.admonition', md: ':::note\n\n:::\n' },
	{
		label: 'Details',
		block: '.details-block',
		md: '<details>\n<summary>Summary</summary>\n\n</details>\n'
	},
	// An empty formula has nothing to render, so the block stays in its source form.
	{ label: 'Math block', block: '.math-block-source', md: '$$\n\n$$\n' },
	{ label: 'Diagram', block: '.mermaid-block', md: '```mermaid\n\n```\n' },
	{ label: 'Divider', block: '.thematic-break-block', md: '---\n' }
];

// A snippet that parses into a lookalike box, or into plain paragraphs, still looks inserted. The
// class says which kind the editor actually built; the bytes say the file got the snippet whole.
for (const { label, block, md } of ENTRIES) {
	test(`the ${label.toLowerCase()} entry lands its own block and saves the snippet`, async ({
		page
	}) => {
		await bootApp(page, { docs: DOCS });
		await caretAtEnd(page);

		await insert(page, label);

		await expect(page.locator(`.editor ${block}`).first()).toBeVisible();
		await expect.poll(() => lastWrite(page)).toBe(`Alpha.\n\n${md}`);
	});
}

test('source and reading modes carry no insert menu', async ({ page }) => {
	await bootApp(page, { docs: DOCS });
	await expect(page.locator('.insert-menu-button')).toBeVisible();

	await page.locator('.mode-toggle button', { hasText: 'Source' }).click();
	await expect(page.locator('.insert-menu-button')).toHaveCount(0);

	await page.locator('.mode-toggle button', { hasText: 'Reading' }).click();
	await expect(page.locator('.insert-menu-button')).toHaveCount(0);
});
