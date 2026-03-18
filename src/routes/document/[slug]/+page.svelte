<script lang="ts">
	import { page } from '$app/state';
	import Document from '$lib/models/Document';

	let doc = $state<Document | null>(null);
	let body = $state('');
	let title = $state('');
	let saving = $state(false);
	let error = $state('');

	async function load() {
		try {
			const id = page.params.slug;
			doc = await Document.fromID(id!);
			body = await doc.loadContent();
			title = doc.title;
		} catch (e: any) {
			error = e.message ?? String(e);
		}
	}

	async function save() {
		if (!doc) return;
		saving = true;
		try {
			if (title !== doc.title) {
				const ext = doc.relPath.match(/\.[^.]+$/)?.[0] ?? '';
				await doc.rename(title + ext);
			}
			await doc.saveContent(body);
		} catch (e: any) {
			error = e.message ?? String(e);
		} finally {
			saving = false;
		}
	}

	load();
</script>

<main>
	<nav>
		<a href="/">&larr; back</a>
		{#if doc}
			<input class="title-input" bind:value={title} />
			<button onclick={save} disabled={saving}>{saving ? 'saving...' : 'save'}</button>
		{/if}
	</nav>

	{#if error}
		<p class="error">{error}</p>
	{:else if !doc}
		<p class="muted">loading...</p>
	{:else}
		<details>
			<summary>document object</summary>
			<pre>{JSON.stringify(doc, null, 2)}</pre>
		</details>
		<textarea bind:value={body}></textarea>
	{/if}
</main>

<style>
	main {
		font-family: monospace;
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem;
		color: var(--color-text-primary);
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	nav a {
		color: var(--color-accent-primary);
		text-decoration: none;
	}

	.title-input {
		flex: 1;
		font-family: monospace;
		font-size: 1rem;
		padding: 0.3rem 0.5rem;
		background: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-ui-muted);
	}

	button {
		padding: 0.3rem 0.8rem;
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

	textarea {
		flex: 1;
		width: 100%;
		font-family: monospace;
		font-size: 0.9rem;
		padding: 0.8rem;
		background: var(--color-surface);
		color: var(--color-text-primary);
		border: 1px solid var(--color-ui-muted);
		resize: none;
	}

	.error {
		color: #f44;
	}

	details {
		margin-bottom: 1rem;
		border: 1px solid var(--color-ui-muted);
		padding: 0.5rem;
	}

	summary {
		cursor: pointer;
		color: var(--color-ui-dulled);
		font-size: 0.85rem;
	}

	pre {
		font-size: 0.8rem;
		overflow-x: auto;
		margin: 0.5rem 0 0;
		color: var(--color-ui-dulled);
	}

	.muted {
		color: var(--color-ui-dulled);
	}
</style>
