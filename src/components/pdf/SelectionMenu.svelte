<script lang="ts">
	/**
	 * the menu that pops up when you select text in a pdf.
	 *
	 * It turns the selection into a highlight (in a color), a comment or a citation, or just copies
	 * the text, which is all it offers when annotations can't be saved.
	 */

	import { Highlighter, Link, MessageSquare, Quote } from '@lucide/svelte';

	let {
		x,
		y,
		writable = true,
		onHighlight,
		onComment,
		onCite,
		onCopyText,
		onClose
	}: {
		/** Where the menu's top-left sits, in the viewer's own coordinates. */
		x: number;
		y: number;
		/** False where annotations can't be saved; only copying the text is offered. */
		writable?: boolean;
		onHighlight: () => void;
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
		<button class="row" type="button" onclick={onHighlight}>
			<span class="icon"><Highlighter size={13} strokeWidth={1.75} /></span>
			<span class="label">Highlight</span>
		</button>
		<button class="row" type="button" onclick={onComment}>
			<span class="icon"><MessageSquare size={13} strokeWidth={1.75} /></span>
			<span class="label">Annotate</span>
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
	/* -------------------------------- The menu -------------------------------- */

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

	/* ---------------------------------- Rows ---------------------------------- */

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
