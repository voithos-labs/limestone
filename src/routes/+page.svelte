<script lang="ts">
    import TopBar from "../components/nav/TopBar.svelte";
    import Session from "$lib/models/Session";
    import SearchPage from "../components/pages/SearchPage.svelte";
    import SettingsPage from "../components/pages/SettingsPage.svelte";
    import MarkdownEditor from "../components/editor/MarkdownEditor.svelte";
    import type { TabState } from "$lib/state/EditorState.svelte";

    let session = $state<Session>();
    let tab: TabState | undefined = $state();

    Session.init().then(s => session = s);

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
</script>
{#if session}
    {@const editor = session.editors[0]}
    <div class="app-layout">
        <TopBar {editor}></TopBar>
        <main class="content-area">
            {#if tab}
                {#key tab.handle.id}
                    <MarkdownEditor {tab} />
                {/key}
            {:else if editor.focused?.kind === 'search'}
                <SearchPage {editor}/>
            {:else if editor.focused?.kind === 'settings'}
                <SettingsPage viewTab={session.getViewTab('settings')} {session}/>
            {:else}
                <div class="panel-placeholder">
                    No document selected
                </div>
            {/if}
        </main>
    </div>
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