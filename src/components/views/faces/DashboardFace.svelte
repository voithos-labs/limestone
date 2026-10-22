<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import View, { ViewFace, VIEW_FIELD_SORTABLE, type SortKey } from '#lib/models/View.svelte.js';
	import { fieldLabel, fieldSections } from '#lib/views/fieldValue.js';
	import { getFieldIcon } from '#lib/views/filterDisplay.js';
	import type { FilterLeaf, FilterNode, ViewField } from '#lib/models/View.svelte.js';
	import { onSourceReconciled } from '#lib/models/Source.js';
	import { folderIdPath, folderIdSource } from '#lib/models/Folder.js';
	import ListFace from './ListFace.svelte';
	import SectionHead from '../SectionHead.svelte';
	import {
		ArrowDown,
		ArrowUp,
		ChevronDown,
		ChevronUp,
		ChevronRight,
		GripVertical,
		EyeOff
	} from '@lucide/svelte';
	import { contextMenu, type CtxEntry } from '#lib/overlays.svelte.js';
	import {
		dashboardSections,
		DASH_SECTION_LABEL,
		type DashSection
	} from '#lib/views/project.svelte.js';
	import Folder from '#lib/models/Folder.js';
	import { listSavedViewJSON } from '#lib/models/View.svelte.js';
	import FolderChips from '../FolderChips.svelte';
	import { LayoutArrowDown, Settings2, ArrowDownUp, ArrowUpAZ, ArrowDownAZ } from '@lucide/svelte';
	import ArrangeFields from '../ArrangeFields.svelte';

	// A project at a glance: its upcoming todos as a checklist and its other notes most recent
	// first, each capped. Each section is an ordinary list face over this view, built here and
	// never saved, so it inherits the view's fields and scope
	let {
		view,
		face,
		scope = null,
		onOpenRow,
		onOpenUnit
	}: {
		view: View;
		face: ViewFace;
		scope?: FilterNode | null;
		onOpenRow?: (rowId: string, newTab?: boolean | 'side') => void;
		onOpenUnit?: (id: string, name: string, newTab?: boolean) => void;
	} = $props();

	const TODO = 'tag:todo';
	const byType = (t: string) => view.fields.find((f: ViewField) => f.type === t);
	const titleId = $derived(byType('title')?.id ?? '');
	const tagsId = $derived(byType('tags')?.id ?? '');
	const updatedId = $derived(byType('updated_at')?.id ?? '');
	const createdId = $derived(byType('created_at')?.id ?? '');
	const folderId = $derived(byType('folder')?.id ?? '');
	const doneId = `${TODO}/done`;
	const dueId = `${TODO}/due`;
	const LIMIT = 7;

	// ── The sections, as list faces that live only here ────────────────────
	const todoFace = ViewFace.create('list');
	const notesFace = ViewFace.create('list');

	// each section sorts on its own key, chosen from the section menu; unset means the default
	type Sort = { field_id: string; direction: 'asc' | 'desc' };
	function sortFor(key: string): Sort | null {
		const saved = face.config[key] as Sort | undefined;
		if (!saved?.field_id) return null;
		return view.fields.some((f) => f.id === saved.field_id) ? saved : null;
	}
	const todoDefault = $derived(
		(
			[
				{ field_id: dueId, direction: 'asc', nulls: 'last' },
				{ field_id: createdId, direction: 'desc' }
			] as SortKey[]
		).filter((k) => k.field_id)
	);
	const docsDefault = $derived<SortKey[]>([{ field_id: updatedId, direction: 'desc' }]);

	// each section's arrangement lives on the dashboard face; the section faces are rebuilt
	// from it, and an arrangement made in the dialog is written back
	type Layout = { display: string[]; right: string[] };
	function layoutFor(key: string, def: Layout): Layout {
		const saved = face.config[key] as Layout | undefined;
		return saved?.display?.length ? saved : def;
	}
	function persistLayout(key: string, f: ViewFace) {
		const next: Layout = { display: [...f.display_field_ids], right: [...(f.config.right ?? [])] };
		const cur = face.config[key] as Layout | undefined;
		if (JSON.stringify(cur) !== JSON.stringify(next)) face.config[key] = next;
	}

	$effect.pre(() => {
		const l = layoutFor('todo_layout', {
			display: [doneId, titleId, tagsId, folderId, dueId].filter(Boolean),
			right: [folderId, dueId]
		});
		todoFace.display_field_ids = [...l.display];
		todoFace.config.right = [...l.right];
		todoFace.config.hide_tag = TODO;
		todoFace.additive_filter = {
			op: 'and',
			children: [
				{ field_id: tagsId, op: 'has_any', value: [TODO] },
				{ field_id: doneId, op: 'eq', value: false }
			]
		};
		const sort = sortFor('todo_sort');
		todoFace.sort = sort ? [{ ...sort, nulls: 'last' }] : [...todoDefault];
	});

	$effect.pre(() => {
		const l = layoutFor('docs_layout', {
			display: [titleId, tagsId, updatedId].filter(Boolean),
			right: [tagsId, updatedId]
		});
		notesFace.display_field_ids = [...l.display];
		notesFace.config.right = [...l.right];
		notesFace.additive_filter = {
			op: 'and',
			children: [{ field_id: tagsId, op: 'has_none', value: [TODO] }]
		};
		const sort = sortFor('docs_sort');
		notesFace.sort = sort ? [sort] : [...docsDefault];
	});
	function sortEntries(key: 'todo_sort' | 'docs_sort'): CtxEntry[] {
		const cur = sorts[key];
		const def = (key === 'todo_sort' ? todoDefault : docsDefault)[0];
		const set = (next: Sort | null) => (face.config[key] = next ?? undefined);
		const dir = cur?.direction ?? def?.direction ?? 'desc';
		const fid = cur?.field_id ?? def?.field_id ?? '';
		return [
			{
				label: 'Default',
				icon: ArrowDownUp,
				checked: !cur,
				keepOpen: true,
				action: () => set(null)
			},
			{ divider: true },
			...fieldSections(
				view.fields
					.filter((f) => VIEW_FIELD_SORTABLE.has(f.type))
					.filter((f) => (key === 'docs_sort' ? f.unit !== TODO : f.id !== doneId))
			).flatMap((s): CtxEntry[] => [
				...(s.label ? [{ divider: true as const, label: s.label }] : []),
				...s.fields.map((f) => ({
					label: fieldLabel(f),
					icon: getFieldIcon(f.type),
					checked: cur?.field_id === f.id,
					keepOpen: true,
					action: () => set({ field_id: f.id, direction: dir })
				}))
			]),
			{ divider: true },
			{
				label: 'Ascending',
				icon: ArrowUpAZ,
				checked: dir === 'asc',
				disabled: !fid,
				keepOpen: true,
				action: () => set({ field_id: fid, direction: 'asc' })
			},
			{
				label: 'Descending',
				icon: ArrowDownAZ,
				checked: dir === 'desc',
				disabled: !fid,
				keepOpen: true,
				action: () => set({ field_id: fid, direction: 'desc' })
			}
		];
	}
	const sorts = $derived({
		todo_sort: sortFor('todo_sort'),
		docs_sort: sortFor('docs_sort')
	});

	const TYPE_RANK: Record<string, number> = { list: 0, kanban: 1, masonry: 2 };
	function hasLeaf(n: FilterNode, ok: (l: FilterLeaf) => boolean): boolean {
		return 'children' in n ? n.children.some((c) => hasLeaf(c, ok)) : ok(n);
	}
	const todoLeaf = (op: string) => (l: FilterLeaf) =>
		l.field_id === tagsId && l.op === op && Array.isArray(l.value) && l.value.includes(TODO);
	function seeAllTarget(section: 'todo' | 'docs'): ViewFace | null {
		const faces = view.faces.filter((f) => f.id !== face.id && f.type in TYPE_RANK);
		const pick = (ok: (f: ViewFace) => boolean) =>
			faces
				.filter(ok)
				.sort(
					(a, b) =>
						a.additive_filter.children.length - b.additive_filter.children.length ||
						TYPE_RANK[a.type] - TYPE_RANK[b.type]
				)[0] ?? null;
		if (section === 'todo') return pick((f) => hasLeaf(f.additive_filter, todoLeaf('has_any')));
		return (
			pick((f) => hasLeaf(f.additive_filter, todoLeaf('has_none'))) ??
			pick((f) => !hasLeaf(f.additive_filter, todoLeaf('has_any')))
		);
	}
	const seeAll = $derived({ todo: seeAllTarget('todo'), docs: seeAllTarget('docs') });

	$effect(() => persistLayout('todo_layout', todoFace));
	$effect(() => persistLayout('docs_layout', notesFace));

	let arrangeOpen = $state(false);
	let arrangeFace: ViewFace = $state(todoFace);

	// counts for the section headers
	let openCount = $state(0);
	let notesCount = $state(0);
	let recount = $state(0);
	$effect(() => onSourceReconciled(() => recount++));
	$effect(() => {
		void view.filter;
		void recount;
		view
			.countMembers({ face: todoFace, scope })
			.then((n) => (openCount = n))
			.catch(() => {});
		view
			.countMembers({ face: notesFace, scope })
			.then((n) => (notesCount = n))
			.catch(() => {});
	});

	// ── Folders: the project's subfolders, projects among them first ────────────
	let allFolders: Folder[] = $state([]);
	let projects: Map<string, { emoji: string }> = $state(new Map());

	async function loadFolders() {
		const unit = view.unit;
		if (!unit || unit.startsWith('tag:')) return;
		try {
			const [all, saved] = await Promise.all([Folder.list(), listSavedViewJSON()]);
			allFolders = all;
			projects = new Map(
				saved
					.filter((v) => v.unit?.startsWith('folder:'))
					.map((v) => [v.unit as string, { emoji: v.emoji ?? '' }])
			);
		} catch (e) {
			console.error('load project folders failed', e);
		}
	}
	onMount(loadFolders);
	$effect(() => onSourceReconciled(loadFolders));

	const query = $derived(((view.state.search as string | undefined) ?? '').trim().toLowerCase());
	const folderBase = $derived(view.subfolder ?? view.unit);
	const underBase = (f: Folder) => {
		if (!folderBase?.startsWith('folder:')) return false;
		const base = folderIdPath(folderBase);
		return (
			folderIdSource(f.id) === folderIdSource(folderBase) &&
			folderIdPath(f.id).startsWith(base ? `${base}/` : '')
		);
	};
	// one row of folders by default; the header offers the rest, and the view remembers it
	// beside the dashboard's other choices
	let foldersShowAll = $state(untrack(() => view.state.folders_all === true));
	$effect(() => {
		const all = foldersShowAll;
		untrack(() => {
			if ((view.state.folders_all === true) !== all) view.state.folders_all = all;
		});
	});
	let foldersHidden = $state(0);

	const subfolders = $derived.by(() => {
		if (query)
			return allFolders
				.filter((f) => underBase(f) && f.slug.toLowerCase().includes(query))
				.sort((a, b) => a.slug.localeCompare(b.slug));
		return allFolders.filter((f) => f.parentId === folderBase);
	});
	const relDir = (f: Folder) => {
		const base = folderBase ? folderIdPath(folderBase) : '';
		const p = folderIdPath(f.id);
		const rel = base ? p.slice(base.length + 1) : p;
		return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
	};

	// ── Sections: order, collapsed, hidden, all on the face ─────────────────────
	// under a search, a section with nothing to show steps aside; the lists report what's left
	const searching = $derived(!!query);
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
			return (s.id === 'todo' ? todoTotal : notesTotal) !== 0;
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
			...(s.id === 'folders'
				? []
				: [
						{
							label: 'Sort by',
							icon: ArrowDownUp,
							children: sortEntries(s.id === 'docs' ? 'docs_sort' : 'todo_sort')
						},
						{
							label: 'Arrange fields',
							icon: LayoutArrowDown,
							action: () => {
								arrangeFace = s.id === 'docs' ? notesFace : todoFace;
								arrangeOpen = true;
							}
						},
						{ divider: true } as CtxEntry
					]),
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
	{#each visible as sec (sec.id)}
		<section data-id={sec.id} class:dragging={dragId === sec.id}>
			<div class="sec">
				<SectionHead
					title={DASH_SECTION_LABEL[sec.id]}
					count={sec.id === 'todo'
						? searching && todoTotal >= 0
							? todoTotal
							: `${openCount} open`
						: sec.id === 'docs'
							? searching && notesTotal >= 0
								? notesTotal
								: notesCount
							: subfolders.length}
					collapsed={sec.collapsed}
					onToggle={() => patch(sec.id, { collapsed: !sec.collapsed })}
					menu={() => sectionMenu(sec)}
				>
					{#snippet lead()}
						<span
							class="grip"
							role="presentation"
							title="Drag to reorder"
							onpointerdown={(e) => armDrag(e, sec.id)}
						>
							<GripVertical size={14} strokeWidth={1.75} />
						</span>
					{/snippet}
					{#snippet tools()}
						<button
							class="sec-cog"
							type="button"
							tabindex="-1"
							aria-label="Section options"
							onclick={(e) => {
								e.stopPropagation();
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								contextMenu.show(r.left, r.bottom + 4, () => sectionMenu(sec));
							}}
						>
							<Settings2 size={13} strokeWidth={1.75} />
						</button>
					{/snippet}
					{#snippet trail()}
						{#if sec.id === 'folders' && !sec.collapsed && (foldersHidden > 0 || foldersShowAll)}
							<button
								class="sec-action"
								type="button"
								onclick={() => (foldersShowAll = !foldersShowAll)}
							>
								{foldersShowAll ? 'fewer' : `${foldersHidden} more`}
								{#if foldersShowAll}<ChevronUp size={12} strokeWidth={2} />{:else}<ChevronDown
										size={12}
										strokeWidth={2}
									/>{/if}
							</button>
						{:else if sec.id !== 'folders' && !sec.collapsed && seeAll[sec.id]}
							{@const target = seeAll[sec.id]!}
							<button
								class="sec-action"
								type="button"
								onclick={() => (view.state.active_face_id = target.id)}
							>
								See all
								<ChevronRight size={12} strokeWidth={2} />
							</button>
						{/if}
					{/snippet}
				</SectionHead>
			</div>
			{#if !sec.collapsed}
				{#if sec.id === 'folders'}
					<div class="strip">
						<FolderChips
							folders={subfolders}
							{projects}
							rows={query ? 99 : 1}
							whereOf={(f) => (query ? relDir(f) : '')}
							onOpen={(f) =>
								projects.has(f.id) ? onOpenUnit?.(f.id, f.slug, true) : (view.state.folder = f.id)}
							onOpenNewTab={(f) => onOpenUnit?.(f.id, f.slug, true)}
							onChanged={loadFolders}
							bind:showAll={foldersShowAll}
							onHidden={(n) => (foldersHidden = n)}
							owner={view.id}
						/>
					</div>
				{:else if sec.id === 'todo'}
					<ListFace
						{view}
						face={todoFace}
						{onOpenRow}
						{scope}
						autoFocus={false}
						reorderable={false}
						limit={LIMIT}
						onTotal={(n) => (todoTotal = n)}
					/>
				{:else}
					<ListFace
						{view}
						face={notesFace}
						{onOpenRow}
						{scope}
						autoFocus={false}
						reorderable={false}
						limit={LIMIT}
						onTotal={(n) => (notesTotal = n)}
					/>
				{/if}
			{/if}
		</section>
	{/each}
</div>

<ArrangeFields bind:open={arrangeOpen} {view} face={arrangeFace} />

<style>
	.dash {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding-top: 8px;
		padding-bottom: 48px;
		font-family: var(--font-ui);
	}

	section {
		display: flex;
		flex-direction: column;
		transition: opacity 100ms ease;
	}

	.strip {
		margin: 4px 24px 6px;
	}

	section.dragging {
		opacity: 0.6;
	}

	.sec {
		margin: 0 24px;
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

	/* the section's menu, on a cog past the caret; only there when the header is hovered */
	.sec-cog {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-left: 2px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 80ms ease,
			background-color 80ms ease;
	}

	.sec:hover .sec-cog {
		opacity: 1;
	}

	.sec-cog:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
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
