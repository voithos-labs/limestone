<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
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
	// Captured when the edit lands, not read back at flush time: a flush can outlive the
	// editor instance (window close, tab teardown), and a saved body must not depend on it.
	let pendingSource: string | null = null;

	function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (pendingSource === null) return;
		const body = pendingSource;
		pendingSource = null;
		return handle?.saveContent(body).catch((e) => console.error('saveContent failed', e));
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

	// ── Wire-up: events, scroll tracking, and the restore of where you left off ─────────

	let restored = false;

	$effect(() => {
		if (!instance || !loaded) return;
		restored = false;
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
		const onScroll = () => {
			if (restored && el) tab.state.scrollTop = el.scrollTop;
		};
		el?.addEventListener('scroll', onScroll, { passive: true });

		untrack(() => void restore());

		return () => {
			offEdit();
			offSelection();
			offError();
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
		// A legacy numeric `tab.state.cursorPos` addresses CodeMirror's flat offset space
		// and has no meaning against a tree of blocks, so it is deliberately ignored.
		if (selection) await instance?.setSelection(selection);
		// An opened document has to be typable without a click. Focusing the editor root would
		// not do it — the root carries `tabindex="-1"` for parking focus and establishes no
		// caret, so keystrokes would reach nothing. Placing one is what makes it usable; the
		// root focus is only the fallback for a document with no placeable first block.
		else if (!flow && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
		if (typeof tab.state.scrollTop === 'number' && scrollEl) {
			scrollEl.scrollTop = tab.state.scrollTop;
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
		if (e.key === '=' || e.key === '+') {
			e.preventDefault();
			setZoom(zoom + 1);
		} else if (e.key === '-') {
			e.preventDefault();
			setZoom(zoom - 1);
		} else if (e.key.toLowerCase() === 'e' && !e.shiftKey && !e.altKey) {
			e.preventDefault();
			setMode(mode === 'reading' ? 'preview-inline' : 'reading');
		}
	}

	async function deleteDoc() {
		if (!handle) return;
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		pendingSource = null;
		try {
			await handle.delete();
			editor?.closeTab(tab.id, false);
		} catch (e) {
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

	.mode-toggle {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
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
