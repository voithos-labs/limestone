<script lang="ts">
	import {
		containsGitRepo,
		createSource,
		GIT_FRONTMATTER_OFF,
		listDirs,
		listSources,
		makeDir,
		setDefaultSource,
		sourceName,
		updateSource,
		updateSourcePath,
		type Source
	} from '$lib/models/Source';
	import { getSetting } from '$lib/models/Settings.svelte';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { ChevronDown, Folder, GitBranch, TriangleAlert } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import Toggle from './Toggle.svelte';
	import FolderValueEditor from './views/FolderValueEditor.svelte';

	let {
		open = $bindable(false),
		mode,
		source = null,
		missing = false,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		source?: Source | null;
		missing?: boolean;
		onSaved: () => void;
	} = $props();

	let folderPath = $state('');
	let noteLocation = $state('');
	let assetLocation = $state('assets');
	let useFrontmatter = $state(true);
	let setAsDefault = $state(false);
	let gitOff = $state(false);
	let hasRepo = $state(false);
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
				noteLocation = source.note_location;
				assetLocation = source.asset_location;
			} else {
				folderPath = '';
				noteLocation = '';
				assetLocation = 'assets';
				useFrontmatter = true;
				setAsDefault = false;
				hasRepo = false;
				getSetting<boolean>(GIT_FRONTMATTER_OFF)
					.then((v) => (gitOff = v ?? true))
					.catch(() => {});
				listSources()
					.then((ss) => (setAsDefault = ss.length === 0))
					.catch(() => {});
			}
		}
		if (!open) wasOpen = false;
	});

	async function chooseFolder() {
		const sel = await openDialog({ directory: true, multiple: false });
		if (typeof sel === 'string') {
			folderPath = sel;
			noteLocation = '';
			assetLocation = 'assets';
			hasRepo = false;
			containsGitRepo(sel)
				.then((found) => {
					if (folderPath === sel) hasRepo = found;
				})
				.catch(() => {});
		}
	}

	async function relocate() {
		const sel = await openDialog({ directory: true, multiple: false });
		if (typeof sel !== 'string' || !source) return;
		error = '';
		busy = true;
		try {
			await updateSourcePath(source.id, sel);
			folderPath = sel;
			onSaved();
		} catch (e) {
			error = String(e);
		}
		busy = false;
	}

	let noteMenuOpen = $state(false);
	let noteMenuAnchor: HTMLElement | null = $state(null);
	let assetMenuOpen = $state(false);
	let assetMenuAnchor: HTMLElement | null = $state(null);

	function dirNode(rel: string) {
		const parts = rel.split('/');
		return {
			id: rel,
			slug: parts[parts.length - 1],
			parentId: parts.length > 1 ? parts.slice(0, -1).join('/') : undefined,
			accessedAt: new Date(0)
		};
	}

	async function loadFsFolders() {
		if (!folderPath) return [];
		return (await listDirs(folderPath)).map(dirNode);
	}

	async function createFsFolder(name: string, parent: { id: string; path: string } | null) {
		const rel = parent ? `${parent.id}/${name}` : name;
		await makeDir(folderPath, rel);
		return dirNode(rel);
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
				const created = await createSource(
					folderPath,
					title,
					config,
					useFrontmatter ? null : false
				);
				if (setAsDefault) await setDefaultSource(created.id);
			} else if (source) {
				await updateSource(source.id, config);
			}
			onSaved();
			open = false;
		} catch (e) {
			error = String(e);
		}
		busy = false;
	}

	function onKey(e: KeyboardEvent) {
		if (noteMenuOpen || assetMenuOpen) return;
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

			{#if mode === 'edit' && missing}
				<div class="info-card">
					<TriangleAlert size={15} strokeWidth={1.75} />
					<div class="mc-body">
						<span class="mc-title">Source folder unavailable</span>
						<span class="mc-text">
							The folder couldn't be found. If it moved, point this source at its new location; your
							notes stay indexed either way.
						</span>
						<button class="btn mc-btn" type="button" disabled={busy} onclick={relocate}>
							Update location…
						</button>
					</div>
				</div>
			{/if}

			<label class="field">
				<span class="label">Folder</span>
				{#if mode === 'create'}
					<button
						class="folder-pick"
						class:empty={!folderPath}
						type="button"
						onclick={chooseFolder}
					>
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
				<button
					class="folder-pick"
					type="button"
					bind:this={noteMenuAnchor}
					disabled={!folderPath}
					onclick={() => (noteMenuOpen = true)}
				>
					<Folder size={14} />
					<span class="folder-text grow">{noteLocation || '(source root)'}</span>
					<ChevronDown size={14} />
				</button>
			</label>

			<label class="field">
				<span class="label">Asset location</span>
				<button
					class="folder-pick"
					type="button"
					bind:this={assetMenuAnchor}
					disabled={!folderPath}
					onclick={() => (assetMenuOpen = true)}
				>
					<Folder size={14} />
					<span class="folder-text grow">{assetLocation}</span>
					<ChevronDown size={14} />
				</button>
			</label>

			{#if mode === 'create' && folderPath}
				<div class="options" transition:slide={{ duration: 160 }}>
					{#if useFrontmatter && gitOff && hasRepo}
						<div class="info-card">
							<GitBranch size={15} strokeWidth={1.75} />
							<div class="mc-body">
								<span class="mc-title">Git repo detected</span>
								<span class="mc-text">
									Based on your settings, files inside Git repos won't have metadata written to
									them.
								</span>
							</div>
						</div>
					{/if}

					<div class="option-card">
						<div class="oc-text">
							<span class="oc-title">Store metadata in YAML frontmatter</span>
							<span class="oc-desc">
								{useFrontmatter
									? "Tags and properties live in each note's file."
									: 'No properties, stable ids or edit history.'}
							</span>
						</div>
						<Toggle bind:checked={useFrontmatter} />
					</div>

					<div class="option-card">
						<div class="oc-text">
							<span class="oc-title">Set as default source</span>
							<span class="oc-desc">New notes are created here by default.</span>
						</div>
						<Toggle bind:checked={setAsDefault} />
					</div>
				</div>
			{/if}

			{#if error}<p class="err">{error}</p>{/if}

			<div class="actions">
				<button class="btn" type="button" onclick={() => (open = false)}>Cancel</button>
				<button class="btn primary" type="button" disabled={busy} onclick={submit}>
					{mode === 'create' ? 'Create' : 'Save'}
				</button>
			</div>

			<FolderValueEditor
				bind:open={noteMenuOpen}
				anchor={noteMenuAnchor}
				value={noteLocation || null}
				rootOption={true}
				rootLabel="(source root)"
				placement="below"
				loadFolders={loadFsFolders}
				onCreateFolder={createFsFolder}
				onChange={(id, path) => (noteLocation = id ? (path ?? id) : '')}
			/>

			<FolderValueEditor
				bind:open={assetMenuOpen}
				anchor={assetMenuAnchor}
				value={assetLocation === 'assets' ? null : assetLocation}
				rootOption={true}
				rootLabel="assets (default)"
				placement="below"
				loadFolders={loadFsFolders}
				onCreateFolder={createFsFolder}
				onChange={(id, path) => (assetLocation = id ? (path ?? id) : 'assets')}
			/>
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
		background: var(--color-bg);
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

	.info-card {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 16px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-ui-muted);
	}

	.info-card > :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.mc-body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.mc-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.mc-text {
		font-size: 12px;
		line-height: 1.4;
	}

	.mc-btn {
		align-self: flex-start;
		margin-top: 6px;
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
		color: var(--color-text-primary);
	}

	.folder-pick.empty {
		color: var(--color-text-primary);
	}

	.folder-pick.empty:hover {
		background: var(--chip-bg);
	}

	.folder-text.grow {
		flex: 1;
	}

	.folder-pick:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.folder-static {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-ui-muted);
		cursor: default;
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 6px 0 18px;
	}

	.options .info-card {
		margin-bottom: 0;
	}

	.option-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.oc-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.oc-title {
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.oc-desc {
		font-size: 12px;
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
		color: var(--color-accent-contrast);
	}

	.btn.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
