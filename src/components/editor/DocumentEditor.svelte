<script lang="ts">
	import { describeError, isRetryable, splitMessage } from '$lib/overlays.svelte';
	import { onDestroy, tick, untrack } from 'svelte';
	import { Editor } from '@voithos-labs/aragonite';
	import type {
		DecorationSourceHandle,
		EditorInstance,
		EditorSelection,
		PastedImage,
		PresentationMode
	} from '@voithos-labs/aragonite';
	import '@voithos-labs/aragonite/styles/editor-theme.css';
	// yes you must load editor-tokens.css after aragonite's editor-theme.css
	import './editor-tokens.css';
	import { EDITOR_PLUGINS } from './editor-plugins';
	import { isImageTarget } from './image-embeds';
	import { createPasteImportLedger } from './paste-imports';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { deleteSourceAsset, importSourceAssetBytes } from '$lib/services/assets';
	import { currentThemeType } from '$lib/services/theme.svelte';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import { registerFlush } from '$lib/services/platform';
	import { onDocChanged, onSourceReconciled, sourceName } from '$lib/models/Source';
	import DocHandle, { readErrorKind, type ReadErrorKind } from '$lib/models/DocHandle';
	import { historyCheckpoints, historyTextAt } from '$lib/services/history';
	import GonePage from '../pages/GonePage.svelte';
	import GoneActions, { type GoneAction } from '../pages/GoneActions.svelte';
	import DocHistory, { type HistoryVersion } from '$lib/models/DocHistory.svelte';
	import View from '$lib/models/View.svelte';
	import { tagId } from '$lib/models/Tag';
	import { resolveWikiLink, touchLinkIndex } from '$lib/services/links.svelte';
	import { joinRel, targetStem } from '$lib/services/links.svelte';
	import { ACTIVATE_EVENT, type ActivateDetail } from './wikilinks';
	import { historyDecorations } from './history-decorations';
	import { bodyTags, createTagStepper, type BodyTag } from './body-tags';
	import { findHeading } from './note-links';
	import { noteLinkMenu } from './note-links';
	import { tagMenu } from './body-tags';
	import { appEditorShortcut, registerDocumentEditor } from '$lib/shortcuts';
	import { TabState, type TabContent } from '$lib/models/EditorState.svelte.js';
	import { getViewIcon } from '$lib/views/filterDisplay';
	import { LayoutList, TextAlignStart } from '@lucide/svelte';
	import type EditorStateModel from '$lib/models/EditorState.svelte.js';
	import DocumentHero from './DocumentHero.svelte';
	import { metaDialog } from '$lib/overlays.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';
	import HistoryPanel from './HistoryPanel.svelte';
	import { portal } from '$lib/util/dom';

	let {
		tab,
		settings,
		editor,
		flow = false,
		readOnly = false,
		findBarAnchor,
		dockTarget,
		showOpenFolder = true
	}: {
		tab: TabState;
		settings: SettingsState;
		editor?: EditorStateModel;
		flow?: boolean;
		/** Renders the document without a caret, for a history entry or anything else not to edit. */
		readOnly?: boolean;
		/** Where the editor should draw its find bar, for a page that scrolls the document itself. */
		findBarAnchor?: HTMLElement | null;
		/** Where a flow host wants mode bars docked: an element in its pane's positioning context. */
		dockTarget?: HTMLElement | null;
		showOpenFolder?: boolean;
	} = $props();

	let handle = $derived(tab.handle);
	// the folder the document sits in, opened in this tab so Back comes straight here
	function onOpenFolder(unitId: string, name: string, newTab = false) {
		if (!editor) return;
		View.forUnit(unitId, name)
			.then((v) => (newTab ? editor.openView(v) : editor.showViewInTab(tab, v)))
			.catch((e) => console.error('open folder failed', e));
	}

	// the folder in a tab of its own, the document staying where it is, with its setting open
	function onFolderMeta(unitId: string, name: string) {
		if (!editor) return;
		View.forUnit(unitId, name)
			.then((v) => {
				editor.openView(v);
				metaDialog.show(unitId);
			})
			.catch((e) => console.error('open folder failed', e));
	}

	function describe(content: TabContent) {
		const view = content.type === 'view' ? content.view : undefined;
		return {
			label: TabState.titleOf(content),
			icon: view ? getViewIcon(view) : TextAlignStart,
			emoji: view?.emoji
		};
	}

	const back = $derived.by(() => {
		if (!editor) return undefined;
		const prev = tab.back?.content;
		if (prev) return { ...describe(prev), go: () => editor!.goBack(tab) };
		if (tab.detail) {
			return { label: tab.detail, icon: LayoutList, go: () => editor!.closeTab(tab.id, false) };
		}
		return undefined;
	});

	const forward = $derived.by(() => {
		const next = tab.next?.content;
		if (!next || !editor) return undefined;
		return { ...describe(next), go: () => editor!.goForward(tab) };
	});
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
		unavailable = null;
		problem = null;
		if (h) void open(h);
	});

	async function open(h: DocHandle) {
		let c = '';
		try {
			c = await h.loadContent();
		} catch (e) {
			const kind = readErrorKind(e);
			const fromHistory = canRestoreKind(kind) && (await lastKnownText(h)) !== null;
			if (h !== handle) return;
			if (kind !== 'not_found' || fromHistory) {
				unavailable = { kind, held: null, fromHistory, settled: true };
				return;
			}
			h.adoptAsDraft();
		}
		if (h !== handle) return;
		content = c;
		loaded = true;
		frontmatterError = h.frontmatterError;
	}

	// ── Unavailable: the source or the file can't be read ───────────────────────────────

	type Unavailable = {
		kind: ReadErrorKind;
		held: string | null;
		fromHistory: boolean;
		settled: boolean;
	};
	let unavailable = $state<Unavailable | null>(null);
	let restoring = $state(false);
	let restoreFailed = $state(false);

	function canRestoreKind(kind: ReadErrorKind): boolean {
		return kind === 'not_found' || kind === 'invalid_data';
	}

	const canRestore = $derived(
		!!unavailable &&
			canRestoreKind(unavailable.kind) &&
			(unavailable.held !== null || unavailable.fromHistory)
	);

	async function lastKnownText(h: DocHandle): Promise<string | null> {
		try {
			const last = (await historyCheckpoints(h.id)).at(-1);
			const text = last ? await historyTextAt(h.id, last) : '';
			return text.trim() ? text : null;
		} catch {
			return null;
		}
	}

	async function retry(h: DocHandle, settle = false) {
		if (!unavailable || restoring) return;
		await h.refreshPath().catch(() => false);
		let c: string;
		try {
			c = await h.loadContent();
		} catch (e) {
			if (h !== handle || !unavailable) return;
			const settling = settle && !unavailable.settled && unavailable.held !== null;
			unavailable = {
				...unavailable,
				kind: readErrorKind(e),
				held: settling ? (instance?.getSource() ?? unavailable.held) : unavailable.held,
				settled: unavailable.settled || settle
			};
			return;
		}
		if (h !== handle || !unavailable) return;
		const held = unavailable.held;
		unavailable = null;
		frontmatterError = h.frontmatterError;
		if (!instance) {
			content = c;
			loaded = true;
			return;
		}
		savedBody = c;
		const live = instance.getSource();
		if (held !== null && live !== held) void flushSave({ body: live });
		else if (c !== live) swapContent(c, null);
	}

	async function restoreFile() {
		const h = handle;
		const u = unavailable;
		if (!h || !u || restoring) return;
		restoring = true;
		restoreFailed = false;
		try {
			const text = u.held ?? (await lastKnownText(h));
			if (text === null) throw new Error('nothing to restore');
			await h.restore(text, u.kind === 'invalid_data');
			if (h !== handle) return;
			unavailable = null;
			frontmatterError = null;
			if (instance) {
				savedBody = text;
				if (text !== instance.getSource()) swapContent(text, null);
			} else {
				content = text;
				loaded = true;
			}
		} catch (e) {
			console.error('restore failed', e);
			restoreFailed = true;
		} finally {
			restoring = false;
		}
	}

	const goneActions = $derived.by(() => {
		const out: GoneAction[] = [];
		if (canRestore)
			out.push({
				label: restoring ? 'Restoring…' : 'Restore',
				run: restoreFile,
				strong: true,
				disabled: restoring
			});
		if (unavailable && unavailable.kind !== 'not_found')
			out.push({ label: 'Try again', run: () => handle && retry(handle) });
		if (editor) out.push({ label: 'Close', run: () => editor.closeTab(tab.id, false) });
		return out;
	});

	const restoreNote = $derived(
		restoreFailed
			? "Restore didn't work. Check that the source is connected, then try again."
			: null
	);

	const sourceLabel = $derived(handle ? sourceName(handle.source) : '');

	const BANG = '<!>';
	const CAT_FACE = ' /\\_/\\\n( o.o )';

	type Problem = { title: string; detail: string | null; retry: (() => unknown) | null };
	let problem = $state.raw<Problem | null>(null);
	let saveProblem: Problem | null = null;

	function reportProblem(e: unknown, fallback: string, retry?: () => unknown): Problem {
		console.error(fallback, e);
		const [title, detail] = splitMessage(fallback);
		problem = {
			title: title.replace(/\.$/, ''),
			detail: [detail, describeError(e, '')].filter(Boolean).join(' ') || null,
			retry: retry && isRetryable(e) ? retry : null
		};
		return problem;
	}

	const problemActions = $derived.by(() => {
		const out: GoneAction[] = [];
		const retry = problem?.retry;
		if (retry)
			out.push({
				label: 'Retry',
				strong: true,
				run: () => {
					problem = null;
					return retry();
				}
			});
		out.push({ label: 'Dismiss', run: () => (problem = null) });
		return out;
	});

	const notice = $derived.by(() => {
		const u = unavailable;
		if (!u) return null;
		switch (u.kind) {
			case 'source_missing':
				return {
					headline: `the ${sourceLabel} source isn't available`,
					detail:
						"Check that the drive or folder is connected. This note opens by itself when it's back."
				};
			case 'source_permission':
				return {
					headline: `limestone can't open the ${sourceLabel} source`,
					detail: 'Check that the folder lets Limestone read it, then try again.'
				};
			case 'not_found':
				return u.held !== null
					? {
							headline: 'this note was deleted',
							detail:
								'Its file was deleted or moved outside Limestone. Restore puts it back as you see it.'
						}
					: {
							headline: "this note's file is gone",
							detail: 'It was deleted or moved outside Limestone.'
						};
			case 'permission':
				return {
					headline: "this note can't be opened",
					detail:
						"You don't have permission to read its file. Check its permissions, then try again."
				};
			case 'locked':
				return {
					headline: 'this note is in use',
					detail: 'Another app is holding its file. Close it there, then try again.'
				};
			case 'invalid_data':
				return {
					headline: "this note isn't readable",
					detail: canRestore
						? "Its file isn't text anymore and may be damaged. Restore replaces it with the last version Limestone saw."
						: "Its file isn't text anymore and may be damaged."
				};
			default:
				return {
					headline: "this note couldn't be opened",
					detail: 'Something went wrong reading its file. Try again in a moment.'
				};
		}
	});

	$effect(() => {
		const h = handle;
		if (!h) return;
		return onSourceReconciled((id) => {
			if (id === h.source.id && unavailable) void retry(h, true);
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
		const body =
			deleted || unavailable
				? null
				: (opts.body ?? liveBody ?? instance?.getSource() ?? pendingSource);
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
				if (saveProblem && problem === saveProblem) problem = null;
				saveProblem = null;
				if (historyOpen && history?.atPresent) void history.load();
			})
			.catch((e) => {
				saveProblem = reportProblem(e, "This note couldn't be saved.", () => flushSave());
			})
			.finally(() => {
				if (saving === write) saving = null;
			});
		saving = write;
		return write;
	}

	const unregisterFlush = registerFlush(() => flushSave());

	function scheduleSave() {
		if (liveBody !== null) return;
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
		const live = liveBody ?? instance?.getSource();
		return live !== undefined && savedBody !== null && live !== savedBody;
	}

	// The watcher reports the file changing under the editor, our own writes included. A body that
	// differs from the editor's is re-seeded, which the caret and undo history do not survive, so an
	// unsaved edit here wins over the file.
	$effect(() => {
		const h = handle;
		if (!h) return;
		return onDocChanged(h, () => void (unavailable ? retry(h) : reloadFromDisk(h)));
	});

	async function reloadFromDisk(h: DocHandle) {
		if (deleted || liveBody !== null || hasUnsavedEdits()) return;
		let fromDisk: string;
		try {
			fromDisk = await h.loadContent();
		} catch (e) {
			if (deleted || h !== handle || !instance) return;
			const held = instance.getSource();
			unavailable = { kind: readErrorKind(e), held, fromHistory: false, settled: false };
			return;
		}
		if (deleted || h !== handle || !instance || liveBody !== null || hasUnsavedEdits()) return;
		frontmatterError = h.frontmatterError;
		if (fromDisk === instance.getSource()) return;
		// Marked saved before the re-seed, so the swap cannot schedule a write of what just came in.
		savedBody = fromDisk;
		swapContent(fromDisk, null);
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

	// ── History: the slider previews a version in the same editor, read-only ────────────

	// History is the tab's too: it reopens docked at the version you left it on, until closed.
	let history = $derived(handle ? new DocHistory(handle.id) : null);
	let historyOpen = $state(untrack(() => tab.state.history_open ?? false));
	const storedHistoryAt = untrack(
		() => tab.state.history_at as { heads: string[]; time: number } | null | undefined
	);
	let restoredHistoryAt = false;
	$effect(() => {
		tab.state.history_open = historyOpen;
	});
	$effect(() => {
		const h = history;
		const cp = h?.selected;
		tab.state.history_at = h && cp && !h.atPresent ? { heads: [...cp.heads], time: cp.time } : null;
	});
	let liveBody: string | null = null;
	let liveSelection: EditorSelection | null = null;
	let previewing = $derived(history?.version != null);

	$effect(() => {
		const h = history;
		if (!historyOpen || !h) {
			untrack(() => h?.reset());
			return;
		}
		if (!loaded) return;
		untrack(() => {
			void Promise.resolve(flushSave())
				.then(() => h.load())
				.then(() => {
					if (restoredHistoryAt || !storedHistoryAt) return;
					restoredHistoryAt = true;
					return h.selectAt(storedHistoryAt.heads, storedHistoryAt.time);
				});
		});
	});

	/** The element that scrolls the document: aragonite's own root, or in flow mode the page's. */
	function scroller(): HTMLElement | null {
		if (!flow) return scrollEl;
		let el = wrapperEl?.parentElement ?? null;
		while (el && el !== document.body) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') return el;
			el = el.parentElement;
		}
		return null;
	}

	// A source swap re-seeds the editor from height estimates, which would land the reader
	// somewhere else on every slider step, so the offset is put back once the swap has rendered.
	function swapContent(next: string, shown: HistoryVersion | null) {
		const el = scroller();
		const top = el?.scrollTop ?? 0;
		const swaps = next !== content;
		swappingTo = shown;
		content = next;
		void tick().then(() => {
			if (el) {
				el.scrollTop = top;
				requestAnimationFrame(() => (el.scrollTop = top));
			}
			// same text as before, so the editor has nothing to swap and no sourceSwap comes
			if (!swaps) {
				shownVersion = shown;
				decorations?.invalidate();
			}
		});
	}

	// The version whose text the editor has actually rendered, so the decoration source never
	// maps a delta onto the wrong document during the swap.
	let shownVersion: HistoryVersion | null = null;
	// the version on its way in, shown once the editor's sourceSwap says its text is in place
	let swappingTo: HistoryVersion | null = null;

	$effect(() => {
		const version = history?.version ?? null;
		const ready = loaded && !!instance;
		untrack(() => {
			if (!ready) return;
			if (version) {
				if (liveBody === null) {
					liveBody = instance?.getSource() ?? content;
					liveSelection = instance?.getSelection() ?? null;
				}
				swapContent(version.text, version);
				return;
			}
			if (liveBody === null) return;
			swapContent(liveBody, null);
			liveBody = null;
			const selection = liveSelection;
			liveSelection = null;
			const h = handle;
			void tick().then(async () => {
				if (selection) await instance?.setSelection(selection);
				if (h) await reloadFromDisk(h);
			});
		});
	});

	let decorations: DecorationSourceHandle | null = null;

	$effect(() => {
		const inst = instance;
		const h = history;
		if (!inst || !h) return;
		const source = untrack(() =>
			inst.getDecorations().addSource({
				name: 'history',
				provide: (doc) => {
					const v = h.version;
					return v && v === shownVersion ? historyDecorations(doc, v.delta) : [];
				}
			})
		);
		decorations = source;
		const offSwap = inst.getEvents().on('sourceSwap', () => {
			shownVersion = swappingTo;
			source.invalidate();
		});
		return () => {
			offSwap();
			if (decorations === source) decorations = null;
			untrack(() => source.dispose());
		};
	});

	async function restoreVersion() {
		const version = history?.version;
		if (!version || !handle) return;
		liveBody = null;
		liveSelection = null;
		const write = flushSave({ body: version.text });
		historyOpen = false;
		await write;
	}

	// ── Tags written in the text, shown read-only in the hero's tag row ────────────────

	let textTags = $state<BodyTag[]>([]);

	$effect(() => {
		const inst = instance;
		if (!inst || !loaded) return;
		const read = () => untrack(() => (textTags = bodyTags(inst.getSource())));
		read();
		const events = inst.getEvents();
		const offEdit = events.on('edit', read);
		const offSwap = events.on('sourceSwap', read);
		return () => {
			offEdit();
			offSwap();
		};
	});

	// clicking the same text tag again goes on to the next place it's written
	const nextTagPlace = createTagStepper();

	function findTextTag(slug: string): void {
		const place = nextTagPlace(textTags, slug);
		if (place) void instance?.getRects().navigateTo(place.path, place.end);
	}

	async function removeTextTag(slug: string): Promise<void> {
		if (!instance) return;
		const body = await invoke<string | null>('strip_body_tag', {
			body: instance.getSource(),
			slug
		});
		if (body === null) return;
		content = body;
		await flushSave({ body });
	}

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
		readOnly || previewing || unavailable?.settled
			? 'reading'
			: settings.get('editor.mode') === 'source'
				? 'source'
				: 'live'
	);
	let font = $derived(settings.get<string>('editor.font') ?? 'sans-serif');

	// ── Wire-up: events, scroll tracking, and the restore of where you left off ─────────

	// The app's window handler asks the editor which keys it takes, so it has to be able to reach it.
	$effect(() => {
		if (instance) return registerDocumentEditor(instance);
	});

	// The menus that open as you type. The vault is read per keystroke, so a tab that swaps its
	// note keeps the same menus.
	$effect(() => {
		const inst = instance;
		if (!inst) return;
		const menus = inst.getInlineMenus();
		const sources = untrack(() => [
			menus.addSource(
				noteLinkMenu({
					vault: () => (handle ? { id: handle.source.id, path: handle.source.path } : null),
					currentId: () => handle?.id ?? null,
					currentText: () => inst.getSource()
				})
			),
			menus.addSource(tagMenu())
		]);
		return () => sources.forEach((s) => s.dispose());
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

	// The tab key a heading link leaves for the note it opens, read once when that note mounts
	const OPEN_AT_HEADING = 'open_at_heading';

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

	export async function focusCaret() {
		const selection = rememberedSelection();
		// Restoring can fail (a file edited outside the app may no longer have the block that
		// selection names), and setSelection reports that by returning false rather than throwing.
		const placed = selection ? await instance?.setSelection(selection) : false;
		// It also returns false in cases where the caret did land, so ask the editor before giving
		// up. An open document has to be typable, and focusing the root leaves no caret, hence last.
		const hasCaret = placed || (!!selection && instance?.getSelection() != null);
		if (!hasCaret && !(await instance?.setSelection(DOCUMENT_START))) scrollEl?.focus();
	}

	async function restore() {
		// The old editor's `cursorPos`/`scrollTop` tab keys are ignored: they measure a flat
		// character offset and a scroller with the header outside it, neither of which exists here.
		// Placing a caret focuses the document, so a reader typing elsewhere (quick search, a title
		// field) keeps their field; the remembered caret stays on the tab for the next open.
		// A fresh note wants its name first: the title takes focus, not the body
		if (handle?.isNew && !flow) {
			const title = wrapperEl?.querySelector<HTMLInputElement>('.title-input');
			if (title) {
				title.focus();
				title.select();
				restored = true;
				return;
			}
		}
		// Opened from a heading link: land on the heading, not where the note was left. A heading
		// that's gone falls through, so the note just opens as usual.
		const heading = tab.state[OPEN_AT_HEADING];
		if (typeof heading === 'string') {
			delete tab.state[OPEN_AT_HEADING];
			if (await jumpToHeading(heading)) {
				restored = true;
				return;
			}
		}
		// A flow host (the journal) owns the scroll, and placing a caret scrolls it into view: the
		// reader switching day would be yanked to wherever that document's caret last was. The
		// remembered caret stays on the tab for when it's opened on its own.
		const inactivePane = !!editor?.session && editor.session.active !== editor;
		if (!typingElsewhere() && !flow && !inactivePane) await focusCaret();
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

	// The editor keeps these %XX escapes as written when it rewrites a link (a width drag, say),
	// so a path limestone wrote still reads back as the same URL.
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
		if (/^https?:/i.test(url)) {
			void openUrl(url);
			return;
		}
		if (HAS_SCHEME.test(url) || !handle) return;
		const clean = decodeDestination(url).replace(/\\/g, '/');
		if (!/\.md$/i.test(clean)) return;
		const dir = handle.relPath.includes('/') ? handle.relPath.replace(/\/[^/]*$/, '') : '';
		const target = clean.startsWith('.') ? joinRel(dir, clean) : clean.replace(/^\//, '');
		void openWikiLink(target);
	}

	async function openWikiLink(target: string, heading?: string, side = false): Promise<void> {
		const h = handle;
		if (!h || !editor) return;
		const hit = await resolveWikiLink(h.source.id, target);
		// this note is already open here and won't reopen, so its heading is jumped to in place
		if (hit?.id === h.id && !side) {
			if (heading) void jumpToHeading(heading);
			return;
		}
		let doc: DocHandle;
		if (hit) {
			doc = await DocHandle.fromID(hit.id);
		} else {
			const slash = target.lastIndexOf('/');
			doc = await DocHandle.createFromTitle(h.source, {
				title: targetStem(target),
				...(slash > 0 ? { dir: target.slice(0, slash) } : {})
			});
			touchLinkIndex();
		}
		const state = heading ? { [OPEN_AT_HEADING]: heading } : {};
		if (side) editor.beside().openDetail({ type: 'markdown', handle: doc }, h.title);
		else editor.showDocInTab(tab, doc, state);
	}

	async function openTagView(slug: string, side = false): Promise<void> {
		if (!editor) return;
		const view = await View.forUnit(tagId(slug), slug);
		if (side) editor.beside().openDetail({ type: 'view', view }, handle?.title ?? slug);
		else editor.showViewInTab(tab, view);
	}

	// Puts the caret on the heading the link names; false if the note has no such heading
	async function jumpToHeading(heading: string): Promise<boolean> {
		const inst = instance;
		const found = inst ? findHeading(inst.getSource(), heading) : null;
		if (!found) return false;
		await inst!.getRects().navigateTo(found.path);
		return true;
	}

	function onActivate(e: Event): void {
		const { kind, target, fragment, side } = (e as CustomEvent<ActivateDetail>).detail;
		if (kind === 'wikilink' && target) void openWikiLink(target, fragment, side);
		else if (kind === 'wikilink' && fragment) void jumpToHeading(fragment);
		else if (kind === 'tag') void openTagView(target, side);
	}

	$effect(() => {
		const el = wrapperEl;
		if (!el) return;
		el.addEventListener(ACTIVATE_EVENT, onActivate);
		return () => el.removeEventListener(ACTIVATE_EVENT, onActivate);
	});

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
			reportProblem(e, "The image couldn't be added.");
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
			reportProblem(e, "This note couldn't be deleted.", deleteDoc);
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
			{loaded}
			{frontmatterError}
			onFrontmatterFix={fixFrontmatter}
			bind:propsOpen
			bind:historyOpen
			{back}
			{forward}
			{onOpenFolder}
			{showOpenFolder}
			{onFolderMeta}
			{textTags}
			onTextTag={findTextTag}
			onRemoveTextTag={removeTextTag}
			onError={reportProblem}
		/>
		{@render docNotices()}
	{/if}
{/snippet}

{#snippet docNotices()}
	{#if notice && unavailable?.held != null && unavailable.settled}
		<div class="held-notice">
			<pre class="held-cat" aria-hidden="true">{CAT_FACE}</pre>
			<div class="held-text">
				<p class="ua-headline">{notice.headline} {BANG}</p>
				<p class="ua-detail">{notice.detail}</p>
			</div>
			<GoneActions actions={goneActions} note={restoreNote} />
		</div>
	{/if}
	{#if problem}
		<div class="held-notice">
			<pre class="held-cat" aria-hidden="true">{CAT_FACE}</pre>
			<div class="held-text">
				<p class="ua-headline">{problem.title} {BANG}</p>
				{#if problem.detail}<p class="ua-detail">{problem.detail}</p>{/if}
			</div>
			<GoneActions actions={problemActions} />
		</div>
	{/if}
{/snippet}

<!-- The zoom and fonts are aragonite's own type-scale root and faces, so they inherit into the
	 editor from here. Code keeps the app's monospace whatever face the document wears. The px unit
	 is load-bearing: a bare number makes the font-size rule it feeds invalid. -->
<div
	class="doc-editor"
	class:flow
	class:history-open={historyOpen}
	data-source-id={handle?.source.id}
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
			{loaded}
			{frontmatterError}
			onFrontmatterFix={fixFrontmatter}
			bind:propsOpen
			bind:historyOpen
			{back}
			{forward}
			{onOpenFolder}
			{showOpenFolder}
			{onFolderMeta}
			{textTags}
			onTextTag={findTextTag}
			onRemoveTextTag={removeTextTag}
			onError={reportProblem}
		/>
		{@render docNotices()}
	{/if}
	{#if unavailable && unavailable.held === null}
		<div class="unavailable" class:flow>
			{#if !flow}{@render documentHeader()}{/if}
			{#if notice}
				<GonePage
					headline={notice.headline}
					detail={notice.detail}
					actions={goneActions}
					note={restoreNote}
				/>
			{/if}
		</div>
	{:else if loaded}
		<Editor
			bind:this={instance}
			source={content}
			scrollMode={flow ? 'host' : 'self'}
			header={flow ? undefined : documentHeader}
			theme={currentThemeType()}
			presentationMode={mode}
			selectionToolbar={mode === 'live'}
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
	{#if historyOpen && history}
		<div class="history-dock" use:portal={flow ? dockTarget : null}>
			<HistoryPanel {history} onRestore={restoreVersion} onClose={() => (historyOpen = false)} />
		</div>
	{/if}
</div>

<style>
	.unavailable {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}

	.unavailable.flow {
		min-height: 320px;
	}

	.ua-headline {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.ua-detail {
		max-width: 360px;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-dulled);
	}

	.held-notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		max-width: calc(var(--page-max-width, 1200px) - 48px);
		margin: -16px auto 16px;
		width: calc(100% - 48px);
		padding: 12px 14px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.held-cat {
		flex-shrink: 0;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.2;
		color: var(--color-ui-dulled);
		user-select: none;
	}

	.held-notice + .held-notice {
		margin-top: -8px;
	}

	.held-text {
		display: flex;
		flex: 1 1 240px;
		flex-direction: column;
		gap: 3px;
	}

	.held-notice :global(.gone-actions) {
		justify-content: flex-start;
	}

	.held-notice .ua-detail {
		max-width: none;
	}

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

	/* In flow the host stacks entries and spaces them itself, so the hero's room above the
	   title is pulled back past the host's own gap, and the room below it is a step tighter
	   than on a page. */
	.doc-editor.flow :global(.hero-inner) {
		margin-top: -40px;
		padding-bottom: 16px;
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

	/* Docked over the document like the app's menus, so the last lines get room to scroll
	   clear of it. A flow host hands over a dock target in its own pane; without one the dock
	   falls back to the window. */
	.history-dock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 18px;
		z-index: 5;
		display: flex;
		justify-content: center;
		padding: 0 24px;
		pointer-events: none;
	}

	.history-dock > :global(*) {
		pointer-events: auto;
	}

	.doc-editor.flow .history-dock {
		position: fixed;
	}

	.doc-editor.history-open :global(.editor > .block-list) {
		padding-bottom: 160px;
	}

	.doc-editor :global(.hist-ins) {
		background: var(--accent-a22);
		border-radius: 2px;
	}

	.doc-editor :global(.hist-block) {
		box-shadow: inset 3px 0 0 var(--color-accent);
	}
</style>
