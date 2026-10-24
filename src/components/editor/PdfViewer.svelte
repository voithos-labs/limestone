<script lang="ts">
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
	import { sourceName } from '#lib/models/Source.js';
	import { mark, reportError } from '#lib/overlays.svelte.js';
	import DocumentHero from './DocumentHero.svelte';
	import { backPlace, forwardPlace, openFolder, openFolderMeta } from './tabPlaces.js';
	import GonePage from '../pages/GonePage.svelte';
	import type { GoneAction } from '../pages/GoneActions.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';
	import PdfIcon from '../ui/PdfIcon.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import MarkdownHandle from '#lib/models/MarkdownHandle.js';
	import { folderDir } from '#lib/views/fieldValue.js';
	import { isValidSegment, nameGuard, segmentProblem } from '#lib/util/paths.js';
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
	const HERO_COLUMN = 300;
	const HERO_GAP = 32;
	const MIN_PAGE_WIDTH = 560;
	const RESIZE_SETTLE_MS = 120;
	const KEEP_MARGIN = '1200px 0px';

	const handle = $derived(tab.content.type === 'pdf' ? tab.content.handle : null);

	let lib: PdfLib | null = null;
	let pdf: PDFDocumentProxy | null = $state.raw(null);
	let ratios: number[] = $state([]);
	let failure: Failure | null = $state(null);
	let attempt = $state(0);
	let paneW = $state(0);
	let paneH = $state(0);
	const side = $derived(!flow && paneW >= HERO_COLUMN + HERO_GAP + MIN_PAGE_WIDTH + SIDE_PAD * 2);
	const width = $derived(
		Math.max(
			0,
			Math.min(MAX_PAGE_WIDTH, paneW - SIDE_PAD * 2 - (side ? HERO_COLUMN + HERO_GAP : 0))
		)
	);
	let heroOpen = $state(false);
	let title = $state('');
	let titleTaken = $state(false);
	let titleCheck = 0;
	const ext = $derived(handle?.relPath.match(/\.[^./]+$/)?.[0] ?? '.pdf');
	const titleIllegal = $derived(title.trim() !== '' && !isValidSegment(`${title.trim()}${ext}`));
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

	$effect(() => {
		title = handle?.title ?? '';
	});

	function titleCandidate(next: string): string {
		const dir = folderDir(handle?.relPath ?? '');
		return dir ? `${dir}/${next}${ext}` : `${next}${ext}`;
	}

	$effect(() => {
		const h = handle;
		const next = title.trim();
		const token = ++titleCheck;
		if (!h || !next || next === h.title) {
			titleTaken = !next;
			return;
		}
		if (titleCandidate(next).toLowerCase() === h.relPath.toLowerCase()) {
			titleTaken = false;
			return;
		}
		MarkdownHandle.pathTaken(h.source, titleCandidate(next))
			.then((taken) => {
				if (token === titleCheck) titleTaken = taken;
			})
			.catch(() => {});
	});

	async function commitTitle() {
		const h = handle;
		if (!h) return;
		const next = title.trim();
		if (!next || next === h.title || titleIllegal || titleTaken) {
			title = h.title;
			return;
		}
		try {
			await h.rename(next);
		} catch (e) {
			title = h.title;
			reportError(e, `${mark('note', h.title)} couldn't be renamed.`);
		}
	}

	function onTitleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== 'Escape') return;
		e.preventDefault();
		if (e.key === 'Escape' && handle) title = handle.title;
		(e.currentTarget as HTMLInputElement).blur();
	}

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
			paneH = el.clientHeight;
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

{#snippet hero(h: PdfHandle)}
	<DocumentHero
		handle={h}
		loaded
		onDelete={deleteDoc}
		bind:propsOpen
		{back}
		{forward}
		{onOpenFolder}
		{showOpenFolder}
		{onFolderMeta}
	/>
{/snippet}

<div class="pdf-viewer" class:flow bind:this={rootEl}>
	<div class="scroll" bind:this={scrollEl}>
		<div class="layout">
			{#if handle && side}
				<aside class="side" style:max-height="{paneH}px">{@render hero(handle)}</aside>
			{/if}
			<div class="body" style:width="{width}px">
				{#if notice}
					<GonePage headline={notice.headline} detail={notice.detail} {actions} />
				{:else if pdf && width > 0}
					<div class="pages">
						{#each ratios as ratio, i (i)}
							<div
								class="page"
								style:width="{width}px"
								style:aspect-ratio={ratio}
								{@attach pageView(i + 1)}
							>
								<div class="textLayer"></div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
	{#if handle && !flow && !side}
		<div class="hero-card" class:open={heroOpen}>
			<div class="card-head">
				<PdfIcon size={14} />
				<input
					class="card-title"
					class:invalid={titleTaken || titleIllegal}
					title={titleIllegal
						? (segmentProblem(`${title.trim()}${ext}`) ?? undefined)
						: titleTaken
							? 'A file with this name is already in this folder.'
							: undefined}
					bind:value={title}
					use:nameGuard
					onblur={commitTitle}
					onkeydown={onTitleKeydown}
					spellcheck="false"
				/>
				<button
					class="card-expand"
					type="button"
					title={heroOpen ? 'Hide details' : 'Show details'}
					onclick={() => (heroOpen = !heroOpen)}
				>
					<ChevronDown size={14} strokeWidth={1.75} />
				</button>
			</div>
			{#if heroOpen}
				<div class="card-body">{@render hero(handle)}</div>
			{/if}
		</div>
	{/if}
	{#if !flow}
		<ScrollThumb scroller={scrollEl} />
	{/if}
</div>

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

	.layout {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 32px;
		padding: 48px 24px 96px;
	}

	.flow .layout {
		padding-top: 0;
	}

	.side {
		position: sticky;
		top: 0;
		flex-shrink: 0;
		width: 300px;
		margin-top: -48px;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.side::-webkit-scrollbar {
		display: none;
	}

	.side :global(.hero-inner) {
		max-width: none;
		padding-right: 0;
		padding-left: 0;
	}

	.body {
		flex-shrink: 1;
		min-width: 0;
	}

	.pages {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}

	.hero-card {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		width: min(260px, calc(100% - 24px));
		max-height: calc(100% - 24px);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.hero-card.open {
		width: min(380px, calc(100% - 24px));
	}

	.card-head {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 4px 0 10px;
		color: var(--color-ui-muted);
	}

	.card-title {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		font-size: 13px;
		font-weight: 500;
		text-overflow: ellipsis;
	}

	.card-title.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.card-expand {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition: transform 120ms ease;
	}

	.card-expand:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.open .card-expand {
		transform: rotate(180deg);
	}

	.card-body {
		overflow-y: auto;
		border-top: 1px solid var(--color-border);
	}

	.card-body :global(.hero-inner) {
		max-width: none;
		padding: 12px 14px;
	}

	.card-body :global(.title-left) {
		display: none;
	}

	.page {
		position: relative;
		max-width: 100%;
		overflow: hidden;
		border-radius: 4px;
		background: #fff;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
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
		z-index: 0;
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
