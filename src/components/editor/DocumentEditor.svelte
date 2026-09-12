<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { Editor } from '@voithos-labs/aragonite';
	import type {
		EditorInstance,
		EditorSelection,
		PastedImage,
		PresentationMode
	} from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	// yes you must load editor-tokens.css after aragonite's editor-theme.css
	import './editor-tokens.css';
	import { EDITOR_PLUGINS } from './editor-plugins';
	import { isImageTarget } from './image-targets';
	import { createPasteImportLedger } from './paste-imports';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { deleteSourceAsset, importSourceAssetBytes } from '$lib/services/assets';
	import { currentThemeType } from '$lib/services/theme.svelte';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import { registerFlush } from '$lib/util/flush';
	import { onDocChanged } from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import { appEditorShortcut, registerDocumentEditor } from '$lib/editor-chords';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type EditorStateModel from '$lib/models/EditorState.svelte.js';
	import DocumentHero from '../DocumentHero.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';

	let {
		tab,
		settings,
		editor,
		flow = false,
		readOnly = false,
		findBarAnchor
	}: {
		tab: TabState;
		settings: SettingsState;
		editor?: EditorStateModel;
		flow?: boolean;
		/** Renders the document without a caret, for a history entry or anything else not to edit. */
		readOnly?: boolean;
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
	/** Why the file's frontmatter failed to parse, which the hero shows beside its two repairs. */
	let frontmatterError = $state<string | null>(null);

	$effect(() => {
		const h = handle;
		loaded = false;
		h?.loadContent().then((c) => {
			if (h !== handle) return;
			content = c;
			loaded = true;
			frontmatterError = h.frontmatterError;
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

	// The write in flight, so a change to the file on disk is not read back over it.
	let saving: Promise<void> | null = null;

	function flushSave(opts: { body?: string; rebuildFrontmatter?: boolean } = {}) {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		// Ask the editor now: its `edit` event is debounced, so the last thing it handed us can be a
		// whole typing burst behind. `pendingSource` is the fallback when the editor is already gone.
		const body = deleted ? null : (opts.body ?? instance?.getSource() ?? pendingSource);
		pendingSource = null;
		// A frontmatter rebuild writes even an unchanged body: the repair is in the part of the file
		// the editor never holds.
		if (!handle || body === null || (body === savedBody && !opts.rebuildFrontmatter)) return;
		// Moved only once the write lands: setting it earlier would mark a failed save as saved,
		// and the next attempt would be skipped as a no-op.
		const write: Promise<void> = handle
			.saveContent(body, opts)
			.then(() => {
				savedBody = body;
			})
			.catch((e) => console.error('saveContent failed', e))
			.finally(() => {
				if (saving === write) saving = null;
			});
		saving = write;
		return write;
	}

	const unregisterFlush = registerFlush(() => flushSave());

	function scheduleSave() {
		pendingSource = instance?.getSource() ?? pendingSource;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
	}

	// ── Outside edits, and the frontmatter repair ───────────────────────────────────────

	/**
	 * Whether an edit here is still on its way to disk, so nothing from disk may replace it. The
	 * editor batches its edit event, so a keystroke runs ahead of the save timer it will schedule;
	 * the document itself is asked, not just the timers.
	 */
	function hasUnsavedEdits(): boolean {
		if (saveTimer !== null || saving !== null) return true;
		return !!instance && savedBody !== null && instance.getSource() !== savedBody;
	}

	// The watcher reports the file changing under the editor, our own writes included. A body that
	// differs from the editor's is re-seeded, which the caret and undo history do not survive, so an
	// unsaved edit here wins over the file.
	$effect(() => {
		const h = handle;
		if (!h) return;
		return onDocChanged(h, () => void reloadFromDisk(h));
	});

	async function reloadFromDisk(h: DocHandle) {
		if (deleted || hasUnsavedEdits()) return;
		const fromDisk = await h.loadContent();
		if (deleted || h !== handle || !instance || hasUnsavedEdits()) return;
		frontmatterError = h.frontmatterError;
		if (fromDisk === instance.getSource()) return;
		// Marked saved before the re-seed, so the swap cannot schedule a write of what just came in.
		savedBody = fromDisk;
		content = fromDisk;
	}

	/**
	 * The hero's two answers to frontmatter that would not parse: keep it as the document's first
	 * lines, or drop it. Either way a fresh frontmatter is written, and the file is read back so the
	 * warning clears on what is actually on disk.
	 */
	async function fixFrontmatter(mode: 'keep' | 'rebuild') {
		const h = handle;
		if (!h || !instance) return;
		const live = instance.getSource();
		const body = mode === 'rebuild' ? DocHandle.stripFence(live) : live;
		// The save takes the body directly rather than waiting on the re-seed to reach the editor.
		if (body !== live) content = body;
		await flushSave({ body, rebuildFrontmatter: true });
		await tick();
		await reloadFromDisk(h);
	}

	// ── Per-tab state ───────────────────────────────────────────────────────────────────

	// Persisted on the tab, so a doc reopens with its properties panel as you left it
	let propsOpen = $state(untrack(() => tab.state.props_open ?? false));
	$effect(() => {
		tab.state.props_open = propsOpen;
	});

	let zoom = $state(
		untrack(() => tab.state.zoom ?? settings.get<number>('editor.font_size') ?? 16)
	);

	function setZoom(next: number) {
		zoom = Math.max(10, Math.min(40, next));
		tab.state.zoom = zoom;
	}

	// The mode and font are global, not the tab's: every open document follows the setting as it
	// changes.
	let mode = $derived<PresentationMode>(
		readOnly ? 'reading' : settings.get('editor.mode') === 'source' ? 'source' : 'live'
	);
	let font = $derived(settings.get<string>('editor.font') ?? 'sans-serif');

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

	/** Whether the reader is mid-word in a field that is not a block of this document. */
	function typingElsewhere(): boolean {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return false;
		if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true;
		return active.isContentEditable && !scrollEl?.contains(active);
	}

	async function restore() {
		// The old editor's `cursorPos`/`scrollTop` tab keys are ignored: they measure a flat
		// character offset and a scroller with the header outside it, neither of which exists here.
		// Placing a caret focuses the document, so a reader typing elsewhere (quick search, a title
		// field) keeps their field; the remembered caret stays on the tab for the next open.
		if (!typingElsewhere()) {
			const selection = rememberedSelection();
			// Restoring can fail (a file edited outside the app may no longer have the block that
			// selection names), and setSelection reports that by returning false rather than throwing.
			const placed = selection ? await instance?.setSelection(selection) : false;
			// It also returns false in cases where the caret did land, so ask the editor before giving
			// up. An open document has to be typable, and focusing the root leaves no caret, hence last.
			const hasCaret = placed || (!!selection && instance?.getSelection() != null);
			if (!hasCaret && !flow && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
		}
		if (typeof tab.state.scrollTopBlocks === 'number' && scrollEl) {
			blocksTop = measureBlocksTop(scrollEl);
			scrollEl.scrollTop = tab.state.scrollTopBlocks + blocksTop;
		}
		// Last: persisting mid-restore would save values the restore is about to overwrite.
		restored = true;
	}

	/**
	 * The editor's caret-from-a-point door, opened up for the page around it: the page answers the
	 * clicks on blank space the editor never sees, and the editor decides where the caret lands.
	 */
	export function placeCaretAtPoint(x: number, y: number): boolean {
		return instance?.placeCaretAtPoint(x, y) ?? false;
	}

	// ── Services the editor delegates to the app ────────────────────────────────────────

	const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

	// The same set aragonite escapes when it writes a destination itself, so a path limestone
	// wrote and one the editor rewrote (a width drag, say) read back the same way.
	function encodeDestination(url: string): string {
		return url.replace(
			/[ \t\r\n()"'\\]/g,
			(c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
		);
	}

	function decodeDestination(url: string): string {
		try {
			return decodeURIComponent(url);
		} catch {
			return url;
		}
	}

	function resolveImageUrl(target: string): string {
		// Anything that already has a scheme is the editor's to judge; rewriting it would turn a
		// URL limestone does not own (`appasset:`) into a path.
		if (!handle || HAS_SCHEME.test(target)) return target;
		// The destination arrives as written, escapes included; the file system wants the name.
		const clean = decodeDestination(target)
			.replace(/\\/g, '/')
			.replace(/^\.?\//, '');
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
		return `![](${encodeDestination(relPath)})`;
	}

	// ── UI the editor doesn't provide: zoom ─────────────────────────────────────────────

	function onKeydown(e: KeyboardEvent) {
		// The same match the window handler stands down on, so the two cannot disagree.
		const shortcut = appEditorShortcut(e);
		if (!shortcut) return;
		// The hero's title input sits inside the editor's header, so without this, typing a rename
		// would flip the mode. Blocks are contenteditable, not form fields, so they are unaffected.
		if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
		e.preventDefault();
		setZoom(shortcut === 'zoom-in' ? zoom + 1 : zoom - 1);
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
			{frontmatterError}
			onFrontmatterFix={fixFrontmatter}
			bind:propsOpen
		/>
	{/if}
{/snippet}

<!-- The zoom and fonts are aragonite's own type-scale root and faces, so they inherit into the
	 editor from here. Code keeps the app's monospace whatever face the document wears. The px unit
	 is load-bearing: a bare number makes the font-size rule it feeds invalid. -->
<div
	class="doc-editor"
	class:flow
	bind:this={wrapperEl}
	style="--editor-font-size: {zoom}px; --font-editor: {font}; --font-code: var(--font-mono)"
	onkeydowncapture={onKeydown}
	role="presentation"
>
	{#if flow && handle}
		<DocumentHero
			{handle}
			onDelete={deleteDoc}
			onDuplicated={(d) => editor?.openDoc(d)}
			compact
			{frontmatterError}
			onFrontmatterFix={fixFrontmatter}
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
			blockDragHandles={true}
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
	{#if mode === 'live'}
		<SelectionToolbar {instance} />
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
</style>
