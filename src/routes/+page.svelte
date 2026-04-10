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

    .content-area::before,
    .content-area::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 24px;
        pointer-events: none;
        z-index: 1;
    }

    .content-area::before {
        top: 0;
        background: linear-gradient(to bottom, var(--color-surface), transparent);
        border-radius: 8px 8px 0 0;
    }

    .content-area::after {
        bottom: 0;
        background: linear-gradient(to top, var(--color-surface), transparent);
        border-radius: 0 0 8px 8px;
    }

    .editor {
        width: 100%;
        height: 100%;
        max-width: 700px;
        margin: 0 auto;
        padding: 48px 24px;
        display: block;
        background: transparent;
        border: none;
        outline: none;
        resize: none;
        color: var(--color-text-primary);
        font-family: var(--font-ui);
        font-size: 16px;
        line-height: 1.6;
        scrollbar-width: none;
    }

    .editor::-webkit-scrollbar {
        display: none;
    }

    .editor::placeholder {
        color: var(--color-ui-muted);
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