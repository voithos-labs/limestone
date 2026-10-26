<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronDown,
		Eye,
		EyeOff,
		Folder,
		FolderTree,
		GitBranch,
		Info,
		LayoutPanelTop
	} from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { documentDir, join } from '@tauri-apps/api/path';
	import type Session from '#lib/models/Session.svelte.js';
	import type { ThemeEntry } from '#lib/models/Session.svelte.js';
	import {
		containsGitRepo,
		createSource,
		GIT_FRONTMATTER_OFF,
		listDirs,
		listSources,
		makeDir,
		setDefaultSource
	} from '#lib/models/Source.js';
	import { getSetting, SETTINGS_REGISTRY } from '#lib/models/Settings.svelte.js';
	import { describeError, type MenuEntry, type MenuItem } from '#lib/overlays.svelte.js';
	import { seedWelcomeProject } from '#lib/views/welcome.js';
	import Menu from '../ui/Menu.svelte';
	import Toggle from '../ui/Toggle.svelte';
	import FolderValueEditor from '../views/editors/FolderValueEditor.svelte';

	let { session }: { session: Session } = $props();

	const MODE_KEY = 'appearance.mode';

	let open = $state(false);
	let themes: ThemeEntry[] = $state([]);
	let folderPath = $state('');
	let noteLocation = $state('');
	let assetLocation = $state('assets');
	let useFrontmatter = $state(true);
	let gitOff = $state(false);
	let hasRepo = $state(false);
	let moreOpen = $state(false);
	let noteMenuOpen = $state(false);
	let noteMenuAnchor: HTMLElement | null = $state(null);
	let assetMenuOpen = $state(false);
	let assetMenuAnchor: HTMLElement | null = $state(null);
	let sample = $state(true);
	const FOLDERS_KEY = 'appearance.folders';
	const folders = $derived(session.settings.get<string>(FOLDERS_KEY) ?? 'show');
	const FOLDER_STYLES = [
		{
			value: 'show',
			label: 'Folders are cool',
			hint: 'Organise notes by folder, like on disk',
			icon: FolderTree
		},
		{
			value: 'hide',
			label: "Don't make me think about folders",
			hint: 'Tags and projects do the sorting',
			icon: LayoutPanelTop,
			info: 'This is only a user interface change. Projects are folders, this just lets you use the app and disk without thinking about it.'
		}
	];
	let busy = $state(false);
	let error = $state('');

	const defs = SETTINGS_REGISTRY.flatMap((c) => c.settings);
	const modeDef = defs.find((d) => d.key === MODE_KEY);

	const modeItems: MenuItem[] = (modeDef?.options ?? []).map((o) => ({
		value: String(o.value),
		label: o.label
	}));

	const mode = $derived(session.settings.get<string>(MODE_KEY) ?? 'system');
	const modeLabel = $derived(modeItems.find((i) => i.value === mode)?.label ?? mode);
	const themeItems = $derived<MenuEntry[]>(
		themes.filter((t) => t.type === session.themeType).map((t) => ({ value: t.key, label: t.name }))
	);
	const themeLabel = $derived(
		themes.find((t) => t.key === session.activeTheme)?.name ?? session.activeTheme
	);

	let modeOpen = $state(false);
	let modeAnchor: HTMLElement | null = $state(null);
	let themeOpen = $state(false);
	let themeAnchor: HTMLElement | null = $state(null);

	onMount(async () => {
		const sources = await listSources().catch(() => null);
		if (sources === null || sources.length > 0) return;
		themes = await session.listThemes();
		gitOff = (await getSetting<boolean>(GIT_FRONTMATTER_OFF).catch(() => null)) ?? true;
		setFolder(await join(await documentDir(), 'notes').catch(() => ''));
		open = true;
	});

	function setFolder(path: string) {
		folderPath = path;
		noteLocation = '';
		assetLocation = 'assets';
		hasRepo = false;
		if (!path) return;
		containsGitRepo(path)
			.then((found) => {
				if (folderPath === path) hasRepo = found;
			})
			.catch(() => {});
	}

	async function chooseFolder() {
		const sel = await openDialog({ directory: true, multiple: false });
		if (typeof sel === 'string') setFolder(sel);
	}

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

	async function start() {
		if (busy || !folderPath) return;
		error = '';
		busy = true;
		try {
			const title = folderPath.split(/[\\/]/).filter(Boolean).pop() || 'Notes';
			const source = await createSource(
				folderPath,
				title,
				{ note_location: noteLocation.trim(), asset_location: assetLocation.trim() || 'assets' },
				useFrontmatter ? null : false
			);
			await setDefaultSource(source.id);
			if (sample) session.active.openView(await seedWelcomeProject(source));
			open = false;
		} catch (e) {
			error =
				typeof e === 'string'
					? e
					: describeError(
							e,
							"That folder couldn't be used. Check that Limestone can create and open it."
						);
		} finally {
			busy = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if (modeOpen || themeOpen || noteMenuOpen || assetMenuOpen) return;
		if (e.key === 'Enter' && !busy) start();
	}
</script>

{#if open}
	<div class="overlay" role="presentation">
		<div class="dialog" onkeydown={onKey} role="dialog" tabindex="-1">
			<h3 class="title">Welcome to Limestone</h3>

			<div class="field">
				<div class="label-row">
					<span class="label">Add a source</span>
					<button class="more" type="button" onclick={() => (moreOpen = !moreOpen)}>
						More options
						{#if moreOpen}
							<EyeOff size={12} strokeWidth={2} />
						{:else}
							<Eye size={12} strokeWidth={2} />
						{/if}
					</button>
				</div>
				<button class="folder-pick" type="button" disabled={busy} onclick={chooseFolder}>
					<Folder size={14} />
					<span class="folder-text">{folderPath || 'Choose folder…'}</span>
				</button>
			</div>

			{#if useFrontmatter && gitOff && hasRepo}
				<div class="card info" transition:slide={{ duration: 160 }}>
					<GitBranch size={15} strokeWidth={1.75} />
					<div class="card-text">
						<span class="card-title">Git repo detected</span>
						<span class="card-desc">
							Based on your settings, files inside Git repos won't have metadata written to them.
						</span>
					</div>
				</div>
			{/if}

			<div class="card">
				<div class="card-text">
					<span class="card-title">Store metadata in YAML frontmatter</span>
					<span class="card-desc">
						{useFrontmatter
							? "Tags and properties live in each note's file."
							: 'No properties, stable ids or edit history.'}
					</span>
				</div>
				<Toggle bind:checked={useFrontmatter} />
			</div>

			{#if moreOpen}
				<div class="more-fields" transition:slide={{ duration: 160 }}>
					<div class="field">
						<span class="label">Default note location</span>
						<button
							class="folder-pick"
							type="button"
							bind:this={noteMenuAnchor}
							disabled={!folderPath || busy}
							onclick={() => (noteMenuOpen = true)}
						>
							<Folder size={14} />
							<span class="folder-text grow">{noteLocation || '(source root)'}</span>
							<ChevronDown size={14} />
						</button>
					</div>

					<div class="field">
						<span class="label">Asset location</span>
						<button
							class="folder-pick"
							type="button"
							bind:this={assetMenuAnchor}
							disabled={!folderPath || busy}
							onclick={() => (assetMenuOpen = true)}
						>
							<Folder size={14} />
							<span class="folder-text grow">{assetLocation}</span>
							<ChevronDown size={14} />
						</button>
					</div>
				</div>
			{/if}

			<div class="divider"></div>

			<div class="tiles">
				{#each FOLDER_STYLES as t (t.value)}
					{@const Icon = t.icon}
					<button
						class="tile"
						class:picked={folders === t.value}
						type="button"
						onclick={() => session.settings.set(FOLDERS_KEY, t.value)}
					>
						<span class="tile-icon"><Icon size={18} strokeWidth={1.5} /></span>
						{#if t.info}
							<span class="tile-info" title={t.info}><Info size={13} strokeWidth={1.75} /></span>
						{/if}
						<span class="tile-label">{t.label}</span>
						<span class="tile-hint">{t.hint}</span>
					</button>
				{/each}
			</div>

			<div class="card">
				<div class="card-text">
					<span class="card-title">Theme options</span>
					<span class="card-desc">More in Settings, whenever.</span>
				</div>
				<div class="selects">
					<button
						class="chip-select"
						type="button"
						bind:this={modeAnchor}
						onclick={() => (modeOpen = !modeOpen)}
					>
						<span class="chip-select-value">{modeLabel}</span>
						<ChevronDown size={13} strokeWidth={2} />
					</button>
					<button
						class="chip-select"
						type="button"
						bind:this={themeAnchor}
						onclick={() => (themeOpen = !themeOpen)}
					>
						<span class="chip-select-value">{themeLabel}</span>
						<ChevronDown size={13} strokeWidth={2} />
					</button>
				</div>
			</div>

			<div class="card">
				<div class="card-text">
					<span class="card-title">
						<LayoutPanelTop size={13} strokeWidth={2} />Start with a sample project
					</span>
				</div>
				<Toggle bind:checked={sample} />
			</div>

			{#if error}<p class="err">{error}</p>{/if}

			<div class="actions">
				<button class="btn primary" type="button" disabled={busy || !folderPath} onclick={start}>
					Get started
				</button>
			</div>

			<Menu
				bind:open={modeOpen}
				anchor={modeAnchor}
				items={modeItems}
				selected={mode}
				onSelect={(v) => {
					modeOpen = false;
					session.settings.set(MODE_KEY, v).catch((e) => console.error('set mode failed', e));
				}}
				minWidth={148}
			/>
			<Menu
				bind:open={themeOpen}
				anchor={themeAnchor}
				items={themeItems}
				selected={session.activeTheme}
				onSelect={(v) => {
					themeOpen = false;
					session.setTheme(v).catch((e) => console.error('set theme failed', e));
				}}
				minWidth={148}
			/>
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
		inset: var(--nav-bar-height) 0 0;
		z-index: 1500;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.overlay::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: calc(-1 * var(--nav-bar-height));
		height: var(--nav-bar-height);
		background: inherit;
		pointer-events: none;
	}

	.dialog {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 460px;
		max-width: calc(100vw - 32px);
		padding: 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		outline: none;
	}

	.title {
		margin: 0 0 2px;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--color-text-primary);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.more-fields {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
	}

	.more {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition: color 120ms ease;
	}

	.more:hover {
		color: var(--color-text-primary);
	}

	.folder-pick {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 32px;
		box-sizing: border-box;
		padding: 0 10px;
		border: none;
		border-radius: 8px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 13px;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.folder-pick:hover:not(:disabled) {
		background: var(--chip-bg-hover);
	}

	.folder-pick:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.folder-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary);
	}

	.folder-text.grow {
		flex: 1;
	}

	.divider {
		height: 1px;
		margin: 2px 0;
		background: var(--chip-divider);
	}

	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: transparent;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.tile:hover {
		background: var(--chip-bg);
	}

	.tile.picked {
		border-color: var(--color-accent);
		background: var(--accent-a9);
	}

	.tile-info {
		position: absolute;
		top: 10px;
		right: 10px;
		display: inline-flex;
		color: var(--color-ui-dulled);
		cursor: help;
	}

	.tile-info:hover {
		color: var(--color-ui-muted);
	}

	.tile-icon {
		display: inline-flex;
		margin-bottom: 6px;
		color: var(--color-ui-muted);
	}

	.tile.picked .tile-icon {
		color: var(--color-accent);
	}

	.tile-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.tile-hint {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 52px;
		box-sizing: border-box;
		padding: 10px 12px;
		border-radius: 8px;
		background: var(--chip-bg);
	}

	.card.info {
		align-items: flex-start;
		justify-content: flex-start;
		gap: 10px;
		color: var(--color-ui-muted);
	}

	.card.info > :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.card-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.card-title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.card-title :global(svg) {
		color: var(--color-ui-muted);
	}

	.card-desc {
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-ui-muted);
	}

	.selects {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.chip-select {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		min-width: 96px;
		padding: 0 7px 0 10px;
		border: 0;
		border-radius: 6px;
		background: var(--color-bg);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		color: var(--color-text-primary);
		white-space: nowrap;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.chip-select:hover {
		background: var(--chip-bg-hover);
	}

	.chip-select-value {
		flex: 1;
		min-width: 0;
		line-height: 1.35;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}

	.chip-select :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.err {
		margin: 0;
		font-size: 12px;
		color: var(--error-fg);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 4px;
	}

	.btn {
		height: 32px;
		padding: 0 14px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
		transition: filter 120ms ease;
	}

	.btn.primary {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font-weight: 600;
	}

	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
