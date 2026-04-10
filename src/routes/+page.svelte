<script lang="ts">
    import TopBar from "../components/nav/TopBar.svelte";
    import EditorState from "$lib/state/EditorState.svelte";
    import Session from "$lib/models/Session";
    import {invoke} from "@tauri-apps/api/core";
    import {listen} from "@tauri-apps/api/event";
    import type {SearchResult} from "$lib/types/SearchResult";
    import {onMount} from "svelte";
    import DocHandle from "$lib/models/DocHandle";

    let session = $state<Session>();
    let content = $state('');

    Session.init().then(async (s) => {
        session = s
        // TESTING
        let searchResults: SearchResult[] = await invoke('search_documents', {query: ''});
        searchResults = searchResults.slice(0, 4); // just need a few
        searchResults.map(async r => session!.editors[0].openDoc(await DocHandle.fromID(r.id)));
        console.info(session);
    });

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
                <textarea class="editor" bind:value={content} placeholder="Start writing..."></textarea>
            {:else if session.editors[0].focusedTab}
                <div class="panel-placeholder">
                    {session.editors[0].focusedTab.kind}
                </div>
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
        flex: 1;
        margin: 0 12px 12px 12px;
        background: var(--color-surface);
        border-radius: 8px;
        overflow: hidden;
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