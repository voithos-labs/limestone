<script lang="ts">
    import {untrack} from "svelte";

    let {open = $bindable(false), anchor, value, onCommit, onCancel}: {
        open: boolean;
        anchor: HTMLElement | null;
        value: string;
        onCommit: (value: string) => void;
        onCancel?: () => void;
    } = $props();

    const MAX_WIDTH = 460;
    const LINE_HEIGHT = 1.35;

    let boxEl: HTMLDivElement | null = $state(null);
    let taEl: HTMLTextAreaElement | null = $state(null);
    let mirrorEl: HTMLSpanElement | null = $state(null);
    let draft = $state('');
    let top = $state(0);
    let left = $state(0);
    let cellW = $state(0);
    let cellH = $state(0);
    let expanded = $state(false);

    function syncFromCell() {
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        top = r.top;
        left = r.left;
        cellW = r.width;
        cellH = r.height;
        const cs = getComputedStyle(anchor);
        const fs = parseFloat(cs.fontSize) || 13;
        const lh = `${fs * LINE_HEIGHT}px`;
        for (const el of [taEl, mirrorEl]) {
            if (!el) continue;
            el.style.fontFamily = cs.fontFamily;
            el.style.fontSize = cs.fontSize;
            el.style.fontWeight = cs.fontWeight;
            el.style.letterSpacing = cs.letterSpacing;
            el.style.lineHeight = lh;
            el.style.paddingLeft = cs.paddingLeft;
            el.style.paddingRight = cs.paddingRight;
        }
        autosize();
    }

    function autosize() {
        if (!taEl || !boxEl) return;
        let w = cellW;
        if (mirrorEl) {
            mirrorEl.textContent = taEl.value.length ? taEl.value : ' ';
            w = Math.min(MAX_WIDTH, Math.max(cellW, mirrorEl.scrollWidth + 2));
        }
        boxEl.style.width = `${w}px`;
        boxEl.style.minHeight = `${cellH}px`;
        taEl.style.height = 'auto';
        taEl.style.height = `${taEl.scrollHeight}px`;
        const boxH = boxEl.getBoundingClientRect().height;
        expanded = w > cellW + 0.5 || boxH > cellH + 0.5;
    }

    function commit() {
        if (!open) return;
        open = false;
        onCommit(draft);
    }

    function cancel() {
        if (!open) return;
        open = false;
        onCancel?.();
    }

    function onKey(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    }

    let wasOpen = false;
    $effect(() => {
        if (open && !wasOpen) {
            wasOpen = true;
            untrack(() => { draft = value ?? ''; });
            queueMicrotask(() => {
                syncFromCell();
                taEl?.focus();
                taEl?.select();
            });
            const onScroll = () => syncFromCell();
            window.addEventListener('resize', onScroll);
            window.addEventListener('scroll', onScroll, true);
            return () => {
                window.removeEventListener('resize', onScroll);
                window.removeEventListener('scroll', onScroll, true);
            };
        }
        if (!open) wasOpen = false;
    });
</script>

{#if open}
    <div
            class="cte"
            class:expanded
            bind:this={boxEl}
            style:top="{top}px"
            style:left="{left}px"
            style:width="{cellW}px"
    >
        <textarea
                bind:this={taEl}
                bind:value={draft}
                rows="1"
                spellcheck="false"
                oninput={autosize}
                onkeydown={onKey}
                onblur={commit}
        ></textarea>
        <span class="mirror" bind:this={mirrorEl} aria-hidden="true"></span>
    </div>
{/if}

<style>
    .cte {
        position: fixed;
        z-index: 50;
        display: flex;
        align-items: center;
        background: var(--color-surface);
        border-radius: 6px;
    }

    .cte.expanded {
        box-shadow: var(--menu-shadow);
    }

    textarea {
        display: block;
        box-sizing: border-box;
        width: 100%;
        margin: 0;
        padding-top: 0;
        padding-bottom: 0;
        border: none;
        outline: none;
        background: transparent;
        resize: none;
        overflow: hidden;
        color: var(--color-text-primary);
        font-size: 13px;
        line-height: 1.35;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .mirror {
        position: absolute;
        top: 0;
        left: 0;
        visibility: hidden;
        white-space: pre;
        font-size: 13px;
        line-height: 1.35;
        pointer-events: none;
    }
</style>
