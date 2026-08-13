<script lang="ts">
	import { untrack } from 'svelte';
	import { Hash, Search, Plus, Pencil, Trash2, ArrowLeft } from '@lucide/svelte';
	import Group, { GroupType } from '$lib/models/Group';

	let {
		open = $bindable(false),
		anchor,
		selectedIds = [],
		onToggle,
		onCreate,
		onMutated,
		width = 240
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		selectedIds?: string[];
		onToggle: (tag: Group) => void | Promise<void>;
		onCreate?: (slug: string) => void | Promise<void>;
		onMutated?: () => void;
		width?: number;
	} = $props();

	let menuEl: HTMLDivElement | null = $state(null);
	let searchEl: HTMLInputElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });

	let tags: Group[] = $state([]);
	let query = $state('');
	let activeIndex = $state(-1);
	let busy = $state(false);

	let renamingId: string | null = $state(null);
	let renameDraft = $state('');
	let confirmId: string | null = $state(null);

	let browseOrder: string[] = $state([]);

	function snapshotOrder() {
		browseOrder = [...tags]
			.sort(
				(a, b) =>
					Number(selectedIds.includes(b.id)) - Number(selectedIds.includes(a.id)) ||
					a.slug.localeCompare(b.slug)
			)
			.map((t) => t.id);
	}

	const browseTags = $derived.by(() => {
		const rank = new Map(browseOrder.map((id, i) => [id, i]));
		return [...tags].sort(
			(a, b) => (rank.get(a.id) ?? browseOrder.length) - (rank.get(b.id) ?? browseOrder.length)
		);
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return browseTags;
		return tags.filter((t) => t.slug.toLowerCase().includes(q));
	});

	const showCreate = $derived(
		!!onCreate &&
			query.trim() !== '' &&
			!tags.some((t) => t.slug.toLowerCase() === query.trim().toLowerCase())
	);
	const navCount = $derived(filtered.length + (showCreate ? 1 : 0));

	async function reload() {
		try {
			tags = (await Group.list()).filter((g) => g.groupType === GroupType.Tag);
			snapshotOrder();
		} catch (e) {
			console.error('load tags failed', e);
		}
	}

	async function create() {
		const slug = query.trim();
		if (!slug || !onCreate || busy) return;
		query = '';
		try {
			await onCreate(slug);
		} catch (e) {
			console.error('create tag failed', e);
		}
		await reload();
	}

	function startRename(t: Group) {
		confirmId = null;
		renamingId = t.id;
		renameDraft = t.slug;
	}

	function renameFocus(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function renameInvalid(t: Group): boolean {
		const s = renameDraft.trim();
		if (s === '' || s === t.slug) return false;
		return tags.some((o) => o.id !== t.id && o.slug === s);
	}

	async function commitRename(t: Group) {
		if (renamingId !== t.id) return;
		const s = renameDraft.trim();
		const invalid = renameInvalid(t);
		renamingId = null;
		if (busy || !s || s === t.slug || invalid) return;
		busy = true;
		try {
			await Group.renameTag(t, s);
			await reload();
			onMutated?.();
		} catch (e) {
			console.error('rename tag failed', e);
		} finally {
			busy = false;
		}
	}

	function onRenameKey(e: KeyboardEvent, t: Group) {
		e.stopPropagation();
		if (e.key === 'Enter') commitRename(t);
		else if (e.key === 'Escape') renamingId = null;
	}

	async function confirmDelete(t: Group) {
		if (busy) return;
		busy = true;
		try {
			await Group.deleteTag(t);
			confirmId = null;
			await reload();
			onMutated?.();
		} catch (e) {
			console.error('delete tag failed', e);
		} finally {
			busy = false;
		}
	}

	function position() {
		if (!anchor || !menuEl) return;
		const a = anchor.getBoundingClientRect();
		const m = menuEl.getBoundingClientRect();
		const margin = 4;
		let top = a.bottom + margin;
		let left = a.left;
		if (top + m.height > window.innerHeight - 8) {
			top = Math.max(8, a.top - m.height - margin);
		}
		if (left + m.width > window.innerWidth - 8) {
			left = Math.max(8, a.right - m.width);
		}
		pos = { top, left };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (menuEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (renamingId) return;
		if (e.key === 'Escape') {
			if (confirmId) confirmId = null;
			else open = false;
			e.preventDefault();
			return;
		}
		if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
			activeIndex = navCount === 0 ? -1 : activeIndex < 0 ? 0 : (activeIndex + 1) % navCount;
			e.preventDefault();
		} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
			activeIndex =
				navCount === 0
					? -1
					: activeIndex < 0
						? navCount - 1
						: (activeIndex - 1 + navCount) % navCount;
			e.preventDefault();
		} else if (e.key === 'Enter') {
			if (activeIndex >= 0 && filtered[activeIndex]) onToggle(filtered[activeIndex]);
			else if (showCreate && activeIndex === filtered.length) create();
			e.preventDefault();
		}
	}

	let wasOpen = false;

	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				query = '';
				activeIndex = -1;
				renamingId = null;
				confirmId = null;
				snapshotOrder();
			});
			reload().then(() => queueMicrotask(position));
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

	let hadQuery = false;

	$effect(() => {
		const searching = query.trim() !== '';
		if (hadQuery && !searching) untrack(snapshotOrder);
		hadQuery = searching;
		if (open) queueMicrotask(position);
	});
</script>

{#if open}
	<div
		class="menu"
		class:busy
		bind:this={menuEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		style:width="{width}px"
		role="menu"
		tabindex="-1"
	>
		<div class="search-row">
			<Search size={13} strokeWidth={1.75} />
			<input
				class="search-input"
				type="text"
				bind:value={query}
				bind:this={searchEl}
				placeholder={onCreate ? 'Search or create…' : 'Search tags…'}
			/>
		</div>
		<div class="list" onmouseleave={() => (activeIndex = -1)} role="presentation">
			{#each filtered as t, i (t.id)}
				<div
					class="row"
					class:active={i === activeIndex}
					class:selected={selectedIds.includes(t.id)}
					class:confirming={confirmId === t.id}
					onmouseenter={() => (activeIndex = i)}
					role="presentation"
				>
					{#if renamingId === t.id}
						<span class="name">
							<Hash size={13} strokeWidth={1.75} />
							<input
								class="name-input"
								class:invalid={renameInvalid(t)}
								bind:value={renameDraft}
								use:renameFocus
								onblur={() => commitRename(t)}
								onkeydown={(e) => onRenameKey(e, t)}
								spellcheck="false"
							/>
						</span>
					{:else}
						<button class="name" type="button" tabindex="-1" onclick={() => onToggle(t)}>
							<Hash size={13} strokeWidth={1.75} />
							<span class="name-text">{t.slug}</span>
						</button>
					{/if}

					{#if confirmId === t.id}
						<button
							class="icon-btn"
							type="button"
							aria-label="Cancel"
							onclick={() => (confirmId = null)}
						>
							<ArrowLeft size={14} strokeWidth={2} />
						</button>
						<button class="confirm-btn" type="button" onclick={() => confirmDelete(t)}
							>Confirm</button
						>
					{:else}
						<button
							class="icon-btn"
							type="button"
							aria-label="Rename"
							onclick={() => startRename(t)}
						>
							<Pencil size={13} strokeWidth={1.75} />
						</button>
						<button
							class="icon-btn"
							type="button"
							aria-label="Delete"
							onclick={() => (confirmId = t.id)}
						>
							<Trash2 size={13} strokeWidth={1.75} />
						</button>
						<span class="check" class:shown={selectedIds.includes(t.id)}>
							<span class="dot"></span>
						</span>
					{/if}
				</div>
			{:else}
				{#if !showCreate}
					<div class="empty">No tags yet</div>
				{/if}
			{/each}
			{#if showCreate}
				<div
					class="row create"
					class:active={activeIndex === filtered.length}
					onmouseenter={() => (activeIndex = filtered.length)}
					role="presentation"
				>
					<button class="name" type="button" tabindex="-1" onclick={create}>
						<Plus size={13} strokeWidth={1.75} />
						<span class="name-text">Create "{query.trim()}"</span>
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		z-index: 1000;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.4;
		color: var(--color-text-primary);
		max-height: 360px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.menu.busy {
		cursor: progress;
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

	.list {
		overflow-y: auto;
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

	.row {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: 5px;
	}

	.row.active {
		background: var(--menu-item-hover);
	}

	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 8px 6px 10px;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		border-radius: 5px;
		white-space: nowrap;
	}

	button.name {
		cursor: pointer;
	}

	.name :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.row.selected .name :global(svg) {
		color: var(--color-accent);
	}

	.name-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row.create .name-text {
		color: var(--color-ui-muted);
	}

	.row.create.active .name-text {
		color: var(--color-text-primary);
	}

	.name-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		outline: none;
		font: inherit;
		color: var(--color-text-primary);
		padding: 0;
	}

	.name-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.row:hover .icon-btn,
	.row.confirming .icon-btn {
		opacity: 1;
	}

	.icon-btn:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		flex-shrink: 0;
		visibility: hidden;
	}

	.check.shown {
		visibility: visible;
	}

	.dot {
		width: 5px;
		height: 5px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.row:hover .check {
		display: none;
	}

	.confirm-btn {
		flex-shrink: 0;
		align-self: center;
		height: 24px;
		padding: 0 10px;
		border: 0;
		border-radius: 5px;
		background: var(--error-bg);
		color: var(--error-fg);
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.confirm-btn:hover {
		background: color-mix(in srgb, var(--color-error) 18%, transparent);
	}

	.empty {
		padding: 8px 10px;
		color: var(--color-ui-muted);
		font-size: 12px;
	}
</style>
