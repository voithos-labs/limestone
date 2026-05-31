<script lang="ts">
    import type {Snippet} from "svelte";

    let {children}: { children: Snippet } = $props();

    let scroller: HTMLDivElement;
    let content: HTMLDivElement;
    let scrolling = $state(false);
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let thumbTop = $state(0);
    let thumbHeight = $state(0);
    let showThumb = $state(false);

    const THUMB_MIN_PX = 24;
    const THUMB_INSET_PX = 8;

    function updateThumb() {
        if (!scroller) return;
        const viewH = scroller.clientHeight;
        const contentH = scroller.scrollHeight;
        const maxScroll = contentH - viewH;
        const trackH = viewH - 2 * THUMB_INSET_PX;
        if (maxScroll <= 1 || trackH <= 0) {
            showThumb = false;
            return;
        }
        const natural = (viewH / contentH) * trackH;
        thumbHeight = Math.max(natural, THUMB_MIN_PX);
        thumbTop = THUMB_INSET_PX + (scroller.scrollTop / maxScroll) * (trackH - thumbHeight);
        showThumb = true;
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

    $effect(() => {
        updateThumb();
        const ro = new ResizeObserver(() => updateThumb());
        if (scroller) ro.observe(scroller);
        if (content) ro.observe(content);
        return () => ro.disconnect();
    });
</script>

<div class="cs-wrapper" class:scrolling>
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
</div>

<style>
    .cs-wrapper {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
    }

    .cs-scroller {
        flex: 1;
        min-height: 0;
        overflow: auto;
        scrollbar-width: none;
    }

    .cs-scroller::-webkit-scrollbar {
        display: none;
    }

    .cs-content {
        display: block;
        width: 100%;
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
        transition: background-color 350ms ease, width 350ms ease;
    }

    .cs-wrapper.scrolling .scroll-thumb::before,
    .scroll-thumb:hover::before {
        width: 4px;
        background: var(--color-ui-muted);
    }
</style>
