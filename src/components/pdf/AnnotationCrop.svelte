<script lang="ts">
	import type { AnnotationFields, PageRect } from '#lib/pdf/annotation.js';
	import { renderCrop, unionRect } from '#lib/pdf/crop.js';
	import { strokePath } from '#lib/pdf/ink.js';
	import { INK_RGB } from './colors.js';

	/** A region or ink annotation drawn from its page, with the ink laid over the crop. */
	let {
		annotation,
		maxHeight
	}: {
		annotation: Pick<AnnotationFields, 'pdf' | 'page' | 'kind' | 'rects' | 'strokes'>;
		maxHeight?: number;
	} = $props();

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
	// maxHeight bites, and the frame hugging it keeps the ink overlay on the drawing.
	function draw(box: HTMLElement) {
		const canvas = box.querySelector('canvas')!;
		let controller: AbortController | null = null;
		let drawnWidth = 0;
		const redraw = () => {
			const r = rect;
			const width = Math.floor(box.clientWidth);
			if (!r || width <= 0 || width === drawnWidth) return;
			drawnWidth = width;
			controller?.abort();
			const signal = (controller = new AbortController()).signal;
			renderCrop(canvas, {
				pdf: annotation.pdf,
				page: annotation.page,
				rect: r,
				width,
				maxHeight,
				signal
			}).catch(() => {
				if (!signal.aborted) drawnWidth = 0;
			});
		};
		const ro = new ResizeObserver(redraw);
		ro.observe(box);
		return () => {
			ro.disconnect();
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
