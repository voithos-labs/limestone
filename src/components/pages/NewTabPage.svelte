<script lang="ts">
    import type EditorState from '$lib/models/EditorState.svelte.js';
    import {TabState} from '$lib/models/EditorState.svelte.js';
    import {listSources} from '$lib/models/Source';
    import DocHandle from '$lib/models/DocHandle';
    import View from '$lib/models/View.svelte';
    import CuboidPlus from '../CuboidPlus.svelte';
    import IconAddNotes from '~icons/material-symbols/add-notes';
    import ClockHero from '../ClockHero.svelte';
    import QuickSearch from '../QuickSearch.svelte';

    let {tab, editor}: { tab: TabState; editor: EditorState } = $props();

    let actionError = $state('');

    async function createNewDocument() {
        actionError = '';
        const sources = await listSources();
        const source = sources[0];
        if (!source) {
            actionError = 'Add a source before creating a document';
            return;
        }
        const doc = await DocHandle.createFromTitle(source, {title: 'Untitled', draft: true});
        editor.replaceTab(tab.id, TabState.forDoc(doc));
    }

    function createNewView() {
        actionError = '';
        editor.replaceTab(tab.id, TabState.forView(View.create('New view')));
    }
</script>

<div class="new-tab-page">
    <div class="stack">
        <div class="hero-wrap">
            <ClockHero/>
        </div>

        <QuickSearch {editor} {tab}/>

        <div class="actions">
            <button class="action" onclick={createNewDocument}>
                <IconAddNotes width={14} height={14}/>
                <span>New document</span>
            </button>
            <button class="action" onclick={createNewView}>
                <CuboidPlus size={13}/>
                <span>New view</span>
            </button>
            {#if actionError}
                <p class="action-error">{actionError}</p>
            {/if}
        </div>
    </div>
</div>

<style>
    .new-tab-page {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding: 0 24px 14vh;
        overflow-y: auto;
        scrollbar-width: none;
    }

    .new-tab-page::-webkit-scrollbar {
        display: none;
    }

    .stack {
        width: 100%;
        max-width: 620px;
        padding-bottom: 24px;
    }

    .hero-wrap {
        margin-bottom: 30px;
    }

    /* ── Default actions ── */
    .actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 100%;
        max-width: 620px;
        margin-top: 14vh;
    }

    .action {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 12px;
        border: none;
        border-radius: var(--radius-ui);
        background: transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-ui);
        font-size: 14px;
        cursor: pointer;
    }

    .action:hover {
        color: var(--color-text-primary);
        text-decoration: underline;
    }

    .action-error {
        margin: 4px 0 0 12px;
        font-size: 12px;
        color: var(--color-accent);
    }
</style>
