<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		Search,
		FileText,
		Folder as FolderIcon,
		FolderInput,
		Hash,
		TextAlignStart,
		CornerDownLeft,
		SlashSquare,
		LayoutPanelTop,
		ChevronRight,
		Bookmark
	} from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type Session from '$lib/models/Session.svelte.js';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import type { SearchResult } from '$lib/types/SearchResult';
	import { searchDocuments } from '$lib/services/search';
	import { select } from '$lib/services/db';
	import { listSources, sourceName, getSource, touchSource, type Source } from '$lib/models/Source';
	import DocHandle from '$lib/models/DocHandle';
	import Tag from '$lib/models/Tag';
	import Folder, { folderId, folderIdPath, folderIdSource } from '$lib/models/Folder';
	import View, { listSavedViewJSON } from '$lib/models/View.svelte';
	import { actions, type Action } from '$lib/actions';
	import { highlightTitle } from '$lib/util/highlight';
	import { palette } from '$lib/palette.svelte';
	import { openProjectSetup } from '$lib/views/projectSetup';
	import { getViewIcon } from '$lib/views/filterDisplay';

	let { session }: { session: Session } = $props();
	const editor = $derived(session.editors[0]);

	// ── Items: one shape for everything the list can hold ─────────────────────
	type Item = {
		id: string;
		label: string;
		hint?: string; // where it is, or what it does
		icon: Component;
		emoji?: string;
		kind: 'doc' | 'view' | 'folder' | 'tag' | 'source' | 'command';
		match?: number[];
		run: (newTab: boolean) => void | Promise<void>;
	};
	type Section = { title: string; items: Item[] };

	let query = $state('');
	let inputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let active = $state(0);
	let sources: Source[] = $state([]);
	let hits: SearchResult[] = $state([]);
	let recentDocs: { id: string; title: string; rel_path: string; source_id: string }[] = $state([]);
	let projects: View[] = $state([]);

	const trimmed = $derived(query.trim());
	const commandMode = $derived(trimmed.startsWith('/'));
	const commandQuery = $derived(commandMode ? trimmed.slice(1).trim().toLowerCase() : '');

	// ── Commands ──────────────────────────────────────────────────────────────
	// the create family is the palette's own; the rest are the app's actions
	// the palette opens things fresh, in their own tab; ⌘↵ instead navigates the current tab,
	// which is what puts a back card on the result
	function openContent(next: TabState, inPlace: boolean) {
		const tab = editor.focusedTab;
		if (inPlace && tab) {
			if (next.content.type === 'markdown') editor.showDocInTab(tab, next.content.handle);
			else if (next.content.type === 'view') editor.showViewInTab(tab, next.content.view);
			return;
		}
		editor.openTab(next);
		editor.focusTab({ kind: 'tab', id: next.id });
	}

	async function newDoc(newTab: boolean) {
		const doc = await DocHandle.createDraft();
		if (doc) openContent(TabState.forDoc(doc), newTab);
	}

	const createCommands: Item[] = [
		{
			id: 'new:project',
			label: 'New project',
			hint: 'A journal, a todo list, a place for notes',
			icon: LayoutPanelTop,
			kind: 'command',
			run: () => openProjectSetup(editor)
		},
		{
			id: 'new:doc',
			label: 'New document',
			hint: 'A blank note in your default source',
			icon: FileText,
			kind: 'command',
			run: newDoc
		}
	];

	const SKIP_ACTIONS = new Set(['tab.new', 'tab.next', 'tab.prev', 'palette.open', 'doc.new']);
	function actionItem(a: Action): Item {
		return {
			id: `act:${a.id}`,
			label: a.title,
			hint: a.defaultKeys?.[0]?.replace('mod', '⌘').replace('arrowleft', '←'),
			icon: SlashSquare,
			kind: 'command',
			run: () => a.run(session)
		};
	}
	const appCommands = $derived(actions.filter((a) => !SKIP_ACTIONS.has(a.id)).map(actionItem));

	// ── Search results into items ─────────────────────────────────────────────
	function srcOf(id: string | null): string {
		if (!id) return '';
		const s = sources.find((x) => x.id === id);
		return s ? sourceName(s) : '';
	}

	function dirOf(rel: string | null): string {
		if (!rel) return '';
		return rel.split('/').slice(0, -1).join(' / ');
	}

	function resultItem(r: SearchResult): Item {
		const where = [srcOf(r.source_id), dirOf(r.rel_path)].filter(Boolean).join(' / ');
		if (r.kind === 'view') {
			return {
				id: r.id,
				label: r.title,
				hint: where || 'view',
				icon: Bookmark,
				emoji: r.emoji,
				kind: 'view',
				match: r.match_indices,
				run: async (newTab) => {
					const saved = (await View.listSaved()).find((v) => v.id === r.id);
					if (saved) openContent(TabState.forView(saved), newTab);
				}
			};
		}
		if (r.kind === 'group') {
			const isFolder = r.group_type === 'folder';
			return {
				id: r.id,
				label: r.title,
				hint: isFolder
					? [srcOf(r.source_id), dirOf(folderIdPath(r.id))].filter(Boolean).join(' / ') || 'folder'
					: 'tag',
				icon: isFolder ? FolderIcon : Hash,
				kind: isFolder ? 'folder' : 'tag',
				match: r.match_indices,
				run: async (newTab) => {
					const g = isFolder ? await Folder.fromID(r.id) : await Tag.fromID(r.id);
					g.touch();
					openContent(TabState.forView(await View.forUnit(g.id, g.slug)), newTab);
				}
			};
		}
		if (r.kind === 'source') {
			return {
				id: r.id,
				label: r.title,
				hint: 'source',
				icon: FolderInput,
				kind: 'source',
				match: r.match_indices,
				run: async (newTab) => {
					const s = await getSource(r.id);
					touchSource(s.id);
					openContent(
						TabState.forView(await View.forUnit(folderId(s.id, ''), sourceName(s))),
						newTab
					);
				}
			};
		}
		return {
			id: r.id,
			label: r.title,
			hint: where,
			icon: TextAlignStart,
			kind: 'doc',
			match: r.match_indices,
			run: async (newTab) => openContent(TabState.forDoc(await DocHandle.fromID(r.id)), newTab)
		};
	}

	const sections = $derived.by((): Section[] => {
		if (commandMode) {
			const q = commandQuery;
			const inNew = q === 'new' || q.startsWith('new ');
			const rest = inNew ? q.slice(3).trim() : q;
			const pool = inNew ? createCommands : [...createCommands, ...appCommands];
			const found = pool.filter((c) => !rest || c.label.toLowerCase().includes(rest));
			return [{ title: inNew ? 'Create' : 'Commands', items: found }];
		}
		if (!trimmed) {
			const out: Section[] = [];
			if (recentDocs.length) {
				out.push({
					title: 'Recent',
					items: recentDocs.map((d) => ({
						id: d.id,
						label: d.title,
						hint: [srcOf(d.source_id), dirOf(d.rel_path)].filter(Boolean).join(' / '),
						icon: TextAlignStart,
						kind: 'doc' as const,
						run: async (newTab) =>
							openContent(TabState.forDoc(await DocHandle.fromID(d.id)), newTab)
					}))
				});
			}
			if (projects.length) {
				out.push({
					title: 'Projects',
					items: projects.map((v) => ({
						id: v.id,
						label: v.slug,
						hint: v.unit?.startsWith('folder:')
							? [srcOf(folderIdSource(v.unit)), dirOf(folderIdPath(v.unit))]
									.filter(Boolean)
									.join(' / ')
							: 'view',
						icon: getViewIcon(v),
						emoji: v.emoji,
						kind: 'view' as const,
						run: (newTab) => openContent(TabState.forView(v), newTab)
					}))
				});
			}
			out.push({ title: 'Create', items: createCommands });
			return out;
		}
		const q = trimmed.toLowerCase();
		const out: Section[] = [];
		const items = hits.map(resultItem);
		// a handful of each: the palette is for the thing you have in mind, not a listing
		const places = items.filter((i) => i.kind !== 'doc').slice(0, 5);
		const docs = items.filter((i) => i.kind === 'doc').slice(0, 8);
		if (places.length) out.push({ title: 'Places', items: places });
		if (docs.length) out.push({ title: 'Documents', items: docs });
		const cmds = [...createCommands, ...appCommands].filter((c) =>
			c.label.toLowerCase().includes(q)
		);
		if (cmds.length) out.push({ title: 'Commands', items: cmds.slice(0, 4) });
		return out;
	});

	const flat = $derived(sections.flatMap((s) => s.items));

	// ── Loading ───────────────────────────────────────────────────────────────
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let token = 0;

	async function search(q: string) {
		const t = ++token;
		if (!q || q.startsWith('/')) {
			hits = [];
			return;
		}
		const ql = q.toLowerCase();
		const [docs, saved] = await Promise.all([
			searchDocuments(q),
			listSavedViewJSON().catch(() => [])
		]);
		if (t !== token) return;
		const views: SearchResult[] = saved
			.filter((v) => v.slug.toLowerCase().includes(ql))
			.map((v) => ({
				id: v.id,
				title: v.slug,
				rel_path: v.unit?.startsWith('folder:') ? folderIdPath(v.unit) : null,
				source_id: v.unit?.startsWith('folder:') ? folderIdSource(v.unit) : null,
				score: 0,
				match_indices: [],
				kind: 'view' as const,
				group_type: null,
				emoji: v.emoji
			}));
		const units = new Set(saved.map((v) => v.unit).filter((u): u is string => !!u));
		hits = [...views, ...docs.filter((r) => !(r.kind === 'group' && units.has(r.id)))].slice(0, 30);
	}

	$effect(() => {
		const q = trimmed;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => search(q), 20);
		active = 0;
	});

	// each part on its own, so one failing doesn't blank the others
	async function loadIdle() {
		listSources()
			.then((s) => (sources = s))
			.catch((e) => console.error('palette sources failed', e));
		View.listSaved()
			.then((saved) => {
				projects = saved
					.filter((v) => !!v.unit)
					.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime())
					.slice(0, 4);
			})
			.catch((e) => console.error('palette projects failed', e));
		// recent means recently opened, which the documents table tracks itself
		select<{ id: string; title: string; rel_path: string; source_id: string }>(
			`SELECT id, title, rel_path, source_id FROM documents
			 WHERE deleted_at IS NULL ORDER BY accessed_at DESC LIMIT 6`
		)
			.then((rows) => (recentDocs = rows))
			.catch((e) => console.error('palette recents failed', e));
	}

	// ── Open / close ──────────────────────────────────────────────────────────
	$effect(() => {
		if (!palette.open) return;
		untrack(() => {
			query = palette.initial;
			active = 0;
		});
		loadIdle();
		tick().then(() => {
			inputEl?.focus();
			inputEl?.setSelectionRange(query.length, query.length);
		});
	});

	async function pick(item: Item, newTab: boolean) {
		palette.close();
		try {
			await item.run(newTab);
		} catch (e) {
			console.error('palette action failed', e);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			palette.close();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (flat.length) active = (active + 1) % flat.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (flat.length) active = (active - 1 + flat.length) % flat.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = flat[active];
			if (item) pick(item, e.ctrlKey || e.metaKey);
		}
	}

	$effect(() => {
		void active;
		const el = listEl?.querySelector<HTMLElement>('[data-active]');
		el?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#if palette.open}
	<div class="overlay" role="presentation" onmousedown={() => palette.close()}>
		<div
			class="palette"
			role="dialog"
			aria-label="Search and commands"
			tabindex="-1"
			onmousedown={(e) => e.stopPropagation()}
			onkeydown={onKey}
		>
			<div class="field">
				{#if commandMode}
					<span class="mode"><ChevronRight size={18} strokeWidth={2.25} /></span>
				{:else}
					<Search size={17} strokeWidth={1.75} />
				{/if}
				<input
					class="input"
					bind:this={inputEl}
					bind:value={query}
					placeholder="Search, or type / for commands"
					spellcheck="false"
					autocomplete="off"
				/>
				<kbd class="esc">esc</kbd>
			</div>

			<div class="list" bind:this={listEl}>
				{#if flat.length === 0}
					<div class="empty">{commandMode ? 'No such command' : 'Nothing found'}</div>
				{/if}
				{#each sections as sec (sec.title)}
					{#if sec.items.length}
						<div class="sec">{sec.title}</div>
						{#each sec.items as item (item.id)}
							{@const i = flat.indexOf(item)}
							{@const Icon = item.icon}
							<button
								class="row"
								class:active={i === active}
								data-active={i === active ? '' : undefined}
								type="button"
								onmouseenter={() => (active = i)}
								onclick={(e) => pick(item, e.ctrlKey || e.metaKey)}
							>
								<span class="icon" class:cmd={item.kind === 'command'}>
									{#if item.emoji}<span class="emoji">{item.emoji}</span>{:else}<Icon
											size={15}
											strokeWidth={1.75}
										/>{/if}
								</span>
								<span class="label">
									{#if item.match?.length}{@html highlightTitle(
											item.label,
											item.match
										)}{:else}{item.label}{/if}
								</span>
								{#if item.hint}<span class="hint">{item.hint}</span>{/if}
								<span class="enter"><CornerDownLeft size={12} strokeWidth={2} /></span>
							</button>
						{/each}
					{/if}
				{/each}
			</div>

			<div class="foot">
				<span><kbd>↑↓</kbd> move</span>
				<span><kbd>↵</kbd> open</span>
				<span><kbd>⌘↵</kbd> open here</span>
				<span class="grow"></span>
				<span><kbd>/</kbd> commands</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 1400;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
		background: rgba(0, 0, 0, 0.32);
	}

	.palette {
		display: flex;
		flex-direction: column;
		width: 600px;
		max-width: calc(100vw - 32px);
		/* a fixed height: the content changes with every keystroke, the frame never does */
		height: min(520px, 70vh);
		border-radius: 12px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
		overflow: hidden;
		outline: none;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 52px;
		padding: 0 16px 0 18px;
		border-bottom: 1px solid var(--menu-search-divider);
		color: var(--color-ui-muted);
	}

	.mode {
		display: inline-flex;
		color: var(--color-accent);
	}

	.input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font: inherit;
		font-size: 15px;
		color: var(--color-text-primary);
		outline: none;
	}

	.input::placeholder {
		color: var(--color-ui-dulled);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		height: 18px;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
		font-size: 10.5px;
		color: var(--color-ui-muted);
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 6px 8px;
		scrollbar-width: none;
	}

	.list::-webkit-scrollbar {
		display: none;
	}

	.sec {
		padding: 10px 10px 4px;
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.sec:first-child {
		padding-top: 4px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: 7px;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row.active {
		background: var(--menu-item-hover);
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		color: var(--color-ui-muted);
	}

	.icon.cmd {
		background: transparent;
	}

	.row.active .icon {
		color: var(--color-text-primary);
	}

	.emoji {
		font-size: 13px;
		line-height: 1;
	}

	.label {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 13.5px;
	}

	.label :global(mark) {
		background: transparent;
		color: var(--color-accent);
		font-weight: 600;
	}

	.hint {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.enter {
		display: inline-flex;
		margin-left: auto;
		color: var(--color-ui-dulled);
		opacity: 0;
	}

	.row.active .enter {
		opacity: 1;
	}

	.empty {
		padding: 22px 10px;
		text-align: center;
		color: var(--color-ui-muted);
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 34px;
		padding: 0 14px;
		border-top: 1px solid var(--menu-search-divider);
		font-size: 11.5px;
		color: var(--color-ui-muted);
	}

	.foot span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.grow {
		flex: 1;
	}
</style>
