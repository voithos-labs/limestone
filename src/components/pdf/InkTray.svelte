<script lang="ts" module>
	export type InkMode = 'pen' | 'eraser' | 'lasso';
</script>

<script lang="ts">
	import { Eraser, Lasso } from '@lucide/svelte';
	import { INK_COLORS, INK_WIDTHS, type InkColor, type InkWidth } from '#lib/pdf/annotation.js';
	import { INK_RGB } from './colors.js';

	let {
		color = $bindable('graphite'),
		width = $bindable('fine'),
		mode = $bindable('pen')
	}: { color?: InkColor; width?: InkWidth; mode?: InkMode } = $props();

	const COLOR_NAMES: Record<InkColor, string> = {
		graphite: 'Graphite',
		pink: 'Pink',
		blue: 'Blue',
		green: 'Green'
	};
	const WIDTH_NAMES: Record<InkWidth, string> = {
		fine: 'Fine',
		medium: 'Medium',
		marker: 'Marker'
	};

	function onWindowKey(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
		const key = e.key.toUpperCase();
		if (key === 'E') mode = mode === 'eraser' ? 'pen' : 'eraser';
		else if (key === 'L') mode = mode === 'lasso' ? 'pen' : 'lasso';
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="tray">
	{#each INK_COLORS as c (c)}
		<button
			class="opt"
			class:on={c === color}
			type="button"
			title={COLOR_NAMES[c]}
			onclick={() => {
				color = c;
				mode = 'pen';
			}}
		>
			<span class="dot" class:current={c === color} style:--ink={INK_RGB[c]}></span>
		</button>
	{/each}
	<span class="sep"></span>
	{#each INK_WIDTHS as w (w)}
		<button
			class="opt"
			class:sel={w === width}
			type="button"
			title={WIDTH_NAMES[w]}
			onclick={() => {
				width = w;
				mode = 'pen';
			}}
		>
			<span class="line {w}" class:current={w === width}></span>
		</button>
	{/each}
	<span class="sep"></span>
	<button
		class="opt icon"
		class:sel={mode === 'eraser'}
		type="button"
		title="Eraser (E)"
		onclick={() => (mode = mode === 'eraser' ? 'pen' : 'eraser')}
	>
		<Eraser size={14} strokeWidth={1.75} />
	</button>
	<button
		class="opt icon"
		class:sel={mode === 'lasso'}
		type="button"
		title="Lasso (L)"
		onclick={() => (mode = mode === 'lasso' ? 'pen' : 'lasso')}
	>
		<Lasso size={14} strokeWidth={1.75} />
	</button>
</div>

<style>
	.tray {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.opt {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 26px;
		padding: 0;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.opt.on {
		background: var(--chip-bg);
	}

	.opt.sel {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.opt:hover {
		background: var(--chip-bg-hover);
	}

	.dot {
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: rgb(var(--ink));
	}

	.dot.current {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 3.5px var(--color-ui-muted);
	}

	.line {
		width: 16px;
		border-radius: 2px;
		background: var(--color-ui-muted);
	}

	.line.current {
		background: var(--color-text-primary);
	}

	.line.fine {
		height: 1.5px;
	}

	.line.medium {
		height: 3px;
	}

	.line.marker {
		height: 6px;
		border-radius: 3px;
		opacity: 0.6;
	}

	.sep {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--color-border);
	}
</style>
