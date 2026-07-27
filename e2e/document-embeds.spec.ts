import type { Page } from '@playwright/test';
import { bootApp, getMockState } from './support/app';
import { expect, test } from './support/test';

const NOTE = 'notes/pic.md';
const OTHER = 'notes/other.md';

/** A 4x4 PNG, so an embed renders at a natural size a sized one can be told apart from. */
const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

/**
 * Answers the asset URLs the app mints, which only the Tauri webview can serve. Without this an
 * embed renders as a broken image of zero height — enough to see that a widget exists, not enough
 * to click one or to tell a sized embed from an unsized one.
 */
async function serveAssets(page: Page) {
	await page.route(/asset\.localhost/, (route) =>
		route.fulfill({ body: Buffer.from(PNG_BASE64, 'base64'), contentType: 'image/png' })
	);
}

const widget = (page: Page) => page.locator('.editor [data-image-widget]');
const saved = (page: Page) => getMockState(page).then((s) => s.writes.at(-1)?.content ?? '');

async function openNote(page: Page, body: string, extra: Record<string, string> = {}) {
	await serveAssets(page);
	await bootApp(page, { docs: { [NOTE]: body, ...extra } });
	await expect(widget(page).first().locator('img')).toBeVisible();
}

/** Puts the caret at the embed's right edge: the start of the text that follows it. */
async function caretAfterEmbed(page: Page) {
	const block = page.locator('.editor .text-editable-block').first();
	const box = (await block.boundingBox())!;
	await block.click({ position: { x: box.width - 4, y: box.height - 4 } });
	await page.keyboard.press('Home');
}

test('an embed renders as an image resolved against the source’s assets', async ({ page }) => {
	await openNote(page, 'Look ![[cat.png]] here.\n');

	await expect(widget(page).locator('img')).toHaveAttribute(
		'src',
		`http://asset.localhost/${encodeURIComponent('/mock-source/assets/cat.png')}`
	);
	await expect(page.locator('.editor')).not.toContainText('![[cat.png]]');
});

test('a size modifier is the width the image renders at', async ({ page }) => {
	await openNote(page, 'Natural ![[cat.png]] and sized ![[cat.png|300]].\n');

	const [natural, sized] = await widget(page).evaluateAll((widgets) =>
		widgets.map((each) => each.getBoundingClientRect().width)
	);
	expect(natural).toBe(4);
	expect(sized).toBe(300);
});

test('arrowing onto an embed selects it, and the next press deletes it', async ({ page }) => {
	await openNote(page, 'Look ![[cat.png]] here.\n');
	await caretAfterEmbed(page);

	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('[data-image-overlay]')).toBeVisible();

	await page.keyboard.press('Backspace');

	await expect(widget(page)).toHaveCount(0);
	await expect.poll(() => saved(page)).toBe('Look  here.\n');
});

test('copying across an embed carries its literal bytes', async ({ page }) => {
	await openNote(page, 'Look ![[cat.png]] here.\n');
	await page.evaluate(() => {
		document.addEventListener('copy', (e) => {
			(window as unknown as { __copied?: string }).__copied =
				e.clipboardData?.getData('text/plain') ?? '';
		});
	});

	await caretAfterEmbed(page);
	await page.keyboard.press('End');
	for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Control+c');

	expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(
		'Look ![[cat.png]] here.'
	);
});

test('an edit elsewhere leaves the embed’s bytes alone, and it still renders on return', async ({
	page
}) => {
	await openNote(page, 'Look ![[cat.png]] here.\n', { [OTHER]: 'The other document.\n' });

	await page
		.locator('.editor .text-editable-block')
		.first()
		.click({ position: { x: 4, y: 4 } });
	await page.keyboard.press('Home');
	await page.keyboard.type('Hey. ');
	await expect.poll(() => saved(page)).toBe('Hey. Look ![[cat.png]] here.\n');

	await page.locator('.tab', { hasText: 'other' }).first().click();
	await expect(page.locator('.editor')).toContainText('The other document.');
	await page.locator('.tab', { hasText: 'pic' }).first().click();

	await expect(widget(page).locator('img')).toBeVisible();
});

test('a pasted image is imported into the source and embedded', async ({ page }) => {
	await serveAssets(page);
	await bootApp(page, { docs: { [NOTE]: 'Notes.\n' } });
	await page.locator('.editor .text-editable-block').first().click();
	await page.keyboard.press('End');

	// The clipboard cannot be given an image from outside the browser, so the event the browser
	// would deliver is constructed instead. Everything downstream of it is the app's own path.
	await page.evaluate(async (base64) => {
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
		document.activeElement?.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
	}, PNG_BASE64);

	await expect(widget(page).locator('img')).toBeVisible();
	await expect.poll(() => saved(page)).toBe('Notes.![[assets/Pasted image 1.png]]\n');
	expect((await getMockState(page)).assetImports).toEqual([
		{ sourceId: 'mock-source', ext: 'png', byteLength: 78, relPath: 'assets/Pasted image 1.png' }
	]);
});

// Recorded, not desired: an embed inherits the built-in image kind's editing handlers, which
// rebuild its source from the node's fields as GFM. Documented in `wiki-embed.md`; the fix is
// upstream, so this pins what a reader's file actually says today.
test('editing an embed rewrites it as a GFM image', async ({ page }) => {
	await openNote(page, 'Look ![[cat.png|300]] here.\n');

	await widget(page).click();
	await expect(page.locator('[data-image-overlay]')).toBeVisible();
	await page.keyboard.press('Shift+ArrowRight');

	await expect.poll(() => saved(page)).toBe('Look ![cat.png|320](cat.png) here.\n');
});
