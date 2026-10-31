<script lang="ts">
	import type { Annotation, PageRect } from '#lib/pdf/annotation.js';
	import { ANNOTATION_RGB } from './colors.js';

	let {
		marks,
		activeId = null,
		draft = null
	}: {
		/** The annotations on this page. */
		marks: Annotation[];
		activeId?: string | null;
		/** A region being dragged out, not yet saved. */
		draft?: PageRect | null;
	} = $props();
</script>

<div class="marks" aria-hidden="true">
	{#each marks as a (a.id)}
		{#each a.rects as r, i (i)}
			<span
				class={a.kind === 'region' ? 'region' : 'highlight'}
				class:active={a.id === activeId}
				style:--ann={ANNOTATION_RGB[a.color]}
				style:left="{r[0] * 100}%"
				style:top="{r[1] * 100}%"
				style:width="{r[2] * 100}%"
				style:height="{r[3] * 100}%"
			></span>
		{/each}
	{/each}
	{#if draft}
		<span
			class="region"
			style:--ann={ANNOTATION_RGB.sky}
			style:left="{draft[0] * 100}%"
			style:top="{draft[1] * 100}%"
			style:width="{draft[2] * 100}%"
			style:height="{draft[3] * 100}%"
		></span>
	{/if}
</div>

<style>
	.marks {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}

	.marks > span {
		position: absolute;
		box-sizing: border-box;
		border-radius: 2px;
	}

	.highlight {
		background: rgb(var(--ann) / 0.38);
		mix-blend-mode: multiply;
	}

	.highlight.active {
		background: rgb(var(--ann) / 0.5);
		box-shadow: 0 0 0 2px rgb(var(--ann));
	}

	.region {
		border: 1.5px dashed rgb(var(--ann));
		background: rgb(var(--ann) / 0.08);
	}

	.region.active {
		border-style: solid;
		background: rgb(var(--ann) / 0.14);
	}
</style>
