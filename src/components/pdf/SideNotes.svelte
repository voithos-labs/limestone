<script lang="ts">
	import type { Annotation } from '#lib/pdf/annotation.js';
	import type { Citing } from '#lib/pdf/citation.js';
	import { stackTops } from '#lib/pdf/margin.js';
	import SideNote, { TEXT_INSET, type NoteActions } from './SideNote.svelte';

	let {
		notes,
		anchorY,
		activeId = null,
		editingId = null,
		citedBy = new Map(),
		...actions
	}: NoteActions & {
		/** The annotations that get a note in the margin. */
		notes: Annotation[];
		/** The top of an annotation's passage in the rail's own coordinates. */
		anchorY: (a: Annotation) => number;
		activeId?: string | null;
		editingId?: string | null;
		/** The notes citing each annotation, by annotation id. */
		citedBy?: Map<string, Citing[]>;
	} = $props();

	const GAP = 10;

	let heights: Record<string, number> = $state({});

	const tops = $derived(
		stackTops(
			notes,
			(a) => anchorY(a) - TEXT_INSET,
			(a) => heights[a.id] ?? 0,
			GAP
		)
	);
</script>

<div class="side-notes">
	{#each notes as a (a.id)}
		<div class="slot" style:top="{tops.get(a) ?? 0}px" bind:offsetHeight={heights[a.id]}>
			<SideNote
				annotation={a}
				active={a.id === activeId}
				editing={a.id === editingId}
				cites={citedBy.get(a.id)}
				{...actions}
			/>
		</div>
	{/each}
</div>

<style>
	.side-notes {
		position: relative;
	}

	/* the card reaches a little past the rail's edge toward the page */
	.slot {
		position: absolute;
		left: -10px;
		right: 0;
	}
</style>
