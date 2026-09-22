<script lang="ts">
	import { onMount } from 'svelte';
	import View, { ViewFace } from '$lib/models/View.svelte';
	import type { FilterNode, ViewField } from '$lib/models/View.svelte';
	import { onSourceReconciled } from '$lib/models/Source';
	import { folderId as makeFolderId, folderIdPath, folderIdSource } from '$lib/models/Folder';
	import { select } from '$lib/services/db';
	import ListFace from './ListFace.svelte';
	import {
		ArrowDown,
		ArrowUp,
		Hash,
		Folder as FolderIcon,
		ChevronDown,
		ChevronRight,
		GripVertical,
		EyeOff
	} from '@lucide/svelte';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { dashboardSections, DASH_SECTION_LABEL, type DashSection } from '$lib/views/dashboard';
	import Folder from '$lib/models/Folder';
	import { listSavedViewJSON } from '$lib/models/View.svelte';
	import FolderChips from '../FolderChips.svelte';
	import { ExternalLink, Bookmark } from '@lucide/svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { getSource, type Source } from '$lib/models/Source';

	// A project at a glance: its tags as a chip row that scopes everything below, its todos as a
	// checklist, and its other notes most recent first. Each section is an ordinary list face
	// over this view, built here and never saved, so it inherits the view's fields and scope
	let {
		view,
		face,
		onOpenRow,
		onOpenUnit,
		createSignal = 0
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string, newTab?: boolean) => void;
		onOpenUnit?: (id: string, name: string) => void;
		createSignal?: number;
	} = $props();

	const TODO = 'tag:todo';
	const byType = (t: string) => view.fields.find((f: ViewField) => f.type === t);
	const titleId = $derived(byType('title')?.id ?? '');
	const tagsId = $derived(byType('tags')?.id ?? '');
	const updatedId = $derived(byType('updated_at')?.id ?? '');
	const folderId = $derived(byType('folder')?.id ?? '');
	const doneId = `${TODO}/done`;
	const dueId = `${TODO}/due`;

	// ── Chips: what this project's notes are tagged, and which subfolders hold them ──
	type Chip = { id: string; slug: string; n: number; kind: 'tag' | 'folder' };
	let chips: Chip[] = $state([]);
	const selectedTag = $derived((view.state.dash_tag as string | undefined) ?? null);

	async function loadChips() {
		try {
			const scope = view.searchScope();
			const where = `d.deleted_at IS NULL${scope.sql ? ` AND ${scope.sql}` : ''}`;
			const tags = await select<{ id: string; slug: string; n: number }>(
				`SELECT t.id, t.slug, COUNT(*) AS n
                 FROM document_tags dt
                          JOIN tags t ON t.id = dt.tag_id
                          JOIN documents d ON d.id = dt.document_id
                 WHERE ${where}
                 GROUP BY t.id
                 ORDER BY n DESC, t.slug ASC`,
				scope.params
			);
			// notes roll up to the direct subfolder they sit under, however deep
			const folders: Chip[] = [];
			const unit = view.unit;
			if (unit && !unit.startsWith('tag:')) {
				const base = folderIdPath(unit);
				const src = folderIdSource(unit);
				const rows = await select<{ folder_id: string | null; n: number }>(
					`SELECT d.folder_id, COUNT(*) AS n FROM documents d WHERE ${where} GROUP BY d.folder_id`,
					scope.params
				);
				const byChild = new Map<string, number>();
				for (const r of rows) {
					if (!r.folder_id) continue;
					const p = folderIdPath(r.folder_id);
					const rel = base ? (p.startsWith(base + '/') ? p.slice(base.length + 1) : '') : p;
					if (!rel) continue;
					const first = rel.split('/')[0];
					byChild.set(first, (byChild.get(first) ?? 0) + r.n);
				}
				for (const [slug, n] of byChild) {
					folders.push({
						id: makeFolderId(src, base ? `${base}/${slug}` : slug),
						slug,
						n,
						kind: 'folder'
					});
				}
				folders.sort((a, b) => b.n - a.n || a.slug.localeCompare(b.slug));
			}
			chips = [
				...folders,
				...tags.filter((r) => r.id !== TODO).map((r) => ({ ...r, kind: 'tag' as const }))
			];
			if (selectedTag && !chips.some((c) => c.id === selectedTag)) view.state.dash_tag = null;
		} catch (e) {
			console.error('load project chips failed', e);
		}
	}

	onMount(loadChips);
	$effect(() => onSourceReconciled(loadChips));

	// the chosen chip narrows both sections: a tag by membership, a folder by subtree
	const tagScope: FilterNode | null = $derived.by(() => {
		if (!selectedTag) return null;
		if (selectedTag.startsWith('folder:'))
			return folderId ? { field_id: folderId, op: 'in', value: selectedTag } : null;
		return tagsId ? { field_id: tagsId, op: 'has_any', value: [selectedTag] } : null;
	});

	// the row stays one line; vertical wheel scrolls it sideways, no bar drawn
	function onChipsWheel(e: WheelEvent) {
		const el = e.currentTarget as HTMLElement;
		if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
		el.scrollLeft += e.deltaY;
		e.preventDefault();
	}

	// ── The two sections, as list faces that live only here ────────────────────
	const showDone = $derived(face.config.show_done === true);
	const notesByName = $derived(face.config.notes_sort === 'name');

	const todoFace = ViewFace.create('list');
	const notesFace = ViewFace.create('list');

	$effect(() => {
		todoFace.display_field_ids = [doneId, titleId, tagsId, folderId].filter(Boolean);
		todoFace.config.right = [folderId];
		todoFace.config.hide_tag = TODO;
		todoFace.additive_filter = {
			op: 'and',
			children: [
				{ field_id: tagsId, op: 'has_any', value: [TODO] },
				...(showDone ? [] : [{ field_id: doneId, op: 'eq', value: false }])
			]
		};
		todoFace.sort = [{ field_id: dueId, direction: 'asc', nulls: 'last' }];
	});

	$effect(() => {
		notesFace.display_field_ids = [titleId, tagsId, updatedId].filter(Boolean);
		notesFace.config.right = [tagsId, updatedId];
		notesFace.additive_filter = {
			op: 'and',
			children: [{ field_id: tagsId, op: 'has_none', value: [TODO] }]
		};
		notesFace.sort = notesByName
			? [{ field_id: titleId, direction: 'asc' }]
			: [{ field_id: updatedId, direction: 'desc' }];
	});

	// counts for the section headers
	let openCount = $state(0);
	let notesCount = $state(0);
	$effect(() => {
		void showDone;
		void tagScope;
		void view.filter;
		const openFace = ViewFace.create('list', [], {
			op: 'and',
			children: [
				{ field_id: tagsId, op: 'has_any', value: [TODO] },
				{ field_id: doneId, op: 'eq', value: false }
			]
		});
		view
			.countMembers({ face: openFace, scope: tagScope })
			.then((n) => (openCount = n))
			.catch(() => {});
		view
			.countMembers({ face: notesFace, scope: tagScope })
			.then((n) => (notesCount = n))
			.catch(() => {});
	});

	// the bar's "+" adds a todo; that's what a project most often needs quickly
	const todoSignal = $derived(createSignal);

	// ── Folders: the project's subfolders, projects among them first ────────────
	let subfolders: Folder[] = $state([]);
	let projects: Map<string, { emoji: string }> = $state(new Map());
	let source: Source | null = $state(null);

	async function loadFolders() {
		const unit = view.unit;
		if (!unit || unit.startsWith('tag:')) return;
		try {
			const [all, saved] = await Promise.all([Folder.list(), listSavedViewJSON()]);
			subfolders = all.filter((f) => f.parentId === unit);
			projects = new Map(
				saved
					.filter((v) => v.unit?.startsWith('folder:'))
					.map((v) => [v.unit as string, { emoji: v.emoji ?? '' }])
			);
			if (!source) source = await getSource(folderIdSource(unit));
		} catch (e) {
			console.error('load project folders failed', e);
		}
	}
	onMount(loadFolders);
	$effect(() => onSourceReconciled(loadFolders));

	function folderContext(f: Folder): CtxEntry[] {
		const isProject = projects.has(f.id);
		return [
			{ label: 'Open', icon: ChevronRight, action: () => onOpenUnit?.(f.id, f.slug) },
			{
				label: 'Reveal in file manager',
				icon: ExternalLink,
				action: () => {
					if (source) revealItemInDir(`${source.path}/${folderIdPath(f.id)}`).catch(console.error);
				}
			},
			{ divider: true },
			{
				label: isProject ? 'Stop being a project' : 'Turn into project',
				icon: Bookmark,
				action: () => {
					View.forUnit(f.id, f.slug)
						.then((v) => (isProject ? v.unsave() : v.save()))
						.then(loadFolders)
						.catch(console.error);
				}
			}
		];
	}

	// ── Sections: order, collapsed, hidden, all on the face ─────────────────────
	// under a search, a section with nothing to show steps aside; the lists report what
	// the search left them
	const searching = $derived(!!(view.state.search as string | undefined)?.trim());
	let todoTotal = $state(-1);
	let notesTotal = $state(-1);
	$effect(() => {
		void view.state.search;
		todoTotal = -1;
		notesTotal = -1;
	});
	const sections = $derived(dashboardSections(face));
	const visible = $derived(
		sections.filter((s) => {
			if (s.hidden) return false;
			if (s.id === 'folders') return subfolders.length > 0;
			if (!searching) return true;
			const total = s.id === 'todo' ? todoTotal : notesTotal;
			return total !== 0;
		})
	);

	function patch(id: string, p: Partial<DashSection>) {
		face.config.sections = sections.map((s) => (s.id === id ? { ...s, ...p } : s));
	}

	function move(id: string, dir: -1 | 1) {
		const order = [...sections];
		const i = order.findIndex((s) => s.id === id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= order.length) return;
		[order[i], order[j]] = [order[j], order[i]];
		face.config.sections = order;
	}

	function sectionMenu(s: DashSection): CtxEntry[] {
		return [
			{
				label: s.collapsed ? 'Expand' : 'Collapse',
				icon: s.collapsed ? ChevronDown : ChevronRight,
				action: () => patch(s.id, { collapsed: !s.collapsed })
			},
			{ divider: true },
			{
				label: 'Move up',
				icon: ArrowUp,
				action: () => move(s.id, -1),
				disabled: sections[0]?.id === s.id
			},
			{
				label: 'Move down',
				icon: ArrowDown,
				action: () => move(s.id, 1),
				disabled: sections.at(-1)?.id === s.id
			},
			{ divider: true },
			{ label: 'Hide section', icon: EyeOff, action: () => patch(s.id, { hidden: true }) }
		];
	}

	// drag by the grip. The dragged section is carried as a box the pointer holds at the same
	// spot it was grabbed; it swaps with a neighbour when its leading edge passes that
	// neighbour's midpoint, which is how the tab strip (and most apps) do it
	const DRAG_PX = 4;
	let dashEl: HTMLDivElement | null = $state(null);
	let arm: { id: string; y: number; grab: number; height: number } | null = null;
	let dragId: string | null = $state(null);

	function armDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		e.preventDefault();
		const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('section[data-id]');
		const r = el?.getBoundingClientRect();
		arm = { id, y: e.clientY, grab: r ? e.clientY - r.top : 0, height: r?.height ?? 0 };
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
	}

	function onDragMove(e: PointerEvent) {
		if (!arm) return;
		if (!dragId) {
			if (Math.abs(e.clientY - arm.y) < DRAG_PX) return;
			dragId = arm.id;
		}
		const els = Array.from(dashEl?.querySelectorAll<HTMLElement>('section[data-id]') ?? []);
		const cur = els.findIndex((el) => el.dataset.id === dragId);
		if (cur < 0) return;
		const top = e.clientY - arm.grab;
		const bottom = top + arm.height;
		let next = cur;
		for (let i = cur + 1; i < els.length; i++) {
			const r = els[i].getBoundingClientRect();
			if (bottom > r.top + r.height / 2) next = i;
			else break;
		}
		for (let i = cur - 1; i >= 0; i--) {
			const r = els[i].getBoundingClientRect();
			if (top < r.top + r.height / 2) next = i;
			else break;
		}
		if (next !== cur) {
			const order = [...sections];
			const fromIdx = order.findIndex((s) => s.id === dragId);
			const [moved] = order.splice(fromIdx, 1);
			const target = els[next].dataset.id;
			const toIdx = order.findIndex((s) => s.id === target);
			order.splice(next > cur ? toIdx + 1 : toIdx, 0, moved);
			face.config.sections = order;
		}
	}

	function onDragUp() {
		arm = null;
		dragId = null;
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
	}
</script>

<div class="dash" bind:this={dashEl}>
	{#if !face.config.hide_chips}
		<div class="chips" onwheel={onChipsWheel}>
			<button
				class="chip"
				class:on={!selectedTag}
				type="button"
				onclick={() => (view.state.dash_tag = null)}
			>
				all
			</button>
			{#each chips as c (c.id)}
				<button
					class="chip"
					class:on={selectedTag === c.id}
					type="button"
					onclick={() => (view.state.dash_tag = selectedTag === c.id ? null : c.id)}
				>
					{#if c.kind === 'folder'}<FolderIcon size={11} strokeWidth={1.75} />{:else}<Hash
							size={11}
							strokeWidth={2}
						/>{/if}{c.slug}
					<span class="n">{c.n}</span>
				</button>
			{/each}
		</div>
	{/if}

	{#each visible as sec (sec.id)}
		<section data-id={sec.id} class:dragging={dragId === sec.id}>
			<header class="sec" use:ctxMenu={() => sectionMenu(sec)}>
				<span
					class="grip"
					role="presentation"
					title="Drag to reorder"
					onpointerdown={(e) => armDrag(e, sec.id)}
				>
					<GripVertical size={14} strokeWidth={1.75} />
				</span>
				<button
					class="sec-head"
					type="button"
					onclick={() => patch(sec.id, { collapsed: !sec.collapsed })}
				>
					<span class="sec-title">{DASH_SECTION_LABEL[sec.id]}</span>
					<span class="sec-count">
						{sec.id === 'todo'
							? searching && todoTotal >= 0
								? todoTotal
								: `${openCount} open`
							: sec.id === 'docs'
								? searching && notesTotal >= 0
									? notesTotal
									: notesCount
								: subfolders.length}
					</span>
					<span class="sec-caret" class:collapsed={sec.collapsed}>
						<ChevronDown size={13} strokeWidth={2} />
					</span>
				</button>
				<span class="sec-rule"></span>
				{#if sec.id === 'todo'}
					<button
						class="sec-action"
						type="button"
						onclick={() => (face.config.show_done = !showDone)}
					>
						{showDone ? 'hide done' : 'show done'}
					</button>
				{:else if sec.id === 'docs'}
					<button
						class="sec-action"
						type="button"
						onclick={() => (face.config.notes_sort = notesByName ? 'recent' : 'name')}
					>
						{notesByName ? 'name' : 'recent'}
						{#if notesByName}<ArrowUp size={12} strokeWidth={2} />{:else}<ArrowDown
								size={12}
								strokeWidth={2}
							/>{/if}
					</button>
				{/if}
			</header>
			{#if !sec.collapsed}
				{#if sec.id === 'folders'}
					<div class="strip">
						<FolderChips
							folders={subfolders}
							{projects}
							rows={1}
							onOpen={(f) => onOpenUnit?.(f.id, f.slug)}
							context={folderContext}
						/>
					</div>
				{:else if sec.id === 'todo'}
					<ListFace
						{view}
						face={todoFace}
						{onOpenRow}
						createSignal={todoSignal}
						scope={tagScope}
						autoFocus={false}
						onTotal={(n) => (todoTotal = n)}
					/>
				{:else}
					<ListFace
						{view}
						face={notesFace}
						{onOpenRow}
						scope={tagScope}
						autoFocus={false}
						onTotal={(n) => (notesTotal = n)}
					/>
				{/if}
			{/if}
		</section>
	{/each}
</div>

<style>
	.dash {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding-bottom: 48px;
		font-family: var(--font-ui);
	}

	.chips {
		display: flex;
		flex-wrap: nowrap;
		gap: 6px;
		margin: 0 24px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chips::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex-shrink: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 24px;
		padding: 0 9px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			background-color 100ms ease,
			color 100ms ease,
			border-color 100ms ease;
	}

	.chip:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.chip.on {
		border-color: transparent;
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		color: var(--color-accent);
	}

	.chip .n {
		margin-left: 4px;
		font-size: 10.5px;
		color: var(--color-ui-muted);
	}

	.chip.on .n {
		color: inherit;
		opacity: 0.7;
	}

	section {
		display: flex;
		flex-direction: column;
		transition: opacity 100ms ease;
	}

	/* a quiet rule runs the header row out from the title to its action */
	.sec-rule {
		flex: 1;
		height: 1px;
		margin: 0 14px 0 10px;
		background: var(--chip-divider);
	}

	.strip {
		margin: 4px 24px 6px;
	}

	section.dragging {
		opacity: 0.6;
	}

	.sec {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0 24px 4px;
	}

	/* the grip lives in the gutter so headers still line up with rows */
	.grip {
		display: inline-flex;
		align-items: center;
		width: 14px;
		margin-left: -18px;
		color: var(--color-ui-muted);
		opacity: 0;
		cursor: grab;
		transition: opacity 80ms ease;
	}

	.sec:hover .grip {
		opacity: 0.7;
	}

	.grip:hover {
		opacity: 1 !important;
	}

	.sec-head {
		display: inline-flex;
		align-items: baseline;
		gap: 8px;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		cursor: pointer;
	}

	.sec-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.sec-count {
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	.sec-caret {
		display: inline-flex;
		align-self: center;
		color: var(--color-ui-muted);
		opacity: 0;
		transition:
			opacity 80ms ease,
			transform 120ms ease;
	}

	.sec:hover .sec-caret,
	.sec-caret.collapsed {
		opacity: 1;
	}

	.sec-caret.collapsed {
		transform: rotate(-90deg);
	}

	.sec-action {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		padding: 2px 6px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.sec-action:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}
</style>
