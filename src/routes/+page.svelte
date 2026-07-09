<script lang="ts">
    import {onMount} from 'svelte';
    import {getCurrentWindow} from '@tauri-apps/api/window';
    import TopBar from '../components/nav/TopBar.svelte';
    import {flushAll} from '$lib/services/flush';
    import Session from '$lib/models/Session';
    import LibraryPage from '../components/pages/LibraryPage.svelte';
    import SettingsPage from '../components/pages/SettingsPage.svelte';
    import ViewPage from '../components/pages/ViewPage.svelte';
    import NewTabPage from '../components/pages/NewTabPage.svelte';
    import MarkdownEditor from '../components/editor/MarkdownEditor.svelte';
    import ContextMenu from '../components/ContextMenu.svelte';
    import type {TabState} from '$lib/state/EditorState.svelte';

    let session = $state<Session>();
    let tab: TabState | undefined = $state();

    Session.init().then((s) => (session = s));

    $effect(() => {
        tab = session?.editors[0]?.focusedTab;
    });

    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    $effect(() => {
        if (!session) return;
        $state.snapshot(session.toJSON());
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => session!.persist(), 200);
    });

    onMount(() => {
        const win = getCurrentWindow();
        const unlisten = win.onCloseRequested(async (e) => {
            e.preventDefault();
            if (persistTimer) clearTimeout(persistTimer);
            try {
                await Promise.all([flushAll(), session?.persist()]);
            } catch (err) {
                console.error('flush on close failed', err);
            }
            await win.destroy();
        });
        return () => {
            unlisten.then((f) => f());
        };
    });

    // When nothing valid is focused (no tabs, or a stale focus), fall back to the library tab.
    $effect(() => {
        const ed = session?.editors[0];
        if (!ed) return;
        const f = ed.focused;
        const valid =
            f?.kind === 'search' ||
            f?.kind === 'settings' ||
            (f?.kind === 'tab' && ed.tabs.some((t) => t.id === f.id));
        if (!valid) ed.focusTab({kind: 'search'});
    });
</script>

{#if session}
    {@const editor = session.editors[0]}
    <div class="app-layout">
        <TopBar {editor}></TopBar>
        <main class="content-area">
            {#if tab}
                {#key tab.id}
                    {#if tab.content.type === 'view'}
                        <ViewPage view={tab.content.view} {editor}/>
                    {:else if tab.content.type === 'markdown'}
                        <MarkdownEditor {tab} {editor}/>
                    {:else if tab.content.type === 'new'}
                        <NewTabPage {tab} {editor}/>
                    {/if}
                {/key}
            {:else if editor.focused?.kind === 'search'}
                <LibraryPage {editor}/>
            {:else if editor.focused?.kind === 'settings'}
                <SettingsPage viewTab={session.getViewTab('settings')} {session}/>
            {:else}
                <div class="panel-placeholder">No document selected</div>
            {/if}
        </main>
    </div>
    <ContextMenu/>
{/if}

<style>
    .app-layout {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: transparent;
    }

    .content-area {
        position: relative;
        flex: 1;
        margin: 0 12px 12px 12px;
        background: var(--color-surface);
        border-radius: 8px;
        overflow: hidden;
    }

    .panel-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-ui-muted);
        font-size: 14px;
        text-transform: capitalize;
    }
</style>
