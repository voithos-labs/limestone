<script lang="ts">
	/**
	 * a tick on the scroll track for each annotation, at its place in the pdf.
	 *
	 * Clicking one goes to that annotation.
	 */

	import { fade } from 'svelte/transition';
	import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
	import { rectsOn, type Annotation, type PageRect } from '#lib/pdf/annotation.js';
	import { renderCrop, unionRect } from '#lib/pdf/crop.js';
	import type { Chapter } from '#lib/pdf/outline.js';
	import { TRACK_START, trackLength } from '../ui/ScrollThumb.svelte';
	import { annotationRgb } from './colors.js';

	/** A tick for each annotation on the scroll track, at its place in the PDF. */
	let {
		scroller,
		pages,
		annotations,
		anchorY,
		endY,
		chapters = [],
		pageY,
		top = TRACK_START,
		doc = null,
		dark = false,
		themed = false,
		onGoTo,
		onGoToPage
	}: {
		scroller: HTMLElement | undefined;
		/** The pages column `anchorY` measures from. */
		pages: HTMLElement | undefined;
		annotations: Annotation[];
		anchorY: (a: Annotation) => number;
		endY: (a: Annotation) => number;
		chapters?: Chapter[];
		pageY: (page: number) => number;
		top?: number;
		doc?: PDFDocumentProxy | null;
		dark?: boolean;
		themed?: boolean;
		onGoTo: (a: Annotation) => void;
		onGoToPage: (page: number) => void;
	} = $props();

	const MIN_SEGMENT = 6;
	const HOVER_MS = 80;
	const PICKER_LINGER_MS = 200;
	const CLUSTER_GAP = 2;
	const BAND = 3;
	const TIP_EDGE = 120;
	const PREVIEW_WIDTH = 240;
	const PREVIEW_MAX_HEIGHT = 150;
	const CHAPTER_VIEW: PageRect = [0, 0, 1, 0.45];
	const PASSAGE_MIN_WIDTH = 0.5;
	const PASSAGE_PAD = 0.03;

	interface Tip {
		y: number;
		text: string;
		page: number;
		rect: PageRect | null;
		marks?: PageRect[];
		rgb?: string;
	}

	function passage(a: Annotation): PageRect | null {
		const r = unionRect(rectsOn(a, a.page));
		if (!r) return null;
		const w = Math.min(1, Math.max(r[2] + PASSAGE_PAD * 2, PASSAGE_MIN_WIDTH));
		const x = Math.min(1 - w, Math.max(0, r[0] + r[2] / 2 - w / 2));
		const y = Math.max(0, r[1] - PASSAGE_PAD);
		return [x, y, w, Math.min(1, r[1] + r[3] + PASSAGE_PAD) - y];
	}

	function preview(canvas: HTMLCanvasElement) {
		const shown = tip;
		if (!shown?.rect || !doc) return;
		const controller = new AbortController();
		renderCrop(canvas, {
			pdf: '',
			page: shown.page,
			rect: shown.rect,
			width: PREVIEW_WIDTH,
			maxHeight: PREVIEW_MAX_HEIGHT,
			signal: controller.signal,
			doc
		}).catch(() => {});
		return () => controller.abort();
	}

	let tip: Tip | null = $state.raw(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function enter(next: Tip) {
		clearTimeout(timer);
		picker = null;
		if (tip) tip = next;
		else timer = setTimeout(() => (tip = next), HOVER_MS);
	}

	function leave() {
		clearTimeout(timer);
		tip = null;
	}

	$effect(() => () => clearTimeout(timer));

	interface Cluster {
		top: number;
		height: number;
		items: Annotation[];
		colors: string[];
	}

	let picker: Cluster | null = $state.raw(null);

	function openPicker(c: Cluster) {
		clearTimeout(timer);
		tip = null;
		if (picker) picker = c;
		else timer = setTimeout(() => (picker = c), HOVER_MS);
	}

	function closeSoon() {
		clearTimeout(timer);
		timer = setTimeout(() => (picker = null), PICKER_LINGER_MS);
	}

	const label = (a: Annotation) =>
		a.comment?.trim() || a.quote?.trim() || (a.kind === 'ink' ? 'Ink' : 'Region');

	// the track's length, and the content it stands for: its height and where the pages start
	let track = $state.raw({ length: 0, content: 0, pagesTop: 0 });

	$effect(() => {
		const el = scroller;
		const column = pages;
		if (!el || !column) return;
		const measure = () => {
			const offset = column.getBoundingClientRect().top - el.getBoundingClientRect().top;
			track = {
				length: trackLength(el.clientHeight, el.scrollHeight, top),
				content: el.scrollHeight,
				pagesTop: offset + el.scrollTop
			};
		};
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		for (const child of el.children) ro.observe(child);
		measure();
		return () => ro.disconnect();
	});

	const at = (y: number) => Math.round(top + ((track.pagesTop + y) / track.content) * track.length);
	const span = (a: Annotation) =>
		Math.max(MIN_SEGMENT, Math.round(((endY(a) - anchorY(a)) / track.content) * track.length));

	const clusters = $derived.by(() => {
		const out: Cluster[] = [];
		const marks = annotations
			.map((a) => ({ a, top: at(anchorY(a)), height: span(a) }))
			.sort((x, y) => x.top - y.top);
		for (const { a, top, height } of marks) {
			const rgb = annotationRgb(a);
			const last = out.at(-1);
			if (last && top <= last.top + last.height + CLUSTER_GAP) {
				last.items.push(a);
				if (!last.colors.includes(rgb)) last.colors.push(rgb);
				last.height = Math.max(last.height, top + height - last.top, last.colors.length * BAND);
			} else out.push({ top, height, items: [a], colors: [rgb] });
		}
		return out;
	});
</script>

{#if track.length > 0}
	{#each chapters as c, i (i)}
		<button
			class="chapter"
			type="button"
			tabindex="-1"
			aria-label={c.title}
			style:top="{at(pageY(c.page))}px"
			onpointerenter={() =>
				enter({ y: at(pageY(c.page)), text: c.title, page: c.page, rect: CHAPTER_VIEW })}
			onpointerleave={leave}
			onclick={() => onGoToPage(c.page)}
		></button>
	{/each}
	{#each clusters as c (c.items[0].id)}
		{@const a = c.items[0]}
		<button
			class="tick"
			type="button"
			tabindex="-1"
			aria-label={c.items.length > 1
				? `${c.items.length} annotations near page ${a.page}`
				: `Annotation on page ${a.page}`}
			style:top="{c.top}px"
			style:height="{c.height + 6}px"
			onpointerenter={() =>
				c.items.length > 1
					? openPicker(c)
					: enter({
							y: c.top + c.height / 2,
							text: a.comment?.trim() || a.quote?.trim() || '',
							page: a.page,
							rect: passage(a),
							marks: a.kind === 'ink' ? [] : rectsOn(a, a.page),
							rgb: annotationRgb(a)
						})}
			onpointerleave={() => (c.items.length > 1 ? closeSoon() : leave())}
			onclick={() => onGoTo(a)}
		>
			<span class="bands">
				{#each c.colors as rgb (rgb)}<span style:--ann={rgb}></span>{/each}
			</span>
		</button>
	{/each}
	{#if picker}
		<div
			class="picker"
			role="presentation"
			style:top="{Math.min(
				Math.max(top + TIP_EDGE, picker.top + picker.height / 2),
				top + track.length - TIP_EDGE
			)}px"
			onpointerenter={() => clearTimeout(timer)}
			onpointerleave={closeSoon}
			in:fade={{ duration: 80 }}
		>
			{#each picker.items as a (a.id)}
				<button
					class="pick"
					type="button"
					style:--ann={annotationRgb(a)}
					onclick={() => {
						picker = null;
						onGoTo(a);
					}}
				>
					<span class="bar"></span>
					<span class="body">
						<span class="text">{label(a)}</span>
						<span class="page">Page {a.page}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
	{#if tip}
		<div
			class="tip"
			style:top="{Math.min(Math.max(top + TIP_EDGE, tip.y), top + track.length - TIP_EDGE)}px"
			style:--ann={tip.rgb}
			in:fade={{ duration: 80 }}
		>
			{#if tip.rect && doc}
				{#key tip}
					<span class="preview" class:dark class:themed>
						<span class="frame">
							<canvas width="0" height="0" {@attach preview}></canvas>
							{#each tip.marks ?? [] as [x, y, w, h], i (i)}
								<span
									class="mark"
									style:left="{((x - tip.rect[0]) / tip.rect[2]) * 100}%"
									style:top="{((y - tip.rect[1]) / tip.rect[3]) * 100}%"
									style:width="{(w / tip.rect[2]) * 100}%"
									style:height="{(h / tip.rect[3]) * 100}%"
								></span>
							{/each}
						</span>
						<span class="tone paper"></span>
						<span class="tone print"></span>
					</span>
				{/key}
			{/if}
			<span class="caption">
				{#if tip.rgb}<span class="bar"></span>{/if}
				<span class="body">
					{#if tip.text}<span class="text">{tip.text}</span>{/if}
					<span class="page">Page {tip.page}</span>
				</span>
			</span>
		</div>
	{/if}
{/if}

<style>
	/* under the thumb, which keeps its drag wherever it passes over a tick */
	.tick {
		position: absolute;
		right: 0;
		z-index: 5;
		width: 12px;
		margin-top: -3px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}

	.bands {
		position: absolute;
		top: 3px;
		bottom: 3px;
		right: 3px;
		display: flex;
		flex-direction: column;
		width: 6px;
		overflow: hidden;
		border-radius: 999px;
	}

	.bands span {
		flex: 1;
		background: rgb(var(--ann));
	}

	.picker {
		position: absolute;
		right: 18px;
		z-index: 7;
		display: flex;
		flex-direction: column;
		width: 262px;
		max-height: 240px;
		padding: 4px;
		box-sizing: border-box;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--color-text-primary);
		transform: translateY(-50%);
	}

	.pick {
		display: flex;
		flex-shrink: 0;
		gap: 8px;
		padding: 6px 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.pick:hover {
		background: var(--chip-bg-hover);
	}

	.pick .text {
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.tip {
		position: absolute;
		right: 18px;
		z-index: 7;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 262px;
		padding: 10px;
		box-sizing: border-box;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--color-text-primary);
		transform: translateY(-50%);
		pointer-events: none;
	}

	.preview {
		position: relative;
		display: flex;
		justify-content: center;
		min-height: 40px;
		overflow: hidden;
		isolation: isolate;
		border-radius: 5px;
		filter: brightness(0.9);
		background: #fff;
	}

	.frame {
		position: relative;
		display: block;
	}

	.mark {
		position: absolute;
		border-radius: 2px;
		background: rgb(var(--ann) / 0.35);
	}

	.preview.dark .frame {
		filter: invert(1) hue-rotate(180deg);
	}

	.preview.dark .mark {
		filter: invert(1) hue-rotate(180deg);
	}

	.tone {
		position: absolute;
		inset: 0;
	}

	.paper {
		background: var(--paper);
		mix-blend-mode: multiply;
	}

	.print {
		background: var(--print);
		mix-blend-mode: lighten;
	}

	.preview.themed {
		--paper: var(--color-surface);
		--print: var(--color-text-primary);
	}

	.preview.dark {
		--paper: #1f1f1f;
		--print: #e0e0e0;
		background: #000;
	}

	.preview.dark.themed {
		--paper: var(--color-bg);
		--print: var(--color-text-primary);
	}

	.preview.dark .paper {
		mix-blend-mode: lighten;
	}

	.preview.dark .print {
		mix-blend-mode: darken;
	}

	.caption {
		display: flex;
		gap: 8px;
	}

	.bar {
		flex-shrink: 0;
		width: 3px;
		border-radius: 2px;
		background: rgb(var(--ann));
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.text {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.page {
		font-size: 11.5px;
		color: var(--color-ui-muted);
	}

	.chapter {
		position: absolute;
		right: 0;
		z-index: 5;
		width: 12px;
		height: 7px;
		margin-top: -3px;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
	}

	.chapter::before {
		content: '';
		position: absolute;
		top: 3px;
		right: 2px;
		width: 8px;
		height: 1px;
		background: var(--color-ui-dulled);
	}
</style>
