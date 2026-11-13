<script lang="ts">
	/**
	 * a tick on the scroll track for each annotation, at its place in the pdf.
	 *
	 * Clicking one goes to that annotation.
	 */

	import { fade } from 'svelte/transition';
	import type { Annotation } from '#lib/pdf/annotation.js';
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
		onGoTo: (a: Annotation) => void;
		onGoToPage: (page: number) => void;
	} = $props();

	const MIN_SEGMENT = 3;
	const HOVER_MS = 80;
	const TIP_EDGE = 22;

	interface Tip {
		y: number;
		text: string;
		page: number;
		rgb?: string;
	}

	let tip: Tip | null = $state.raw(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function enter(next: Tip) {
		clearTimeout(timer);
		if (tip) tip = next;
		else timer = setTimeout(() => (tip = next), HOVER_MS);
	}

	function leave() {
		clearTimeout(timer);
		tip = null;
	}

	$effect(() => () => clearTimeout(timer));

	// the track's length, and the content it stands for: its height and where the pages start
	let track = $state.raw({ length: 0, content: 0, pagesTop: 0 });

	$effect(() => {
		const el = scroller;
		const column = pages;
		if (!el || !column) return;
		const measure = () => {
			const top = column.getBoundingClientRect().top - el.getBoundingClientRect().top;
			track = {
				length: trackLength(el.clientHeight, el.scrollHeight, top),
				content: el.scrollHeight,
				pagesTop: top + el.scrollTop
			};
		};
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		for (const child of el.children) ro.observe(child);
		measure();
		return () => ro.disconnect();
	});

	const at = (y: number) => top + ((track.pagesTop + y) / track.content) * track.length;
	const span = (a: Annotation) =>
		Math.max(MIN_SEGMENT, ((endY(a) - anchorY(a)) / track.content) * track.length);
</script>

{#if track.length > 0}
	{#each chapters as c, i (i)}
		<button
			class="chapter"
			type="button"
			tabindex="-1"
			aria-label={c.title}
			style:top="{at(pageY(c.page))}px"
			onpointerenter={() => enter({ y: at(pageY(c.page)), text: c.title, page: c.page })}
			onpointerleave={leave}
			onclick={() => onGoToPage(c.page)}
		></button>
	{/each}
	{#each annotations as a (a.id)}
		<button
			class="tick"
			type="button"
			tabindex="-1"
			aria-label="Annotation on page {a.page}"
			style:top="{at(anchorY(a))}px"
			style:height="{span(a) + 6}px"
			style:--ann={annotationRgb(a)}
			onpointerenter={() =>
				enter({
					y: at(anchorY(a)) + span(a) / 2,
					text: a.comment?.trim() || a.quote?.trim() || '',
					page: a.page,
					rgb: annotationRgb(a)
				})}
			onpointerleave={leave}
			onclick={() => onGoTo(a)}
		></button>
	{/each}
	{#if tip}
		<div
			class="tip"
			style:top="{Math.max(top + TIP_EDGE, tip.y)}px"
			style:--ann={tip.rgb}
			in:fade={{ duration: 80 }}
		>
			{#if tip.rgb}<span class="bar"></span>{/if}
			<span class="body">
				{#if tip.text}<span class="text">{tip.text}</span>{/if}
				<span class="page">Page {tip.page}</span>
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

	/* drawn where the thumb's line runs */
	.tick::before {
		content: '';
		position: absolute;
		top: 3px;
		bottom: 3px;
		right: 4px;
		width: 4px;
		border-radius: 2px;
		background: rgb(var(--ann));
	}

	.tip {
		position: absolute;
		right: 18px;
		z-index: 7;
		display: flex;
		gap: 8px;
		max-width: 260px;
		padding: 7px 10px;
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
