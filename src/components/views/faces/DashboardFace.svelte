<script lang="ts">
	import { onMount } from 'svelte';
	import View, { ViewFace, VIEW_FIELD_SORTABLE } from '$lib/models/View.svelte';
	import { fieldLabel } from '$lib/views/fieldValue';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import type { FilterNode, ViewField } from '$lib/models/View.svelte';
	import { onSourceReconciled } from '$lib/models/Source';
	import { folderId as makeFolderId, folderIdPath, folderIdSource } from '$lib/models/Folder';
	import { select } from '$lib/services/db';
	import ListFace from './ListFace.svelte';
	import SectionHead from '../SectionHead.svelte';
	import {
		ArrowDown,
		ArrowUp,
		Hash,
		Folder as FolderIcon,
		ChevronDown,
		ChevronRight,
		GripVertical,
		EyeOff,
		Trash2
	} from '@lucide/svelte';
	import { contextMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { dashboardSections, DASH_SECTION_LABEL, type DashSection } from '$lib/views/dashboard';
	import Folder from '$lib/models/Folder';
	import { toasts } from '$lib/toasts.svelte';
	import { listSavedViewJSON } from '$lib/models/View.svelte';
	import FolderChips from '../FolderChips.svelte';
	import {
		ExternalLink,
		Bookmark,
		LayoutArrowDown,
		Settings2,
		ArrowDownUp,
		ArrowUpAZ,
		ArrowDownAZ
	} from '@lucide/svelte';
	import ArrangeFields from '../ArrangeFields.svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { getSource, type Source } from '$lib/models/Source';

	// A project at a glance: its tags as a chip row that scopes everything below, its todos as a
	// checklist, and its other notes most recent first. Each section is an ordinary list face
	// over this view, built here and never saved, so it inherits the view's fields and scope
	let {
		view,
		face,
		onOpenRow,
		onOpenUnit
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string, newTab?: boolean) => void;
		onOpenUnit?: (id: string, name: string) => void;
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
	const selectedTag = $derived(
		face.config.hide_chips ? null : ((view.state.dash_tag as string | undefined) ?? null)
	);

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

	// ── The sections, as list faces that live only here ────────────────────
	const todoFace = ViewFace.create('list');
	const doneFace = ViewFace.create('list');
	const notesFace = ViewFace.create('list');

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

	$effect(() => {
		const l = layoutFor('todo_layout', {
			display: [doneId, titleId, tagsId, folderId, dueId].filter(Boolean),
			right: [folderId, dueId]
		});
		todoFace.display_field_ids = [...l.display];
		todoFace.config.right = [...l.right];
		todoFace.config.hide_tag = TODO;
		todoFace.config.edit_in_place = true;
		todoFace.additive_filter = {
			op: 'and',
			children: [
				{ field_id: tagsId, op: 'has_any', value: [TODO] },
				{ field_id: doneId, op: 'eq', value: false }
			]
		};
		const sort = sortFor('todo_sort', { field_id: dueId, direction: 'asc' });
		const manual = sort.field_id === MANUAL;
		todoFace.sort = [
			{ ...(manual ? { field_id: dueId, direction: 'asc' as const } : sort), nulls: 'last' }
		];
		todoFace.config.order = manual ? [...((face.config.todo_order as string[]) ?? [])] : undefined;

		doneFace.display_field_ids = [...l.display];
		doneFace.config.right = [...l.right];
		doneFace.config.hide_tag = TODO;
		doneFace.config.edit_in_place = true;
		doneFace.additive_filter = {
			op: 'and',
			children: [
				{ field_id: tagsId, op: 'has_any', value: [TODO] },
				{ field_id: doneId, op: 'eq', value: true }
			]
		};
		doneFace.sort = [{ field_id: updatedId, direction: 'desc' }];
	});

	$effect(() => {
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
		const sort = sortFor('docs_sort', { field_id: updatedId, direction: 'desc' });
		const manual = sort.field_id === MANUAL;
		notesFace.sort = [manual ? { field_id: updatedId, direction: 'desc' } : sort];
		notesFace.config.order = manual ? [...((face.config.docs_order as string[]) ?? [])] : undefined;
	});

	// each section sorts on its own key, chosen from the section menu or the header
	type Sort = { field_id: string; direction: 'asc' | 'desc' };
	const MANUAL = 'manual';
	function sortFor(key: string, def: Sort): Sort {
		const saved = face.config[key] as Sort | undefined;
		if (!saved?.field_id) return def;
		if (saved.field_id === MANUAL) return saved;
		return view.fields.some((f) => f.id === saved.field_id) ? saved : def;
	}

	// a drag writes the section's order and makes it the sort; newcomers land at the end
	function onReorder(section: 'todo' | 'docs', ids: string[]) {
		face.config[`${section}_order`] = ids;
		const cur = face.config[`${section}_sort`] as Sort | undefined;
		if (cur?.field_id !== MANUAL) {
			face.config[`${section}_sort`] = { field_id: MANUAL, direction: 'asc' };
		}
	}
	function sortEntries(key: 'todo_sort' | 'docs_sort'): CtxEntry[] {
		const cur = sorts[key];
		const set = (next: Sort) => (face.config[key] = next);
		return [
			{
				label: 'Manual',
				icon: GripVertical,
				checked: cur.field_id === MANUAL,
				keepOpen: true,
				action: () => set({ field_id: MANUAL, direction: 'asc' })
			},
			{ divider: true },
			...view.fields
				.filter((f) => VIEW_FIELD_SORTABLE.has(f.type))
				.filter((f) => (key === 'docs_sort' ? f.unit !== TODO : f.id !== doneId))
				.map((f): CtxEntry => ({
					label: fieldLabel(f),
					icon: getFieldIcon(f.type),
					checked: cur.field_id === f.id,
					keepOpen: true,
					action: () => set({ field_id: f.id, direction: cur.direction })
				})),
			{ divider: true },
			{
				label: 'Ascending',
				icon: ArrowUpAZ,
				checked: cur.direction === 'asc',
				keepOpen: true,
				action: () => set({ field_id: cur.field_id, direction: 'asc' })
			},
			{
				label: 'Descending',
				icon: ArrowDownAZ,
				checked: cur.direction === 'desc',
				keepOpen: true,
				action: () => set({ field_id: cur.field_id, direction: 'desc' })
			}
		];
	}
	const sorts = $derived({
		todo_sort: sortFor('todo_sort', { field_id: dueId, direction: 'asc' }),
		docs_sort: sortFor('docs_sort', { field_id: updatedId, direction: 'desc' })
	});
	function sortLabel(sort: Sort): string {
		const f = view.fields.find((x) => x.id === sort.field_id);
		return f ? fieldLabel(f).toLowerCase() : 'manual';
	}

	$effect(() => persistLayout('todo_layout', todoFace));
	$effect(() => persistLayout('docs_layout', notesFace));

	let arrangeOpen = $state(false);
	let arrangeFace: ViewFace = $state(todoFace);

	// counts for the section headers
	let openCount = $state(0);
	let doneCount = $state(0);
	let notesCount = $state(0);
	let recount = $state(0);
	$effect(() => onSourceReconciled(() => recount++));
	$effect(() => {
		void tagScope;
		void view.filter;
		void recount;
		view
			.countMembers({ face: todoFace, scope: tagScope })
			.then((n) => (openCount = n))
			.catch(() => {});
		view
			.countMembers({ face: doneFace, scope: tagScope })
			.then((n) => (doneCount = n))
			.catch(() => {});
		view
			.countMembers({ face: notesFace, scope: tagScope })
			.then((n) => (notesCount = n))
			.catch(() => {});
	});

	// ── Folders: the project's subfolders, projects among them first ────────────
	let allFolders: Folder[] = $state([]);
	let projects: Map<string, { emoji: string }> = $state(new Map());
	let source: Source | null = $state(null);

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
			},
			{ divider: true },
			confirmChipDelete === f.id
				? { label: 'Confirm delete', icon: Trash2, danger: true, action: () => deleteChip(f) }
				: {
						label: 'Delete folder',
						icon: Trash2,
						keepOpen: true,
						action: () => (confirmChipDelete = f.id)
					}
		];
	}

	let confirmChipDelete: string | null = $state(null);
	$effect(() => {
		if (!contextMenu.open) confirmChipDelete = null;
	});

	async function deleteChip(f: Folder) {
		confirmChipDelete = null;
		try {
			await Folder.delete(folderIdSource(f.id), folderIdPath(f.id));
			await loadFolders();
		} catch (e) {
			toasts.push(Folder.describeOpError(e, "That folder couldn't be deleted."));
		}
	}

	const query = $derived(((view.state.search as string | undefined) ?? '').trim().toLowerCase());
	const folderBase = $derived(selectedTag?.startsWith('folder:') ? selectedTag : view.unit);
	const underBase = (f: Folder) => {
		if (!folderBase?.startsWith('folder:')) return false;
		const base = folderIdPath(folderBase);
		return (
			folderIdSource(f.id) === folderIdSource(folderBase) &&
			folderIdPath(f.id).startsWith(base ? `${base}/` : '')
		);
	};
	const subfolders = $derived.by(() => {
		if (query)
			return allFolders
				.filter((f) => underBase(f) && f.slug.toLowerCase().includes(query))
				.sort((a, b) => a.slug.localeCompare(b.slug));
		if (selectedTag && selectedTag !== folderBase) return [];
		return allFolders.filter((f) => f.parentId === folderBase);
	});
	const relDir = (f: Folder) => {
		const base = folderBase ? folderIdPath(folderBase) : '';
		const p = folderIdPath(f.id);
		const rel = base ? p.slice(base.length + 1) : p;
		return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
	};

	// ── Sections: order, collapsed, hidden, all on the face ─────────────────────
	// under a search or a chip, a section with nothing to show steps aside; the lists report
	// what's left
	const searching = $derived(!!query);
	const narrowed = $derived(searching || !!selectedTag);
	let todoTotal = $state(-1);
	let doneTotal = $state(-1);
	let notesTotal = $state(-1);
	$effect(() => {
		void view.state.search;
		void selectedTag;
		todoTotal = -1;
		doneTotal = -1;
		notesTotal = -1;
	});
	const sections = $derived(dashboardSections(face));
	const visible = $derived(
		sections.filter((s) => {
			if (s.hidden) return false;
			if (s.id === 'folders') return subfolders.length > 0;
			if (s.id === 'done' && !searching && doneCount === 0) return false;
			if (!narrowed) return true;
			const total = s.id === 'todo' ? todoTotal : s.id === 'done' ? doneTotal : notesTotal;
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
	{#if !face.config.hide_chips && chips.length > 0}
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
			<button
				class="chips-hide"
				type="button"
				title="Hide quick filters"
				aria-label="Hide quick filters"
				onclick={() => (face.config.hide_chips = true)}
			>
				<EyeOff size={13} strokeWidth={1.75} />
			</button>
		</div>
	{/if}

	{#each visible as sec (sec.id)}
		<section data-id={sec.id} class:dragging={dragId === sec.id}>
			<div class="sec">
				<SectionHead
					title={DASH_SECTION_LABEL[sec.id]}
					count={sec.id === 'todo'
						? searching && todoTotal >= 0
							? todoTotal
							: `${openCount} open`
						: sec.id === 'done'
							? searching && doneTotal >= 0
								? doneTotal
								: doneCount
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
						{#if sec.id === 'docs' || sec.id === 'todo'}
							{@const key = sec.id === 'docs' ? 'docs_sort' : 'todo_sort'}
							{@const sort = sorts[key]}
							<button
								class="sec-action"
								type="button"
								onclick={(e) =>
									contextMenu.showAt(e.currentTarget as HTMLElement, () => sortEntries(key))}
							>
								{sortLabel(sort)}
								{#if sort.field_id !== MANUAL}{#if sort.direction === 'asc'}<ArrowUp
											size={12}
											strokeWidth={2}
										/>{:else}<ArrowDown size={12} strokeWidth={2} />{/if}{/if}
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
							onOpen={(f) => onOpenUnit?.(f.id, f.slug)}
							context={folderContext}
						/>
					</div>
				{:else if sec.id === 'todo'}
					<ListFace
						{view}
						face={todoFace}
						{onOpenRow}
						scope={tagScope}
						autoFocus={false}
						onTotal={(n) => (todoTotal = n)}
						onReorder={(ids) => onReorder('todo', ids)}
					/>
				{:else if sec.id === 'done'}
					<ListFace
						{view}
						face={doneFace}
						{onOpenRow}
						scope={tagScope}
						autoFocus={false}
						onTotal={(n) => (doneTotal = n)}
					/>
				{:else}
					<ListFace
						{view}
						face={notesFace}
						{onOpenRow}
						scope={tagScope}
						autoFocus={false}
						onTotal={(n) => (notesTotal = n)}
						onReorder={(ids) => onReorder('docs', ids)}
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

	.chips {
		display: flex;
		flex-wrap: nowrap;
		gap: 6px;
		margin: 0 24px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chips-hide {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.chips-hide:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
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
		background: var(--accent-a14);
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
