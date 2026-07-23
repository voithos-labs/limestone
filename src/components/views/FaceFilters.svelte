<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, ViewField, FilterLeaf, FilterNode } from '$lib/models/View.svelte';
	import { VIEW_FIELD_OPS } from '$lib/models/View.svelte';
	import Group from '$lib/models/Group';
	import { getSource, sourceName } from '$lib/models/Source';
	import {
		getFieldIcon,
		getOpLabel,
		opHasValue,
		formatFilterValue,
		opsFor
	} from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import FilterChipIsland from './FilterChipIsland.svelte';
	import Menu from './Menu.svelte';

	let {
		view,
		face,
		sourceId
	}: {
		view: View;
		face: ViewFace;
		sourceId?: string;
	} = $props();

	const fieldsById = $derived(new Map(view.fields.map((f: ViewField) => [f.id, f])));
	const leaves = $derived(
		face.additive_filter.children.filter((n: FilterNode): n is FilterLeaf => 'field_id' in n)
	);

	let groupNames: Record<string, string> = $state({});
	let sourceNames: Record<string, string> = $state({});

	$effect(() => {
		const groupIds = new Set<string>();
		const sourceIds = new Set<string>();
		for (const leaf of leaves) {
			const field = fieldsById.get(leaf.field_id);
			if (!field) continue;
			if (field.type === 'folder') {
				if (typeof leaf.value === 'string') groupIds.add(leaf.value);
			} else if (field.type === 'tags') {
				if (Array.isArray(leaf.value))
					for (const v of leaf.value) if (typeof v === 'string') groupIds.add(v);
			} else if (field.type === 'source') {
				if (typeof leaf.value === 'string') sourceIds.add(leaf.value);
			}
		}
		for (const id of groupIds) {
			if (id in groupNames) continue;
			Group.fromID(id)
				.then((g) => {
					groupNames = { ...groupNames, [id]: g.slug };
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
			return groupNames[leaf.value] ?? leaf.value;
		}
		if (field.type === 'source') {
			if (typeof leaf.value !== 'string') return '';
			return sourceNames[leaf.value] ?? leaf.value;
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

	function changeOp(node: FilterLeaf, newOp: string) {
		const wasArray = node.op === 'any_of' || node.op === 'has_all';
		const isArray = newOp === 'any_of' || newOp === 'has_all';
		node.op = newOp;
		if (wasArray !== isArray) node.value = isArray ? [] : null;
	}

	function changeValue(node: FilterLeaf, v: unknown) {
		node.value = v;
	}

	function removeFilter(node: FilterLeaf) {
		const i = face.additive_filter.children.indexOf(node);
		if (i >= 0) face.additive_filter.children.splice(i, 1);
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
		face.additive_filter.children.push({ field_id: field.id, op, value: defaultValueFor(field) });
		pendingFocusLeaf = face.additive_filter.children[
			face.additive_filter.children.length - 1
		] as FilterLeaf;
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

<div class="ff">
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
				{sourceId}
				autoOpenValue={leaf === pendingFocusLeaf}
				onOpChange={(op) => changeOp(leaf, op)}
				onValueChange={(v) => changeValue(leaf, v)}
				onRemove={() => removeFilter(leaf)}
			/>
		</div>
	{/each}

	<button class="ff-add" type="button" bind:this={addEl} onclick={() => (addOpen = !addOpen)}>
		<Plus size={14} strokeWidth={1.75} />
		<span>Add filter</span>
	</button>
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
	.ff-chip:has(.seg.open) {
		max-width: none;
		overflow: visible;
		z-index: 5;
		background: var(--color-bg);
		box-shadow: var(--menu-shadow);
	}

	.ff-add {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-ui-muted);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.ff-add:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}

	.ff-add :global(svg) {
		flex-shrink: 0;
	}
</style>
