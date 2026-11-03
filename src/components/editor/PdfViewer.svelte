<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type {
		PageViewport,
		PDFDocumentLoadingTask,
		PDFDocumentProxy,
		PDFPageProxy,
		RenderTask,
		TextLayer
	} from 'pdfjs-dist/legacy/build/pdf.mjs';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import type { TabState } from '#lib/models/EditorState.svelte.js';
	import type EditorState from '#lib/models/EditorState.svelte.js';
	import { readErrorKind, type ReadErrorKind } from '#lib/models/MarkdownHandle.js';
	import MarkdownHandle from '#lib/models/MarkdownHandle.js';
	import { sourceName } from '#lib/models/Source.js';
	import StepHistory, { type Step } from '#lib/models/StepHistory.svelte.js';
	import { mark, reportError, toasts, undoHint, type MenuEntry } from '#lib/overlays.svelte.js';
	import {
		INK_COLORS,
		pagesOf,
		rectsOn,
		type Annotation,
		type AnnotationColor,
		type InkColor,
		type InkWidth,
		type PageRect
	} from '#lib/pdf/annotation.js';
	import {
		inLasso,
		moveStrokes,
		nearStroke,
		simplify,
		strokesBox,
		type LooseStroke
	} from '#lib/pdf/ink.js';
	import LooseInk from '#lib/pdf/looseInk.svelte.js';
	import { openPdf, pdfLib, type PdfLib } from '#lib/pdf/open.js';
	import PdfAnnotations from '#lib/pdf/annotations.svelte.js';
	import { boxTarget, pagePoint, textRange, textTarget, type TextTarget } from '#lib/pdf/anchor.js';
	import { carryOver, type Placement, type TextPoint, type Unplaced } from '#lib/pdf/migrate.js';
	import { loadPdf } from '#lib/pdf/crop.js';
	import {
		canvasScale,
		holdRange,
		keepPlace,
		layoutPages,
		pageAt as pageIndexAt,
		pagesBetween,
		type PageLayout,
		type PageRange
	} from '#lib/pdf/layout.js';
	import { scrollParent } from '#lib/util/dom.js';
	import {
		OPEN_AT_ANNOTATION,
		citedIn,
		copyCitation,
		copyLink,
		type Citing
	} from '#lib/pdf/citation.js';
	import { linkIndex } from '#lib/services/links.svelte.js';
	import { appEditorShortcut } from '#lib/shortcuts.js';
	import { currentThemeType } from '#lib/services/theme.svelte.js';
	import DocumentHero from './DocumentHero.svelte';
	import { backPlace, forwardPlace, openFolder, openFolderMeta } from './tabPlaces.js';
	import GonePage from '../pages/GonePage.svelte';
	import type { GoneAction } from '../pages/GoneActions.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';
	import Menu from '../ui/Menu.svelte';
	import PageMarks from '../pdf/PageMarks.svelte';
	import SideNotes from '../pdf/SideNotes.svelte';
	import type { NoteActions } from '../pdf/SideNote.svelte';
	import MarginMarkers from '../pdf/MarginMarkers.svelte';
	import SelectionMenu from '../pdf/SelectionMenu.svelte';
	import PdfDock, { toolForKey, type PdfTool } from '../pdf/PdfDock.svelte';
	import InkTray, { modeForKey, type InkMode } from '../pdf/InkTray.svelte';
	import PdfDigest from '../pdf/PdfDigest.svelte';
	import AnnotationTicks from '../pdf/AnnotationTicks.svelte';
	import NotPlaced from '../pdf/NotPlaced.svelte';
	import PlaceHint from '../pdf/PlaceHint.svelte';
	import { INK_RGB } from '../pdf/colors.js';
	import { MessageSquare, Pin, Quote, SquareArrowOutUpRight, Trash2 } from '@lucide/svelte';
	import { editionDate, editionOf, editionPath, isPreserved } from '#lib/pdf/edition.js';
	import type PdfHandle from '#lib/models/PdfHandle.js';

	let {
		tab,
		editor,
		flow = false,
		showOpenFolder = true
	}: { tab: TabState; editor?: EditorState; flow?: boolean; showOpenFolder?: boolean } = $props();

	type Failure = ReadErrorKind | 'password' | 'damaged';

	const MAX_PAGE_WIDTH = 1000;
	const SIDE_PAD = 24;
	const MIN_PAGE_WIDTH = 560;
	const RAIL_WIDTH = 300;
	const RAIL_GAP = 24;
	const PAGE_GAP = 10;
	const RESIZE_SETTLE_MS = 120;
	// pages within this of the view are mounted and drawn, and stay until they're twice as far
	const MOUNT_MARGIN = 1200;
	const KEEP_MARGIN = 2400;
	const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

	const handle = $derived(tab.content.type === 'pdf' ? tab.content.handle : null);

	let lib: PdfLib | null = null;
	let pdf: PDFDocumentProxy | null = $state.raw(null);
	// each page's width over height: page one's until a page is fetched and says otherwise
	let ratios: number[] = $state.raw([]);
	let failure: Failure | null = $state(null);
	let attempt = $state(0);
	let paneW = $state(0);
	// the reading column a note gets, which the page and its margin share
	let columnMax = $state(MAX_PAGE_WIDTH);
	// dark pages follow the app's theme until this PDF's own toggle says otherwise
	const savedDark = untrack(() => tab.state.pdf_dark);
	let darkChoice = $state<boolean | undefined>(
		typeof savedDark === 'boolean' ? savedDark : undefined
	);
	const dark = $derived(darkChoice ?? currentThemeType() === 'dark');
	const savedZoom = untrack(() => tab.state.pdf_zoom);
	let zoom = $state(typeof savedZoom === 'number' ? savedZoom : 1);
	const column = $derived(Math.min(columnMax, paneW - SIDE_PAD * 2));
	// The margin fits once a page beside it still reads comfortably. The page keeps the size it has
	// beside the margin whether or not the margin shows, so showing it only moves the page.
	const railFits = $derived(column >= MIN_PAGE_WIDTH + RAIL_GAP + RAIL_WIDTH);
	const fitWidth = $derived(
		Math.max(0, Math.min(MAX_PAGE_WIDTH, column - (railFits ? RAIL_GAP + RAIL_WIDTH : 0)))
	);
	// a zoomed page never runs wider than the pane, which the column would squeeze it to anyway
	const width = $derived(Math.round(Math.min(fitWidth * zoom, paneW)));
	let rootEl: HTMLDivElement | undefined = $state();
	let scrollEl: HTMLDivElement | undefined = $state();
	// in flow the page scrolls, not the viewer
	let hostScroller: HTMLElement | null = $state.raw(null);

	let propsOpen = $state(false);
	const back = $derived(backPlace(editor, tab));
	const forward = $derived(forwardPlace(editor, tab));
	const onOpenFolder = (unitId: string, name: string, newTab = false) =>
		openFolder(editor, tab, unitId, name, newTab);
	const onFolderMeta = (unitId: string, name: string) => openFolderMeta(editor, unitId, name);

	async function deleteDoc() {
		const h = handle;
		if (!h) return;
		const go = back;
		try {
			await h.delete();
			if (go) {
				go.go();
				tab.forward.length = 0;
			} else editor?.closeTab(tab.id, false);
		} catch (e) {
			reportError(e, `${mark('note', h.title)} couldn't be deleted.`, deleteDoc);
		}
	}

	function failureOf(e: unknown): Failure {
		const name = (e as { name?: string } | null)?.name;
		if (name === 'PasswordException') return 'password';
		if (name === 'InvalidPDFException') return 'damaged';
		return readErrorKind(e);
	}

	$effect(() => {
		const h = handle;
		const old = viewing;
		void attempt;
		if (!h) return;
		let cancelled = false;
		let task: PDFDocumentLoadingTask | null = null;
		failure = null;
		void (async () => {
			try {
				const [mod, opening] = await Promise.all([
					pdfLib(),
					old
						? openPdf({
								sourceId: h.source.id,
								sourcePath: h.source.path,
								relPath: editionPath(old)
							})
						: h.open()
				]);
				// closed while opening: the cleanup ran before there was a task to stop
				if (cancelled) return void opening.destroy();
				task = opening;
				lib = mod;
				const doc = await task.promise;
				if (cancelled) return;
				const first = (await doc.getPage(1)).getViewport({ scale: 1 });
				const edition = old ?? (await editionOf(doc));
				if (cancelled) return;
				if (!old) annotations.edition = edition;
				shownEdition = edition;
				ratios = Array.from({ length: doc.numPages }, () => first.width / first.height);
				pdf = doc;
			} catch (e) {
				if (!cancelled) failure = failureOf(e);
			}
		})();
		return () => {
			cancelled = true;
			pdf = null;
			void task?.destroy();
		};
	});

	$effect(() => {
		const el = rootEl;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			paneW = el.clientWidth;
			const page = getComputedStyle(el).getPropertyValue('--page-max-width');
			columnMax = parseFloat(page) || MAX_PAGE_WIDTH;
		};
		measure();
		const ro = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(measure, RESIZE_SETTLE_MS);
		});
		ro.observe(el);
		return () => {
			clearTimeout(timer);
			ro.disconnect();
		};
	});

	$effect(() => {
		if (flow && rootEl) hostScroller = scrollParent(rootEl);
	});

	/** Draws page `n` while it's mounted; only pages near the view are. */
	function pageView(n: number): Attachment<HTMLElement> {
		return (node) => {
			const doc = pdf;
			const w = width;
			if (!doc || !lib || w <= 0) return;
			const pdfLib = lib;
			let page: PDFPageProxy | null = null;
			let render: RenderTask | null = null;
			let text: TextLayer | null = null;
			let live = true;

			void (async () => {
				page = await doc.getPage(n);
				if (!live) return;
				const base = page.getViewport({ scale: 1 });
				learnRatio(n, base.width / base.height);
				const scale = w / base.width;
				const viewport = page.getViewport({ scale });
				const out = canvasScale(viewport.width, viewport.height, window.devicePixelRatio || 1);
				const canvas = document.createElement('canvas');
				canvas.width = Math.floor(viewport.width * out);
				canvas.height = Math.floor(viewport.height * out);
				render = page.render({
					canvas,
					canvasContext: canvas.getContext('2d')!,
					viewport,
					transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0]
				});
				try {
					await render.promise;
				} catch {
					return;
				}
				if (!live) return;
				node.querySelector('canvas')?.remove();
				node.prepend(canvas);
				text = layText(node, page, viewport, pdfLib);
				await text.render().catch(() => {});
			})();

			return () => {
				live = false;
				render?.cancel();
				text?.cancel();
				// A page leaving the window lets pdf.js drop its decoded resources; one redrawn at
				// a new zoom keeps them.
				if (n - 1 < mounted.first || n - 1 > mounted.last) page?.cleanup();
			};
		};
	}

	/** Lays a page's text out over it in `node`'s text layer, where it can be selected. */
	function layText(
		node: HTMLElement,
		page: PDFPageProxy,
		viewport: PageViewport,
		pdfLib: PdfLib
	): TextLayer {
		node.style.setProperty('--scale-factor', String(viewport.scale));
		node.style.setProperty('--total-scale-factor', String(viewport.scale));
		const container = node.querySelector<HTMLElement>('.textLayer')!;
		container.replaceChildren();
		return new pdfLib.TextLayer({
			textContentSource: page.streamTextContent(),
			container,
			viewport
		});
	}

	function learnRatio(n: number, ratio: number) {
		if (ratios[n - 1] === ratio) return;
		const next = ratios.slice();
		next[n - 1] = ratio;
		ratios = next;
	}

	// ── Zoom and position ───────────────────────────────────────────────────

	let pagesEl: HTMLDivElement | undefined = $state();
	let currentPage = $state(1);

	/** Where every page sits, from the ratios, so pages that aren't mounted count too. */
	const layout = $derived(layoutPages(ratios, width, PAGE_GAP));

	let mounted: PageRange = $state.raw({ first: 0, last: -1 });
	const shownPages = $derived.by(() => {
		const out: number[] = [];
		const last = Math.min(mounted.last, ratios.length - 1);
		for (let i = mounted.first; i <= last; i++) out.push(i + 1);
		return out;
	});

	/** The scroller, and the band of the pages column it shows. */
	function view(): { el: HTMLElement; top: number; height: number } | null {
		const pages = pagesEl;
		const el = flow ? (hostScroller ?? document.scrollingElement) : scrollEl;
		if (!pages || !(el instanceof HTMLElement)) return null;
		const top = el === document.scrollingElement ? 0 : el.getBoundingClientRect().top;
		return { el, top: top - pages.getBoundingClientRect().top, height: el.clientHeight };
	}

	// The view's top in pages coordinates as last seen, kept exact across a correction the
	// browser rounds to its pixels, so a run of corrections doesn't drift.
	let viewTop = 0;
	let wrote: { scrollTop: number; viewTop: number } | null = null;

	function scrollBy(v: { el: HTMLElement; top: number }, delta: number) {
		const was = v.el.scrollTop;
		v.el.scrollTop += delta;
		// the page's end can clamp the write, and then what moved is what counts
		const moved = v.el.scrollTop - was;
		wrote = {
			scrollTop: v.el.scrollTop,
			viewTop: v.top + (Math.abs(moved - delta) < 1 ? delta : moved)
		};
		viewTop = wrote.viewTop;
	}

	function updateWindow() {
		const v = view();
		if (!v) return;
		if (wrote?.scrollTop === v.el.scrollTop) viewTop = wrote.viewTop;
		else {
			wrote = null;
			viewTop = v.top;
		}
		const bottom = v.top + v.height;
		const next = holdRange(
			mounted,
			pagesBetween(layout, v.top - MOUNT_MARGIN, bottom + MOUNT_MARGIN),
			pagesBetween(layout, v.top - KEEP_MARGIN, bottom + KEEP_MARGIN)
		);
		if (next.first !== mounted.first || next.last !== mounted.last) mounted = next;
		if (!flow) currentPage = pageIndexAt(layout.tops, v.top + v.height / 3) + 1;
	}

	$effect(() => {
		const pages = pagesEl;
		const el = flow ? hostScroller : scrollEl;
		if (!pages || (!flow && !el)) return;
		const target: HTMLElement | Window = el ?? window;
		const onScroll = () => updateWindow();
		target.addEventListener('scroll', onScroll, { passive: true });
		const ro = new ResizeObserver(onScroll);
		ro.observe(el ?? document.documentElement);
		// The header above the pages can change height while the reader is down in them (its
		// properties load late); with the browser's anchoring off, that's held here too. A page
		// changing size has already been held by the time this runs, so it finds nothing to do.
		const holdHeader = () => {
			const v = view();
			if (!v || viewTop <= 0) return;
			const delta = viewTop - v.top;
			if (Math.abs(delta) >= 0.5) scrollBy(v, delta);
		};
		const columnRo = new ResizeObserver(holdHeader);
		untrack(updateWindow);
		const column = pages.closest('.column');
		if (column) columnRo.observe(column);
		return () => {
			target.removeEventListener('scroll', onScroll);
			ro.disconnect();
			columnRo.disconnect();
		};
	});

	// When a page learns its real size, or a zoom or a resize changes every page's, the reader's
	// place is held by scrolling the difference. The browser's own anchoring is off for the
	// pages (see .reading), or it would correct a second time.
	let placed: { layout: PageLayout; pages: HTMLElement } | null = null;
	$effect(() => {
		const next = layout;
		const pages = pagesEl;
		if (!pages) return;
		untrack(() => {
			const before = placed?.pages === pages ? placed.layout : null;
			placed = { layout: next, pages };
			const v = view();
			// with the header still in view there's nothing above the reader to correct for
			if (before && v && viewTop > 0) {
				const delta = keepPlace(before, next, viewTop) - v.top;
				if (Math.abs(delta) >= 0.5) scrollBy(v, delta);
			}
			updateWindow();
		});
	});

	function setZoom(next: number) {
		zoom = Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], next));
		tab.state.pdf_zoom = zoom;
	}

	function stepZoom(dir: 1 | -1) {
		const i = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);
		setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
	}

	function onWheel(e: WheelEvent) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		stepZoom(e.deltaY < 0 ? 1 : -1);
	}

	function zoomKey(e: KeyboardEvent) {
		const shortcut = appEditorShortcut(e);
		if (shortcut) stepZoom(shortcut === 'zoom-in' ? 1 : -1);
		else if (e.key === '0') setZoom(1);
		else return;
		e.preventDefault();
	}

	// ── Annotations ─────────────────────────────────────────────────────────

	const annotations = new PdfAnnotations(() => handle as PdfHandle);
	$effect(() => {
		if (!handle) return;
		return annotations.watch();
	});

	// ── Editions ────────────────────────────────────────────────────────────

	/** A preserved edition being read instead of the current file. */
	let viewing: string | null = $state(null);
	let viewingDay: string | null = $state(null);
	let shownEdition: string | null = $state(null);

	// Marks made on other bytes aren't painted on these; one made before editions were recorded
	// has no edition and shows everywhere.
	const onEdition = (a: Annotation) => !a.edition || !shownEdition || a.edition === shownEdition;
	const here = $derived(annotations.items.filter(onEdition));
	const elsewhere = $derived(annotations.items.filter((a) => !onEdition(a)));
	const canAnnotate = $derived(annotations.writable && !viewing);

	async function openEdition(edition: string | null): Promise<boolean> {
		const h = handle;
		if (!h) return false;
		if (edition && !(await isPreserved(h.source.path, edition))) {
			toasts.push(
				"That edition wasn't preserved in this source: its marks can't be shown on the current file."
			);
			return false;
		}
		viewingDay = edition && (await editionDate(h.source.id, edition));
		menu = null;
		activeId = editingId = placing = null;
		tool = 'select';
		viewing = edition;
		// carrying over works on the current file, so the question waits for the reader's return
		if (edition && asking !== null) toasts.dismiss(asking);
		return true;
	}

	const byPage = $derived.by(() => {
		const map = new Map<number, Annotation[]>();
		for (const a of here) for (const n of pagesOf(a)) map.set(n, [...(map.get(n) ?? []), a]);
		return map;
	});

	// which notes cite each annotation, asked again whenever the index or the list changes
	let citedBy: Map<string, Citing[]> = $state(new Map());
	$effect(() => {
		const items = annotations.items;
		void linkIndex.version;
		let cancelled = false;
		void Promise.all(
			items.map((a) =>
				citedIn(a.title, a.id)
					.catch(() => [])
					.then((c): [string, Citing[]] => [a.id, c])
			)
		).then((entries) => {
			if (!cancelled) citedBy = new Map(entries);
		});
		return () => {
			cancelled = true;
		};
	});

	// Opened at an annotation (from a citation): land on its passage once both have loaded.
	$effect(() => {
		const id = tab.state[OPEN_AT_ANNOTATION];
		if (typeof id !== 'string' || !pdf || !pagesEl) return;
		const a = annotations.items.find((x) => x.id === id);
		if (!a) return;
		if (!onEdition(a)) {
			// its passage is on another edition's pages; this runs again once that edition loads
			void openEdition(a.edition ?? null).then((ok) => {
				if (!ok) delete tab.state[OPEN_AT_ANNOTATION];
			});
			return;
		}
		delete tab.state[OPEN_AT_ANNOTATION];
		activeId = a.id;
		requestAnimationFrame(() => scrollToAnnotation(a));
	});

	/** Brings an annotation's passage a third of the way down the view, mounted or not. */
	function scrollToAnnotation(a: Annotation) {
		const v = view();
		if (v) scrollBy(v, anchorY(a) - v.height / 3 - v.top);
	}

	function openNote(id: string) {
		MarkdownHandle.fromID(id)
			.then((doc) => editor?.openDoc(doc))
			.catch((e) => reportError(e, "The note couldn't be opened."));
	}

	// ── Pages and digest ────────────────────────────────────────────────────

	let mode: 'pages' | 'digest' = $state(
		untrack(() => tab.state.pdf_mode) === 'digest' ? 'digest' : 'pages'
	);
	// a digest of nothing has nothing to show, and its switch hides, so the PDF goes back to pages
	$effect(() => {
		if (annotations.loaded && !here.length && untrack(() => mode) === 'digest') setMode('pages');
	});
	// the digest's passages read in the editor's own face, as a note's text does
	const editorFont = $derived(editor?.session?.settings.get<string>('editor.font') ?? 'sans-serif');

	function setMode(next: 'pages' | 'digest') {
		mode = next;
		tab.state.pdf_mode = next;
		menu = null;
	}

	let tool: PdfTool = $state('select');
	let color: AnnotationColor = $state('amber');
	let activeId: string | null = $state(null);
	let editingId: string | null = $state(null);
	let menu: { x: number; y: number; page: number; target: TextTarget } | null = $state(null);
	let draft: { page: number; from: { x: number; y: number }; rect: PageRect | null } | null =
		$state(null);
	let moreFor: Annotation | null = $state(null);
	let moreAnchor: HTMLElement | null = $state(null);
	let moreOpen = $state(false);

	// ── Ink ─────────────────────────────────────────────────────────────────

	let inkColor: InkColor = $state('graphite');
	let inkWidth: InkWidth = $state('fine');
	let inkMode: InkMode = $state('pen');
	let gesture: { page: number; points: number[] } | null = $state(null);
	// what the eraser takes during a gesture, kept out of `gesture` so the strokes stay raw
	const erased: LooseStroke[] = [];
	const ERASER_RADIUS = 0.012;

	const looseInk = new LooseInk(() => handle as PdfHandle);
	// undo and redo for the ink drawn while this PDF is open
	const inkHistory = new StepHistory();
	$effect(() => {
		if (!handle) return;
		looseInk.load().catch((e) => console.error('ink load failed', e));
		return () => {
			void looseInk.flush();
			inkHistory.clear();
		};
	});

	const looseByPage = $derived.by(() => {
		const map = new Map<number, LooseStroke[]>();
		for (const s of looseInk.strokes) map.set(s.page, [...(map.get(s.page) ?? []), s]);
		return map;
	});

	const activeInk = $derived(here.find((a) => a.id === activeId && a.kind === 'ink') ?? null);

	function aspectOf(page: number): number {
		return 1 / (ratios[page - 1] ?? ratios[0] ?? 1);
	}

	function pageEl(page: number): HTMLElement | null {
		return pagesEl?.querySelector<HTMLElement>(`.page[data-page="${page}"]`) ?? null;
	}

	function inkAt(e: PointerEvent) {
		const g = gesture;
		const page = g && pageEl(g.page);
		if (!g || !page) return;
		const [x, y] = pagePoint(e, page);
		if (inkMode === 'eraser') {
			erased.push(
				...looseInk.take(
					(s) => s.page === g.page && nearStroke(s, x, y, ERASER_RADIUS, aspectOf(g.page))
				)
			);
			return;
		}
		const n = g.points.length;
		if (n && Math.hypot(x - g.points[n - 2], y - g.points[n - 1]) < 0.0015) return;
		g.points.push(x, y);
	}

	async function endInk() {
		const g = gesture;
		gesture = null;
		const rubbed = erased.splice(0);
		if (rubbed.length) recordInk(looseStep([], rubbed));
		if (!g || inkMode === 'eraser') return;
		if (inkMode === 'pen') {
			if (g.points.length >= 2) {
				const points = simplify(g.points, aspectOf(g.page));
				const stroke = { page: g.page, color: inkColor, width: inkWidth, points };
				looseInk.add(stroke);
				recordInk(looseStep([stroke], []));
			}
			return;
		}
		const taken = looseInk.take((s) => s.page === g.page && inLasso(s, g.points));
		if (taken.length === 0) return;
		try {
			const a = await groupInk(taken);
			activeId = editingId = a.id;
			recordInk(groupStep(taken, a.id));
		} catch (e) {
			reportError(e, "The ink couldn't be grouped.");
		}
	}

	/** Makes loose strokes from one page into an ink annotation, putting them back if it can't. */
	async function groupInk(taken: LooseStroke[], comment = ''): Promise<Annotation> {
		const strokes = taken.map(({ page: _page, ...stroke }) => stroke);
		try {
			return await annotations.create(
				{ page: taken[0].page, kind: 'ink', color: 'amber', rects: [strokesBox(strokes)], strokes },
				comment
			);
		} catch (e) {
			looseInk.add(...taken);
			throw e;
		}
	}

	function recordInk(step: Step) {
		// the newest change is what Ctrl+Z takes back, not an older delete's undo hint
		undoHint.dismiss();
		inkHistory.record(step);
	}

	/** Undo takes the `added` strokes away and puts the `removed` ones back; redo the reverse. */
	function looseStep(added: LooseStroke[], removed: LooseStroke[]): Step {
		const swap = (out: LooseStroke[], back: LooseStroke[]) => {
			looseInk.take((s) => out.includes(s));
			looseInk.add(...back);
		};
		return { undo: () => swap(added, removed), redo: () => swap(removed, added) };
	}

	/** Undo trashes the group's note and loosens its strokes; redo groups them in a new note. */
	function groupStep(taken: LooseStroke[], id: string): Step {
		let comment = '';
		return {
			undo: async () => {
				// the note may be gone already, deleted from its menu
				const note = annotations.items.find((a) => a.id === id);
				if (note) await annotations.remove(id);
				comment = note?.comment ?? '';
				if (activeId === id) activeId = null;
				if (editingId === id) editingId = null;
				looseInk.add(...taken);
			},
			redo: async () => {
				looseInk.take((s) => taken.includes(s));
				id = (await groupInk(taken, comment)).id;
			}
		};
	}

	async function recolorInk(a: Annotation) {
		const next =
			INK_COLORS[(INK_COLORS.indexOf(a.strokes?.[0]?.color ?? 'graphite') + 1) % INK_COLORS.length];
		try {
			await annotations.setFields(a.id, {
				strokes: (a.strokes ?? []).map((s) => ({ ...s, color: next }))
			});
		} catch (e) {
			reportError(e, "The ink's color couldn't be changed.");
		}
	}

	let sidenotesOn = $state(untrack(() => tab.state.pdf_sidenotes) !== false);
	// A bare highlight stays out of the margin until it's picked or given a comment. While
	// sidenotes are hidden, only a comment being written shows.
	const notes = $derived(
		here.filter((a) => a.id === editingId || (sidenotesOn && (a.comment || a.id === activeId)))
	);
	// The margin opens with a PDF's first annotation, so an unmarked one reads centered.
	const rail = $derived(railFits && (sidenotesOn ? here.length > 0 : editingId !== null));
	// the digest reads at the full column whatever the sidenotes show, since it has no margin
	const columnWidth = $derived(
		width + ((mode === 'digest' ? railFits : rail) ? RAIL_GAP + RAIL_WIDTH : 0)
	);

	function toggleSidenotes() {
		sidenotesOn = !sidenotesOn;
		tab.state.pdf_sidenotes = sidenotesOn;
	}

	/** The top of an annotation's passage in the pages column, mounted or not. */
	function anchorY(a: Annotation): number {
		const i = a.page - 1;
		return (layout.tops[i] ?? 0) + (a.rects[0]?.[1] ?? 0) * (layout.heights[i] ?? 0);
	}

	/** The bottom of an annotation's passage on its own page. */
	function belowY(a: Annotation): number {
		const i = a.page - 1;
		const bottom = Math.max(0, ...rectsOn(a, a.page).map((r) => r[1] + r[3]));
		return (layout.tops[i] ?? 0) + bottom * (layout.heights[i] ?? 0);
	}

	const noteActions: NoteActions = {
		onOpenNote: openNote,
		onActivate: (a) => (activeId = a.id),
		onEdit: (a) => {
			editingId = a?.id ?? null;
			if (a) activeId = a.id;
		},
		onSave: saveComment,
		onCite: cite,
		onLink: link,
		onMore: (a, anchor) => {
			moreFor = a;
			moreAnchor = anchor;
			moreOpen = true;
		}
	};

	function pageAt(target: EventTarget | Node | null): HTMLElement | null {
		const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
		return (el?.closest('.page') as HTMLElement | null) ?? null;
	}

	function pageNumber(page: HTMLElement): number {
		return Number(page.dataset.page);
	}

	async function addHighlight(page: number, target: TextTarget, comment = '') {
		try {
			return await annotations.create(
				{
					page,
					kind: 'highlight',
					color,
					rects: target.rects,
					quote: target.quote,
					prefix: target.prefix,
					suffix: target.suffix
				},
				comment
			);
		} catch (e) {
			reportError(e, "The highlight couldn't be saved.");
			return null;
		}
	}

	function onPagesPointerDown(e: PointerEvent) {
		if ((acting !== 'region' && acting !== 'ink') || e.button !== 0) return;
		const page = pageAt(e.target);
		if (!page) return;
		e.preventDefault();
		if (placing?.kind === 'ink') {
			const strokes = moveStrokes(placing.strokes ?? [], ...pagePoint(e, page));
			void place(placing, { page: pageNumber(page), rects: [strokesBox(strokes)], strokes });
			return;
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (acting === 'ink') {
			gesture = { page: pageNumber(page), points: [] };
			inkAt(e);
			return;
		}
		draft = { page: pageNumber(page), from: { x: e.clientX, y: e.clientY }, rect: null };
	}

	function onPagesPointerMove(e: PointerEvent) {
		if (gesture) inkAt(e);
		if (!draft) return;
		const page = pagesEl?.querySelector<HTMLElement>(`.page[data-page="${draft.page}"]`);
		if (page) draft.rect = boxTarget(draft.from, { x: e.clientX, y: e.clientY }, page);
	}

	async function onPagesPointerUp(e: PointerEvent) {
		if (gesture) {
			await endInk();
			return;
		}
		if (draft) {
			const { page, rect } = draft;
			draft = null;
			if (!rect) return;
			if (placing) return void place(placing, { page, rects: [rect] });
			try {
				const a = await annotations.create({ page, kind: 'region', color: 'sky', rects: [rect] });
				activeId = editingId = a.id;
			} catch (err) {
				reportError(err, "The region couldn't be saved.");
			}
			return;
		}
		if (e.button !== 0 || !(acting === 'select' || acting === 'highlight')) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			pickAt(e);
			return;
		}
		const range = selection.getRangeAt(0);
		const page = pageAt(range.startContainer);
		const target = page && textTarget(range, page);
		if (!page || !target) return;
		if (acting === 'highlight') {
			selection.removeAllRanges();
			if (placing) await place(placing, { page: pageNumber(page), ...target });
			else await addHighlight(pageNumber(page), target);
			return;
		}
		const end = range.getClientRects();
		const last = end[end.length - 1];
		const box = rootEl!.getBoundingClientRect();
		menu = {
			x: Math.min(last.left - box.left, box.width - 212),
			y: last.bottom - box.top + 8,
			page: pageNumber(page),
			target
		};
	}

	/** A click on a mark picks its annotation; a click anywhere else lets go of it. */
	function pickAt(e: PointerEvent) {
		const page = pageAt(e.target);
		const [x, y] = page ? pagePoint(e, page) : [0, 0];
		const n = page ? pageNumber(page) : 0;
		const hit = (byPage.get(n) ?? []).find((a) =>
			rectsOn(a, n).some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])
		);
		activeId = hit?.id ?? null;
		if (editingId && editingId !== activeId) editingId = null;
	}

	async function fromMenu(run: (a: Annotation) => unknown) {
		const m = menu;
		menu = null;
		window.getSelection()?.removeAllRanges();
		if (!m) return;
		const a = await addHighlight(m.page, m.target);
		if (a) await run(a);
	}

	async function saveComment(a: Annotation, comment: string) {
		try {
			await annotations.setComment(a.id, comment);
		} catch (e) {
			reportError(e, "The comment couldn't be saved.");
		}
	}

	async function cite(a: Annotation) {
		try {
			await copyCitation(a.title);
		} catch (e) {
			reportError(e, "The citation couldn't be copied.");
		}
	}

	async function link(a: Annotation) {
		try {
			await copyLink(a.title);
		} catch (e) {
			reportError(e, "The link couldn't be copied.");
		}
	}

	async function removeAnnotation(a: Annotation) {
		if (activeId === a.id) activeId = null;
		try {
			await annotations.remove(a.id);
		} catch (e) {
			reportError(e, "The annotation couldn't be deleted.");
		}
	}

	const moreItems: MenuEntry[] = [
		{ value: 'open', label: 'Open as note', icon: SquareArrowOutUpRight },
		{ kind: 'divider' },
		{ value: 'delete', label: 'Delete', icon: Trash2, danger: true }
	];

	function onMoreSelect(value: string) {
		const a = moreFor;
		moreFor = null;
		if (!a) return;
		if (value === 'delete') void removeAnnotation(a);
		else if (value === 'open') openNote(a.id);
	}

	// ── Carrying over ───────────────────────────────────────────────────────

	/** Why each annotation tried in this opening stayed unplaced. */
	let unplaced: Map<string, Unplaced> = $state(new Map());
	let carrying = $state(false);
	/** An annotation waiting for its new spot on the pages. */
	let placing = $state<Annotation | null>(null);
	// while one waits, the pages act as the tool that made it
	const acting: PdfTool = $derived(placing?.kind ?? tool);
	// a hidden page copied to lay text out off screen, styled as the pages are
	let probe: HTMLElement | undefined = $state();

	let asking: number | null = null;
	$effect(() => {
		if (asking !== null || viewing || !annotations.loaded || !elsewhere.length) return;
		const n = elsewhere.length;
		asking = toasts.push(
			`This PDF has changed since ${n} of its annotations ${n === 1 ? 'was' : 'were'} made`,
			{ variant: 'info', action: { label: 'Carry them over', run: () => void carry() } }
		);
	});
	$effect(() => () => {
		if (asking !== null) toasts.dismiss(asking);
	});

	async function carry() {
		const doc = pdf;
		const h = handle;
		const todo = elsewhere.filter((a) => !unplaced.has(a.id));
		if (!doc || !h || viewing || carrying || !todo.length) return;
		carrying = true;
		if (asking !== null) toasts.dismiss(asking);
		try {
			const carried = await carryOver(todo, {
				doc,
				earlier: async (edition) =>
					(await isPreserved(h.source.path, edition)) ? loadPdf(h.id, edition) : null,
				select: (from, to) => selectOffscreen(doc, from, to)
			});
			for (const { id, placement } of carried.placed) await annotations.place(id, placement);
			const left = carried.unplaced.map(({ id, reason }): [string, Unplaced] => [id, reason]);
			unplaced = new Map([...unplaced, ...left]);
			toasts.push(carriedMessage(carried.placed.length, left.length), { variant: 'info' });
		} catch (e) {
			reportError(e, "The annotations couldn't be carried over.");
		} finally {
			carrying = false;
		}
	}

	function carriedMessage(placed: number, left: number): string {
		const moved = placed
			? `Carried over ${placed} annotation${placed === 1 ? '' : 's'}`
			: 'None could be carried over';
		return left ? `${moved}; ${left} need${left === 1 ? 's' : ''} placing by hand.` : `${moved}.`;
	}

	/** What a reader selecting `doc`'s text from `from` to `to` would make, laid out unseen. */
	async function selectOffscreen(
		doc: PDFDocumentProxy,
		from: TextPoint,
		to: TextPoint
	): Promise<TextTarget | null> {
		const template = probe;
		const host = template?.parentElement;
		const pdfLib = lib;
		if (!template || !host || !pdfLib) return null;
		const copies: HTMLElement[] = [];
		try {
			for (let n = from.page; n <= to.page; n++) {
				const page = await doc.getPage(n);
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: (width || MAX_PAGE_WIDTH) / base.width });
				const copy = template.cloneNode(true) as HTMLElement;
				copy.dataset.page = String(n);
				copy.style.width = `${viewport.width}px`;
				copy.style.height = `${viewport.height}px`;
				host.append(copy);
				copies.push(copy);
				await layText(copy, page, viewport, pdfLib).render();
			}
			const layer = (copy: HTMLElement) => copy.querySelector('.textLayer')!;
			const range = textRange(
				{ layer: layer(copies[0]), offset: from.offset },
				{ layer: layer(copies[copies.length - 1]), offset: to.offset }
			);
			return textTarget(range, copies[0]);
		} finally {
			for (const copy of copies) copy.remove();
		}
	}

	function placeAgain(a: Annotation) {
		if (mode !== 'pages') setMode('pages');
		menu = null;
		activeId = editingId = null;
		placing = a;
		requestAnimationFrame(() => scrollToAnnotation(a));
	}

	async function place(a: Annotation, placement: Placement) {
		placing = null;
		try {
			await annotations.place(a.id, placement);
			activeId = a.id;
		} catch (e) {
			reportError(e, "The annotation couldn't be placed.");
		}
	}

	const notice = $derived.by(() => {
		if (!failure || !handle) return null;
		const src = sourceName(handle.source);
		switch (failure) {
			case 'source_missing':
				return {
					headline: `the ${src} source isn't available`,
					detail: 'Check that the drive or folder is connected, then try again.'
				};
			case 'source_permission':
				return {
					headline: `limestone can't open the ${src} source`,
					detail: 'Check that the folder lets Limestone read it, then try again.'
				};
			case 'not_found':
				return {
					headline: "this PDF's file is gone",
					detail: 'It was deleted or moved outside Limestone.'
				};
			case 'permission':
				return {
					headline: "this PDF can't be opened",
					detail:
						"You don't have permission to read its file. Check its permissions, then try again."
				};
			case 'locked':
				return {
					headline: 'this PDF is in use',
					detail: 'Another app is holding its file. Close it there, then try again.'
				};
			case 'password':
				return {
					headline: 'this PDF is password-protected',
					detail: "Limestone can't open protected PDFs yet. Open it from its folder instead."
				};
			case 'damaged':
				return {
					headline: "this PDF isn't readable",
					detail: 'Its file may be damaged or not really a PDF. Open it from its folder to check.'
				};
			default:
				return {
					headline: "this PDF couldn't be opened",
					detail: 'Something went wrong reading its file. Try again in a moment.'
				};
		}
	});

	const actions = $derived.by((): GoneAction[] => {
		const h = handle;
		if (!h || !failure) return [];
		if (failure === 'password' || failure === 'damaged') {
			return [
				{
					label: 'Show in folder',
					strong: true,
					run: () => revealItemInDir(`${h.source.path}/${h.relPath}`)
				}
			];
		}
		if (failure === 'not_found') return [];
		return [{ label: 'Try again', strong: true, run: () => attempt++ }];
	});

	// ── Keys ────────────────────────────────────────────────────────────────

	// Keys arrive through the window, which every pane shares, so only the pane being worked in
	// takes them, and never while text is being typed.
	const paneActive = $derived(!editor?.session || editor.session.active === editor);
	const docked = $derived(!!pdf && !flow && !notice && mode === 'pages');

	function onWindowKey(e: KeyboardEvent) {
		if (!paneActive || !rootEl?.isConnected || typingIn(e.target)) return;
		if (e.key === 'Escape' && placing) {
			placing = null;
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			if (docked && tool === 'ink') inkHistoryKey(e);
			if (!flow) zoomKey(e);
			return;
		}
		if (e.altKey) return;
		if ((e.key === 'Delete' || e.key === 'Backspace') && activeId && !editingId) {
			const a = annotations.items.find((x) => x.id === activeId);
			if (a) void removeAnnotation(a);
			return;
		}
		// a narrow pane's floating card closes, as a click away closes it; a menu's Escape is its own
		if (e.key === 'Escape' && !railFits && !e.defaultPrevented) activeId = editingId = null;
		if (!docked) return;
		const picked = toolForKey(e.key);
		if (e.key === 'Escape') tool = 'select';
		else if (picked) {
			if (canAnnotate) tool = picked;
		} else if (tool === 'ink') inkMode = modeForKey(inkMode, e.key) ?? inkMode;
	}

	/** Ctrl or Cmd with Z undoes the ink; with Y, or Shift+Z, redoes it. */
	function inkHistoryKey(e: KeyboardEvent) {
		const key = e.key.toLowerCase();
		if (e.altKey || (key !== 'z' && key !== 'y')) return;
		e.preventDefault();
		const redo = key === 'y' || e.shiftKey;
		(redo ? inkHistory.redo() : inkHistory.undo()).catch((err) =>
			reportError(err, `The ink couldn't be ${redo ? 'redone' : 'undone'}.`)
		);
	}

	function typingIn(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet inkTray()}
	<InkTray bind:color={inkColor} bind:width={inkWidth} bind:mode={inkMode} />
{/snippet}

{#snippet placeHint()}
	{#if placing}<PlaceHint kind={placing.kind} onCancel={() => (placing = null)} />{/if}
{/snippet}

{#snippet heroExtra()}
	{#if viewing || elsewhere.length}<span class="meta-sep"></span>{/if}
	{#if viewing}
		<button class="edition-chip" type="button" onclick={() => openEdition(null)}>
			<Pin size={12} strokeWidth={1.75} />
			{#if viewingDay}<span class="day">{viewingDay} edition</span>{:else}Earlier edition{/if}
			· back to the current file
		</button>
	{:else if elsewhere.length}
		<NotPlaced
			annotations={elsewhere}
			reasons={unplaced}
			{carrying}
			onCarry={carry}
			onPlace={flow ? undefined : placeAgain}
			onOpenEdition={openEdition}
		/>
	{/if}
	<span class="meta-fill"></span>
	{#if here.length}
		<span class="modes" role="tablist">
			<button
				class:on={mode === 'pages'}
				type="button"
				role="tab"
				aria-selected={mode === 'pages'}
				onclick={() => setMode('pages')}>Pages</button
			>
			<button
				class:on={mode === 'digest'}
				type="button"
				role="tab"
				aria-selected={mode === 'digest'}
				onclick={() => setMode('digest')}>Digest</button
			>
		</span>
	{/if}
{/snippet}

<div
	class="pdf-viewer"
	class:flow
	class:drawing={acting === 'region' || acting === 'ink'}
	class:dark-pages={dark}
	bind:this={rootEl}
>
	<div
		class="scroll"
		role="presentation"
		bind:this={scrollEl}
		onwheel={onWheel}
		onpointerdown={(e) => {
			const el = e.target as Element;
			if (!el.closest('.pages, .rail, .margin-markers, .ink-menu')) activeId = null;
		}}
	>
		<div class="column" style:width="{columnWidth}px">
			{#if handle}
				<DocumentHero
					{handle}
					loaded
					onDelete={deleteDoc}
					bind:propsOpen
					{back}
					{forward}
					{onOpenFolder}
					{showOpenFolder}
					{onFolderMeta}
					extra={heroExtra}
				/>
			{/if}
			{#if notice}
				<GonePage headline={notice.headline} detail={notice.detail} {actions} />
			{:else if mode === 'digest'}
				<div class="digest" style:--font-editor={editorFont}>
					<PdfDigest
						annotations={here}
						{citedBy}
						doc={pdf}
						onGoTo={(a) => {
							tab.state[OPEN_AT_ANNOTATION] = a.id;
							setMode('pages');
						}}
						onOpenNote={openNote}
					/>
				</div>
			{:else if pdf && width > 0}
				<div class="reading">
					<div
						class="pages"
						role="presentation"
						style:height="{layout.total}px"
						bind:this={pagesEl}
						onpointerdown={onPagesPointerDown}
						onpointermove={onPagesPointerMove}
						onpointerup={onPagesPointerUp}
					>
						{#each shownPages as n (n)}
							<div
								class="page"
								data-page={n}
								style:top="{layout.tops[n - 1]}px"
								style:width="{width}px"
								style:height="{layout.heights[n - 1]}px"
								{@attach pageView(n)}
							>
								<PageMarks
									page={n}
									marks={byPage.get(n) ?? []}
									aspect={aspectOf(n)}
									{activeId}
									draft={draft?.page === n ? draft.rect : null}
									loose={looseByPage.get(n)}
									drawing={gesture?.page === n && inkMode === 'pen'
										? { color: inkColor, width: inkWidth, points: gesture.points }
										: null}
									lasso={gesture?.page === n && inkMode === 'lasso' ? gesture.points : null}
								/>
								<div class="textLayer"></div>
							</div>
						{/each}
					</div>
					{#if activeInk?.rects[0]}
						{@const r = activeInk.rects[0]}
						{@const pen = activeInk.strokes?.[0]?.color ?? 'graphite'}
						<div
							class="ink-menu"
							style:left="{Math.max(0, r[0] * width - 22)}px"
							style:top="{(layout.tops[activeInk.page - 1] ?? 0) +
								(r[1] + r[3]) * (layout.heights[activeInk.page - 1] ?? 0) +
								14}px"
						>
							<button class="on" type="button" onclick={() => (editingId = activeInk.id)}>
								<MessageSquare size={12} strokeWidth={1.75} />Comment
							</button>
							<button type="button" onclick={() => cite(activeInk)}>
								<Quote size={12} strokeWidth={1.75} />Copy citation
							</button>
							<span class="sep"></span>
							<button
								class="square"
								type="button"
								title="Change the ink's color"
								onclick={() => recolorInk(activeInk)}
							>
								<span class="dot" style:--ink={INK_RGB[pen]}></span>
							</button>
							<button
								class="square muted"
								type="button"
								title="Delete"
								onclick={() => removeAnnotation(activeInk)}
							>
								<Trash2 size={13} strokeWidth={1.75} />
							</button>
						</div>
					{/if}
					{#if rail}
						<div class="rail" style:left="{width + RAIL_GAP}px">
							<SideNotes {notes} {anchorY} {activeId} {editingId} {citedBy} {...noteActions} />
						</div>
					{:else if !railFits}
						<MarginMarkers
							{notes}
							{anchorY}
							{belowY}
							{activeId}
							{editingId}
							{citedBy}
							{...noteActions}
							pageWidth={width}
							pane={{ left: (columnWidth - paneW) / 2, right: (columnWidth + paneW) / 2 }}
							{dark}
							onClose={() => (activeId = editingId = null)}
						/>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	{#if menu}
		<SelectionMenu
			x={menu.x}
			y={menu.y}
			{color}
			writable={canAnnotate}
			onColor={(c) => {
				color = c;
				void fromMenu(() => {});
			}}
			onComment={() =>
				fromMenu((a) => {
					activeId = editingId = a.id;
				})}
			onCite={() => fromMenu(cite)}
			onCopyText={() => {
				const quote = menu?.target.quote ?? '';
				menu = null;
				void navigator.clipboard.writeText(quote);
			}}
			onClose={() => (menu = null)}
		/>
	{/if}
	{#if docked}
		<PdfDock
			bind:tool
			page={currentPage}
			pages={ratios.length}
			{zoom}
			disabled={!canAnnotate}
			onZoomReset={() => setZoom(1)}
			{dark}
			sidenotes={sidenotesOn}
			onToggleSidenotes={toggleSidenotes}
			onToggleDark={() => {
				darkChoice = !dark;
				tab.state.pdf_dark = darkChoice;
			}}
			tray={placing ? placeHint : tool === 'ink' ? inkTray : undefined}
		/>
	{/if}
	{#if !flow}
		<ScrollThumb scroller={scrollEl} />
	{/if}
	{#if docked}
		<AnnotationTicks
			scroller={scrollEl}
			pages={pagesEl}
			annotations={here}
			{anchorY}
			onGoTo={(a) => {
				activeId = a.id;
				scrollToAnnotation(a);
			}}
		/>
	{/if}
	<div class="probe" aria-hidden="true">
		<div class="page" bind:this={probe}><div class="textLayer"></div></div>
	</div>
</div>

<Menu
	bind:open={moreOpen}
	anchor={moreAnchor}
	items={moreItems}
	onSelect={onMoreSelect}
	minWidth={160}
/>

<style>
	.pdf-viewer {
		position: relative;
		height: 100%;
	}

	.pdf-viewer.flow {
		height: auto;
	}

	.scroll {
		height: 100%;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.scroll::-webkit-scrollbar {
		display: none;
	}

	.flow .scroll {
		height: auto;
		overflow: visible;
	}

	/* The header shares the pages' column, the way a note's shares its text's. */
	/* The column's top padding keeps the hero's back card in place until the reader scrolls past
	   it, and puts the title where a note's sits. */
	.column {
		max-width: 100%;
		margin: 0 auto;
		padding: 16px 0 96px;
	}

	.column :global(.hero-inner) {
		max-width: none;
		padding-right: 0;
		padding-left: 0;
	}

	.column :global(.back-slot) {
		left: 0;
		right: 0;
	}

	/* In flow the host spaces entries itself, as it does for a note's hero. */
	.flow .column {
		padding-top: 0;
	}

	.flow .column :global(.hero-inner) {
		margin-top: -6px;
		padding-top: 0;
		padding-bottom: 16px;
	}

	.meta-sep {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--color-border);
	}

	.edition-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-text-secondary);
		font: inherit;
		cursor: pointer;
	}

	.edition-chip:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.edition-chip .day {
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.meta-fill {
		flex: 1;
	}

	/* the design's Pages | Digest switch, at the far end of the meta row */
	.modes {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 7px;
		background: var(--chip-bg);
	}

	.modes button {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 9px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		font: inherit;
		cursor: pointer;
	}

	.modes button.on {
		background: var(--chip-seg-active);
		color: var(--color-text-primary);
	}

	.digest {
		padding-top: 10px;
	}

	/* The viewer holds the reader's place itself as page sizes change; the browser's anchoring
	   would move them a second time. */
	.reading {
		position: relative;
		overflow-anchor: none;
	}

	/* Only the pages near the view exist, each placed at its computed top. */
	.pages {
		position: relative;
	}

	/* the ink group's menu, under the group like the design's */
	.ink-menu {
		position: absolute;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 1px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.ink-menu button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.ink-menu button.on,
	.ink-menu button:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.ink-menu button.square {
		justify-content: center;
		width: 24px;
		padding: 0;
	}

	.ink-menu button.muted {
		color: var(--color-ui-muted);
	}

	.ink-menu .sep {
		width: 1px;
		height: 14px;
		margin: 0 3px;
		background: var(--color-border);
	}

	.ink-menu .dot {
		width: 11px;
		height: 11px;
		border-radius: 999px;
		background: rgb(var(--ink));
	}

	.rail {
		position: absolute;
		top: 0;
		width: 300px;
	}

	/* copies of a page laid out unseen, to find where a passage's text sits */
	.probe {
		position: absolute;
		inset: 0;
		overflow: hidden;
		visibility: hidden;
		pointer-events: none;
	}

	.page {
		position: absolute;
		left: 0;
		overflow: hidden;
		border-radius: 4px;
		background: #fff;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
	}

	/* Dark pages are a display filter: the file and every stored mark keep their own colors. Ink
	   inverts with its paper so graphite stays visible; highlights don't, so amber stays amber. */
	.dark-pages .page {
		background: #1f1f1f;
	}

	.dark-pages .page :global(canvas),
	.dark-pages .page :global(svg.ink) {
		filter: invert(0.88) hue-rotate(180deg);
	}

	.dark-pages .page :global(.highlight) {
		mix-blend-mode: normal;
	}

	.drawing .page {
		cursor: crosshair;
		user-select: none;
	}

	.drawing .textLayer {
		pointer-events: none;
	}

	.page :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.textLayer {
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: clip;
		line-height: 1;
		text-align: initial;
		letter-spacing: normal;
		word-spacing: normal;
		text-size-adjust: none;
		-webkit-text-size-adjust: none;
		forced-color-adjust: none;
		transform-origin: 0 0;
	}

	.textLayer :global(:is(span, br)) {
		position: absolute;
		color: transparent;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
	}

	.textLayer > :global(:not(.markedContent)),
	.textLayer :global(.markedContent span:not(.markedContent)) {
		--font-height: 0;
		--scale-x: 1;
		--rotate: 0deg;
		z-index: 1;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
	}

	.textLayer :global(.markedContent) {
		display: contents;
	}

	.textLayer :global(span[role='img']) {
		user-select: none;
		cursor: default;
	}

	.textLayer :global(::selection) {
		background: var(--accent-a22);
		color: transparent;
	}

	.textLayer :global(br::selection) {
		background: transparent;
	}
</style>
