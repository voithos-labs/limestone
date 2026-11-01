<script lang="ts">
	import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
	import type { AnnotationFields, PageRect } from '#lib/pdf/annotation.js';
	import { renderCrop, unionRect } from '#lib/pdf/crop.js';
	import { strokePath } from '#lib/pdf/ink.js';
	import { scrollParent } from '#lib/util/dom.js';
	import { INK_RGB } from './colors.js';

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

	// how far outside the scroller's view a crop starts drawing, so it's there when it scrolls in
	const NEAR = '600px 0px';

	const rect = $derived(padded(unionRect(annotation.rects), annotation.kind));

	// ink sits right at its box's edge, so its crop gets a margin to keep the strokes whole
	function padded(rect: PageRect | null, kind: AnnotationFields['kind']): PageRect | null {
		if (!rect || kind !== 'ink') return rect;
		const m = 0.015;
		const x = Math.max(0, rect[0] - m);
		const y = Math.max(0, rect[1] - m);
		return [x, y, Math.min(1, rect[0] + rect[2] + m) - x, Math.min(1, rect[1] + rect[3] + m) - y];
	}

	// The full-width box is what's measured; the canvas inside can come out narrower when
	// maxHeight bites, and the frame hugging it keeps the ink overlay on the drawing. Nothing is
	// drawn until the box nears the view, and a drawing it leaves unfinished is dropped.
	function draw(box: HTMLElement) {
		const canvas = box.querySelector('canvas')!;
		const shared = doc;
		let controller: AbortController | null = null;
		let drawing = false;
		let drawnWidth = 0;
		let near = false;
		const redraw = () => {
			const r = rect;
			const width = Math.floor(box.clientWidth);
			if (!near || !r || width <= 0 || width === drawnWidth) return;
			drawnWidth = width;
			controller?.abort();
			const signal = (controller = new AbortController()).signal;
			drawing = true;
			renderCrop(canvas, {
				pdf: annotation.pdf,
				edition: annotation.edition,
				page: annotation.page,
				rect: r,
				width,
				maxHeight,
				signal,
				doc: shared
			})
				.catch(() => {
					if (!signal.aborted) drawnWidth = 0;
				})
				.finally(() => {
					if (!signal.aborted) drawing = false;
				});
		};
		const ro = new ResizeObserver(redraw);
		ro.observe(box);
		const io = new IntersectionObserver(
			([entry]) => {
				near = entry.isIntersecting;
				if (near) redraw();
				else if (drawing) {
					controller?.abort();
					drawing = false;
					drawnWidth = 0;
				}
			},
			{ root: scrollParent(box), rootMargin: NEAR }
		);
		io.observe(box);
		return () => {
			ro.disconnect();
			io.disconnect();
			controller?.abort();
		};
	}
</script>

{#if rect}
	{#key `${annotation.pdf} ${annotation.page} ${rect.join()}`}
		<span class="crop" {@attach draw}>
			<span class="frame">
				<canvas width="0" height="0"></canvas>
				{#if annotation.strokes?.length}
					<svg viewBox={rect.join(' ')} preserveAspectRatio="none" aria-hidden="true">
						{#each annotation.strokes as s, i (i)}
							<path d={strokePath(s.points, 1)} stroke="rgb({INK_RGB[s.color]})" />
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

	canvas {
		display: block;
		max-width: 100%;
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
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	path {
		vector-effect: non-scaling-stroke;
	}
</style>
