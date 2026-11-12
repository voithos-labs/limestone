<script lang="ts" module>
	/**
	 * the dock under a pdf: its tools and view controls.
	 *
	 * The tools (select, highlight H, region R, ink P) come first, then the page number, zoom, dark
	 * pages and the sidenotes toggle. The current tool's own options, like the ink tray, stack
	 * above it.
	 */

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
	import { ANNOTATION_COLORS, type AnnotationColor } from '#lib/pdf/annotation.js';
	import { ANNOTATION_RGB } from './colors.js';

	let {
		tool = $bindable('select'),
		page,
		pages,
		zoom,
		disabled = false,
		dark = false,
		color,
		onColor,
		zoomSteps,
		onZoom,
		onGoToPage,
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
		color: AnnotationColor;
		onColor: (color: AnnotationColor) => void;
		zoomSteps: readonly number[];
		onZoom: (zoom: number) => void;
		onGoToPage: (page: number) => void;
		onToggleDark: () => void;
		/** Options for the current tool, stacked above the dock. */
		tray?: Snippet;
	} = $props();

	let popOpen: 'color' | 'zoom' | null = $state(null);

	function onWindowPointer(e: PointerEvent) {
		if (popOpen && !(e.target as Element).closest?.('.pop-slot')) popOpen = null;
	}

	let pageInput: HTMLInputElement | undefined = $state();
	let pageDraft: string | null = $state(null);

	function commitPage() {
		const n = parseInt(pageDraft ?? '', 10);
		if (n >= 1) onGoToPage(Math.min(n, pages));
		pageInput?.blur();
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} />

<div class="dock-stack">
	{@render tray?.()}
	<div
		class="dock"
		role="toolbar"
		tabindex="-1"
		onmousedown={(e) => {
			if (e.target !== pageInput) e.preventDefault();
		}}
	>
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
		<span class="pop-slot">
			{#if popOpen === 'color'}
				<div class="pop">
					{#each ANNOTATION_COLORS as c (c)}
						<button
							class="tool"
							class:on={c === color}
							type="button"
							title={c}
							onclick={() => {
								popOpen = null;
								onColor(c);
							}}
						>
							<span class="dot" class:accent={c === 'accent'} style:--ann={ANNOTATION_RGB[c]}
							></span>
						</button>
					{/each}
				</div>
			{/if}
			<button
				class="tool"
				class:on={popOpen === 'color'}
				type="button"
				title="Color"
				{disabled}
				onclick={() => (popOpen = popOpen === 'color' ? null : 'color')}
			>
				<span class="dot" class:accent={color === 'accent'} style:--ann={ANNOTATION_RGB[color]}
				></span>
			</button>
		</span>
		<span class="sep"></span>
		<span class="count" role="presentation" title="Go to page" onclick={() => pageInput?.focus()}>
			<input
				class="page-input"
				bind:this={pageInput}
				inputmode="numeric"
				aria-label="Page number"
				value={pageDraft ?? page}
				style:width="{String(pageDraft ?? page).length || 1}ch"
				onfocus={() => {
					pageDraft = String(page);
					requestAnimationFrame(() => pageInput?.select());
				}}
				oninput={(e) => (pageDraft = e.currentTarget.value.replace(/\D/g, ''))}
				onblur={() => (pageDraft = null)}
				onkeydown={(e) => {
					if (e.key === 'Enter') commitPage();
					else if (e.key === 'Escape') pageInput?.blur();
				}}
			/>
			<span class="of">/ {pages}</span>
		</span>
		<span class="sep"></span>
		<span class="pop-slot">
			{#if popOpen === 'zoom'}
				<div class="pop">
					{#each zoomSteps as z (z)}
						<button
							class="zoom-step"
							class:on={Math.abs(z - zoom) < 0.001}
							type="button"
							onclick={() => {
								popOpen = null;
								onZoom(z);
							}}>{Math.round(z * 100)}%</button
						>
					{/each}
				</div>
			{/if}
			<button
				class="zoom"
				class:on={popOpen === 'zoom'}
				type="button"
				title="Zoom"
				onclick={() => (popOpen = popOpen === 'zoom' ? null : 'zoom')}
			>
				{Math.round(zoom * 100)}%
			</button>
		</span>
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
	/* -------------------------------- The dock -------------------------------- */

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

	/* ------------------------------ Tool buttons ------------------------------ */

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

	.pop-slot {
		position: relative;
		display: flex;
	}

	.pop {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 50%;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		translate: -50% 0;
	}

	.dot {
		position: relative;
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: rgb(var(--ann));
	}

	.dot.accent::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--color-bg);
		translate: -50% -50%;
	}

	/* -------------------- Separators, page count and zoom --------------------- */

	.sep {
		width: 1px;
		height: 16px;
		background: var(--color-border);
	}

	.count {
		display: flex;
		align-items: baseline;
		gap: 0.35em;
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
		cursor: text;
	}

	.page-input {
		box-sizing: content-box;
		min-width: 1ch;
		padding: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.page-input:focus {
		box-shadow: 0 1px 0 currentColor;
	}

	.zoom-step {
		padding: 4px 10px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
		cursor: pointer;
	}

	.zoom-step:hover {
		color: var(--color-text-secondary);
	}

	.zoom-step.on {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
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
