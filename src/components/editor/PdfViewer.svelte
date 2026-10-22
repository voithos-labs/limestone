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
	import { readErrorKind, type ReadErrorKind } from '#lib/models/MarkdownHandle.js';
	import { sourceName } from '#lib/models/Source.js';
	import GonePage from '../pages/GonePage.svelte';
	import type { GoneAction } from '../pages/GoneActions.svelte';
	import ScrollThumb from '../ui/ScrollThumb.svelte';

	let { tab, flow = false }: { tab: TabState; flow?: boolean } = $props();

	type Failure = ReadErrorKind | 'password' | 'damaged';
	type PdfLib = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

	const MAX_PAGE_WIDTH = 1000;
	const SIDE_PAD = 24;
	const RESIZE_SETTLE_MS = 120;
	const KEEP_MARGIN = '1200px 0px';

	const handle = $derived(tab.content.type === 'pdf' ? tab.content.handle : null);

	let lib: PdfLib | null = null;
	let pdf: PDFDocumentProxy | null = $state.raw(null);
	let ratios: number[] = $state([]);
	let failure: Failure | null = $state(null);
	let attempt = $state(0);
	let width = $state(0);
	let rootEl: HTMLDivElement | undefined = $state();
	let scrollEl: HTMLDivElement | undefined = $state();
	let io: IntersectionObserver | null = $state.raw(null);
	const watchers = new Map<Element, (visible: boolean) => void>();

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
			width = Math.max(0, Math.min(MAX_PAGE_WIDTH, el.clientWidth - SIDE_PAD * 2));
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

<div class="pdf-viewer" class:flow bind:this={rootEl}>
	{#if notice}
		<GonePage headline={notice.headline} detail={notice.detail} {actions} />
	{:else}
		<div class="scroll" bind:this={scrollEl}>
			{#if pdf && width > 0}
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
		{#if !flow}
			<ScrollThumb scroller={scrollEl} />
		{/if}
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

	.pages {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 40px 24px 96px;
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
