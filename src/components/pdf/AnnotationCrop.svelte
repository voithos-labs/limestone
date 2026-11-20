<script lang="ts">
	/**
	 * a region or ink annotation, drawn as a crop of its page.
	 *
	 * Citation cards and the digest use it to show what a box marks. It waits until it's near the
	 * view before drawing, since a long digest can hold a lot of these.
	 */

	/* -------------------------------------------------------------------------- */
	/*                                  Imports                                   */
	/* -------------------------------------------------------------------------- */

	import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
	import {
		rectsOn,
		type AnnotationFields,
		type InkStroke,
		type PageRect
	} from '#lib/pdf/annotation.js';
	import { inkOf } from '#lib/pdf/LooseInk.svelte.js';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { importGlobalAssetBytes } from '#lib/services/assets.js';
	import { renderCrop, unionRect } from '#lib/pdf/crop.js';
	import { strokePath } from '#lib/pdf/ink.js';
	import { scrollParent } from '#lib/util/dom.js';
	import { INK_RGB } from './colors.js';

	/* -------------------------------------------------------------------------- */
	/*                                   Props                                    */
	/* -------------------------------------------------------------------------- */

	/** A region or ink annotation drawn from its page, with the ink laid over the crop. */
	let {
		annotation,
		maxHeight,
		doc = null
	}: {
		annotation: Pick<AnnotationFields, 'pdf' | 'page' | 'kind' | 'rects' | 'strokes' | 'edition'>;
		maxHeight?: number;
		/** The PDF already open on the annotation's edition, when the caller has it. */
		doc?: PDFDocumentProxy | null;
	} = $props();

	/* -------------------------------------------------------------------------- */
	/*                               The crop's box                               */
	/* -------------------------------------------------------------------------- */

	const rect = $derived(padded(unionRect(rectsOn(annotation, annotation.page)), annotation.kind));

	// ink sits right at its box's edge, so its crop gets a margin to keep the strokes whole
	function padded(rect: PageRect | null, kind: AnnotationFields['kind']): PageRect | null {
		if (!rect || kind !== 'ink') return rect;
		const m = 0.015;
		const x = Math.max(0, rect[0] - m);
		const y = Math.max(0, rect[1] - m);
		return [x, y, Math.min(1, rect[0] + rect[2] + m) - x, Math.min(1, rect[1] + rect[3] + m) - y];
	}

	/* -------------------------------------------------------------------------- */
	/*                           Drawing near the view                            */
	/* -------------------------------------------------------------------------- */

	// how far outside the scroller's view a crop starts drawing, so it's there when it scrolls in
	const NEAR = '600px 0px';
	const THUMB_WIDTH = 1200;
	const THUMB_MAX_HEIGHT = 1800;

	let loose: InkStroke[] = $state.raw([]);
	$effect(() => {
		const { pdf, page } = annotation;
		if (!pdf) return;
		let live = true;
		inkOf(pdf)
			.then((all) => {
				if (live) loose = all.filter((s) => s.page === page);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	});
	const strokes = $derived([...(annotation.strokes ?? []), ...loose]);

	let aspect = $state(0);

	function shaped(w: number, h: number) {
		if (rect && w > 0) aspect = ((h / w) * rect[2]) / rect[3];
	}

	const key = $derived(
		rect &&
			`pdf-thumb:${annotation.pdf}:${annotation.edition ?? ''}:${annotation.page}:${[rect[0], rect[1], rect[2], rect[3]].map((n) => Math.round(n * 10000))}`
	);
	let failed: string | null = $state(null);
	const thumb = $derived(key && key !== failed ? stored(key) : null);

	function stored(k: string): string | null {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	}

	async function keep(canvas: HTMLCanvasElement, k: string) {
		const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
		if (!blob) return;
		const name = await importGlobalAssetBytes(await blob.arrayBuffer(), 'png');
		localStorage.setItem(k, name);
	}

	function draw(canvas: HTMLCanvasElement) {
		const r = rect;
		const k = key;
		if (!r || !k) return;
		const controller = new AbortController();
		let started = false;
		const io = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting || started) return;
				started = true;
				renderCrop(canvas, {
					pdf: annotation.pdf,
					edition: annotation.edition,
					page: annotation.page,
					rect: r,
					width: THUMB_WIDTH,
					maxHeight: THUMB_MAX_HEIGHT,
					signal: controller.signal,
					doc
				})
					.then(() => {
						canvas.style.width = canvas.style.height = '';
						shaped(canvas.width, canvas.height);
						return keep(canvas, k);
					})
					.catch(() => {
						if (!controller.signal.aborted) started = false;
					});
			},
			{ root: scrollParent(canvas), rootMargin: NEAR }
		);
		io.observe(canvas);
		return () => {
			io.disconnect();
			controller.abort();
		};
	}
</script>

{#if rect}
	{#key `${annotation.pdf} ${annotation.page} ${rect.join()}`}
		<span class="crop" style:--crop-max={maxHeight ? `${maxHeight}px` : 'none'}>
			<span class="frame">
				{#if thumb}
					<img
						src={convertFileSrc(thumb, 'appasset')}
						alt=""
						loading="lazy"
						onerror={() => (failed = key)}
						onload={(e) => {
							const img = e.currentTarget as HTMLImageElement;
							shaped(img.naturalWidth, img.naturalHeight);
						}}
					/>
				{:else}
					<canvas width="1" height="1" {@attach draw}></canvas>
				{/if}
				{#if strokes.length && aspect}
					<svg
						viewBox="{rect[0]} {rect[1] * aspect} {rect[2]} {rect[3] * aspect}"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						{#each strokes as s, i (i)}
							<path
								d={strokePath(s.points, aspect)}
								style:stroke="rgb({INK_RGB[s.color]})"
								stroke-width={s.width}
								stroke-opacity={s.highlighter ? 0.4 : 1}
							/>
						{/each}
					</svg>
				{/if}
			</span>
		</span>
	{/key}
{/if}

<style>
	.crop {
		display: block;
		line-height: 0;
	}

	.frame {
		position: relative;
		display: inline-block;
		max-width: 100%;
		vertical-align: top;
	}

	canvas,
	img {
		display: block;
		width: auto;
		height: auto;
		max-width: 100%;
		max-height: var(--crop-max);
		border-radius: var(--crop-radius, 5px);
	}

	/* a ring a caller can turn on, drawn over the canvas since an inset shadow paints beneath it */
	.frame::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: var(--crop-radius, 5px);
		box-shadow: inset 0 0 0 var(--crop-ring, 0) rgb(var(--ann, 0 0 0) / 0.6);
		pointer-events: none;
	}

	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
