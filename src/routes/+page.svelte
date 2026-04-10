<script lang="ts">
    import TopBar from "../components/nav/TopBar.svelte";
    import Session from "$lib/models/Session";
    import SearchPage from "../components/pages/SearchPage.svelte";
    import SettingsPage from "../components/pages/SettingsPage.svelte";
    import MarkdownEditor from "../components/editor/MarkdownEditor.svelte";

    let session = $state<Session>();
    let content = $state('');

    Session.init().then(s => session = s);

    // Load content when focused document changes
    $effect(() => {
        const doc = session?.editors[0]?.focusedDocument;
        if (doc) {
            doc.loadContent().then(body => {
                content = body;
            });
        } else {
            content = '';
        }
    });
</script>
{#if session}
    <div class="app-layout">
        <TopBar editor={session.editors[0]}></TopBar>
        <main class="content-area">
            {#if session.editors[0].focusedDocument}
                <MarkdownEditor bind:content />
            {:else if session.editors[0].focusedTabKey === 'search'}
                <SearchPage editor={session.editors[0]}/>
            {:else if session.editors[0].focusedTabKey === 'settings'}
                <SettingsPage viewTab={session.getViewTab('settings')} {session} />
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