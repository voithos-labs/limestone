<script lang="ts">
	let { scroller, top = 34 }: { scroller: HTMLElement | null | undefined; top?: number } = $props();

	const THUMB_MAX_FRACTION = 1 / 5;
	const THUMB_MIN_PX = 24;
	const THUMB_INSET_PX = 8;

	let thumbTop = $state(0);
	let thumbHeight = $state(0);
	let show = $state(false);
	let scrolling = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function update() {
		const el = scroller;
		if (!el) return;
		const viewH = el.clientHeight;
		const contentH = el.scrollHeight;
		const maxScroll = contentH - viewH;
		const trackH = viewH - top - THUMB_INSET_PX;
		if (maxScroll <= 0 || trackH <= 0) {
			show = false;
			return;
		}
		const natural = (viewH / contentH) * trackH;
		const capped = Math.min(natural, trackH * THUMB_MAX_FRACTION);
		thumbHeight = Math.max(capped, THUMB_MIN_PX);
		thumbTop = top + (el.scrollTop / maxScroll) * (trackH - thumbHeight);
		show = true;
	}

	$effect(() => {
		const el = scroller;
		if (!el) return;

		function onScroll() {
			scrolling = true;
			if (hideTimer) clearTimeout(hideTimer);
			hideTimer = setTimeout(() => (scrolling = false), 500);
			update();
		}

		el.addEventListener('scroll', onScroll);
		const ro = new ResizeObserver(() => update());
		ro.observe(el);
		for (const child of el.children) ro.observe(child);
		update();

		return () => {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
			if (hideTimer) clearTimeout(hideTimer);
		};
	});

	function startDrag(e: PointerEvent) {
		const el = scroller;
		if (!el) return;
		e.preventDefault();
		const startY = e.clientY;
		const startScroll = el.scrollTop;
		const viewH = el.clientHeight;
		const maxScroll = el.scrollHeight - viewH;
		const trackRange = viewH - top - THUMB_INSET_PX - thumbHeight;
		if (trackRange <= 0 || maxScroll <= 0) return;
		const ratio = maxScroll / trackRange;

		const onMove = (ev: PointerEvent) => {
			el.scrollTop = startScroll + (ev.clientY - startY) * ratio;
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

{#if show}
	<div
		class="scroll-thumb"
		class:scrolling
		style="height: {thumbHeight}px; transform: translateY({thumbTop}px);"
		onpointerdown={startDrag}
	></div>
{/if}

<style>
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

	.scroll-thumb.scrolling::before,
	.scroll-thumb:hover::before {
		width: 4px;
		background: var(--color-ui-muted);
	}
</style>
