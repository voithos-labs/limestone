<script lang="ts">
    import {onMount, onDestroy} from 'svelte';
    import {v4 as uuidv4} from 'uuid';
    import View from '$lib/models/View.svelte';
    import type {ViewFace, FilterLeaf} from '$lib/models/View.svelte';
    import type EditorState from '$lib/models/EditorState.svelte.js';
    import type {TabState} from '$lib/models/EditorState.svelte.js';
    import {listSources} from '$lib/models/Source';
    import DocHandle from '$lib/models/DocHandle';
    import ViewHeader from '../views/ViewHeader.svelte';
    import TableFace from '../views/faces/TableFace.svelte';
    import JournalFace from '../views/faces/JournalFace.svelte';
    import {convertFileSrc} from '@tauri-apps/api/core';
    import Menu from '../views/Menu.svelte';
    import CoverSourceDialog from '../CoverSourceDialog.svelte';
    import type {MenuEntry} from '$lib/views/menuTypes';
    import {Crop, X, Check, EllipsisVertical, Trash2, ImageUp, Plus, Copy} from '@lucide/svelte';

    let {view, tab, editor}: { view: View; tab?: TabState; editor: EditorState } = $props();

    const activeFace: ViewFace = $derived(
        view.faces.find((f) => f.id === view.state.active_face_id) ?? view.faces[0]
    );

    const bodyFlow = true;
    let bodyEl: HTMLDivElement | null = $state(null);

    let faceInit = false;
    $effect(() => {
        const id = activeFace?.id;
        if (!id || !bodyEl) return;
        if (!faceInit) {
            faceInit = true;
            return;
        }
        bodyEl.scrollTop = 0;
        if (tab) tab.state.scrollTop = 0;
    });

    function bodyScroll() {
        if (tab && bodyEl) tab.state.scrollTop = bodyEl.scrollTop;
    }

    let didRestoreScroll = false;
    $effect(() => {
        if (!bodyEl || didRestoreScroll) return;
        didRestoreScroll = true;
        const el = bodyEl;
        const st = tab?.state.scrollTop;
        if (typeof st === 'number' && st > 0) {
            requestAnimationFrame(() => {
                el.scrollTop = st;
            });
        }
    });

    const FB_SNAP_TOP = 20;
    const FB_SNAP_ZONE = 40;
    let fbSnapTimer: ReturnType<typeof setTimeout> | null = null;

    function snapFilterBar() {
        if (!bodyFlow || !view.cover || !bodyEl) return;
        const fb = bodyEl.querySelector('.filter-bar') as HTMLElement | null;
        if (!fb) return;
        const delta = fb.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - FB_SNAP_TOP;
        if (delta === 0 || Math.abs(delta) > FB_SNAP_ZONE) return;
        bodyEl.scrollTo({top: bodyEl.scrollTop + delta, behavior: 'smooth'});
    }

    function queueFilterBarSnap() {
        if (fbSnapTimer) clearTimeout(fbSnapTimer);
        fbSnapTimer = setTimeout(snapFilterBar, 150);
    }

    // Bumped by the header's "+ New" button; the active face watches it and begins
    // a create in whatever way fits its layout (table = floating draft row at top).
    let createSignal = $state(0);

    function parseCover(cover: string) {
        const [ref, q] = cover.split('?');
        const p = new URLSearchParams(q ?? '');
        const num = (k: string, d: number) => {
            const v = parseFloat(p.get(k) ?? '');
            return Number.isFinite(v) ? v : d;
        };
        return {
            ref,
            x: Math.min(100, Math.max(0, num('x', 50))),
            y: Math.min(100, Math.max(0, num('y', 50))),
            z: Math.max(1, num('z', 1))
        };
    }

    function buildCover(ref: string, x: number, y: number, z: number) {
        const parts: string[] = [];
        if (Math.round(x) !== 50) parts.push(`x=${Math.round(x)}`);
        if (Math.round(y) !== 50) parts.push(`y=${Math.round(y)}`);
        if (z !== 1) parts.push(`z=${z.toFixed(2)}`);
        return parts.length ? `${ref}?${parts.join('&')}` : ref;
    }

    let cropping = $state(false);
    let cropX = $state(50);
    let cropY = $state(50);
    let cropZoom = $state(1);
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const geo = $derived.by(() => {
        if (cropping) return {x: cropX, y: cropY, z: cropZoom};
        if (view.cover) {
            const g = parseCover(view.cover);
            return {x: g.x, y: g.y, z: g.z};
        }
        return {x: 50, y: 50, z: 1};
    });

    let coverUrl = $state('');
    let coverReady = $state(false);
    $effect(() => {
        const cover = view.cover;
        if (!cover) {
            coverUrl = '';
            coverReady = false;
            return;
        }
        const {ref} = parseCover(cover);
        let cancelled = false;
        (async () => {
            const url = convertFileSrc(ref, 'appasset');
            const img = new Image();
            img.src = url;
            try {
                await img.decode();
            } catch {
            }
            if (cancelled) return;
            coverUrl = url;
            coverReady = true;
        })();
        return () => {
            cancelled = true;
        };
    });

    let lastSig = '';
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        const sig = JSON.stringify(view.toJSON(), (k, v) =>
            k === 'active_cell' || k === 'search' || k === 'temporary' ? undefined : v
        );
        if (lastSig === '') {
            lastSig = sig;
            return;
        }
        if (sig === lastSig || view.temporary) return;
        lastSig = sig;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            view.save().catch((e) => console.error('save view failed', e));
        }, 400);
    });

    onDestroy(() => {
        if (fbSnapTimer) clearTimeout(fbSnapTimer);
        if (saveTimer && !view.temporary) view.save().catch(() => {
        });
    });

    let sourceRemoved = $state(false);

    onMount(async () => {
        const sourceField = view.fields.find((f) => f.type === 'source');
        if (!sourceField) return;
        const leaf = view.filter.children.find(
            (n): n is FilterLeaf => 'field_id' in n && n.field_id === sourceField.id && n.op === 'eq'
        );
        const sid = leaf && typeof leaf.value === 'string' ? leaf.value : undefined;
        if (!sid) return;
        const sources = await listSources();
        sourceRemoved = !sources.some((s) => s.id === sid);
    });

    let coverDialogOpen = $state(false);

    function pickCover() {
        coverDialogOpen = true;
    }

    function removeCover() {
        view.cover = '';
        cropping = false;
    }

    function startCrop() {
        const g = parseCover(view.cover);
        cropX = g.x;
        cropY = g.y;
        cropZoom = g.z;
        cropping = true;
    }

    function confirmCrop() {
        const {ref} = parseCover(view.cover);
        view.cover = buildCover(ref, cropX, cropY, cropZoom);
        cropping = false;
    }

    function cropPointerDown(e: PointerEvent) {
        if (!cropping) return;
        if ((e.target as HTMLElement).closest('.cover-actions')) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function cropPointerMove(e: PointerEvent) {
        if (!cropping || !dragging) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        cropX = Math.min(100, Math.max(0, cropX - ((e.clientX - lastX) / rect.width) * 100));
        cropY = Math.min(100, Math.max(0, cropY - ((e.clientY - lastY) / rect.height) * 100));
        lastX = e.clientX;
        lastY = e.clientY;
    }

    function cropPointerUp() {
        dragging = false;
    }

    function cropWheel(e: WheelEvent) {
        if (!cropping) return;
        e.preventDefault();
        cropZoom = Math.min(4, Math.max(1, cropZoom - e.deltaY * 0.002));
    }

    let moreOpen = $state(false);
    let moreAnchor: HTMLElement | null = $state(null);
    let confirmingDelete = $state(false);

    $effect(() => {
        if (!moreOpen) confirmingDelete = false;
    });

    const moreItems = $derived.by(() => {
        const items: MenuEntry[] = [];
        if (!view.cover) items.push({value: 'add-cover', label: 'Add cover', icon: ImageUp});
        items.push({value: 'duplicate', label: 'Duplicate', icon: Copy});
        items.push(
            confirmingDelete
                ? {value: 'confirm-delete', label: 'Confirm delete', icon: Trash2, danger: true}
                : {value: 'delete', label: 'Delete', icon: Trash2, keepOpen: true}
        );
        return items;
    });

    function openMore(e: MouseEvent) {
        moreAnchor = e.currentTarget as HTMLElement;
        moreOpen = true;
    }

    async function duplicateView() {
        try {
            const json = JSON.parse(JSON.stringify(view.toJSON()));
            json.id = uuidv4();
            json.slug = `${view.slug} copy`;
            json.created_at = new Date();
            json.updated_at = new Date();
            json.temporary = false;
            const copy = new View(json);
            await copy.save();
            editor.openView(copy);
        } catch (e) {
            console.error('duplicate view failed', e);
        }
    }

    async function deleteView() {
        try {
            await view.unsave();
            editor.closeTab(view.id);
        } catch (e) {
            console.error('delete view failed', e);
        }
    }

    function onMoreSelect(value: string) {
        if (value === 'delete') {
            confirmingDelete = true;
            return;
        }
        moreOpen = false;
        if (value === 'add-cover') pickCover();
        if (value === 'duplicate') duplicateView();
        if (value === 'confirm-delete') deleteView();
    }

    function onOpenRow(rowId: string) {
        DocHandle.fromID(rowId)
            .then((d) => editor.openDoc(d))
            .catch(console.error);
    }
</script>

<div class="view-page">
    {#if sourceRemoved}
        <div class="source-removed">
            <p class="source-removed-msg">Source <strong>{view.slug}</strong> was removed.</p>
            <button class="source-removed-close" type="button" onclick={() => editor.closeTab(view.id)}>
                Close tab
            </button>
        </div>
    {:else}
        <div
                class="view-body"
                class:flow={bodyFlow}
                bind:this={bodyEl}
                onwheel={queueFilterBarSnap}
                onscroll={bodyScroll}
        >
            {#if view.cover}
                <div
                        class="view-cover"
                        class:cropping
                        role="presentation"
                        onpointerdown={cropPointerDown}
                        onpointermove={cropPointerMove}
                        onpointerup={cropPointerUp}
                        onpointerleave={cropPointerUp}
                        onwheel={cropWheel}
                >
                    <div
                            class="cover-img"
                            class:ready={coverReady}
                            style:background-image={coverReady ? `url('${coverUrl}')` : undefined}
                            style:background-position="{geo.x}% {geo.y}%"
                            style:background-size="{geo.z * 100}%"
                    ></div>
                    {#if cropping}
                        <div class="crop-frame">
                            <span class="cc tl"></span>
                            <span class="cc tr"></span>
                            <span class="cc bl"></span>
                            <span class="cc br"></span>
                        </div>
                    {:else}
                        <div class="cover-actions top">
                            <button class="cover-btn" type="button" title="More" onclick={openMore}>
                                <EllipsisVertical size={14}/>
                            </button>
                        </div>
                    {/if}
                    <div class="cover-actions">
                        {#if cropping}
                            <button class="cover-btn" type="button" title="Confirm" onclick={confirmCrop}>
                                <Check size={14}/>
                            </button>
                        {:else}
                            <button class="cover-btn" type="button" title="Crop" onclick={startCrop}>
                                <Crop size={14}/>
                            </button>
                            <button class="cover-btn" type="button" title="Replace" onclick={pickCover}>
                                <ImageUp size={14}/>
                            </button>
                            <button class="cover-btn" type="button" title="Remove" onclick={removeCover}>
                                <X size={14}/>
                            </button>
                        {/if}
                    </div>
                </div>
            {/if}

            <div class="view-chrome" class:has-cover={!!view.cover}>
                <ViewHeader
                        {view}
                        hasCover={!!view.cover}
                        onMore={(anchor) => {
						moreAnchor = anchor;
						moreOpen = true;
					}}
                />
            </div>

            {#if activeFace?.type === 'journal'}
                <JournalFace {view} face={activeFace} flow={true}/>
            {:else}
                <TableFace {view} face={activeFace} {onOpenRow} {createSignal} flow={bodyFlow}/>
            {/if}
        </div>

        {#if activeFace?.type !== 'journal'}
            <button class="new-fab" type="button" title="New note" onclick={() => createSignal++}>
                <Plus size={18} strokeWidth={2}/>
            </button>
        {/if}
    {/if}
</div>

<Menu
        bind:open={moreOpen}
        anchor={moreAnchor}
        items={moreItems}
        onSelect={onMoreSelect}
        minWidth={170}
/>
<CoverSourceDialog
        bind:open={coverDialogOpen}
        onPicked={(ref) => {
		view.cover = ref;
	}}
/>

<style>
    .view-page {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        max-width: var(--page-max-width, none);
        margin-left: auto;
        margin-right: auto;
        overflow: hidden;
    }


    .source-removed {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        height: 100%;
        font-family: var(--font-ui);
        color: var(--color-ui-muted);
    }

    .source-removed-msg {
        margin: 0;
        font-size: 14px;
    }

    .source-removed-msg strong {
        color: var(--color-text-primary);
        font-weight: 600;
    }

    .source-removed-close {
        padding: 6px 14px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 13px;
        cursor: pointer;
    }

    .source-removed-close:hover {
        background: var(--menu-item-hover);
    }

    .view-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        margin: 2px;
        border-radius: 6px;
    }

    .view-body:not(.flow) {
        overflow: hidden;
    }

    .view-body.flow {
        display: block;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .view-body.flow::-webkit-scrollbar {
        display: none;
    }

    .new-fab {
        position: absolute;
        bottom: 24px;
        right: 24px;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border: none;
        border-radius: 10px;
        background: var(--color-accent);
        color: var(--color-accent-contrast);
        cursor: pointer;
        box-shadow: var(--menu-shadow);
    }

    .new-fab:hover {
        filter: brightness(1.08);
    }

    .view-chrome {
        flex-shrink: 0;
        padding: 20px 0 0 24px;
    }

    .view-chrome.has-cover {
        padding-top: 0;
    }


    .view-cover {
        position: relative;
        flex-shrink: 0;
        box-sizing: border-box;
        height: 180px;
        margin: 16px 16px 0;
        border-radius: 10px 10px 0 0;
        overflow: hidden;
        background: var(--chip-bg);
    }

    .cover-img {
        position: absolute;
        inset: 0;
        background-repeat: no-repeat;
        opacity: 0;
        transition: opacity 50ms ease;
        pointer-events: none;
    }

    .cover-img.ready {
        opacity: 1;
    }

    .view-cover.cropping {
        cursor: grab;
    }

    .view-cover.cropping:active {
        cursor: grabbing;
    }

    .crop-frame {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .cc {
        position: absolute;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.9);
    }

    .cc.tl {
        top: 10px;
        left: 10px;
        border-right: none;
        border-bottom: none;
    }

    .cc.tr {
        top: 10px;
        right: 10px;
        border-left: none;
        border-bottom: none;
    }

    .cc.bl {
        bottom: 10px;
        left: 10px;
        border-right: none;
        border-top: none;
    }

    .cc.br {
        bottom: 10px;
        right: 10px;
        border-left: none;
        border-top: none;
    }

    .cover-actions {
        position: absolute;
        bottom: 10px;
        right: 14px;
        display: flex;
        gap: 6px;
        opacity: 0;
        transition: opacity 120ms ease;
    }

    .cover-actions.top {
        top: 10px;
        bottom: auto;
        opacity: 1;
    }

    .cover-actions.top .cover-btn {
        width: 26px;
        height: 26px;
        background: transparent;
        box-shadow: none;
        color: #fff;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }

    .view-cover:hover .cover-actions,
    .view-cover.cropping .cover-actions {
        opacity: 1;
    }

    .cover-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        border-radius: 6px;
        background: var(--color-bg);
        color: var(--color-text-secondary);
        cursor: pointer;
        box-shadow: var(--menu-shadow);
    }

    .cover-btn:hover {
        color: var(--color-text-primary);
    }
</style>
