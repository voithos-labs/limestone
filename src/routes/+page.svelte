<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';

	interface Source {
		id: string;
		title: string;
		path: string;
		created_at: string;
		accessed_at: string;
	}

	interface SearchResult {
		id: string;
		title: string;
		rel_path: string | null;
		score: number;
		match_indices: number[];
	}

	let sources = $state<Source[]>([]);
	let newSourcePath = $state('');
	let newSourceTitle = $state('');
	let loading = $state(false);

	let searchQuery = $state('');
	let searchResults = $state<SearchResult[]>([]);

	async function loadSources() {
		sources = await invoke('get_sources');
		await doSearch();
	}

	async function doSearch() {
		searchResults = await invoke('search_documents', { query: searchQuery });
	}

	async function createSource() {
		if (!newSourcePath) return;
		await invoke('create_source', {
			path: newSourcePath,
			title: newSourceTitle || newSourcePath.split(/[\\/]/).pop() || 'Untitled'
		});
		newSourcePath = '';
		newSourceTitle = '';
		await loadSources();
	}

	function highlightTitle(title: string, indices: number[]): string {
		if (!indices.length) return title;
		const chars = [...title];
		const set = new Set(indices);
		return chars.map((ch, i) => (set.has(i) ? `<mark>${ch}</mark>` : ch)).join('');
	}

	loadSources();

	listen('source-reconciled', () => {
		doSearch();
	});
</script>

<main>
	<h2>limestone</h2>

	<section>
		<h3>create source</h3>
		<div class="row">
			<input bind:value={newSourceTitle} placeholder="title (optional)" />
			<input bind:value={newSourcePath} placeholder="/path/to/source" />
			<button onclick={createSource} disabled={loading || !newSourcePath}>create</button>
		</div>
	</section>

	<section>
		<h3>sources</h3>
		{#if sources.length === 0}
			<p class="muted">no sources</p>
		{:else}
			<ul>
				{#each sources as source}
					<li>
						<span>{source.title}</span>
						<span class="path">{source.path}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3>search</h3>
		<input
			bind:value={searchQuery}
			oninput={doSearch}
			placeholder="search documents..."
			class="search-input"
		/>
		{#if searchResults.length > 0}
			<table>
				<thead>
					<tr>
						<th>title</th>
						<th>path</th>
					</tr>
				</thead>
				<tbody>
					{#each searchResults as result}
						<tr>
							<td>
								<a href="/document/{result.id}"
									>{@html highlightTitle(result.title, result.match_indices)}</a
								>
							</td>
							<td class="mono">{result.rel_path ?? '-'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if searchQuery}
			<p class="muted">no results</p>
		{/if}
	</section>

	{#if loading}
		<div class="loading">working...</div>
	{/if}
</main>

<style>
	main {
		font-family: monospace;
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
		color: var(--color-text-primary);
		background: var(--color-bg);
		min-height: 100vh;
	}

	h2 {
		margin-bottom: 1.5rem;
	}

	h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	section {
		margin-bottom: 2rem;
	}

	a {
		color: var(--color-text-primary);
		text-decoration: none;
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	input {
		padding: 0.4rem 0.6rem;
		font-family: monospace;
		flex: 1;
		border: 1px solid var(--color-ui-muted);
		background: var(--color-surface);
		color: var(--color-text-primary);
	}

	.search-input {
		width: 100%;
		margin-bottom: 0.5rem;
		font-size: 1rem;
		padding: 0.5rem 0.6rem;
	}

	button {
		padding: 0.4rem 0.8rem;
		font-family: monospace;
		cursor: pointer;
		background: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-ui-muted);
	}

	button:hover:not(:disabled) {
		background: var(--color-ui-muted);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	button.small {
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
	}

	ul {
		list-style: none;
		padding: 0;
	}

	li {
		padding: 0.3rem 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.path {
		color: var(--color-ui-dulled);
		font-size: 0.85rem;
	}

	.muted {
		color: var(--color-ui-dulled);
	}

	.mono {
		font-family: monospace;
		font-size: 0.85rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--color-ui-muted);
	}

	th {
		color: var(--color-ui-dulled);
	}

	:global(mark) {
		background: #ff05;
		color: #ff0;
		padding: 0;
	}

	.loading {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		background: var(--color-surface);
		padding: 0.4rem 0.8rem;
		border-radius: 4px;
	}
    import {invoke} from "@tauri-apps/api/core";
    import {listen} from "@tauri-apps/api/event";
    import EditorBrowserHarness from "$lib/editor/ui/EditorBrowserHarness.svelte";

    interface Vault {
        id: string;
        title: string;
        path: string;
        created_at: string;
        accessed_at: string;
    }

    interface SearchResult {
        id: string;
        title: string;
        rel_path: string | null;
        score: number;
        match_indices: number[];
    }

    let vaults = $state<Vault[]>([]);
    let activeVault = $state<Vault | null>(null);
    let newVaultPath = $state("");
    let newVaultTitle = $state("");
    let loading = $state(false);

    let searchQuery = $state("");
    let searchResults = $state<SearchResult[]>([]);

    async function loadVaults() {
        vaults = await invoke("get_vaults");
        activeVault = await invoke("get_active_vault");
        if (activeVault) {
            await doSearch();
        }
    }

    async function doSearch() {
        if (!activeVault) return;
        searchResults = await invoke("search_documents", {query: searchQuery});
    }

    async function createVault() {
        if (!newVaultPath) return;
        await invoke("create_vault", {
            path: newVaultPath,
            title: newVaultTitle || newVaultPath.split(/[\\/]/).pop() || "Untitled",
        });
        newVaultPath = "";
        newVaultTitle = "";
        await loadVaults();
    }

    async function switchVault(id: string) {
        await invoke("set_active_vault", {id});
        await loadVaults();
    }

    function highlightTitle(title: string, indices: number[]): string {
        if (!indices.length) return title;
        const chars = [...title];
        const set = new Set(indices);
        return chars
            .map((ch, i) => set.has(i) ? `<mark>${ch}</mark>` : ch)
            .join("");
    }

    loadVaults();

    listen("vault-reconciled", () => {
        doSearch();
    });
</script>

<main>
    <h2>limestone</h2>

    <section>
        <h3>create vault</h3>
        <div class="row">
            <input bind:value={newVaultTitle} placeholder="title (optional)"/>
            <input bind:value={newVaultPath} placeholder="/path/to/vault"/>
            <button onclick={createVault} disabled={loading || !newVaultPath}>create</button>
        </div>
    </section>

    <section>
        <h3>vaults</h3>
        {#if vaults.length === 0}
            <p class="muted">no vaults</p>
        {:else}
            <ul>
                {#each vaults as vault}
                    <li class:active={activeVault?.id === vault.id}>
                        <button onclick={() => switchVault(vault.id)} disabled={loading}>
                            {vault.title}
                        </button>
                        <span class="path">{vault.path}</span>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    {#if activeVault}
        <section>
            <h3>search</h3>
            <input
                    bind:value={searchQuery}
                    oninput={doSearch}
                    placeholder="search documents..."
                    class="search-input"
            />
            {#if searchResults.length > 0}
                <table>
                    <thead>
                    <tr>
                        <th>title</th>
                        <th>path</th>
                    </tr>
                    </thead>
                    <tbody>
                    {#each searchResults as result}
                        <tr>
                            <td>{@html highlightTitle(result.title, result.match_indices)}</td>
                            <td class="mono">{result.rel_path ?? '-'}</td>
                        </tr>
                    {/each}
                    </tbody>
                </table>
            {:else if searchQuery}
                <p class="muted">no results</p>
            {/if}
        </section>
    {/if}

    {#if loading}
        <div class="loading">working...</div>
    {/if}

    <section>
        <h3>editor harness</h3>
        <p class="muted">
            Browser-backed projection and selection prototype for the editor module.
        </p>
        <div class="editor-harness-panel">
            <EditorBrowserHarness/>
        </div>
    </section>
</main>

<style>
    main {
        font-family: monospace;
        max-width: 900px;
        margin: 0 auto;
        padding: 2rem;
        color: var(--color-text-primary);
        background: var(--color-bg);
        min-height: 100vh;
    }

    h2 {
        margin-bottom: 1.5rem;
    }

    h3 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    section {
        margin-bottom: 2rem;
    }

    .row {
        display: flex;
        gap: 0.5rem;
    }

    input {
        padding: 0.4rem 0.6rem;
        font-family: monospace;
        flex: 1;
        border: 1px solid var(--color-ui-muted);
        background: var(--color-surface);
        color: var(--color-text-primary);
    }

    .search-input {
        width: 100%;
        margin-bottom: 0.5rem;
        font-size: 1rem;
        padding: 0.5rem 0.6rem;
    }

    button {
        padding: 0.4rem 0.8rem;
        font-family: monospace;
        cursor: pointer;
        background: var(--color-surface);
        color: var(--color-text-primary);
        border: 1px solid var(--color-ui-muted);
    }

    button:hover:not(:disabled) {
        background: var(--color-ui-muted);
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    ul {
        list-style: none;
        padding: 0;
    }

    li {
        padding: 0.3rem 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    li.active button {
        color: var(--color-accent-primary);
    }

    .path {
        color: var(--color-ui-dulled);
        font-size: 0.85rem;
    }

    .muted {
        color: var(--color-ui-dulled);
    }

    .mono {
        font-family: monospace;
        font-size: 0.85rem;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
    }

    th, td {
        text-align: left;
        padding: 0.3rem 0.5rem;
        border-bottom: 1px solid var(--color-ui-muted);
    }

    th {
        color: var(--color-ui-dulled);
    }

    :global(mark) {
        background: #ff05;
        color: #ff0;
        padding: 0;
    }

    .loading {
        position: fixed;
        bottom: 1rem;
        right: 1rem;
        background: var(--color-surface);
        padding: 0.4rem 0.8rem;
        border-radius: 4px;
    }

    .editor-harness-panel {
        margin-top: 0.75rem;
    }
</style>
