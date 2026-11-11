<script lang="ts">
	/**
	 * a tick on the scroll track for each annotation, at its place in the pdf.
	 *
	 * Clicking one goes to that annotation.
	 */

	import type { Annotation } from '#lib/pdf/annotation.js';
	import { TRACK_START, trackLength } from '../ui/ScrollThumb.svelte';
	import { annotationRgb } from './colors.js';

	/** A tick for each annotation on the scroll track, at its place in the PDF. */
	let {
		scroller,
		pages,
		annotations,
		anchorY,
		onGoTo
	}: {
		scroller: HTMLElement | undefined;
		/** The pages column `anchorY` measures from. */
		pages: HTMLElement | undefined;
		annotations: Annotation[];
		anchorY: (a: Annotation) => number;
		onGoTo: (a: Annotation) => void;
	} = $props();

	// the track's length, and the content it stands for: its height and where the pages start
	let track = $state.raw({ length: 0, content: 0, pagesTop: 0 });

	$effect(() => {
		const el = scroller;
		const column = pages;
		if (!el || !column) return;
		const measure = () => {
			const top = column.getBoundingClientRect().top - el.getBoundingClientRect().top;
			track = {
				length: trackLength(el.clientHeight, el.scrollHeight),
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

	const at = (a: Annotation) =>
		TRACK_START + ((track.pagesTop + anchorY(a)) / track.content) * track.length;
</script>

{#if track.length > 0}
	{#each annotations as a (a.id)}
		<button
			class="tick"
			type="button"
			tabindex="-1"
			aria-label="Annotation on page {a.page}"
			style:top="{at(a)}px"
			style:--ann={annotationRgb(a)}
			onclick={() => onGoTo(a)}
		></button>
	{/each}
{/if}

<style>
	/* under the thumb, which keeps its drag wherever it passes over a tick */
	.tick {
		position: absolute;
		right: 0;
		z-index: 5;
		width: 12px;
		height: 9px;
		padding: 0;
		border: 0;
		background: none;
		transform: translateY(-50%);
		cursor: pointer;
	}

	/* drawn where the thumb's line runs */
	.tick::before {
		content: '';
		position: absolute;
		top: 3px;
		right: 4px;
		width: 4px;
		height: 3px;
		border-radius: 2px;
		background: rgb(var(--ann));
	}
</style>
