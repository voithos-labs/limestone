<script lang="ts">
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { Search, Folder, FolderPlus, Folders, ChevronRight, Check } from '@lucide/svelte';
	import Group, { GroupType } from '$lib/models/Group';
	import { listSources, sourceName } from '$lib/models/Source';
	import { folderPath } from '$lib/views/createDefaults';
	import { isValidSegment } from '$lib/util/paths';

	type FolderNode = {
		id: string;
		slug: string;
		parentGroupId?: string;
		sourceId?: string;
		accessedAt: Date;
		touch?: () => Promise<void>;
	};

	let {
		open = $bindable(false),
		anchor,
		value,
		sourceId,
		rootOption = false,
		rootLabel,
		placement = 'auto',
		loadFolders,
		onCreateFolder,
		onChange
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		value: string | null;
		sourceId?: string;
		rootOption?: boolean;
		rootLabel?: string;
		placement?: 'auto' | 'below';
		loadFolders?: () => Promise<FolderNode[]>;
		onCreateFolder?: (
			name: string,
			parent: { id: string; path: string } | null
		) => Promise<FolderNode>;
		onChange: (id: string, path?: string) => void;
	} = $props();

	let popEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let maxH = $state(window.innerHeight - 16);

	let folders: FolderNode[] = $state([]);
	let sourceNames: Map<string, string> = $state(new Map());
	let loadError = $state('');
	let query = $state('');
	let focusId: string | null = $state(null);

	const scoped = $derived(sourceId ? folders.filter((f) => f.sourceId === sourceId) : folders);

	const byId = $derived(new Map(scoped.map((f) => [f.id, f])));

	const childrenByParent = $derived.by(() => {
		const map = new Map<string | null, FolderNode[]>();
		for (const f of scoped) {
			const key = f.parentGroupId ?? null;
			const list = map.get(key) ?? [];
			list.push(f);
			map.set(key, list);
		}
		for (const list of map.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));
		return map;
	});

	let createMode = $state(false);

	const searching = $derived(!createMode && query.trim() !== '');

	const focusFolder = $derived(focusId ? byId.get(focusId) : undefined);

	const focusChain = $derived.by(() => {
		const chain: FolderNode[] = [];
		let f = focusFolder;
		let guard = 0;
		while (f && guard++ < 32) {
			chain.unshift(f);
			f = f.parentGroupId ? byId.get(f.parentGroupId) : undefined;
		}
		return chain;
	});

	let navDir = $state(1);

	const levelRows = $derived.by(() => {
		if (focusId) return childrenByParent.get(focusId) ?? [];
		const inScope = new Set(scoped.map((f) => f.id));
		return scoped
			.filter((f) => !f.parentGroupId || !inScope.has(f.parentGroupId))
			.sort((a, b) => a.slug.localeCompare(b.slug));
	});

	const searchMatches = $derived.by(() => {
		if (!searching) return [] as FolderNode[];
		const q = query.trim().toLowerCase();
		const prefix: FolderNode[] = [];
		const rest: FolderNode[] = [];
		for (const f of scoped) {
			const s = f.slug.toLowerCase();
			if (s.startsWith(q)) prefix.push(f);
			else if (s.includes(q)) rest.push(f);
		}
		const bySlug = (a: FolderNode, b: FolderNode) => a.slug.localeCompare(b.slug);
		return [...prefix.sort(bySlug), ...rest.sort(bySlug)];
	});

	const RECENTS_MIN = 9;
	const recentFolders = $derived.by(() => {
		if (searching || loadFolders || scoped.length < RECENTS_MIN) return [] as FolderNode[];
		const current = value ? scoped.find((f) => f.id === value) : undefined;
		const recents = scoped
			.filter((f) => f.id !== value)
			.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
			.slice(0, 2);
		return current ? [current, ...recents] : recents;
	});

	const createSourceId = $derived(
		sourceId ??
			(new Set(folders.map((f) => f.sourceId)).size === 1 ? folders[0]?.sourceId : undefined)
	);
	const canCreate = $derived(!!onCreateFolder || !!createSourceId);

	function siblingExists(slug: string): boolean {
		const s = slug.trim().toLowerCase();
		if (!s) return false;
		return (childrenByParent.get(focusId ?? null) ?? []).some((f) => f.slug.toLowerCase() === s);
	}

	const showCreate = $derived(
		searching && canCreate && isValidSegment(query) && !siblingExists(query)
	);

	type NavEntry = { kind: 'folder'; folder: FolderNode } | { kind: 'root' } | { kind: 'create' };

	const navEntries = $derived.by((): NavEntry[] => {
		if (searching) {
			const out: NavEntry[] = searchMatches.map((f) => ({ kind: 'folder' as const, folder: f }));
			if (showCreate) out.push({ kind: 'create' });
			return out;
		}
		const out: NavEntry[] = recentFolders.map((f) => ({ kind: 'folder' as const, folder: f }));
		if (rootOption && !focusId) out.push({ kind: 'root' });
		for (const f of levelRows) out.push({ kind: 'folder', folder: f });
		return out;
	});

	const navCount = $derived(navEntries.length);
	const levelBase = $derived(
		searching ? 0 : recentFolders.length + (rootOption && !focusId ? 1 : 0)
	);
	let activeIndex = $state(0);

	$effect(() => {
		query;
		focusId;
		if (activeIndex >= navCount) activeIndex = 0;
	});

	let creating = $state(false);

	async function createFolderNamed(slug: string) {
		const name = slug.trim();
		if (!isValidSegment(name) || !canCreate || creating || siblingExists(name)) return;
		creating = true;
		try {
			const parent = focusId ? { id: focusId, path: folderPath(focusId, folders) } : null;
			const g = onCreateFolder
				? await onCreateFolder(name, parent)
				: await Group.createFolder(name, createSourceId!, parent ?? undefined);
			folders = [...folders, g];
			pick(g.id);
		} catch (e) {
			loadError = String(e);
		} finally {
			creating = false;
		}
	}

	function toggleCreateMode() {
		createMode = !createMode;
		query = '';
		searchEl?.focus();
	}

	function hasChildren(id: string): boolean {
		return (childrenByParent.get(id)?.length ?? 0) > 0;
	}

	function ancestorPath(folder: FolderNode): string {
		const parts: string[] = [];
		let p = folder.parentGroupId ? byId.get(folder.parentGroupId) : undefined;
		let guard = 0;
		while (p && guard++ < 32) {
			parts.unshift(p.slug);
			p = p.parentGroupId ? byId.get(p.parentGroupId) : undefined;
		}
		return parts.join(' / ');
	}

	function pick(id: string) {
		if (id)
			byId
				.get(id)
				?.touch?.()
				.catch(() => {});
		onChange(id, id ? folderPath(id, folders) : '');
		open = false;
	}

	function focusFolderId(id: string) {
		navDir = 1;
		focusId = id;
		activeIndex = 0;
		query = '';
	}

	function jumpTo(id: string | null) {
		navDir = -1;
		focusId = id;
		activeIndex = 0;
	}

	function goUp() {
		if (!focusId) return;
		const from = focusId;
		navDir = -1;
		focusId = focusFolder?.parentGroupId ?? null;
		const i = navEntries.findIndex((n) => n.kind === 'folder' && n.folder.id === from);
		activeIndex = i >= 0 ? i : 0;
	}

	function revealValue() {
		if (!value) return;
		const target = folders.find((g) => g.id === value);
		if (!target) return;
		focusId = target.parentGroupId ?? null;
		const i = navEntries.findIndex((n) => n.kind === 'folder' && n.folder.id === value);
		if (i >= 0) activeIndex = i;
		queueMicrotask(() => {
			popEl?.querySelector('.folder-row.selected')?.scrollIntoView({ block: 'nearest' });
		});
	}

	function position() {
		if (!anchor || !popEl) return;
		const a = anchor.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		const listEl = popEl.querySelector('.list');
		const clipped = listEl ? listEl.scrollHeight - listEl.clientHeight : 0;
		const naturalH = m.height + clipped;
		const spaceBelow = window.innerHeight - 8 - (a.bottom + margin);
		const spaceAbove = a.top - margin - 8;
		let top: number;
		if (placement === 'below' || naturalH <= spaceBelow || spaceBelow >= spaceAbove) {
			top = a.bottom + margin;
			maxH = spaceBelow;
		} else {
			maxH = spaceAbove;
			top = Math.max(8, a.top - margin - Math.min(naturalH, spaceAbove));
		}
		let left = a.left;
		if (left + m.width > window.innerWidth - 8) {
			left = Math.max(8, a.right - m.width);
		}
		pos = { top, left };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		const entry = navEntries[activeIndex];
		if (e.key === 'Escape') {
			if (createMode) {
				createMode = false;
				query = '';
			} else if (focusId) {
				goUp();
			} else {
				open = false;
			}
			e.preventDefault();
		} else if (e.key === 'Enter' && createMode) {
			e.preventDefault();
			createFolderNamed(query);
		} else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
			e.preventDefault();
			if (navCount > 0) activeIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % navCount;
		} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
			e.preventDefault();
			if (navCount > 0)
				activeIndex = activeIndex < 0 ? navCount - 1 : (activeIndex - 1 + navCount) % navCount;
		} else if (e.key === 'ArrowRight' && !searching) {
			if (entry?.kind !== 'folder') return;
			e.preventDefault();
			focusFolderId(entry.folder.id);
		} else if (e.key === 'ArrowLeft' && !searching) {
			if (!focusId) return;
			e.preventDefault();
			goUp();
		} else if (e.key === 'Enter') {
			if (!entry) return;
			e.preventDefault();
			if (entry.kind === 'create') createFolderNamed(query);
			else if (entry.kind === 'root') pick('');
			else pick(entry.folder.id);
		}
	}

	let wasOpen = false;

	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				query = '';
				createMode = false;
				focusId = null;
				activeIndex = 0;
			});
			const load = loadFolders
				? loadFolders()
				: Group.list().then((gs) => gs.filter((g) => g.groupType === GroupType.Folder));
			load
				.then((fs) => {
					folders = fs;
					loadError = '';
					revealValue();
					queueMicrotask(position);
				})
				.catch((e) => {
					loadError = String(e);
				});
			listSources()
				.then((ss) => (sourceNames = new Map(ss.map((s) => [s.id, sourceName(s)]))))
				.catch(() => {});
			queueMicrotask(() => {
				position();
				searchEl?.focus();
			});
			window.addEventListener('resize', position);
			window.addEventListener('scroll', position, true);
			document.addEventListener('pointerdown', onDocPointerDown);
			document.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('resize', position);
				window.removeEventListener('scroll', position, true);
				document.removeEventListener('pointerdown', onDocPointerDown);
				document.removeEventListener('keydown', onKey);
			};
		}
		if (!isOpen && wasOpen) {
			wasOpen = false;
		}
	});

	$effect(() => {
		query;
		focusId;
		createMode;
		if (open) queueMicrotask(position);
	});
</script>

{#if open}
	<div
		class="pop"
		bind:this={popEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		style:max-height="{maxH}px"
		role="menu"
		tabindex="-1"
	>
		<div class="search-row" class:create={createMode}>
			{#if createMode}
				<FolderPlus size={13} strokeWidth={1.75} />
			{:else}
				<Search size={13} strokeWidth={1.75} />
			{/if}
			<input
				class="search-input"
				class:invalid={createMode &&
					query.trim() !== '' &&
					(!isValidSegment(query) || siblingExists(query))}
				type="text"
				bind:value={query}
				bind:this={searchEl}
				placeholder={createMode
					? focusFolder
						? `New folder in ${focusFolder.slug}…`
						: 'New folder name…'
					: 'Search folders…'}
			/>
			{#if canCreate}
				<button
					class="create-toggle"
					class:on={createMode}
					type="button"
					title={createMode ? 'Back to search' : 'New folder'}
					onclick={toggleCreateMode}
				>
					{#if createMode}
						<Search size={13} strokeWidth={1.75} />
					{:else}
						<FolderPlus size={13} strokeWidth={1.75} />
					{/if}
				</button>
			{/if}
		</div>

		{#if loadError}
			<div class="load-error">{loadError}</div>
		{/if}
		<div class="list" onmouseleave={() => (activeIndex = -1)} role="presentation">
			{#if searching}
				{#each searchMatches as folder, i (folder.id)}
					{@const sourceLabel = folder.sourceId ? sourceNames.get(folder.sourceId) : undefined}
					<div
						class="folder-row"
						class:selected={folder.id === value}
						class:active={i === activeIndex}
					>
						<span class="disclosure-spacer"></span>
						<button
							class="folder-name"
							type="button"
							tabindex="-1"
							onclick={() => pick(folder.id)}
							onmouseenter={() => (activeIndex = i)}
						>
							<Folder size={13} strokeWidth={1.75} />
							<span class="name-label">{folder.slug}</span>
							{#if folder.id === value}
								<Check size={13} strokeWidth={2} />
							{/if}
							{#if ancestorPath(folder)}
								<span class="name-path">{ancestorPath(folder)}</span>
							{/if}
							{#if sourceLabel}
								<span class="source-label">{sourceLabel}</span>
							{/if}
						</button>
					</div>
				{/each}
				{#if showCreate}
					<div class="folder-row create" class:active={activeIndex === searchMatches.length}>
						<span class="disclosure-spacer"></span>
						<button
							class="folder-name"
							type="button"
							tabindex="-1"
							onclick={() => createFolderNamed(query)}
							onmouseenter={() => (activeIndex = searchMatches.length)}
						>
							<FolderPlus size={13} strokeWidth={1.75} />
							<span class="name-label">Create folder</span>
							<span class="create-name">{query.trim()}</span>
							<span class="create-hint">{focusFolder ? `in ${focusFolder.slug}` : 'at root'}</span>
						</button>
					</div>
				{:else if searchMatches.length === 0}
					<div class="empty">No folders</div>
				{/if}
			{:else}
				{#if recentFolders.length}
					<div class="section-label">Recent</div>
					{#each recentFolders as folder, i ('r' + folder.id)}
						<div
							class="folder-row"
							class:selected={folder.id === value}
							class:active={i === activeIndex}
						>
							<span class="disclosure-spacer"></span>
							<button
								class="folder-name"
								type="button"
								tabindex="-1"
								onclick={() => pick(folder.id)}
								onmouseenter={() => (activeIndex = i)}
							>
								<Folder size={13} strokeWidth={1.75} />
								<span class="name-label">{folder.slug}</span>
								{#if folder.id === value}
									<Check size={13} strokeWidth={2} />
								{/if}
								{#if ancestorPath(folder)}
									<span class="name-path">{ancestorPath(folder)}</span>
								{/if}
							</button>
						</div>
					{/each}
				{/if}
				{#if recentFolders.length || focusId}
					<div class="section-label all-row">
						<button
							class="crumb-root"
							type="button"
							disabled={!focusId}
							onclick={() => jumpTo(null)}>All folders</button
						>
						{#if focusChain.length > 2}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<span class="crumb-dots">…</span>
						{/if}
						{#if focusChain.length > 1}
							{@const parent = focusChain[focusChain.length - 2]}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<button class="crumb" type="button" onclick={() => jumpTo(parent.id)}
								>{parent.slug}</button
							>
						{/if}
						{#if focusFolder}
							<span class="crumb-sep"><ChevronRight size={9} strokeWidth={2.25} /></span>
							<button
								class="focus-name"
								class:selected={focusId === value}
								type="button"
								title="Use this folder"
								onclick={() => focusId && pick(focusId)}
							>
								<span>{focusFolder.slug}</span>
								{#if focusId === value}
									<Check size={12} strokeWidth={2} />
								{/if}
							</button>
						{/if}
					</div>
				{/if}
				{#key focusId}
					<div class="level" in:fly={{ x: 24 * navDir, duration: 130 }}>
						{#if rootOption && !focusId}
							<div class="folder-row root-row" class:active={activeIndex === recentFolders.length}>
								<span class="disclosure-spacer"></span>
								<button
									class="folder-name"
									type="button"
									tabindex="-1"
									onclick={() => pick('')}
									onmouseenter={() => (activeIndex = recentFolders.length)}
								>
									<Folders size={13} strokeWidth={1.75} />
									<span class="name-label"
										>{rootLabel ?? ((sourceId && sourceNames.get(sourceId)) || 'No folder')}</span
									>
								</button>
							</div>
						{/if}
						{#each levelRows as folder, i (folder.id)}
							{@const navIndex = levelBase + i}
							{@const children = hasChildren(folder.id)}
							{@const sourceLabel = folder.sourceId ? sourceNames.get(folder.sourceId) : undefined}
							<div
								class="folder-row"
								class:selected={folder.id === value}
								class:active={navIndex === activeIndex}
							>
								{#if children}
									<button
										class="disclosure"
										type="button"
										tabindex="-1"
										aria-label="Open folder"
										onclick={() => focusFolderId(folder.id)}
									>
										<ChevronRight size={12} strokeWidth={2} />
									</button>
								{:else}
									<span class="disclosure-spacer"></span>
								{/if}
								<button
									class="folder-name"
									type="button"
									tabindex="-1"
									onclick={() => pick(folder.id)}
									onmouseenter={() => (activeIndex = navIndex)}
								>
									<Folder size={13} strokeWidth={1.75} />
									<span class="name-label">{folder.slug}</span>
									{#if folder.id === value}
										<Check size={13} strokeWidth={2} />
									{/if}
									{#if sourceLabel}
										<span class="source-label">{sourceLabel}</span>
									{/if}
								</button>
							</div>
						{:else}
							<div class="empty">{focusFolder ? 'No folders inside' : 'No folders'}</div>
						{/each}
					</div>
				{/key}
			{/if}
		</div>
	</div>
{/if}

<style>
	.pop {
		position: fixed;
		z-index: 1000;
		width: 320px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.search-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: -4px -4px 4px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--menu-search-divider);
		color: var(--color-ui-muted);
	}

	.search-row :global(svg) {
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
		padding: 0;
	}

	.search-input::placeholder {
		color: var(--color-ui-dulled);
	}

	.search-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.create-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		padding: 3px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
	}

	.create-toggle:hover {
		color: var(--color-text-primary);
	}

	.create-toggle.on {
		color: var(--color-accent);
	}

	.list {
		overflow-y: auto;
		overflow-x: hidden;
		flex: 1;
		scrollbar-width: thin;
		scrollbar-color: var(--menu-scrollbar-thumb) transparent;
	}

	.list::-webkit-scrollbar {
		width: 5px;
	}

	.list::-webkit-scrollbar-track {
		background: transparent;
	}

	.list::-webkit-scrollbar-thumb {
		background: var(--menu-scrollbar-thumb);
		border-radius: 3px;
	}

	.list::-webkit-scrollbar-thumb:hover {
		background: var(--menu-scrollbar-thumb-hover);
	}

	.section-label {
		padding: 6px 10px 2px;
		color: var(--color-ui-dulled);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.all-row {
		display: flex;
		align-items: center;
		gap: 3px;
		min-width: 0;
		height: 28px;
		box-sizing: border-box;
	}

	.crumb-root {
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
		flex-shrink: 0;
	}

	.crumb-root:disabled {
		cursor: default;
	}

	.crumb-root:not(:disabled):hover {
		color: var(--color-text-primary);
	}

	.crumb-sep {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
		opacity: 0.7;
	}

	.crumb-dots {
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.crumb {
		max-width: 70px;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.crumb:hover {
		color: var(--color-text-primary);
	}

	.level {
		min-width: 0;
	}

	.focus-name {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 150px;
		min-width: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		cursor: pointer;
	}

	.focus-name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.focus-name:hover {
		color: var(--color-text-primary);
	}

	.focus-name :global(svg) {
		flex-shrink: 0;
		color: var(--color-accent);
	}

	.folder-row {
		display: flex;
		align-items: stretch;
		border-radius: 5px;
	}

	.disclosure,
	.disclosure-spacer {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		flex-shrink: 0;
		border: 0;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
	}

	.disclosure:hover {
		color: var(--color-text-primary);
	}

	.disclosure-spacer {
		cursor: default;
	}

	.folder-row.selected {
		background: var(--chip-bg);
	}

	.folder-row.active {
		background: var(--menu-item-hover);
	}

	.root-row .name-label {
		color: var(--color-ui-muted);
	}

	.root-row.active .name-label {
		color: var(--color-text-primary);
	}

	.folder-name {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 8px 6px 6px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
	}

	.folder-name :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	/* Highlight is driven by .folder-row.active (set on mouseenter), so hover and
       keyboard nav share one cursor */

	.name-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.name-path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.source-label {
		flex-shrink: 0;
		margin-left: auto;
		padding-left: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.folder-row.create .name-label {
		color: var(--color-ui-muted);
	}

	.create-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.create-hint {
		flex-shrink: 0;
		margin-left: auto;
		padding-left: 8px;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.empty {
		padding: 8px 10px;
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.load-error {
		margin: 0 2px 4px;
		padding: 6px 10px;
		font-size: 11px;
		color: var(--error-fg);
		background: var(--error-bg);
		border-radius: 5px;
	}
</style>
