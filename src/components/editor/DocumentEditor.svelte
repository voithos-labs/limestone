<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { Editor } from 'aragonite';
	import type { EditorInstance, EditorSelection, PastedImage, PresentationMode } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	// Loaded after aragonite's own palette, which is what lets the bridge win over it.
	import './editor-tokens.css';
	import { EDITOR_PLUGINS } from './editor-plugins';
	import { isImageTarget } from './image-targets';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { importSourceAssetBytes } from '$lib/services/assets';
	import { currentThemeType } from '$lib/services/theme.svelte';
	import { getSetting } from '$lib/models/Settings.svelte';
	import { registerFlush } from '$lib/util/flush';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type EditorStateModel from '$lib/models/EditorState.svelte.js';
	import DocumentHero from '../DocumentHero.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';

	let {
		tab,
		editor,
		flow = false
	}: { tab: TabState; editor?: EditorStateModel; flow?: boolean } = $props();

	let handle = $derived(tab.handle);
	let instance = $state<EditorInstance>();
	let wrapperEl = $state<HTMLDivElement | null>(null);
	// aragonite's `.editor` root, which owns the scroll outside flow mode. Queried after
	// mount rather than bound, and `$state` because ScrollThumb reads it as a prop.
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

	// ── Save: edit events → debounce → the source the editor serialized ─────────────────

	const SAVE_DEBOUNCE_MS = 250;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Captured when the edit lands, so a flush that outlives the editor instance (window close,
	// tab teardown) still has a body to write.
	let pendingSource: string | null = null;
	// The body as the editor serializes it, last written or as handed over. Comparing against it
	// keeps an untouched document unwritten even when the editor's bytes differ from the disk's.
	let savedBody: string | null = null;
	// A deleted document must not be resurrected by the flush its own teardown triggers.
	let deleted = false;

	function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		// Read live: the `edit` event is debounced for undo batching, so its last snapshot can be a
		// whole typing burst behind. `pendingSource` covers a flush with no instance left to read.
		const body = deleted ? null : (instance?.getSource() ?? pendingSource);
		pendingSource = null;
		if (body === null || body === savedBody) return;
		// Advanced only once the write lands: a baseline moved on the way out would call a failed
		// save saved, and the retry behind it would be skipped as a no-op.
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

	/** aragonite's `preview-block` rung is deliberately not among them. */
	function isOfferedMode(value: unknown): value is PresentationMode {
		return MODES.some((m) => m.value === value);
	}

	// A tab remembers its mode only once the reader picks one; until then the global
	// setting seeds it, so `tab.state.presentationMode` is written by setMode alone.
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

	/** Steps from the live mode, not a remembered one, so the chord and the toggle buttons compose. */
	function cycleMode() {
		const from = MODES.findIndex((m) => m.value === mode);
		setMode(MODES[(from + 1) % MODES.length].value);
	}

	// ── Wire-up: events, scroll tracking, and the restore of where you left off ─────────

	/**
	 * Height of the header the editor renders above the blocks. Scroll is persisted relative to it,
	 * never as a raw `scrollTop`: the header can reopen shorter than the reader left it (its
	 * properties panel loads async), and the editor compensates for that growth itself — a raw
	 * offset would be corrected twice and land the reader a header's growth too low.
	 */
	let blocksTop = 0;

	// A parameter, not a read of `scrollEl`: the wire-up effect writes that state and measures in
	// the same pass, and reading it back there would re-run the effect against its own teardown.
	function measureBlocksTop(scroller: HTMLElement | null): number {
		// `:scope >` is load-bearing — nested list and table blocks carry `.block-list` too, and one
		// of those measures a block, not the header.
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
		// Untracked: serializing reads the document, and a dependency on it would re-run this
		// whole wire-up — listeners, restore and all — on every keystroke.
		savedBody = untrack(() => instance?.getSource() ?? null);
		const events = instance.getEvents();
		const offEdit = events.on('edit', scheduleSave);
		const offSelection = events.on('selectionChange', (selection) => {
			if (restored && selection) tab.state.selection = structuredClone(selection);
		});
		const offError = events.on('error', (err) =>
			console.error('[editor]', err.origin, err.error, err.context)
		);

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

	/** A persisted selection, or null when the tab carries none this editor can place. */
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
		// The previous editor's `cursorPos`/`scrollTop` tab keys are ignored: both address a
		// flat-offset, header-outside-the-scroller space this editor does not have.
		const selection = rememberedSelection();
		// A remembered selection can fail — a file that shrank outside the app no longer holds the
		// block its path names — and `setSelection` reports that by returning false, not throwing.
		const placed = selection ? await instance?.setSelection(selection) : false;
		// `false` covers placed-but-out-of-view shapes too, so only a caretless editor falls back.
		// An opened document must be typable, and root focus parks without a caret — hence last.
		const hasCaret = placed || (!!selection && instance?.getSelection() != null);
		if (!hasCaret && !flow && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
		if (typeof tab.state.scrollTopBlocks === 'number' && scrollEl) {
			blocksTop = measureBlocksTop(scrollEl);
			scrollEl.scrollTop = tab.state.scrollTopBlocks + blocksTop;
		}
		// Only now: persisting mid-restore would write values the restore is about to re-state.
		restored = true;
	}

	// ── Services the editor delegates to the app ────────────────────────────────────────

	const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

	function resolveImageUrl(target: string): string {
		// Anything already carrying a scheme is the editor's own allowlist to judge —
		// rebasing it would mangle a URL limestone does not own (`appasset:`) into a path.
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

	async function onPasteImage(image: PastedImage): Promise<string | null> {
		if (!handle) return null;
		const relPath = await importSourceAssetBytes(
			handle.source.id,
			await image.blob.arrayBuffer(),
			MIME_EXTS[image.mimeType] ?? 'png'
		);
		return `![[${relPath}]]`;
	}

	// ── Chrome the editor doesn't own: zoom and the presentation toggle ─────────────────

	function onKeydown(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		// The hero's title input rides in the editor's header slot, so a rename would otherwise flip
		// the mode under the reader. Blocks are contenteditable, never fields, so they are unaffected.
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		if (e.key === '=' || e.key === '+') {
			e.preventDefault();
			setZoom(zoom + 1);
		} else if (e.key === '-') {
			e.preventDefault();
			setZoom(zoom - 1);
		} else if (e.key.toLowerCase() === 'e' && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			cycleMode();
			// Reading mode is read-only, so focus drops to <body>, past this wrapper-scoped handler.
			// Reclaimed after the mode's re-render so the chord that steps back out still lands.
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
		// Before the delete, not after it: a flush landing while the delete is in flight reads the
		// editor's live source, and would write back the file the backend has just removed.
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

	/* The app pane already provides the frame, and the native scrollbar would double up with
	   ScrollThumb. The padding stays: it is the document's only margin once the page column
	   stops centring, and it spaces the hero off the top edge. Reached through the wrapper
	   because a bare `.editor` selector loses to the editor component's own scoped rule. */
	.doc-editor :global(.editor) {
		border: none;
		border-radius: 0;
		scrollbar-width: none;
	}

	.doc-editor :global(.editor::-webkit-scrollbar) {
		display: none;
	}

	/* Takes the page column its neighbours take, so the toggle's right edge is the document's.
	   Without it `flex-end` aligns to the editor root's padding, far outside the text column. */
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
