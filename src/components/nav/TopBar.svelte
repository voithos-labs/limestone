<script lang="ts">
    import type EditorState from "$lib/state/EditorState.svelte";
    import type {Tab} from "$lib/state/EditorState.svelte";
    import {getCurrentWindow} from "@tauri-apps/api/window";

    import {Settings, Search, Bookmark, ChevronDown, Eye, X, GripVertical} from "@lucide/svelte";

    let {editor}: { editor: EditorState } = $props();

    const settingsTab: Tab = {kind: 'settings'};
    const searchTab: Tab = {kind: 'search'};

    const appWindow = getCurrentWindow();
    let isMaximized = $state(false);

    // Check initial maximized state
    appWindow.isMaximized().then(v => isMaximized = v);

    async function minimize() {
        await appWindow.minimize();
    }

    async function toggleMaximize() {
        await appWindow.toggleMaximize();
        isMaximized = await appWindow.isMaximized();
    }

    async function close() {
        await appWindow.close();
    }

    function handleDrag(e: MouseEvent) {
        // Don't drag if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.closest('button, .tab, .dropdown-btn')) return;
        appWindow.startDragging();
    }
</script>

<nav class="nav-bar" onmousedown={handleDrag}>
    <!-- Drag handle -->
    <div class="drag-handle">
        <GripVertical size={16} />
    </div>

    <!-- Pinned icon tabs -->
    <div
            class="tab icon-tab"
            class:active={editor.isTabFocused(settingsTab)}
            onclick={() => editor.focusTab(settingsTab)}
            role="button"
            tabindex="0"
    >
        <Settings size={16}/>
    </div>
    <div
            class="tab icon-tab"
            class:active={editor.isTabFocused(searchTab)}
            onclick={() => editor.focusTab(searchTab)}
            role="button"
            tabindex="0"
    >
        <Search size={16}/>
    </div>

    <!-- Bookmarks dropdown -->
    <button class="dropdown-btn" title="Bookmarks">
        <Bookmark size={16}/>
        <ChevronDown size={12}/>
    </button>

    <!-- Divider -->
    <div class="divider"></div>

    <!-- Document tabs -->
    <div class="tabs-scroll">
        {#each editor.docs as d}
            {@const tab: Tab = {kind: 'document', id: d.id}}
            <div
                    class="tab"
                    class:active={editor.isTabFocused(tab)}
                    onclick={() => editor.focusTab(tab)}
                    role="button"
                    tabindex="0"
            >
                <span class="doc-icon"></span>
                <span class="tab-label">{d.title}</span>
                <span class="tab-fade"></span>
                <button
                        class="close-btn"
                        title="Close tab"
                        onclick={(e) => { e.stopPropagation(); editor.closeDoc(d.id); }}
                >
                    <X size={12}/>
                </button>
            </div>
        {/each}
    </div>

    <!-- Window controls -->
    <div class="window-controls">
        <button class="caption-btn" title="Minimize" onclick={minimize}>
            <span class="caption-icon">&#xE921;</span>
        </button>
        <button class="caption-btn" title={isMaximized ? "Restore" : "Maximize"} onclick={toggleMaximize}>
            <span class="caption-icon">{isMaximized ? "\uE923" : "\uE922"}</span>
        </button>
        <button class="caption-btn close" title="Close" onclick={close}>
            <span class="caption-icon">&#xE8BB;</span>
        </button>
    </div>
</nav>

<style>
    .nav-bar {
        display: flex;
        align-items: flex-end;
        height: 42px;
        width: 100%;
        background: transparent;
        padding-left: 8px;
        gap: 6px;
        overflow: hidden;
    }

    /* ── Drag handle ── */
    .drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 32px;
        margin-bottom: 4px;
        flex-shrink: 0;
        color: var(--color-ui-muted);
        cursor: grab;
    }

    /* ── Dropdown button ── */
    .dropdown-btn {
        display: flex;
        align-items: center;
        height: 32px;
        margin-bottom: 4px;
        padding: 0 10px;
        border: none;
        border-radius: 6px;
        background: var(--color-surface);
        color: var(--color-ui-muted);
        cursor: pointer;
        gap: 2px;
    }

    .dropdown-btn:hover {
        color: var(--color-ui-dulled);
    }

    /* ── Divider ── */
    .divider {
        width: 1px;
        height: 22px;
        margin: 0 -4px 9px 4px;
        background: var(--color-border);
        flex-shrink: 0;
    }

    /* ── Tabs scroll container ── */
    .tabs-scroll {
        display: flex;
        align-items: flex-end;
        flex: 1;
        min-width: 0;
        gap: 6px;
        padding-left: 8px;
        overflow-x: hidden;
        overflow-y: hidden;
    }

    /* ── Tab ── */
    .tab {
        position: relative;
        display: flex;
        align-items: center;
        height: 32px;
        margin-bottom: 4px;
        padding: 0 12px;
        border: none;
        border-radius: 6px;
        background: var(--color-surface);
        color: var(--color-ui-muted);
        font-size: 13px;
        font-family: inherit;
        white-space: nowrap;
        flex-shrink: 0;
        cursor: pointer;
        gap: 6px;
    }

    .tabs-scroll .tab {
        flex-shrink: 1;
        min-width: 60px;
        max-width: 240px;
    }

    .tab.icon-tab {
        padding: 0 10px;
    }

    .doc-icon {
        display: inline-block;
        width: 18px;
        height: 18px;
        margin-right: 2px;
        background-color: currentColor;
        mask-image: url('/assets/markdown-icon.svg');
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        -webkit-mask-image: url('/assets/markdown-icon.svg');
        -webkit-mask-size: contain;
        -webkit-mask-repeat: no-repeat;
        -webkit-mask-position: center;
    }

    .tab.active .doc-icon {
        background-color: var(--color-accent);
    }

    .tab:hover {
        color: var(--color-ui-dulled);
    }

    .tab.active {
        height: 36px;
        margin-bottom: 0;
        padding-bottom: 4px;
        border-radius: 6px 6px 0 0;
        color: var(--color-text-secondary);
    }

    /* Concave corners on active tab */
    .tab.active::before,
    .tab.active::after {
        content: '';
        position: absolute;
        bottom: 0;
        width: 6px;
        height: 6px;
    }

    .tab.active::before {
        left: -6px;
        border-bottom-right-radius: 6px;
        box-shadow: 3px 0 0 0 var(--color-surface);
    }

    .tab.active::after {
        right: -6px;
        border-bottom-left-radius: 6px;
        box-shadow: -3px 0 0 0 var(--color-surface);
    }

    .tab-label {
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
    }

    .tab-fade {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 32px;
        background: linear-gradient(to right, transparent, var(--color-surface));
        pointer-events: none;
        border-radius: 0 6px 6px 0;
    }

    .tab.active .tab-fade {
        border-radius: 0 6px 0 0;
    }

    .tab:hover .tab-fade {
        display: none;
    }

    /* ── Close button ── */
    .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0;
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        z-index: 1;
    }

    .tab:hover .close-btn {
        opacity: 0.6;
    }

    .tab:hover .close-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        opacity: 1;
    }

    .tab.active:hover .close-btn {
        opacity: 0.6;
    }

    .tab.active:hover .close-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        opacity: 1;
    }

    /* ── Window controls ── */
    .window-controls {
        display: flex;
        flex-shrink: 0;
        height: 100%;
        margin-left: auto;
    }

    .caption-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 100%;
        border: none;
        background: transparent;
        color: var(--color-ui-dulled);
        cursor: pointer;
    }

    .caption-btn:hover {
        background: rgba(0, 0, 0, 0.06);
    }

    .caption-btn:active {
        background: rgba(0, 0, 0, 0.1);
    }

    .caption-btn.close:hover {
        background: #c42b1c;
        color: white;
    }

    .caption-btn.close:active {
        background: #b32a1b;
        color: white;
    }

    .caption-icon {
        font-family: "Segoe MDL2 Assets", "Segoe Fluent Icons", sans-serif;
        font-size: 10px;
        line-height: 1;
    }
</style>
