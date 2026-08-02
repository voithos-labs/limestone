<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { Editor, parse } from 'aragonite';
	import type { EditorInstance, EditorSelection, PastedImage, PresentationMode } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	// yes you must load editor-tokens.css after aragonite's editor-theme.css
	import './editor-tokens.css';
	import { EDITOR_PLUGINS } from './editor-plugins';
	import { isImageTarget } from './image-targets';
	import { createPasteImportLedger } from './paste-imports';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { deleteSourceAsset, importSourceAssetBytes } from '$lib/services/assets';
	import { currentThemeType } from '$lib/services/theme.svelte';
	import { getSetting } from '$lib/models/Settings.svelte';
	import { registerFlush } from '$lib/util/flush';
	import { appEditorShortcut, registerDocumentEditor } from '$lib/editor-chords';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type EditorStateModel from '$lib/models/EditorState.svelte.js';
	import DocumentHero from '../DocumentHero.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';

	let {
		tab,
		editor,
		flow = false,
		findBarAnchor
	}: {
		tab: TabState;
		editor?: EditorStateModel;
		flow?: boolean;
		/** Where the editor should draw its find bar, for a page that scrolls the document itself. */
		findBarAnchor?: HTMLElement | null;
	} = $props();

	let handle = $derived(tab.handle);
	let instance = $state<EditorInstance>();
	let wrapperEl = $state<HTMLDivElement | null>(null);
	// aragonite's own `.editor` element, which is the scroller outside flow mode. Found by query
	// after mount (there is nothing to bind to), and `$state` so ScrollThumb can take it as a prop.
	let scrollEl = $state<HTMLElement | null>(null);

	// The thumb track starts level with the document title rather than at the scroller's top.
	const THUMB_TOP_PX = 34;

	// ── Load: the body only; frontmatter stays DocHandle-owned ──────────────────────────

	let content = $state('');
	let loaded = $state(false);

	$effect(() => {
		loaded = false;
		handle?.loadContent().then((c) => {
			content = c;
			loaded = true;
		});
	});

	// ── Save: edit events, debounced, writing back what the editor serialized ───────────

	const SAVE_DEBOUNCE_MS = 250;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Captured when the edit lands, so a flush that outlives the editor instance (window close,
	// tab teardown) still has a body to write.
	let pendingSource: string | null = null;
	// What we last wrote, or what the editor started with. Comparing against it keeps an untouched
	// document unsaved even when the editor's output differs from the file on disk.
	let savedBody: string | null = null;
	// A deleted document must not be resurrected by the flush its own teardown triggers.
	let deleted = false;

	function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		// Ask the editor now: its `edit` event is debounced, so the last thing it handed us can be a
		// whole typing burst behind. `pendingSource` is the fallback when the editor is already gone.
		const body = deleted ? null : (instance?.getSource() ?? pendingSource);
		pendingSource = null;
		if (body === null || body === savedBody) return;
		// Moved only once the write lands: setting it earlier would mark a failed save as saved,
		// and the next attempt would be skipped as a no-op.
		return handle
			?.saveContent(body)
			.then(() => {
				savedBody = body;
			})
			.catch((e) => console.error('saveContent failed', e));
	}

	const unregisterFlush = registerFlush(flushSave);

	function scheduleSave() {
		pendingSource = instance?.getSource() ?? pendingSource;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
	}

	// ── Per-tab state ───────────────────────────────────────────────────────────────────

	// Persisted on the tab, so a doc reopens with its properties panel as you left it
	let propsOpen = $state(untrack(() => tab.state.props_open ?? false));
	$effect(() => {
		tab.state.props_open = propsOpen;
	});

	let zoom = $state(untrack(() => tab.state.zoom ?? 16));
	if (untrack(() => tab.state.zoom) === undefined) {
		getSetting<number>('appearance.editor_font_size').then((v) => {
			if (tab.state.zoom === undefined && typeof v === 'number') zoom = v;
		});
	}

	function setZoom(next: number) {
		zoom = Math.max(10, Math.min(40, next));
		tab.state.zoom = zoom;
	}

	const MODES: readonly { value: PresentationMode; label: string }[] = [
		{ value: 'source', label: 'Source' },
		{ value: 'preview-inline', label: 'Live' },
		{ value: 'reading', label: 'Reading' }
	];

	/** aragonite has a fourth mode, `preview-block`; limestone deliberately doesn't offer it. */
	function isOfferedMode(value: unknown): value is PresentationMode {
		return MODES.some((m) => m.value === value);
	}

	// A tab only remembers a mode once the reader picks one; until then the global setting
	// supplies it. That is why setMode is the only thing that writes tab.state.presentationMode.
	let mode = $state<PresentationMode>(
		untrack(() => {
			const remembered = tab.state.presentationMode;
			return isOfferedMode(remembered) ? remembered : 'preview-inline';
		})
	);
	if (untrack(() => tab.state.presentationMode) === undefined) {
		getSetting<string>('appearance.default_editor_mode').then((v) => {
			if (tab.state.presentationMode === undefined && isOfferedMode(v)) mode = v;
		});
	}

	function setMode(next: PresentationMode) {
		mode = next;
		tab.state.presentationMode = next;
	}

	/** Steps from the current mode, not the stored one, so the shortcut and the buttons agree. */
	function cycleMode() {
		const from = MODES.findIndex((m) => m.value === mode);
		setMode(MODES[(from + 1) % MODES.length].value);
	}

	// ── Wire-up: events, scroll tracking, and the restore of where you left off ─────────

	// The app's window handler asks the editor which keys it takes, so it has to be able to reach it.
	$effect(() => {
		if (instance) return registerDocumentEditor(instance);
	});

	/**
	 * Height of the header the editor draws above the blocks. Scroll position is stored relative
	 * to this, not as a raw `scrollTop`: the header can come back shorter than the reader left it
	 * (the properties panel loads late) and the editor already corrects for that growth, so a raw
	 * offset would be corrected twice and land the reader a header too low.
	 */
	let blocksTop = 0;

	// Takes the scroller as an argument instead of reading `scrollEl`: the effect below sets that
	// state and measures in the same pass, and reading it back there would re-run the effect.
	function measureBlocksTop(scroller: HTMLElement | null): number {
		// `:scope >` matters: lists and tables have their own inner `.block-list`, and matching one
		// of those would measure a block instead of the header.
		const list = scroller?.querySelector(':scope > .block-list');
		if (!list || !scroller) return 0;
		return (
			list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
		);
	}

	let restored = false;

	$effect(() => {
		if (!instance || !loaded) return;
		restored = false;
		// Untracked: serializing reads the document, so tracking it would re-run this whole block
		// (listeners, restore and all) on every keystroke.
		savedBody = untrack(() => instance?.getSource() ?? null);
		const events = instance.getEvents();
		// Any edit commits the ledger, not just the paste's own. An unrelated edit arriving between
		// the import and its insertion clears it, which errs toward leaving a stray file behind
		// rather than deleting one the document still points at.
		const offEdit = events.on('edit', () => {
			pasteImports.commit();
			scheduleSave();
		});
		const offSelection = events.on('selectionChange', (selection) => {
			if (restored && selection) tab.state.selection = structuredClone(selection);
		});
		const offError = events.on('error', (err) => {
			console.error('[editor]', err.origin, err.error, err.context);
			// A clipboard failure that isn't our own import error means the pasted markdown never
			// made it in, so any file imported for it is now sitting in the source unreferenced.
			if (err.origin === 'clipboard' && !pasteImports.isOwnFailure(err.error)) {
				void pasteImports.release();
			}
		});

		const el = wrapperEl?.querySelector<HTMLElement>('.editor') ?? null;
		scrollEl = el;
		blocksTop = measureBlocksTop(el);
		const onScroll = () => {
			if (restored && el) tab.state.scrollTopBlocks = el.scrollTop - blocksTop;
		};
		el?.addEventListener('scroll', onScroll, { passive: true });
		// Re-measured on header resize rather than on every scroll event of a long document.
		const headerResize = new ResizeObserver(() => (blocksTop = measureBlocksTop(el)));
		const headerEl = el?.querySelector(':scope > .editor-header');
		if (headerEl) headerResize.observe(headerEl);

		untrack(() => void restore());

		return () => {
			offEdit();
			offSelection();
			offError();
			headerResize.disconnect();
			el?.removeEventListener('scroll', onScroll);
		};
	});

	/** The selection stored on the tab, or null if it has nothing this editor could place. */
	function rememberedSelection(): EditorSelection | null {
		const stored = $state.snapshot(tab.state.selection) as Partial<EditorSelection> | undefined;
		if (!stored?.anchor || !stored.focus) return null;
		return Array.isArray(stored.anchor.path) && Array.isArray(stored.focus.path)
			? (stored as EditorSelection)
			: null;
	}

	const DOCUMENT_START: EditorSelection = {
		anchor: { path: [0], offset: 0 },
		focus: { path: [0], offset: 0 }
	};

	async function restore() {
		// The old editor's `cursorPos`/`scrollTop` tab keys are ignored: they measure a flat
		// character offset and a scroller with the header outside it, neither of which exists here.
		const selection = rememberedSelection();
		// Restoring can fail (a file edited outside the app may no longer have the block that
		// selection names), and setSelection reports that by returning false rather than throwing.
		const placed = selection ? await instance?.setSelection(selection) : false;
		// It also returns false in cases where the caret did land, so ask the editor before giving
		// up. An open document has to be typable, and focusing the root leaves no caret, hence last.
		const hasCaret = placed || (!!selection && instance?.getSelection() != null);
		if (!hasCaret && !flow && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
		if (typeof tab.state.scrollTopBlocks === 'number' && scrollEl) {
			blocksTop = measureBlocksTop(scrollEl);
			scrollEl.scrollTop = tab.state.scrollTopBlocks + blocksTop;
		}
		// Last: persisting mid-restore would save values the restore is about to overwrite.
		restored = true;
	}

	/**
	 * Puts the caret at the end of the document, for a click in the empty space below a flow entry
	 * that the editor itself never sees. The instance hands out no parsed document, hence the
	 * re-parse to count blocks; an over-large offset is clamped by the editor.
	 */
	export async function focusEntryEnd(): Promise<boolean> {
		if (!instance) return false;
		const last = parse(instance.getSource()).children.length - 1;
		if (last < 0) return false;
		const end = { path: [last], offset: Number.MAX_SAFE_INTEGER };
		return instance.setSelection({ anchor: end, focus: end });
	}

	// ── Services the editor delegates to the app ────────────────────────────────────────

	const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

	function resolveImageUrl(target: string): string {
		// Anything that already has a scheme is the editor's to judge; rewriting it would turn a
		// URL limestone does not own (`appasset:`) into a path.
		if (!handle || HAS_SCHEME.test(target)) return target;
		const clean = target.replace(/\\/g, '/').replace(/^\.?\//, '');
		if (!isImageTarget(clean)) return target;
		const loc = handle.source.asset_location.replace(/^\/+|\/+$/g, '');
		const rel = clean.includes('/') || !loc ? clean : `${loc}/${clean}`;
		return convertFileSrc(`${handle.source.path}/${rel}`);
	}

	function onLinkActivate(url: string, event: MouseEvent) {
		event.preventDefault();
		if (/^https?:/i.test(url)) void openUrl(url);
	}

	const MIME_EXTS: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/svg+xml': 'svg',
		'image/bmp': 'bmp',
		'image/avif': 'avif'
	};

	// Anything still uncommitted at teardown is left on disk on purpose: a tab closing mid-paste
	// cannot tell an insertion that failed from one whose markdown already landed.
	const pasteImports = createPasteImportLedger({
		deleteAsset: async (relPath) => {
			if (handle) await deleteSourceAsset(handle.source.id, relPath);
		}
	});

	async function onPasteImage(image: PastedImage): Promise<string | null> {
		if (!handle) return null;
		let relPath: string;
		try {
			relPath = await importSourceAssetBytes(
				handle.source.id,
				await image.blob.arrayBuffer(),
				MIME_EXTS[image.mimeType] ?? 'png'
			);
		} catch (e) {
			// The editor reports this on the same `clipboard` error channel as a failed insertion,
			// and the paste's other images still land, so the error handler must not delete on it.
			pasteImports.markOwnFailure(e);
			throw e;
		}
		pasteImports.record(relPath);
		return `![[${relPath}]]`;
	}

	// ── UI the editor doesn't provide: zoom and the mode toggle ─────────────────────────

	function onKeydown(e: KeyboardEvent) {
		// The same match the window handler stands down on, so the two cannot disagree.
		const shortcut = appEditorShortcut(e);
		if (!shortcut) return;
		// The hero's title input sits inside the editor's header, so without this, typing a rename
		// would flip the mode. Blocks are contenteditable, not form fields, so they are unaffected.
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		e.preventDefault();
		if (shortcut === 'zoom-in') setZoom(zoom + 1);
		else if (shortcut === 'zoom-out') setZoom(zoom - 1);
		else {
			cycleMode();
			// Reading mode is read-only, so focus falls to <body>, outside this wrapper's handler.
			// Take it back after the re-render or the shortcut cannot cycle out again.
			void tick().then(() => scrollEl?.focus());
		}
	}

	async function deleteDoc() {
		if (!handle) return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		pendingSource = null;
		// Set before the delete, not after: a save flushing while the delete is in flight reads the
		// editor's live text and would write the file back after the backend removed it.
		deleted = true;
		try {
			await handle.delete();
			editor?.closeTab(tab.id, false);
		} catch (e) {
			deleted = false;
			console.error('delete failed', e);
		}
	}

	onDestroy(() => {
		unregisterFlush();
		flushSave();
		const selection = restored ? instance?.getSelection() : null;
		if (selection) tab.state.selection = structuredClone(selection);
	});
</script>

{#snippet documentHeader()}
	{#if handle}
		<DocumentHero
			{handle}
			onDelete={deleteDoc}
			onDuplicated={(d) => editor?.openDoc(d)}
			compact={false}
			bind:propsOpen
		/>
	{/if}
	<div class="mode-toggle" role="group" aria-label="Editor mode">
		{#each MODES as { value, label } (value)}
			<button
				type="button"
				class:active={mode === value}
				aria-pressed={mode === value}
				onclick={() => setMode(value)}>{label}</button
			>
		{/each}
	</div>
{/snippet}

<div
	class="doc-editor"
	class:flow
	bind:this={wrapperEl}
	style="--ls-zoom: {zoom}px"
	onkeydowncapture={onKeydown}
	role="presentation"
>
	{#if flow && handle}
		<DocumentHero
			{handle}
			onDelete={deleteDoc}
			onDuplicated={(d) => editor?.openDoc(d)}
			compact
			bind:propsOpen
		/>
	{/if}
	{#if loaded}
		<Editor
			bind:this={instance}
			source={content}
			scrollMode={flow ? 'host' : 'self'}
			header={flow ? undefined : documentHeader}
			theme={currentThemeType()}
			presentationMode={mode}
			blockDragHandles={false}
			searchBarAnchor={flow ? findBarAnchor : undefined}
			plugins={EDITOR_PLUGINS}
			{resolveImageUrl}
			{onLinkActivate}
			{onPasteImage}
		/>
	{/if}
	{#if !flow}
		<ScrollThumb scroller={scrollEl} top={THUMB_TOP_PX} />
	{/if}
</div>

<style>
	.doc-editor {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.doc-editor.flow {
		display: block;
		height: auto;
	}

	/* The app pane already draws the frame, and the native scrollbar would double up with
	   ScrollThumb. The padding stays: it is the document's only margin once the page column
	   stops centring, and it keeps the hero off the top edge. Selected through the wrapper
	   because a bare `.editor` rule loses to the editor component's own scoped one. */
	.doc-editor :global(.editor) {
		border: none;
		border-radius: 0;
		scrollbar-width: none;
	}

	.doc-editor :global(.editor::-webkit-scrollbar) {
		display: none;
	}

	/* Same page column as its neighbours, so the toggle's right edge is the document's. Without
	   it, `flex-end` aligns to the editor root's padding, far outside the text column. */
	.mode-toggle {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
		box-sizing: border-box;
		width: 100%;
		max-width: var(--page-max-width, 1200px);
		margin: 0 auto;
		padding: 0 24px;
	}

	.mode-toggle button {
		padding: 3px 9px;
		border: none;
		border-radius: var(--radius-ui, 4px);
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
	}

	.mode-toggle button:hover {
		color: var(--color-text-primary);
	}

	.mode-toggle button.active {
		background: var(--color-border);
		color: var(--color-text-primary);
	}
</style>
