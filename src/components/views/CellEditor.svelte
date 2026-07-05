<script lang="ts">
	import type { ViewField } from '$lib/models/View.svelte';
	import SelectOptionEditor from './SelectOptionEditor.svelte';
	import FolderValueEditor from './FolderValueEditor.svelte';
	import FilterValueEditor from './FilterValueEditor.svelte';

	let {
		open = $bindable(false),
		anchor,
		field,
		value,
		sourceId,
		onChange,
		onRenameOption
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		field: ViewField;
		value: unknown;
		sourceId?: string;
		onChange: (value: unknown, folderDir?: string) => void;
		onRenameOption?: (oldValue: string, newValue: string) => void;
	} = $props();
</script>

{#if field.type === 'select' || field.type === 'multiselect'}
	<SelectOptionEditor
		bind:open
		{anchor}
		{field}
		{value}
		multiple={field.type === 'multiselect'}
		onChange={(v) => onChange(v)}
		onRenameOption={(oldV, newV) => onRenameOption?.(oldV, newV)}
	/>
{:else if field.type === 'folder'}
	<FolderValueEditor
		bind:open
		{anchor}
		value={typeof value === 'string' ? value : null}
		{sourceId}
		onChange={(id, dir) => {
			onChange(id, dir);
			open = false;
		}}
	/>
{:else}
	<FilterValueEditor
		bind:open
		{anchor}
		{field}
		{value}
		onChange={(v) => {
			onChange(v);
			open = false;
		}}
	/>
{/if}
