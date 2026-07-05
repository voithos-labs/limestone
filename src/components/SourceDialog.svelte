<script lang="ts">
	import {
		createSource,
		getSourceConfig,
		isGitRepo,
		setSourceConfig,
		sourceName,
		type Source
	} from '$lib/models/Source';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { Folder, GitBranch } from '@lucide/svelte';
	import Toggle from './Toggle.svelte';

	let {
		open = $bindable(false),
		mode,
		source = null,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		source?: Source | null;
		onSaved: () => void;
	} = $props();

	let folderPath = $state('');
	let noteLocation = $state('');
	let assetLocation = $state('assets');
	let useFrontmatter = $state(true);
	let isGit = $state(false);
	let error = $state('');
	let busy = $state(false);

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			error = '';
			busy = false;
			if (mode === 'edit' && source) {
				folderPath = source.path;
				noteLocation = '';
				assetLocation = 'assets';
				getSourceConfig(source.id)
					.then((c) => {
						noteLocation = c.note_location;
						assetLocation = c.asset_location;
					})
					.catch((e) => (error = String(e)));
			} else {
				folderPath = '';
				noteLocation = '';
				assetLocation = 'assets';
				useFrontmatter = true;
				isGit = false;
			}
		}
		if (!open) wasOpen = false;
	});

	async function chooseFolder() {
		const sel = await openDialog({ directory: true, multiple: false });
		if (typeof sel === 'string') {
			folderPath = sel;
			isGit = await isGitRepo(sel);
			useFrontmatter = !isGit;
		}
	}

	async function submit() {
		error = '';
		const config = {
			note_location: noteLocation.trim(),
			asset_location: assetLocation.trim() || 'assets'
		};
		busy = true;
		try {
			if (mode === 'create') {
				if (!folderPath) {
					error = 'Choose a folder';
					busy = false;
					return;
				}
				const title = folderPath.split(/[\\/]/).filter(Boolean).pop() || 'Untitled';
				await createSource(folderPath, title, config, useFrontmatter);
			} else if (source) {
				await setSourceConfig(source.id, config);
			}
			onSaved();
			open = false;
		} catch (e) {
			error = String(e);
		}
		busy = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
		else if (e.key === 'Enter' && !busy) submit();
	}
</script>

{#if open}
	<div class="overlay" onclick={() => (open = false)} onkeydown={onKey} role="presentation">
		<div
			class="dialog"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKey}
			role="dialog"
			tabindex="-1"
		>
			<h3 class="title">
				{mode === 'create' ? 'Add source' : sourceName(source ?? { path: '', title: '' })}
			</h3>

			<label class="field">
				<span class="label">Folder</span>
				{#if mode === 'create'}
					<button class="folder-pick" type="button" onclick={chooseFolder}>
						<Folder size={14} />
						<span class="folder-text" class:placeholder={!folderPath}
							>{folderPath || 'Choose folder…'}</span
						>
					</button>
				{:else}
					<div class="folder-static" title={folderPath}>{folderPath}</div>
				{/if}
			</label>

			<label class="field">
				<span class="label">Default note location</span>
				<input
					class="input"
					type="text"
					bind:value={noteLocation}
					placeholder="(source root)"
					spellcheck="false"
				/>
			</label>

			<label class="field">
				<span class="label">Asset location</span>
				<input
					class="input"
					type="text"
					bind:value={assetLocation}
					placeholder="assets"
					spellcheck="false"
				/>
			</label>

			{#if mode === 'create'}
				<div class="fm-field">
					{#if isGit}
						<span class="git-note"><GitBranch size={12} /> Off by default for Git repos</span>
					{/if}
					<div class="toggle-row">
						<Toggle bind:checked={useFrontmatter} />
						<span class="toggle-text">Store metadata in YAML frontmatter</span>
					</div>
					{#if !useFrontmatter}
						<p class="hint">
							Documents can't have custom properties including a static id, which means: no edit
							history and lower functionality within views.
						</p>
					{/if}
				</div>
			{/if}

			{#if error}<p class="err">{error}</p>{/if}

			<div class="actions">
				<button class="btn" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="button" disabled={busy} onclick={submit}>
					{mode === 'create' ? 'Create' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		width: 420px;
		max-width: calc(100vw - 32px);
		padding: 20px;
		background: var(--color-bg-opaque, var(--color-bg));
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
	}

	.title {
		margin: 0 0 16px;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-bottom: 14px;
	}

	.label {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.input,
	.folder-pick,
	.folder-static {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-bg);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 13px;
	}

	.input:focus {
		outline: none;
		border-color: var(--color-ui-muted);
	}

	.folder-pick {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		cursor: pointer;
		color: var(--color-ui-muted);
	}

	.folder-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.folder-text.placeholder {
		color: var(--color-ui-muted);
	}

	.folder-static {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-ui-muted);
		cursor: default;
	}

	.fm-field {
		margin-bottom: 14px;
	}

	.git-note {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-bottom: 6px;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.toggle-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.toggle-text {
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.hint {
		margin: 6px 0 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.err {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--color-accent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}

	.btn {
		padding: 7px 14px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.btn:hover {
		color: var(--color-text-primary);
	}

	.btn.primary {
		border-color: transparent;
		background: var(--color-accent);
		color: #fff;
	}

	.btn.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
