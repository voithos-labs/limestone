<script lang="ts" module>
	/**
	 * the ink options above the dock: the stroke (pen or highlighter), its size, the eraser and the lasso.
	 *
	 * E and L switch to the eraser or the lasso. Pressing the same key again, or picking a color,
	 * goes back to the pen.
	 */

	export type InkMode = 'pen' | 'eraser' | 'lasso';
	export type InkTool = 'pen' | 'highlighter';

	export const INK_SIZE_UNIT = 0.001;
	export const INK_SIZE_RANGE: Record<InkTool, [min: number, max: number]> = {
		pen: [1, 12],
		highlighter: [8, 40]
	};

	export function inkSize(tool: InkTool, size: number): number {
		const [min, max] = INK_SIZE_RANGE[tool];
		return Math.min(max, Math.max(min, Math.round(size)));
	}

	const MODE_KEYS: Record<string, InkMode | undefined> = { E: 'eraser', L: 'lasso' };

	/** The mode a key switches to, as the tray's titles show; pressing it again goes back to the pen. */
	export function modeForKey(mode: InkMode, key: string): InkMode | null {
		const hit = MODE_KEYS[key.toUpperCase()];
		if (!hit) return null;
		return mode === hit ? 'pen' : hit;
	}
</script>

<script lang="ts">
	import { ChevronUp, Eraser, Highlighter, Lasso, Pen } from '@lucide/svelte';
	import type { AnnotationColor } from '#lib/pdf/annotation.js';
	import { ANNOTATION_RGB } from './colors.js';

	let {
		tool = $bindable('pen'),
		sizes = $bindable({ pen: 3, highlighter: 16 }),
		mode = $bindable('pen'),
		color
	}: {
		tool?: InkTool;
		sizes?: Record<InkTool, number>;
		mode?: InkMode;
		color: AnnotationColor;
	} = $props();

	const TOOLS = [
		{ id: 'pen', label: 'Pen', icon: Pen },
		{ id: 'highlighter', label: 'Highlighter', icon: Highlighter }
	] as const;
	const current = $derived(TOOLS.find((t) => t.id === tool) ?? TOOLS[0]);

	let open = $state(false);

	function onWindowPointer(e: PointerEvent) {
		if (open && !(e.target as Element).closest?.('.tool-slot')) open = false;
	}

	const [min, max] = $derived(INK_SIZE_RANGE[tool]);
	const THUMB_INSET = 7;
	let sliding = false;

	function slideTo(e: PointerEvent & { currentTarget: HTMLElement }) {
		const box = e.currentTarget.getBoundingClientRect();
		const t = (e.clientX - box.left - THUMB_INSET) / (box.width - THUMB_INSET * 2);
		sizes[tool] = inkSize(tool, min + Math.min(1, Math.max(0, t)) * (max - min));
	}
</script>

<svelte:window onpointerdowncapture={onWindowPointer} />

<div class="tray" style:--ink={ANNOTATION_RGB[color]}>
	<span
		class="slider"
		role="slider"
		tabindex="0"
		aria-label="Stroke size"
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={sizes[tool]}
		style:--t={(inkSize(tool, sizes[tool]) - min) / (max - min)}
		onpointerdown={(e) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			sliding = true;
			slideTo(e);
		}}
		onpointermove={(e) => sliding && slideTo(e)}
		onpointerup={() => (sliding = false)}
		onpointercancel={() => (sliding = false)}
		onkeydown={(e) => {
			const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
			if (step) sizes[tool] = inkSize(tool, sizes[tool] + step);
		}}
	>
		<span class="track"></span>
		<span class="thumb"></span>
	</span>
	<span class="px">{sizes[tool]}px</span>
	<span class="tool-slot">
		{#if open}
			<div class="pop">
				{#each TOOLS as t (t.id)}
					<button
						class="row"
						class:sel={t.id === tool}
						type="button"
						onclick={() => {
							open = false;
							tool = t.id;
							mode = 'pen';
						}}
					>
						<t.icon size={14} strokeWidth={1.75} />{t.label}
					</button>
				{/each}
			</div>
		{/if}
		<button
			class="opt tool"
			class:sel={mode === 'pen'}
			type="button"
			title={current.label}
			onclick={() => {
				if (mode !== 'pen') mode = 'pen';
				else open = !open;
			}}
		>
			<current.icon size={14} strokeWidth={1.75} /><ChevronUp size={11} strokeWidth={2} />
		</button>
	</span>
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
	/* ------------------------ The tray and its buttons ------------------------ */

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

	.opt.sel {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.opt:hover {
		background: var(--chip-bg-hover);
	}

	.opt.tool {
		gap: 2px;
		width: auto;
		padding: 0 5px 0 7px;
	}

	.tool-slot {
		position: relative;
		display: flex;
	}

	.pop {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 12px 5px 8px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12.5px;
		white-space: nowrap;
		cursor: pointer;
	}

	.row:hover,
	.row.sel {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.slider {
		position: relative;
		flex-shrink: 0;
		width: 140px;
		height: 26px;
		margin-left: 6px;
		outline: none;
		cursor: pointer;
		touch-action: none;
	}

	.track {
		position: absolute;
		top: 50%;
		left: 7px;
		right: 7px;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			rgb(var(--ink)) calc(var(--t) * 100%),
			rgb(var(--ink) / 0.25) calc(var(--t) * 100%)
		);
		translate: 0 -50%;
	}

	.thumb {
		position: absolute;
		top: 50%;
		left: calc(7px + (100% - 14px) * var(--t));
		width: 14px;
		height: 14px;
		border-radius: 999px;
		background: rgb(var(--ink));
		translate: -50% -50%;
	}

	.px {
		min-width: 30px;
		margin-right: 4px;
		font-family: var(--font-ui);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: var(--color-text-secondary);
	}

	.sep {
		width: 1px;
		height: 16px;
		margin: 0 3px;
		background: var(--color-border);
	}
</style>
