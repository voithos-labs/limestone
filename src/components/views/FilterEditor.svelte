<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type View from '$lib/models/View.svelte';
	import type { FilterCompound, ViewField, FilterLeaf, FilterNode } from '$lib/models/View.svelte';
	import { VIEW_FIELD_OPS } from '$lib/models/View.svelte';
	import Tag from '$lib/models/Tag';
	import Folder, { folderIdSource, isSourceRoot } from '$lib/models/Folder';
	import { getSource, sourceName } from '$lib/models/Source';
	import {
		getFieldIcon,
		getOpLabel,
		opHasValue,
		formatFilterValue,
		opsFor
	} from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import { Tags, Folder as FolderIcon } from '@lucide/svelte';
	import FilterChipIsland from './FilterChipIsland.svelte';
	import Menu from './Menu.svelte';

	// edits the leaves of one 'and' compound: a view's filter or a face's subfilter
	let {
		view,
		filter,
		label,
		icon,
		showUnit = false
	}: {
		view: View;
		filter: FilterCompound;
		label: string;
		icon?: Component;
		showUnit?: boolean; // a unit view's implicit scope, shown as a chip that can't be edited
	} = $props();
	const Icon = $derived(icon);
	const unitChip = $derived(
		showUnit && view.unit
			? view.unit.startsWith('tag:')
				? { icon: Tags, fieldName: 'Tags', operator: 'any', value: view.slug }
				: { icon: FolderIcon, fieldName: 'Location', operator: 'in', value: view.slug }
			: null
	);

	const fieldsById = $derived(new Map(view.fields.map((f: ViewField) => [f.id, f])));
	const leaves = $derived(
		filter.children.filter((n: FilterNode): n is FilterLeaf => 'field_id' in n)
	);

	// a view scoped to one source narrows every other folder pick to that source
	const sourceScopeLeaf = $derived.by(() => {
		for (const n of view.filter.children) {
			if (!('field_id' in n)) continue;
			const f = fieldsById.get(n.field_id);
			if (
				f?.type === 'folder' &&
				n.op === 'in' &&
				typeof n.value === 'string' &&
				isSourceRoot(n.value)
			)
				return n;
		}
		return undefined;
	});
	const sourceId = $derived(
		sourceScopeLeaf ? folderIdSource(sourceScopeLeaf.value as string) : undefined
	);

	let groupNames: Record<string, string> = $state({});
	let sourceNames: Record<string, string> = $state({});

	$effect(() => {
		const folderIds = new Set<string>();
		const tagIds = new Set<string>();
		const sourceIds = new Set<string>();
		for (const leaf of leaves) {
			const field = fieldsById.get(leaf.field_id);
			if (!field) continue;
			if (field.type === 'folder') {
				if (
					typeof leaf.value === 'string' &&
					(leaf.op === 'in' || leaf.op === 'not_in' || leaf.op === 'is')
				) {
					if (isSourceRoot(leaf.value)) sourceIds.add(folderIdSource(leaf.value));
					else folderIds.add(leaf.value);
				}
			} else if (field.type === 'tags') {
				if (Array.isArray(leaf.value))
					for (const v of leaf.value) if (typeof v === 'string') tagIds.add(v);
			}
		}
		for (const id of folderIds) {
			if (id in groupNames) continue;
			Folder.fromID(id)
				.then((f) => {
					groupNames = { ...groupNames, [id]: f.slug };
				})
				.catch(() => {
					groupNames = { ...groupNames, [id]: id };
				});
		}
		for (const id of tagIds) {
			if (id in groupNames) continue;
			Tag.fromID(id)
				.then((t) => {
					groupNames = { ...groupNames, [id]: t.slug };
				})
				.catch(() => {
					groupNames = { ...groupNames, [id]: id };
				});
		}
		for (const id of sourceIds) {
			if (id in sourceNames) continue;
			getSource(id)
				.then((s) => {
					sourceNames = { ...sourceNames, [id]: sourceName(s) };
				})
				.catch(() => {
					sourceNames = { ...sourceNames, [id]: id };
				});
		}
	});

	function displayValue(leaf: FilterLeaf, field: ViewField | undefined): string | undefined {
		if (!opHasValue(leaf.op)) return undefined;
		if (!field) return formatFilterValue(leaf.value);
		if (field.type === 'tags') {
			const arr = Array.isArray(leaf.value) ? leaf.value : [];
			if (arr.length === 0) return '';
			return arr.map((id) => groupNames[String(id)] ?? String(id)).join(', ');
		}
		if (field.type === 'folder') {
			if (typeof leaf.value !== 'string') return '';
			return groupNames[leaf.value] ?? sourceNames[leaf.value] ?? leaf.value;
		}
		if (field.type === 'boolean') return leaf.value ? 'Checked' : 'Unchecked';
		return formatFilterValue(leaf.value);
	}

	function valuePillsFor(leaf: FilterLeaf, field: ViewField | undefined) {
		if (!field || (leaf.op !== 'any_of' && leaf.op !== 'has_all')) return undefined;
		const vals = Array.isArray(leaf.value)
			? leaf.value.filter((v): v is string => typeof v === 'string')
			: [];
		if (vals.length === 0) return undefined;
		const opts = (field.config?.options ?? []) as { value: string; color: number }[];
		return vals.map((v) => ({ label: v, color: opts.find((o) => o.value === v)?.color ?? 0 }));
	}

	// what kind of value an op takes; the value survives an op change within one kind
	function valueKind(field: ViewField | undefined, op: string): string {
		if (op === 'is_empty' || op === 'is_not_empty') return 'none';
		if (op === 'any_of' || op === 'has_all' || op === 'has_any' || op === 'has_none') return 'list';
		if (field?.type === 'folder')
			return op === 'in' || op === 'not_in' || op === 'is' ? 'folder' : 'text';
		return 'scalar';
	}

	function changeOp(node: FilterLeaf, newOp: string) {
		const field = fieldsById.get(node.field_id);
		const was = valueKind(field, node.op);
		const now = valueKind(field, newOp);
		node.op = newOp;
		if (was !== now && now !== 'none' && was !== 'none') node.value = now === 'list' ? [] : null;
	}

	function changeValue(node: FilterLeaf, v: unknown) {
		node.value = v;
	}

	function removeFilter(node: FilterLeaf) {
		const i = filter.children.indexOf(node);
		if (i >= 0) filter.children.splice(i, 1);
	}

	function defaultValueFor(field: ViewField): unknown {
		return field.type === 'tags' ? [] : null;
	}

	let pendingFocusLeaf: FilterLeaf | null = $state(null);

	function addByField(fieldId: string) {
		const field = view.fields.find((f: ViewField) => f.id === fieldId);
		if (!field) return;
		const ops = VIEW_FIELD_OPS[field.type] ?? [];
		const op = ops[0] ?? 'eq';
		filter.children.push({ field_id: field.id, op, value: defaultValueFor(field) });
		pendingFocusLeaf = filter.children[filter.children.length - 1] as FilterLeaf;
	}

	const fieldPickerItems = $derived(
		view.fields.map((f: ViewField) => ({
			value: f.id,
			label: fieldLabel(f),
			icon: getFieldIcon(f.type)
		}))
	);

	let addEl: HTMLButtonElement | null = $state(null);
	let addOpen = $state(false);
</script>

<div class="ff-head">
	{#if Icon}<Icon size={12} strokeWidth={2} />{/if}
	<span>{label}</span>
	<button
		class="ff-add"
		type="button"
		aria-label="Add filter"
		title="Add filter"
		bind:this={addEl}
		onclick={() => (addOpen = !addOpen)}
	>
		<Plus size={14} strokeWidth={2} />
	</button>
</div>
<div class="ff">
	{#if unitChip}
		<div class="ff-chip">
			<FilterChipIsland
				icon={unitChip.icon}
				fieldName={unitChip.fieldName}
				operator={unitChip.operator}
				value={unitChip.value}
			/>
		</div>
	{/if}
	{#each leaves as leaf (leaf)}
		{@const field = fieldsById.get(leaf.field_id)}
		<div class="ff-chip">
			<FilterChipIsland
				icon={getFieldIcon(field?.type)}
				fieldName={field ? fieldLabel(field) : 'unknown'}
				operator={getOpLabel(leaf.op)}
				opValue={leaf.op}
				opOptions={opsFor(field?.type)}
				value={displayValue(leaf, field)}
				valuePills={valuePillsFor(leaf, field)}
				rawValue={leaf.value}
				{field}
				sourceId={leaf === sourceScopeLeaf ? undefined : sourceId}
				autoOpenValue={leaf === pendingFocusLeaf}
				onOpChange={(op) => changeOp(leaf, op)}
				onValueChange={(v) => changeValue(leaf, v)}
				onRemove={() => removeFilter(leaf)}
			/>
		</div>
	{/each}
</div>

<Menu
	bind:open={addOpen}
	anchor={addEl}
	items={fieldPickerItems}
	onSelect={addByField}
	searchable={fieldPickerItems.length > 7}
	placeholder="Search fields…"
	minWidth={180}
	placement="right"
/>

<style>
	.ff {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 5px;
		padding: 2px 2px 0;
	}

	/* Clip a wide chip to the menu width; reveal the overflow (extending past the
	   menu's right edge) on hover, keyboard focus, or while a segment is open. */
	.ff-chip {
		position: relative;
		max-width: 100%;
		overflow: hidden;
		border-radius: 6px;
	}

	.ff-chip:hover,
	.ff-chip:focus-within,
	.ff-chip:has(:global(.seg.open)) {
		max-width: none;
		overflow: visible;
		z-index: 5;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.ff-head {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 4px 4px 8px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.ff-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.ff-add:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}
</style>
