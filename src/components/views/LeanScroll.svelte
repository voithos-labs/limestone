<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	let { children, flow = false }: { children: Snippet; flow?: boolean } = $props();

	let scroller: HTMLDivElement;
	let content: HTMLDivElement;
	let scrolling = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// Vertical thumb
	let thumbTop = $state(0);
	let thumbHeight = $state(0);
	let showThumb = $state(false);

	// Horizontal "tick lens"
	let showHBar = $state(false);
	let railWidth = $state(0);
	let draggingRail = false;
	const lensFrac = new Tween(0, { duration: 220, easing: cubicOut });

	const THUMB_MIN_PX = 24;
	const THUMB_INSET_PX = 8;

	// Tick field
	const TICK_GAP = 7; // px between ticks
	const TICK_BASE = 1; // resting tick thickness
	const TICK_PEAK = 3; // tick thickness inside the thumb
	const THUMB_MIN_W = 24; // px, floor for the thumb span
	const THUMB_MAX_W = 64; // px, cap for the thumb span
	const RAIL_PAD = 24; // left/right inset; matches the table's 24px side margin

	let viewFrac = $state(0);

	const ticks = $derived.by(() => {
		if (!showHBar || railWidth <= 0) return [];
		const span = Math.max(1, railWidth - 2 * RAIL_PAD);
		const n = Math.max(2, Math.floor(span / TICK_GAP));
		const step = span / n;
		const thumbW = Math.min(THUMB_MAX_W, Math.max(THUMB_MIN_W, span * viewFrac));
		const start = RAIL_PAD + lensFrac.current * (span - thumbW);
		const end = start + thumbW;
		const out: { x: number; w: number; o: number }[] = [];
		for (let i = 0; i <= n; i++) {
			const x = RAIL_PAD + i * step;
			const inside = x >= start && x <= end;
			out.push({
				x,
				w: inside ? TICK_PEAK : TICK_BASE,
				o: inside ? 0.85 : 0.3
			});
		}
		return out;
	});

	function updateThumb() {
		if (!scroller) return;

		// vertical
		const viewH = scroller.clientHeight;
		const contentH = scroller.scrollHeight;
		const maxScrollY = contentH - viewH;
		const trackH = viewH - 2 * THUMB_INSET_PX;
		if (maxScrollY <= 1 || trackH <= 0) {
			showThumb = false;
		} else {
			const natural = (viewH / contentH) * trackH;
			thumbHeight = Math.max(natural, THUMB_MIN_PX);
			thumbTop = THUMB_INSET_PX + (scroller.scrollTop / maxScrollY) * (trackH - thumbHeight);
			showThumb = true;
		}

		// Horizontal
		const viewW = scroller.clientWidth;
		const contentW = scroller.scrollWidth;
		const maxScrollX = contentW - viewW;
		if (maxScrollX <= 1 || viewW <= 0) {
			showHBar = false;
		} else {
			railWidth = viewW;
			viewFrac = viewW / contentW;
			const frac = scroller.scrollLeft / maxScrollX;
			if (draggingRail) lensFrac.set(frac, { duration: 0 });
			else lensFrac.target = frac;
			showHBar = true;
		}
	}

	function onScroll() {
		updateThumb();
		scrolling = true;
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (scrolling = false), 600);
	}

	function startThumbDrag(e: PointerEvent) {
		if (!scroller) return;
		e.preventDefault();
		const startY = e.clientY;
		const startScroll = scroller.scrollTop;
		const viewH = scroller.clientHeight;
		const maxScroll = scroller.scrollHeight - viewH;
		const trackRange = viewH - 2 * THUMB_INSET_PX - thumbHeight;
		if (trackRange <= 0 || maxScroll <= 0) return;
		const ratio = maxScroll / trackRange;

		function move(ev: PointerEvent) {
			scroller.scrollTop = startScroll + (ev.clientY - startY) * ratio;
		}
		function up() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function startRailDrag(e: PointerEvent) {
		if (!scroller) return;
		e.preventDefault();
		const rail = e.currentTarget as HTMLElement;
		const maxScroll = scroller.scrollWidth - scroller.clientWidth;
		if (maxScroll <= 0) return;
		draggingRail = true;

		function apply(clientX: number) {
			const rect = rail.getBoundingClientRect();
			const span = Math.max(1, rect.width - 2 * RAIL_PAD);
			const frac = Math.max(0, Math.min(1, (clientX - rect.left - RAIL_PAD) / span));
			scroller.scrollLeft = frac * maxScroll;
		}
		apply(e.clientX);

		function move(ev: PointerEvent) {
			apply(ev.clientX);
		}
		function up() {
			draggingRail = false;
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	$effect(() => {
		updateThumb();
		const ro = new ResizeObserver(() => updateThumb());
		if (scroller) ro.observe(scroller);
		if (content) ro.observe(content);
		return () => ro.disconnect();
	});
</script>

<div class="cs-wrapper" class:scrolling class:has-hbar={showHBar} class:flow>
	<div class="cs-scroller" bind:this={scroller} onscroll={onScroll}>
		<div class="cs-content" bind:this={content}>
			{@render children()}
		</div>
	</div>
	{#if showThumb}
		<div
			class="scroll-thumb"
			style="height: {thumbHeight}px; transform: translateY({thumbTop}px);"
			onpointerdown={startThumbDrag}
		></div>
	{/if}
	{#if showHBar}
		<div class="hbar-rail" onpointerdown={startRailDrag}>
			<div class="hbar-ticks">
				{#each ticks as t (t.x)}
					<span class="tick" style="left: {t.x}px; width: {t.w}px; opacity: {t.o};"></span>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.cs-wrapper {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.cs-wrapper.flow {
		flex: none;
		min-height: 0;
		display: block;
	}

	.cs-scroller {
		flex: 1;
		min-height: 0;
		overflow: auto;
		scrollbar-width: none;
	}

	.cs-wrapper.flow .cs-scroller {
		flex: none;
		min-height: 0;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.cs-wrapper.flow .hbar-rail {
		position: sticky;
		margin-top: calc(-1 * var(--hbar-h, 16px));
	}

	.cs-scroller::-webkit-scrollbar {
		display: none;
	}

	.cs-content {
		display: block;
		width: 100%;
	}

	.cs-wrapper.has-hbar .cs-content {
		padding-bottom: var(--hbar-h, 16px);
	}

	.scroll-thumb {
		position: absolute;
		right: 0;
		top: 0;
		width: 14px;
		background: transparent;
		cursor: pointer;
		z-index: 6;
	}

	.scroll-thumb::before {
		content: '';
		position: absolute;
		right: 4px;
		top: 0;
		bottom: 0;
		width: 1px;
		border-radius: 4px;
		background: var(--color-border);
		transition:
			background-color 350ms ease,
			width 350ms ease;
	}

	.cs-wrapper.scrolling .scroll-thumb::before,
	.scroll-thumb:hover::before {
		width: 4px;
		background: var(--color-ui-muted);
	}

	.hbar-rail {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: var(--hbar-h, 16px);
		background: transparent;
		cursor: pointer;
		z-index: 6;
	}

	.hbar-ticks {
		position: absolute;
		left: 0;
		right: 0;
		top: 3px;
		bottom: 3px;
	}

	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 1px;
		background: var(--hbar-tick, var(--color-ui-muted));
		transform: translateX(-50%);
	}
</style>
