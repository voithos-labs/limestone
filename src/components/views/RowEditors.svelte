<script lang="ts">
	import {
		ArrowUpRight,
		SquareArrowOutUpRight,
		SquareCheck,
		SquareMinus,
		Trash2
	} from '@lucide/svelte';
	import type View from '$lib/models/View.svelte';
	import type { MemberRow, ViewField } from '$lib/models/View.svelte';
	import type Tag from '$lib/models/Tag';
	import type { FaceRows, RowTag } from '$lib/views/FaceRows.svelte';
	import { rawStatefulValue } from '$lib/views/fieldValue';
	import CellEditor from './CellEditor.svelte';
	import CellTextEditor from './CellTextEditor.svelte';
	import TagMenu from './TagMenu.svelte';
	import Menu from './Menu.svelte';

	// The popovers a face needs once, whatever it draws its rows as: the value editor, the tag
	// menu, and the row menu (from a button, or at the pointer on right-click)
	let {
		view,
		rows,
		onOpen
	}: { view: View; rows: FaceRows; onOpen?: (rowId: string, newTab?: boolean) => void } = $props();

	// ── Value editor ───────────────────────────────────────────────────────────
	let editing: { rowId: string; fieldId: string } | null = $state(null);
	let editAnchor: HTMLElement | null = $state(null);
	let editOpen = $state(false);
	const editingRow = $derived(rows.rows.find((r) => r.id === editing?.rowId));
	const editingField = $derived(view.fields.find((f) => f.id === editing?.fieldId));
	const editingValue = $derived(
		editingRow && editingField ? rawStatefulValue(editingRow, editingField) : null
	);

	export function edit(row: MemberRow, field: ViewField, anchor: HTMLElement) {
		if (editOpen && editing?.rowId === row.id && editing?.fieldId === field.id) {
			editOpen = false;
			return;
		}
		editing = { rowId: row.id, fieldId: field.id };
		editAnchor = anchor;
		editOpen = true;
	}

	// ── Tags: edit a snapshot, since a change can drop the row out of the view ──
	let tagMenuOpen = $state(false);
	let tagMenuAnchor: HTMLElement | null = $state(null);
	let tagRowId: string | null = $state(null);
	let tagDraft: RowTag[] = $state([]);

	export function tags(row: MemberRow, anchor: HTMLElement) {
		tagRowId = row.id;
		tagDraft = [...(rows.rowTags[row.id] ?? [])];
		tagMenuAnchor = anchor;
		tagMenuOpen = true;
	}

	async function applyTags(slugs: string[]) {
		const rowId = tagRowId;
		if (!rowId) return;
		const next = await rows.setTags(rowId, slugs);
		if (!next) tagMenuOpen = false;
		else if (tagRowId === rowId) tagDraft = next;
	}

	function toggleTag(tag: Tag) {
		const has = tagDraft.some((t) => t.id === tag.id);
		tagDraft = has
			? tagDraft.filter((t) => t.id !== tag.id)
			: [...tagDraft, { id: tag.id, slug: tag.slug }];
		applyTags(tagDraft.map((t) => t.slug));
	}

	function createTag(slug: string) {
		const s = slug.trim();
		if (!s || tagDraft.some((t) => t.slug === s)) return;
		applyTags([...tagDraft.map((t) => t.slug), s]);
	}

	// ── Row menu ───────────────────────────────────────────────────────────────
	let menuOpen = $state(false);
	let menuAnchor: HTMLElement | null = $state(null);
	let menuRowId: string | null = $state(null);
	let ctxEl: HTMLElement | null = $state(null);
	let ctxPos: { x: number; y: number } = $state({ x: 0, y: 0 });
	const menuIsTodo = $derived(!!menuRowId && rows.tagSlugsFor(menuRowId).includes('todo'));
	let confirmDelete = $state(false);
	$effect(() => {
		if (!menuOpen) confirmDelete = false;
	});
	const menuItems = $derived([
		{ value: 'open', label: 'Open', icon: ArrowUpRight },
		{ value: 'open-tab', label: 'Open in new tab', icon: SquareArrowOutUpRight },
		{ kind: 'divider' as const },
		menuIsTodo
			? { value: 'untodo', label: 'Remove from #todo', icon: SquareMinus }
			: { value: 'todo', label: 'Add to #todo', icon: SquareCheck },
		{ kind: 'divider' as const },
		confirmDelete
			? { value: 'confirm-delete', label: 'Confirm delete', icon: Trash2, danger: true }
			: { value: 'delete', label: 'Delete', icon: Trash2, keepOpen: true }
	]);

	// from a button it hangs off the button; from a right-click it opens at the pointer
	export function menu(e: MouseEvent, rowId: string) {
		e.preventDefault();
		e.stopPropagation();
		if (e.type === 'contextmenu') {
			ctxPos = { x: e.clientX, y: e.clientY };
			menuAnchor = ctxEl;
		} else {
			menuAnchor = e.currentTarget as HTMLElement;
		}
		menuRowId = rowId;
		menuOpen = true;
	}

	async function onMenuSelect(value: string) {
		if (value === 'delete') {
			confirmDelete = true;
			return;
		}
		menuOpen = false;
		const rowId = menuRowId;
		menuRowId = null;
		if (!rowId) return;
		if (value === 'open') onOpen?.(rowId);
		else if (value === 'open-tab') onOpen?.(rowId, true);
		else if (value === 'todo') await rows.setTags(rowId, [...rows.tagSlugsFor(rowId), 'todo']);
		else if (value === 'untodo')
			await rows.setTags(
				rowId,
				rows.tagSlugsFor(rowId).filter((s) => s !== 'todo')
			);
		else if (value === 'confirm-delete') await rows.delete(rowId);
	}

	// a reload can drop the row a popover was opened on
	$effect(() => {
		const ids = new Set(rows.rows.map((r) => r.id));
		if (menuOpen && menuRowId && !ids.has(menuRowId)) menuOpen = false;
		if (tagMenuOpen && tagRowId && !ids.has(tagRowId)) tagMenuOpen = false;
		if (editOpen && editing && !ids.has(editing.rowId)) editOpen = false;
	});
</script>

{#if editingField && editingRow}
	{#if editingField.type === 'text'}
		<CellTextEditor
			bind:open={editOpen}
			anchor={editAnchor}
			value={editingValue == null ? '' : String(editingValue)}
			onCommit={(v) => editingRow && editingField && rows.writeCell(editingRow, editingField, v)}
		/>
	{:else}
		<CellEditor
			bind:open={editOpen}
			anchor={editAnchor}
			field={editingField}
			value={editingValue}
			sourceId={editingRow.source_id}
			onChange={(v) => editingRow && editingField && rows.writeCell(editingRow, editingField, v)}
			onRenameOption={(oldV, newV) =>
				editingField && view.renameOption(editingField, oldV, newV).then(() => rows.load(true))}
		/>
	{/if}
{/if}

<TagMenu
	bind:open={tagMenuOpen}
	anchor={tagMenuAnchor}
	selectedIds={tagDraft.map((t) => t.id)}
	onToggle={toggleTag}
	onCreate={createTag}
	onMutated={() => rows.load(true)}
/>

<span class="ctx-anchor" bind:this={ctxEl} style:top="{ctxPos.y}px" style:left="{ctxPos.x}px"
></span>
<Menu
	bind:open={menuOpen}
	anchor={menuAnchor}
	items={menuItems}
	onSelect={onMenuSelect}
	minWidth={160}
/>

<style>
	.ctx-anchor {
		position: fixed;
		width: 0;
		height: 0;
		pointer-events: none;
	}
</style>
