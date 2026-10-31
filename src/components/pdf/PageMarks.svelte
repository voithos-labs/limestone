<script lang="ts">
	import type { Annotation, InkStroke, PageRect } from '#lib/pdf/annotation.js';
	import { strokePath } from '#lib/pdf/ink.js';
	import { ANNOTATION_RGB, INK_RGB, INK_STROKE } from './colors.js';

	let {
		marks,
		aspect,
		activeId = null,
		draft = null,
		loose = [],
		drawing = null,
		lasso = null
	}: {
		/** The annotations on this page. */
		marks: Annotation[];
		/** The page's height over its width, the ink's viewBox height. */
		aspect: number;
		activeId?: string | null;
		/** A region being dragged out, not yet saved. */
		draft?: PageRect | null;
		/** Ink on this page that no annotation holds yet. */
		loose?: InkStroke[];
		/** The stroke being drawn. */
		drawing?: InkStroke | null;
		/** The lasso being drawn, as a flat point list. */
		lasso?: number[] | null;
	} = $props();

	const boxes = $derived(marks.filter((a) => a.kind !== 'ink'));
	const inked = $derived(marks.filter((a) => a.kind === 'ink'));
	const activeInk = $derived(inked.find((a) => a.id === activeId));
</script>

{#snippet stroke(s: InkStroke)}
	<path
		d={strokePath(s.points, aspect)}
		stroke="rgb({INK_RGB[s.color]})"
		stroke-width={INK_STROKE[s.width]}
		stroke-opacity={s.width === 'marker' ? 0.5 : 0.9}
	/>
{/snippet}

<div class="marks" aria-hidden="true">
	{#each boxes as a (a.id)}
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
	{#if activeInk?.rects[0]}
		{@const r = activeInk.rects[0]}
		<span
			class="ink-group"
			style:left="calc({r[0] * 100}% - 6px)"
			style:top="calc({r[1] * 100}% - 6px)"
			style:width="calc({r[2] * 100}% + 12px)"
			style:height="calc({r[3] * 100}% + 12px)"
		></span>
	{/if}
	{#if loose.length || inked.length || drawing || lasso}
		<svg class="ink" viewBox="0 0 1 {aspect}" preserveAspectRatio="none">
			{#each inked as a (a.id)}
				{#each a.strokes ?? [] as s, i (i)}{@render stroke(s)}{/each}
			{/each}
			{#each loose as s, i (i)}{@render stroke(s)}{/each}
			{#if drawing}{@render stroke(drawing)}{/if}
			{#if lasso && lasso.length >= 4}
				<path
					class="lasso"
					d={strokePath(lasso, aspect) + 'Z'}
					stroke-width="0.0018"
					stroke-dasharray="0.008 0.006"
				/>
			{/if}
		</svg>
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

	.marks > .ink-group {
		border: 1px dashed var(--color-accent);
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.ink {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.lasso {
		stroke: var(--color-accent);
		fill: color-mix(in srgb, var(--color-accent) 6%, transparent);
	}
</style>
