<script lang="ts">
	import { Link, MessageSquare, Quote } from '@lucide/svelte';
	import { ANNOTATION_COLORS, type AnnotationColor } from '#lib/pdf/annotation.js';
	import { ANNOTATION_RGB } from './colors.js';

	let {
		x,
		y,
		color,
		writable = true,
		onColor,
		onComment,
		onCite,
		onCopyText,
		onClose
	}: {
		/** Where the menu's top-left sits, in the viewer's own coordinates. */
		x: number;
		y: number;
		/** The color last used, which a plain highlight takes. */
		color: AnnotationColor;
		/** False where annotations can't be saved; only copying the text is offered. */
		writable?: boolean;
		onColor: (color: AnnotationColor) => void;
		onComment: () => void;
		onCite: () => void;
		onCopyText: () => void;
		onClose: () => void;
	} = $props();

	let el: HTMLDivElement | undefined = $state();

	function onWindowPointer(e: PointerEvent) {
		if (el && !el.contains(e.target as Node)) onClose();
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
		else if (
			writable &&
			(e.key === 'c' || e.key === 'C') &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			e.preventDefault();
			onComment();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div class="selection-menu" bind:this={el} style:left="{x}px" style:top="{y}px" role="menu">
	{#if writable}
		<div class="swatches">
			{#each ANNOTATION_COLORS as c (c)}
				<button
					class="swatch"
					class:current={c === color}
					type="button"
					title={c}
					onclick={() => onColor(c)}
				>
					<span style:--ann={ANNOTATION_RGB[c]}></span>
				</button>
			{/each}
		</div>
		<div class="divider"></div>
		<button class="row" type="button" onclick={onComment}>
			<span class="icon"><MessageSquare size={13} strokeWidth={1.75} /></span>
			<span class="label">Comment</span>
			<span class="key">C</span>
		</button>
		<button class="row" type="button" onclick={onCite}>
			<span class="icon"><Quote size={13} strokeWidth={1.75} /></span>
			<span class="label">Copy as citation</span>
		</button>
	{:else}
		<p class="reason">This folder doesn't store metadata, so annotations can't be saved here.</p>
	{/if}
	<button class="row" type="button" onclick={onCopyText}>
		<span class="icon"><Link size={13} strokeWidth={1.75} /></span>
		<span class="label">Copy text</span>
	</button>
</div>

<style>
	.selection-menu {
		position: absolute;
		z-index: 6;
		width: 204px;
		padding: 4px;
		box-sizing: border-box;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary);
	}

	.swatches {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
	}

	.swatch {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 30px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		cursor: pointer;
	}

	.swatch span {
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: rgb(var(--ann));
	}

	.swatch.current {
		background: var(--chip-bg);
	}

	.swatch.current span {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 3.5px var(--color-ui-muted);
	}

	.divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px 6px 10px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.swatch:hover,
	.row:hover {
		background: var(--chip-bg-hover);
	}

	.reason {
		margin: 0;
		padding: 6px 10px 4px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.icon {
		display: inline-flex;
		color: var(--color-ui-muted);
	}

	.label {
		flex: 1;
	}

	.key {
		font-size: 12px;
		color: var(--color-ui-muted);
	}
</style>
