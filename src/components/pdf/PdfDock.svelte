<script lang="ts" module>
	import type { Component } from 'svelte';
	import { Highlighter, Pen, SquareDashed, TextCursor } from '@lucide/svelte';

	export type PdfTool = 'select' | 'highlight' | 'region' | 'ink';

	const TOOLS: { id: PdfTool; label: string; key?: string; icon: Component }[] = [
		{ id: 'select', label: 'Select text', icon: TextCursor },
		{ id: 'highlight', label: 'Highlight', key: 'H', icon: Highlighter },
		{ id: 'region', label: 'Region', key: 'R', icon: SquareDashed },
		{ id: 'ink', label: 'Ink', key: 'P', icon: Pen }
	];

	/** The tool a single key picks, as its button's title shows. */
	export function toolForKey(key: string): PdfTool | null {
		return TOOLS.find((t) => t.key === key.toUpperCase())?.id ?? null;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Moon } from '@lucide/svelte';

	let {
		tool = $bindable('select'),
		page,
		pages,
		zoom,
		disabled = false,
		dark = false,
		onZoomReset,
		onToggleDark,
		tray
	}: {
		tool?: PdfTool;
		/** The page in view, counted from 1. */
		page: number;
		pages: number;
		/** Zoom as a fraction of the page's fitted width. */
		zoom: number;
		/** Annotating isn't possible here; only selecting text is. */
		disabled?: boolean;
		/** Whether pages are shown with dark colors. */
		dark?: boolean;
		onZoomReset: () => void;
		onToggleDark: () => void;
		/** Options for the current tool, stacked above the dock. */
		tray?: Snippet;
	} = $props();
</script>

<div class="dock-stack">
	{@render tray?.()}
	<div class="dock">
		{#each TOOLS as t (t.id)}
			<button
				class="tool"
				class:on={tool === t.id}
				type="button"
				title={t.key ? `${t.label} (${t.key})` : t.label}
				disabled={disabled && t.id !== 'select'}
				onclick={() => (tool = t.id)}
			>
				<t.icon size={14} strokeWidth={1.75} />
			</button>
		{/each}
		<span class="sep"></span>
		<span class="count">{page} <span class="of">/ {pages}</span></span>
		<span class="sep"></span>
		<button class="zoom" type="button" title="Reset zoom" onclick={onZoomReset}>
			{Math.round(zoom * 100)}%
		</button>
		<span class="sep"></span>
		<button
			class="tool"
			class:on={dark}
			type="button"
			title={dark ? 'Original page colors' : 'Dark pages'}
			onclick={onToggleDark}
		>
			<Moon size={14} strokeWidth={1.75} />
		</button>
	</div>
</div>

<style>
	.dock-stack {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 18px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		pointer-events: none;
	}

	.dock-stack > :global(*) {
		pointer-events: auto;
	}

	.dock {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.tool {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.tool:hover:not(:disabled) {
		color: var(--color-text-secondary);
	}

	.tool.on {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.tool:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.sep {
		width: 1px;
		height: 16px;
		background: var(--color-border);
	}

	.count {
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
	}

	.of {
		color: var(--color-ui-muted);
	}

	.zoom {
		padding: 0 6px;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.zoom:hover {
		color: var(--color-text-secondary);
	}
</style>
