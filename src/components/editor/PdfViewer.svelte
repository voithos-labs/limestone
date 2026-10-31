<script lang="ts">
	import { untrack } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type {
		PDFDocumentLoadingTask,
		PDFDocumentProxy,
		RenderTask,
		TextLayer
	} from 'pdfjs-dist/legacy/build/pdf.mjs';
	import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import type { TabState } from '#lib/models/EditorState.svelte.js';
	import type EditorState from '#lib/models/EditorState.svelte.js';
	import { readErrorKind, type ReadErrorKind } from '#lib/models/MarkdownHandle.js';
	import MarkdownHandle from '#lib/models/MarkdownHandle.js';
	import { sourceName } from '#lib/models/Source.js';
	import { mark, reportError, type MenuEntry } from '#lib/overlays.svelte.js';
	import {
		INK_COLORS,
		type Annotation,
		type AnnotationColor,
		type InkColor,
		type InkWidth,
		type PageRect
	} from '#lib/pdf/annotation.js';
	import { inLasso, nearStroke, simplify, strokesBox, type LooseStroke } from '#lib/pdf/ink.js';
	import LooseInk from '#lib/pdf/looseInk.svelte.js';
	import PdfAnnotations from '#lib/pdf/annotations.svelte.js';
	import { boxTarget, pagePoint, textTarget, type TextTarget } from '#lib/pdf/anchor.js';
	import {
		OPEN_AT_ANNOTATION,
		citedIn,
		copyCitation,
		copyLink,
		type Citing
	} from '#lib/pdf/citation.js';
	import { linkIndex } from '#lib/services/links.svelte.js';
	import { appEditorShortcut } from '#lib/shortcuts.js';
	import DocumentHero from './DocumentHero.svelte';
	import { backPlace, forwardPlace, openFolder, openFolderMeta } from './tabPlaces.js';
	import GonePage from '../pages/GonePage.svelte';
	import type { GoneAction } from '../pages/GoneActions.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';
	import Menu from '../ui/Menu.svelte';
	import PageMarks from '../pdf/PageMarks.svelte';
	import SideNotes from '../pdf/SideNotes.svelte';
	import SelectionMenu from '../pdf/SelectionMenu.svelte';
	import PdfDock, { type PdfTool } from '../pdf/PdfDock.svelte';
	import InkTray, { type InkMode } from '../pdf/InkTray.svelte';
	import { INK_RGB } from '../pdf/colors.js';
	import { MessageSquare, Quote, SquareArrowOutUpRight, Trash2 } from '@lucide/svelte';
	import type PdfHandle from '#lib/models/PdfHandle.js';

	let {
		tab,
		editor,
		flow = false,
		showOpenFolder = true
	}: { tab: TabState; editor?: EditorState; flow?: boolean; showOpenFolder?: boolean } = $props();

	type Failure = ReadErrorKind | 'password' | 'damaged';
	type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

	const MAX_PAGE_WIDTH = 1000;
	const SIDE_PAD = 24;
	const MIN_PAGE_WIDTH = 560;
	const RAIL_WIDTH = 300;
	const RAIL_GAP = 24;
	const PAGE_GAP = 10;
	const RESIZE_SETTLE_MS = 120;
	const KEEP_MARGIN = '1200px 0px';
	const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

	const handle = $derived(tab.content.type === 'pdf' ? tab.content.handle : null);

	let lib: PdfLib | null = null;
	let pdf: PDFDocumentProxy | null = $state.raw(null);
	let ratios: number[] = $state([]);
	let failure: Failure | null = $state(null);
	let attempt = $state(0);
	let paneW = $state(0);
	// the reading column a note gets, which the page and its margin share
	let columnMax = $state(MAX_PAGE_WIDTH);
	const savedZoom = untrack(() => tab.state.pdf_zoom);
	let zoom = $state(typeof savedZoom === 'number' ? savedZoom : 1);
	const column = $derived(Math.min(columnMax, paneW - SIDE_PAD * 2));
	// the margin rail takes room only once a page beside it still reads comfortably
	const rail = $derived(column >= MIN_PAGE_WIDTH + RAIL_GAP + RAIL_WIDTH);
	const fitWidth = $derived(
		Math.max(0, Math.min(MAX_PAGE_WIDTH, column - (rail ? RAIL_GAP + RAIL_WIDTH : 0)))
	);
	const width = $derived(Math.round(fitWidth * zoom));
	const columnWidth = $derived(width + (rail ? RAIL_GAP + RAIL_WIDTH : 0));
	let rootEl: HTMLDivElement | undefined = $state();
	let scrollEl: HTMLDivElement | undefined = $state();
	let io: IntersectionObserver | null = $state.raw(null);
	const watchers = new Map<Element, (visible: boolean) => void>();

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
		void attempt;
		if (!h) return;
		let cancelled = false;
		let task: PDFDocumentLoadingTask | null = null;
		failure = null;
		void (async () => {
			try {
				const [mod, data] = await Promise.all([
					import('pdfjs-dist/legacy/build/pdf.mjs'),
					h.loadBytes()
				]);
				if (cancelled) return;
				lib = mod;
				mod.GlobalWorkerOptions.workerSrc = workerUrl;
				task = mod.getDocument({ data });
				const doc = await task.promise;
				if (cancelled) return;
				const first = (await doc.getPage(1)).getViewport({ scale: 1 });
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
		const root = flow ? null : scrollEl;
		if (!flow && !root) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) watchers.get(entry.target)?.(entry.isIntersecting);
			},
			{ root, rootMargin: KEEP_MARGIN }
		);
		io = observer;
		return () => {
			observer.disconnect();
			io = null;
		};
	});

	function pageView(n: number): Attachment<HTMLElement> {
		return (node) => {
			const doc = pdf;
			const w = width;
			const observer = io;
			if (!doc || !lib || w <= 0 || !observer) return;
			const pdfLib = lib;
			const textEl = node.querySelector<HTMLElement>('.textLayer')!;
			let render: RenderTask | null = null;
			let text: TextLayer | null = null;
			let shown = false;

			const show = async () => {
				if (shown) return;
				shown = true;
				const page = await doc.getPage(n);
				if (!shown) return;
				const base = page.getViewport({ scale: 1 });
				ratios[n - 1] = base.width / base.height;
				const scale = w / base.width;
				const viewport = page.getViewport({ scale });
				const dpr = window.devicePixelRatio || 1;
				const canvas = document.createElement('canvas');
				canvas.width = Math.floor(viewport.width * dpr);
				canvas.height = Math.floor(viewport.height * dpr);
				render = page.render({
					canvas,
					canvasContext: canvas.getContext('2d')!,
					viewport,
					transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
				});
				try {
					await render.promise;
				} catch {
					return;
				}
				if (!shown) return;
				node.querySelector('canvas')?.remove();
				node.prepend(canvas);
				node.style.setProperty('--scale-factor', String(scale));
				node.style.setProperty('--total-scale-factor', String(scale));
				text = new pdfLib.TextLayer({
					textContentSource: page.streamTextContent(),
					container: textEl,
					viewport
				});
				textEl.replaceChildren();
				await text.render().catch(() => {});
			};

			const hide = () => {
				shown = false;
				render?.cancel();
				text?.cancel();
				node.querySelector('canvas')?.remove();
				textEl.replaceChildren();
			};

			watchers.set(node, (visible) => (visible ? void show() : hide()));
			observer.observe(node);
			return () => {
				shown = false;
				render?.cancel();
				text?.cancel();
				observer.unobserve(node);
				watchers.delete(node);
			};
		};
	}

	// ── Zoom and position ───────────────────────────────────────────────────

	let pagesEl: HTMLDivElement | undefined = $state();
	let currentPage = $state(1);

	/** Each page's top within the pages column, from the ratios, so unrendered pages count too. */
	const pageTops = $derived.by(() => {
		const tops: number[] = [];
		let y = 0;
		for (const ratio of ratios) {
			tops.push(y);
			y += width / ratio + PAGE_GAP;
		}
		return tops;
	});

	function setZoom(next: number) {
		const scroller = scrollEl;
		const before =
			scroller && scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
		zoom = Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0], next));
		tab.state.pdf_zoom = zoom;
		// the same place stays in view once the pages have taken their new size
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = before * scroller.scrollHeight;
		});
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

	function onWindowKey(e: KeyboardEvent) {
		if (flow || !(e.ctrlKey || e.metaKey) || !rootEl?.isConnected) return;
		const shortcut = appEditorShortcut(e);
		if (shortcut) stepZoom(shortcut === 'zoom-in' ? 1 : -1);
		else if (e.key === '0') setZoom(1);
		else return;
		e.preventDefault();
	}

	function trackPage() {
		const scroller = scrollEl;
		if (!scroller || !pagesEl) return;
		const pagesTop = pagesEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		const y = scroller.clientHeight / 3 - pagesTop;
		let n = 1;
		while (n < pageTops.length && pageTops[n] <= y) n++;
		currentPage = n;
	}

	// ── Annotations ─────────────────────────────────────────────────────────

	const annotations = new PdfAnnotations(() => handle as PdfHandle);
	$effect(() => {
		if (!handle) return;
		return annotations.watch();
	});

	const byPage = $derived.by(() => {
		const map = new Map<number, Annotation[]>();
		for (const a of annotations.items) map.set(a.page, [...(map.get(a.page) ?? []), a]);
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
		delete tab.state[OPEN_AT_ANNOTATION];
		activeId = a.id;
		requestAnimationFrame(() => scrollToAnnotation(a));
	});

	function scrollToAnnotation(a: Annotation) {
		const scroller = scrollEl;
		if (flow || !scroller || !pagesEl) {
			pagesEl?.querySelector(`.page[data-page="${a.page}"]`)?.scrollIntoView({ block: 'start' });
			return;
		}
		const pagesTop =
			pagesEl.getBoundingClientRect().top -
			scroller.getBoundingClientRect().top +
			scroller.scrollTop;
		scroller.scrollTo({ top: pagesTop + anchorY(a) - scroller.clientHeight / 3 });
	}

	function openNote(id: string) {
		MarkdownHandle.fromID(id)
			.then((doc) => editor?.openDoc(doc))
			.catch((e) => reportError(e, "The note couldn't be opened."));
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

	// ── Ink ─────────────────────────────────────────────────────────────────

	let inkColor: InkColor = $state('graphite');
	let inkWidth: InkWidth = $state('fine');
	let inkMode: InkMode = $state('pen');
	let gesture: { page: number; points: number[] } | null = $state(null);
	const ERASER_RADIUS = 0.012;

	const looseInk = new LooseInk(() => handle as PdfHandle);
	$effect(() => {
		if (!handle) return;
		looseInk.load().catch((e) => console.error('ink load failed', e));
		return () => void looseInk.flush();
	});

	const looseByPage = $derived.by(() => {
		const map = new Map<number, LooseStroke[]>();
		for (const s of looseInk.strokes) map.set(s.page, [...(map.get(s.page) ?? []), s]);
		return map;
	});

	const activeInk = $derived(
		annotations.items.find((a) => a.id === activeId && a.kind === 'ink') ?? null
	);

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
			looseInk.take(
				(s) => s.page === g.page && nearStroke(s, x, y, ERASER_RADIUS, aspectOf(g.page))
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
		if (!g || inkMode === 'eraser') return;
		if (inkMode === 'pen') {
			if (g.points.length >= 2) {
				const points = simplify(g.points, aspectOf(g.page));
				looseInk.add({ page: g.page, color: inkColor, width: inkWidth, points });
			}
			return;
		}
		const taken = looseInk.take((s) => s.page === g.page && inLasso(s, g.points));
		if (taken.length === 0) return;
		const strokes = taken.map(({ page: _page, ...stroke }) => stroke);
		try {
			const a = await annotations.create({
				page: g.page,
				kind: 'ink',
				color: 'amber',
				rects: [strokesBox(strokes)],
				strokes
			});
			activeId = editingId = a.id;
		} catch (e) {
			for (const s of taken) looseInk.add(s);
			reportError(e, "The ink couldn't be grouped.");
		}
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

	// a bare highlight stays out of the margin until it's picked or given a comment
	const notes = $derived(
		annotations.items.filter((a) => a.comment || a.id === activeId || a.id === editingId)
	);

	function anchorY(a: Annotation): number {
		const ratio = ratios[a.page - 1] ?? ratios[0] ?? 1;
		// the note's text starts below its card padding, so the card rises to meet the passage
		return (pageTops[a.page - 1] ?? 0) + (a.rects[0]?.[1] ?? 0) * (width / ratio) - 10;
	}

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
		if ((tool !== 'region' && tool !== 'ink') || e.button !== 0) return;
		const page = pageAt(e.target);
		if (!page) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (tool === 'ink') {
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
			try {
				const a = await annotations.create({ page, kind: 'region', color: 'sky', rects: [rect] });
				activeId = editingId = a.id;
			} catch (err) {
				reportError(err, "The region couldn't be saved.");
			}
			return;
		}
		if (e.button !== 0 || !(tool === 'select' || tool === 'highlight')) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			pickAt(e);
			return;
		}
		const range = selection.getRangeAt(0);
		const page = pageAt(range.startContainer);
		const target = page && textTarget(range, page);
		if (!page || !target) return;
		if (tool === 'highlight') {
			selection.removeAllRanges();
			await addHighlight(pageNumber(page), target);
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
		const hit = page
			? (byPage.get(pageNumber(page)) ?? []).find((a) =>
					a.rects.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])
				)
			: undefined;
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

	function onWindowKeyForMarks(e: KeyboardEvent) {
		if (!activeId || editingId || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
		const focused = document.activeElement as HTMLElement | null;
		if (focused && (focused.isContentEditable || /^(INPUT|TEXTAREA)$/.test(focused.tagName)))
			return;
		const a = annotations.items.find((x) => x.id === activeId);
		if (a) void removeAnnotation(a);
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
</script>

<svelte:window
	onkeydown={(e) => {
		onWindowKey(e);
		onWindowKeyForMarks(e);
	}}
/>

{#snippet inkTray()}
	<InkTray bind:color={inkColor} bind:width={inkWidth} bind:mode={inkMode} />
{/snippet}

{#snippet heroExtra()}
	{#if annotations.items.length}
		<span class="meta-sep"></span>
		<span class="ann-count">
			<MessageSquare size={12} strokeWidth={1.75} />
			{annotations.items.length}
			{annotations.items.length === 1 ? 'annotation' : 'annotations'}
		</span>
	{/if}
{/snippet}

<div
	class="pdf-viewer"
	class:flow
	class:drawing={tool === 'region' || tool === 'ink'}
	bind:this={rootEl}
>
	<div
		class="scroll"
		role="presentation"
		bind:this={scrollEl}
		onscroll={trackPage}
		onwheel={onWheel}
		onpointerdown={(e) => {
			const el = e.target as Element;
			if (!el.closest('.pages, .rail, .ink-menu')) activeId = null;
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
			{:else if pdf && width > 0}
				<div class="reading">
					<div
						class="pages"
						role="presentation"
						bind:this={pagesEl}
						onpointerdown={onPagesPointerDown}
						onpointermove={onPagesPointerMove}
						onpointerup={onPagesPointerUp}
					>
						{#each ratios as ratio, i (i)}
							<div
								class="page"
								data-page={i + 1}
								style:width="{width}px"
								style:aspect-ratio={ratio}
								{@attach pageView(i + 1)}
							>
								<PageMarks
									marks={byPage.get(i + 1) ?? []}
									aspect={1 / ratio}
									{activeId}
									draft={draft?.page === i + 1 ? draft.rect : null}
									loose={looseByPage.get(i + 1)}
									drawing={gesture?.page === i + 1 && inkMode === 'pen'
										? { color: inkColor, width: inkWidth, points: gesture.points }
										: null}
									lasso={gesture?.page === i + 1 && inkMode === 'lasso' ? gesture.points : null}
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
							style:top="{(pageTops[activeInk.page - 1] ?? 0) +
								(r[1] + r[3]) * width * aspectOf(activeInk.page) +
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
							<SideNotes
								{notes}
								{anchorY}
								{activeId}
								{editingId}
								{citedBy}
								onOpenNote={openNote}
								onActivate={(a) => (activeId = a.id)}
								onEdit={(a) => {
									editingId = a?.id ?? null;
									if (a) activeId = a.id;
								}}
								onSave={saveComment}
								onCite={cite}
								onLink={link}
								onMore={(a, anchor) => {
									moreFor = a;
									moreAnchor = anchor;
								}}
							/>
						</div>
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
			writable={annotations.writable}
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
	{#if pdf && !flow && !notice}
		<PdfDock
			bind:tool
			page={currentPage}
			pages={ratios.length}
			{zoom}
			disabled={!annotations.writable}
			onZoomReset={() => setZoom(1)}
			tray={tool === 'ink' ? inkTray : undefined}
		/>
	{/if}
	{#if !flow}
		<ScrollThumb scroller={scrollEl} />
	{/if}
</div>

<Menu
	open={!!moreFor}
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
	.column {
		max-width: 100%;
		margin: 0 auto;
		padding: 0 0 96px;
	}

	.column :global(.hero-inner) {
		max-width: none;
		padding-right: 0;
		padding-left: 0;
	}

	/* In flow the host spaces entries itself, as it does for a note's hero. */
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

	.ann-count {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 6px;
	}

	.reading {
		position: relative;
	}

	.pages {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
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

	.page {
		position: relative;
		max-width: 100%;
		overflow: hidden;
		border-radius: 4px;
		background: #fff;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
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
