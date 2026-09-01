<script lang="ts">
    import {getCurrentWindow} from '@tauri-apps/api/window';
    import type {WindowStyle} from '$lib/services/platform';

    let {style}: { style: WindowStyle } = $props();

    const appWindow = getCurrentWindow();
    let isMaximized = $state(false);
    let isFocused = $state(true);

    appWindow.isMaximized().then((v) => (isMaximized = v));

    // Track state changes from every path (drag-restore, snap, Win+arrows)
    let maxCheckTimer: ReturnType<typeof setTimeout> | null = null;
    $effect(() => {
        let unlisten: (() => void) | undefined;
        appWindow
            .onResized(() => {
                if (maxCheckTimer) clearTimeout(maxCheckTimer);
                maxCheckTimer = setTimeout(async () => {
                    isMaximized = await appWindow.isMaximized();
                }, 80);
            })
            .then((u) => (unlisten = u));
        return () => {
            if (maxCheckTimer) clearTimeout(maxCheckTimer);
            unlisten?.();
        };
    });

    // Traffic lights gray out with the window, so the focus state only matters there
    $effect(() => {
        if (style !== 'macos') return;
        let unlisten: (() => void) | undefined;
        appWindow.onFocusChanged(({payload}) => (isFocused = payload)).then((u) => (unlisten = u));
        return () => unlisten?.();
    });

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
</script>

{#if style === 'macos'}
    <div class="traffic-lights" class:unfocused={!isFocused}>
        <button class="light close" title="Close" tabindex="-1" onclick={close}>
            <svg aria-hidden="true" width="6" height="6" viewBox="0 0 6 6">
                <path
                        d="M1 1 L5 5 M5 1 L1 5"
                        stroke="currentColor"
                        stroke-width="1.1"
                        stroke-linecap="round"
                />
            </svg>
        </button>
        <button class="light minimize" title="Minimize" tabindex="-1" onclick={minimize}>
            <svg aria-hidden="true" width="6" height="6" viewBox="0 0 6 6">
                <path d="M0.5 3 L5.5 3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
        </button>
        <button
                class="light zoom"
                title={isMaximized ? 'Restore' : 'Zoom'}
                tabindex="-1"
                onclick={toggleMaximize}
        >
            <svg aria-hidden="true" width="6" height="6" viewBox="0 0 6 6">
                <path d="M0.6 4.6 L0.6 1.4 L3.8 4.6 Z" fill="currentColor"/>
                <path d="M5.4 1.4 L5.4 4.6 L2.2 1.4 Z" fill="currentColor"/>
            </svg>
        </button>
    </div>
{:else}
    <div class="window-controls">
        <button class="caption-btn" title="Minimize" tabindex="-1" onclick={minimize}>
            {#if style === 'windows'}
                <span class="caption-icon">&#xE921;</span>
            {:else}
                <svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12">
                    <rect fill="currentColor" width="10" height="1" x="1" y="6"></rect>
                </svg>
            {/if}
        </button>
        <button
                class="caption-btn"
                title={isMaximized ? 'Restore' : 'Maximize'}
                tabindex="-1"
                onclick={toggleMaximize}
        >
            {#if style === 'windows'}
                <span class="caption-icon">{isMaximized ? '\uE923' : '\uE922'}</span>
            {:else}
                <svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12">
                    <rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect>
                </svg>
            {/if}
        </button>
        <button class="caption-btn close" title="Close" tabindex="-1" onclick={close}>
            {#if style === 'windows'}
                <span class="caption-icon">&#xE8BB;</span>
            {:else}
                <svg aria-hidden="true" role="img" width="12" height="12" viewBox="0 0 12 12">
                    <polygon
                            fill="currentColor"
                            fill-rule="evenodd"
                            points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"
                    ></polygon>
                </svg>
            {/if}
        </button>
    </div>
{/if}

<style>
    /* ── Windows / Linux caption buttons ── */
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
        font-family: 'Segoe MDL2 Assets', 'Segoe Fluent Icons', sans-serif;
        font-size: 10px;
        line-height: 1;
    }

    /* ── macOS traffic lights ── */
    .traffic-lights {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 32px;
        margin-bottom: 4px;
        padding: 0 6px 0 2px;
        flex-shrink: 0;
    }

    .light {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        height: 12px;
        padding: 0;
        border: none;
        border-radius: 50%;
        color: rgba(0, 0, 0, 0.55);
        cursor: default;
    }

    .light svg {
        display: block;
        opacity: 0;
    }

    .traffic-lights:hover .light svg {
        opacity: 1;
    }

    .light.close {
        background: #ff5f57;
    }

    .light.minimize {
        background: #febc2e;
    }

    .light.zoom {
        background: #28c840;
    }

    .light:active {
        filter: brightness(0.85);
    }

    .traffic-lights.unfocused .light {
        background: color-mix(in srgb, var(--color-ui-muted) 55%, transparent);
    }

    .traffic-lights.unfocused:hover .light.close {
        background: #ff5f57;
    }

    .traffic-lights.unfocused:hover .light.minimize {
        background: #febc2e;
    }

    .traffic-lights.unfocused:hover .light.zoom {
        background: #28c840;
    }
</style>
