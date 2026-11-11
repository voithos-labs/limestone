<script lang="ts">
	/**
	 * the little menu under picked ink.
	 *
	 * It shows for an ink annotation, or for the loose strokes a lasso is holding, and lets you
	 * comment on the ink, cite it, recolor it or delete it.
	 */

	import { MessageSquare, Quote, Trash } from '@lucide/svelte';
	import type { InkColor, PageRect } from '#lib/pdf/annotation.js';
	import type { PageLayout } from '#lib/pdf/layout.js';
	import { INK_RGB } from './colors.js';

	/** What can be done with picked ink: a group's or a lasso's. */
	let {
		page,
		rect,
		pen,
		actions,
		width,
		layout
	}: {
		/** The page the ink is on, and its box on that page. */
		page: number;
		rect: PageRect;
		/** The pen the ink was drawn with, whose color the swatch shows. */
		pen: InkColor | undefined;
		actions: { comment(): unknown; cite(): unknown; recolor(): unknown; remove(): unknown };
		/** The width pages are drawn at, and where each sits, which put the menu under the box. */
		width: number;
		layout: PageLayout;
	} = $props();
</script>

<div
	class="ink-menu"
	style:left="{Math.max(0, rect[0] * width - 22)}px"
	style:top="{(layout.tops[page - 1] ?? 0) +
		(rect[1] + rect[3]) * (layout.heights[page - 1] ?? 0) +
		14}px"
>
	<button class="on" type="button" onclick={actions.comment}>
		<MessageSquare size={12} strokeWidth={1.75} />Comment
	</button>
	<button type="button" onclick={actions.cite}>
		<Quote size={12} strokeWidth={1.75} />Copy citation
	</button>
	<span class="sep"></span>
	<button class="square" type="button" title="Change the ink's color" onclick={actions.recolor}>
		<span class="dot" style:--ink={INK_RGB[pen ?? 'graphite']}></span>
	</button>
	<button class="square muted" type="button" title="Delete" onclick={actions.remove}>
		<Trash size={13} strokeWidth={1.75} />
	</button>
</div>

<style>
	/* the ink group's menu, under the group like the design's */
	.ink-menu {
		position: absolute;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 1px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 12px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.ink-menu button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.ink-menu button.on,
	.ink-menu button:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.ink-menu button.square {
		justify-content: center;
		width: 24px;
		padding: 0;
	}

	.ink-menu button.muted {
		color: var(--color-ui-muted);
	}

	.ink-menu .sep {
		width: 1px;
		height: 14px;
		margin: 0 3px;
		background: var(--color-border);
	}

	.ink-menu .dot {
		width: 11px;
		height: 11px;
		border-radius: 999px;
		background: rgb(var(--ink));
	}
</style>
