<script lang="ts">
	let {
		scroller,
		top = 34,
		axis = 'y'
	}: { scroller: HTMLElement | null | undefined; top?: number; axis?: 'x' | 'y' } = $props();

	// along the axis: `top` is the inset at the start, the thumb runs the rest of the way
	const vertical = $derived(axis === 'y');
	const viewOf = (el: HTMLElement) => (vertical ? el.clientHeight : el.clientWidth);
	const contentOf = (el: HTMLElement) => (vertical ? el.scrollHeight : el.scrollWidth);
	const posOf = (el: HTMLElement) => (vertical ? el.scrollTop : el.scrollLeft);

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
		const viewH = viewOf(el);
		const contentH = contentOf(el);
		const maxScroll = contentH - viewH;
		const trackH = viewH - top - THUMB_INSET_PX;
		if (maxScroll <= 0 || trackH <= 0) {
			show = false;
			return;
		}
		const natural = (viewH / contentH) * trackH;
		const capped = Math.min(natural, trackH * THUMB_MAX_FRACTION);
		thumbHeight = Math.max(capped, THUMB_MIN_PX);
		thumbTop = top + (posOf(el) / maxScroll) * (trackH - thumbHeight);
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
		const startY = vertical ? e.clientY : e.clientX;
		const startScroll = posOf(el);
		const viewH = viewOf(el);
		const maxScroll = contentOf(el) - viewH;
		const trackRange = viewH - top - THUMB_INSET_PX - thumbHeight;
		if (trackRange <= 0 || maxScroll <= 0) return;
		const ratio = maxScroll / trackRange;

		const onMove = (ev: PointerEvent) => {
			const next = startScroll + ((vertical ? ev.clientY : ev.clientX) - startY) * ratio;
			if (vertical) el.scrollTop = next;
			else el.scrollLeft = next;
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
		class:horizontal={!vertical}
		style={vertical
			? `height: ${thumbHeight}px; transform: translateY(${thumbTop}px);`
			: `width: ${thumbHeight}px; transform: translateX(${thumbTop}px);`}
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

	/* the same hairline laid along the bottom edge */
	.scroll-thumb.horizontal {
		top: auto;
		right: auto;
		left: 0;
		bottom: 0;
		width: auto;
		height: 14px;
	}

	.scroll-thumb.horizontal::before {
		top: auto;
		right: 0;
		left: 0;
		bottom: 4px;
		width: auto;
		height: 1px;
		transition:
			background-color 350ms ease,
			height 350ms ease;
	}

	.scroll-thumb.horizontal.scrolling::before,
	.scroll-thumb.horizontal:hover::before {
		width: auto;
		height: 4px;
	}
</style>
