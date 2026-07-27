<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { Editor } from 'aragonite';
	import type { EditorInstance, EditorSelection, PastedImage, PresentationMode } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';
	// Loaded after aragonite's own palette, which is what lets the bridge win over it.
	import './editor-tokens.css';
	import { EDITOR_PLUGINS } from './editor-plugins';
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
	// The body as the editor itself serializes it, last written or as it was handed over. What a
	// flush compares against, so an untouched document is never rewritten — not even when the
	// editor's serialization of it differs from the bytes on disk.
	let savedBody: string | null = null;
	// A deleted document must not be resurrected by the flush its own teardown triggers.
	let deleted = false;

	function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		// The editor's model is current the moment a key lands, but its `edit` event is debounced
		// for undo batching — so the last event's snapshot can be a whole burst behind, and a
		// reader who types and immediately quits would lose it. The fallback covers a flush with
		// no instance left to read; removing it would leave the window-close scenario in
		// `editor-save.spec.ts` as the only cover for the live read.
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
		// Every route into reading records the mode it left — chord, toggle button, alike — so
		// Mod+E hands the reader back a mode they chose. On the tab, not in a local, or the memory
		// dies with the component: leaving the document and returning is a remount.
		if (next === 'reading' && mode !== 'reading') tab.state.modeBeforeReading = mode;
		mode = next;
		tab.state.presentationMode = next;
	}

	function toggleReading() {
		if (mode !== 'reading') return setMode('reading');
		const remembered = tab.state.modeBeforeReading;
		setMode(isOfferedMode(remembered) && remembered !== 'reading' ? remembered : 'preview-inline');
	}

	// ── Wire-up: events, scroll tracking, and the restore of where you left off ─────────

	/**
	 * Where the document's blocks begin inside the scroller — the height of the header the editor
	 * renders above them, cached because the scroll listener reads it on every event.
	 *
	 * Scroll positions are persisted relative to it, never as a raw `scrollTop`: the header can be
	 * shorter when a document is reopened than it was when the reader left (its properties panel
	 * loads asynchronously), and the editor compensates for that growth with a relative scroll
	 * write of its own. A raw offset would be corrected twice over — once by this restore, once by
	 * that compensation — and land the reader the header's growth below where they were.
	 */
	let blocksTop = 0;

	function measureBlocksTop(): number {
		// The editor's own top-level list, addressed as aragonite addresses it: a nested list or
		// table block carries `.block-list` too, and one of those measures a block, not the header.
		const list = scrollEl?.querySelector(':scope > .block-list');
		if (!list || !scrollEl) return 0;
		return (
			list.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
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
		blocksTop = measureBlocksTop();
		const onScroll = () => {
			if (restored && el) tab.state.scrollTopBlocks = el.scrollTop - blocksTop;
		};
		el?.addEventListener('scroll', onScroll, { passive: true });
		// The header's own height is the only term that offset depends on, so it is re-measured
		// when the header resizes rather than on every scroll event of a long document.
		const headerResize = new ResizeObserver(() => (blocksTop = measureBlocksTop()));
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
		const selection = rememberedSelection();
		// Two keys the previous editor left on a tab are deliberately ignored, both because they
		// address a space this editor does not have: `cursorPos`, a flat character offset against
		// a tree of blocks, and `scrollTop`, an offset into a scroller that held the document
		// header outside it. Honouring that one would land the reader a header's height too low,
		// so the position this editor persists carries a name of its own.
		if (selection) await instance?.setSelection(selection);
		// An opened document has to be typable without a click. Focusing the editor root would
		// not do it — the root carries `tabindex="-1"` for parking focus and establishes no
		// caret, so keystrokes would reach nothing. Placing one is what makes it usable; the
		// root focus is only the fallback for a document with no placeable first block.
		else if (!flow && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
		if (typeof tab.state.scrollTopBlocks === 'number' && scrollEl) {
			blocksTop = measureBlocksTop();
			scrollEl.scrollTop = tab.state.scrollTopBlocks + blocksTop;
		}
		// Only now: a restore emits selectionChange more than once, and the first of the
		// burst can carry the pre-restore value.
		restored = true;
	}

	// ── Services the editor delegates to the app ────────────────────────────────────────

	const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
	const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

	function resolveImageUrl(target: string): string {
		// Anything already carrying a scheme is the editor's own allowlist to judge —
		// rebasing it would mangle a URL limestone does not own (`appasset:`) into a path.
		if (!handle || HAS_SCHEME.test(target)) return target;
		const clean = target.replace(/\\/g, '/').replace(/^\.?\//, '');
		const ext = clean.split('.').pop()?.toLowerCase() ?? '';
		if (!IMAGE_EXTS.has(ext)) return target;
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
		// A text field in the chrome keeps its own keystrokes — the hero's title input rides in
		// the editor's header slot, so a rename would otherwise flip the mode under the reader.
		// The document's own blocks are contenteditable, never fields, so they are unaffected.
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		if (e.key === '=' || e.key === '+') {
			e.preventDefault();
			setZoom(zoom + 1);
		} else if (e.key === '-') {
			e.preventDefault();
			setZoom(zoom - 1);
		} else if (e.key.toLowerCase() === 'e' && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			toggleReading();
			// Reading mode is read-only, so the block holding focus releases it to <body> and this
			// wrapper-scoped handler would never see the chord that returns. Claimed back after the
			// mode's own re-render, which is what drops it; the root needs no caret to route keys.
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

	/* The editor's standalone-widget frame is chrome the app pane already provides, and
	   its native scrollbar would double up with ScrollThumb. Its padding stays: the hover
	   drag handle rides in that gutter. Reached through the wrapper because a bare
	   `.editor` selector loses to the editor component's own scoped rule. */
	.doc-editor :global(.editor) {
		border: none;
		border-radius: 0;
		scrollbar-width: none;
	}

	.doc-editor :global(.editor::-webkit-scrollbar) {
		display: none;
	}

	/* Takes the page column its neighbours take — the hero above it and the block list
	   below — so the toggle ends where the document's own right edge does. Without it
	   `flex-end` aligns to the editor root's padding, far outside the text column. */
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
