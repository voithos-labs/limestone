<script lang="ts">
	/**
	 * A formatting bar that exists only while a live-mode selection does. Live paints no syntax, so
	 * this is where bold and friends become clickable.
	 */
	import type { EditorInstance, EditorSelection } from 'aragonite';
	import { createEditorFormatActions } from './editor-command-adapter';
	import { Bold, Code, Italic, Link, Strikethrough } from '@lucide/svelte';

	let { instance }: { instance: EditorInstance | undefined } = $props();

	let position = $state<{ x: number; y: number } | null>(null);
	let actions = $derived(instance ? createEditorFormatActions(instance) : null);

	$effect(() => {
		if (!instance) return;
		return instance.getEvents().on('selectionChange', (s) => (position = place(s)));
	});

	/** Where the bar should sit for this selection, or null when it should not be shown at all. */
	function place(selection: EditorSelection | null): { x: number; y: number } | null {
		if (!instance || !selection) return null;
		if (selection.anchor.cellCoordinate || selection.focus.cellCoordinate) return null;
		// A selection inside one table carries cell-numbered offsets on endpoints that are never
		// flagged, so the flag misses it and the focused element is the only thing that can say.
		if (document.activeElement?.closest('.table-block')) return null;

		// Every format command declines a range that crosses blocks, on the chord path and the
		// command door alike, so a bar there is dead buttons. Anchoring returns if aragonite#157 lands.
		if (selection.anchor.path.join('.') !== selection.focus.path.join('.')) return null;

		const lo = Math.min(selection.anchor.offset, selection.focus.offset);
		const hi = Math.max(selection.anchor.offset, selection.focus.offset);
		if (lo === hi) return null;
		const rects = instance.getRects().rangeRects(selection.focus.path, lo, hi);
		return rects.length ? { x: rects[0].left, y: Math.max(4, rects[0].top - 38) } : null;
	}

	const BUTTONS = [
		{ label: 'Bold', Icon: Bold, act: () => actions?.toggleStrong() },
		{ label: 'Italic', Icon: Italic, act: () => actions?.toggleEmphasis() },
		{ label: 'Strikethrough', Icon: Strikethrough, act: () => actions?.toggleStrike() },
		{ label: 'Code', Icon: Code, act: () => actions?.toggleCode() },
		{ label: 'Link', Icon: Link, act: () => actions?.editLink() }
	];
</script>

{#if position}
	<div class="selection-toolbar" style:left="{position.x}px" style:top="{position.y}px">
		{#each BUTTONS as { label, Icon, act } (label)}
			<!-- Mousedown is swallowed so the press never takes the selection the command needs. -->
			<button
				type="button"
				aria-label={label}
				onmousedown={(e) => e.preventDefault()}
				onclick={act}
			>
				<Icon size={14} />
			</button>
		{/each}
	</div>
{/if}

<style>
	.selection-toolbar {
		position: fixed;
		z-index: 100;
		display: flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-surface, 8px);
		background: var(--color-surface);
	}

	.selection-toolbar button {
		display: inline-flex;
		align-items: center;
		padding: 4px 6px;
		border: none;
		border-radius: var(--radius-ui, 4px);
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.selection-toolbar button:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}
</style>
