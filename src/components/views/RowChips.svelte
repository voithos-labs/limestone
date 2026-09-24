<script lang="ts">
	import { Check } from '@lucide/svelte';
	import type { MemberRow, ViewField } from '$lib/models/View.svelte';
	import { isDerived } from '$lib/models/View.svelte';
	import {
		fieldLabel,
		folderDir,
		rawArrayValue,
		rawStatefulValue,
		statefulValue,
		titleFor,
		valueFor
	} from '$lib/views/fieldValue';
	import { formatDateCompact } from '$lib/views/dateFormat';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import { listPrefixed } from '$lib/views/listLayout';
	import type { FaceRows } from '$lib/views/FaceRows.svelte';
	import CellValue from './CellValue.svelte';

	// One lane of a row's fields. A value is drawn only when the row has it, unless the face
	// edits in place, where an empty field shows its label so it can be set. Prefixed values
	// (see listLayout) sit in a chip so the pair reads as one thing
	let {
		row,
		fields,
		rows,
		editMode = false,
		compact = false,
		onEdit,
		onTags
	}: {
		row: MemberRow;
		fields: ViewField[];
		rows: FaceRows;
		editMode?: boolean;
		compact?: boolean; // cards: dates without a time of day
		onEdit?: (row: MemberRow, field: ViewField, anchor: HTMLElement) => void;
		onTags?: (row: MemberRow, anchor: HTMLElement) => void;
	} = $props();

	// the view's own scope is left out: every note here has it
	const tags = $derived(rows.tagSlugsFor(row.id).filter((t) => !rows.hiddenTags.has(t)));
	const inScopeDir = $derived(rows.scopeDir !== null && folderDir(row.rel_path) === rows.scopeDir);

	function hasValue(f: ViewField): boolean {
		switch (f.type) {
			case 'tags':
				return tags.length > 0;
			case 'folder':
				return !inScopeDir && valueFor(f, row) !== '';
			case 'select':
				return statefulValue(row, f) !== '';
			case 'multiselect':
				return rawArrayValue(row, f).length > 0;
			case 'boolean':
				return rawStatefulValue(row, f) === true;
			default: {
				const v = valueFor(f, row);
				return v !== '' && v !== '—';
			}
		}
	}

	const isDate = (f: ViewField) =>
		f.type === 'date' || f.type === 'created_at' || f.type === 'updated_at';
	const editable = (f: ViewField) => editMode && (f.type === 'tags' || !isDerived(f.type));

	function onClick(e: MouseEvent, f: ViewField) {
		if (!editable(f)) return;
		e.stopPropagation();
		const anchor = e.currentTarget as HTMLElement;
		if (f.type === 'tags') onTags?.(row, anchor);
		else if (f.type === 'boolean') rows.toggle(row, f);
		else onEdit?.(row, f, anchor);
	}
</script>

{#each fields as f (f.id)}
	{@const has = hasValue(f)}
	{#if rows.memberOf(row, f) && (has || editable(f))}
		{@const Icon = getFieldIcon(f.type)}
		<span
			class="value"
			class:chip={listPrefixed(f.type)}
			class:date={isDate(f)}
			class:empty={!has}
			class:tag-slot={f.type === 'tags' && !has}
			class:editable={editable(f)}
			role="presentation"
			title={titleFor(f, row)}
			onclick={(e) => onClick(e, f)}
		>
			{#if (listPrefixed(f.type) && f.type !== 'folder') || !has}
				{#if isDerived(f.type)}
					<span class="prefix icon"><Icon size={13} strokeWidth={1.75} /></span>
				{:else}
					<span class="prefix label">{fieldLabel(f)}</span>
				{/if}
			{/if}
			{#if f.type === 'boolean'}
				<span class="box" class:on={has}><Check size={10} strokeWidth={3} /></span>
			{:else if !has}
				{#if f.type !== 'tags'}<span class="none">—</span>{/if}
			{:else if compact && isDate(f)}
				{formatDateCompact(
					f.type === 'created_at'
						? row.created_at
						: f.type === 'updated_at'
							? row.updated_at
							: (rawStatefulValue(row, f) as string)
				)}
			{:else}
				<CellValue field={f} {row} sources={rows.sources} {tags} />
			{/if}
		</span>
	{/if}
{/each}

<style>
	.value {
		flex: 0 1 auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		max-width: 100%;
		border-radius: 5px;
		white-space: nowrap;
		overflow: hidden;
		color: var(--color-text-secondary);
	}

	/* a long value truncates inside its chip rather than pushing past the row or card */
	.value > :global(*:last-child) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.value.chip {
		height: 22px;
		padding: 0 8px;
		border-radius: 6px;
		background: var(--chip-bg);
		font-size: 13px;
	}

	.value.tag-slot {
		justify-content: center;
		width: 28px;
		height: 22px;
		border-radius: 999px;
		background: var(--chip-bg);
	}

	.value.tag-slot:hover {
		background: var(--chip-bg-hover);
	}

	.value.editable {
		cursor: pointer;
	}

	.value.chip.editable:hover {
		background: var(--chip-bg-hover);
	}

	/* bare pills brighten on hover rather than getting a box drawn behind the group */
	.value.editable:not(.chip):hover {
		filter: brightness(1.12);
	}

	/* placeholders for unset fields appear with the row, not before it */
	.value.empty {
		opacity: 0;
		transition: opacity 80ms ease;
	}

	:global(.row:hover) .value.empty,
	:global(.row:focus-within) .value.empty,
	:global(.card:hover) .value.empty,
	:global(.card:focus-within) .value.empty {
		opacity: 0.55;
	}

	.value.empty:hover {
		opacity: 1 !important;
	}

	.value.date {
		font-size: 13px;
		color: var(--color-ui-muted);
		font-variant-numeric: tabular-nums;
	}

	.value.date:not(.chip) {
		min-width: 56px;
		justify-content: flex-end;
	}

	.prefix {
		display: inline-flex;
		align-items: center;
		color: var(--color-ui-muted);
	}

	.prefix.label {
		font-size: 12px;
	}

	.prefix.label::after {
		content: ':';
	}

	.none {
		color: var(--color-ui-muted);
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border: 1.5px solid var(--color-ui-muted);
		border-radius: 4px;
		color: transparent;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
	}

	.box.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	/* every chip-shaped thing in a row is 22px tall */
	.value :global(.pill),
	.value :global(.tag) {
		height: 22px;
		padding-top: 0;
		padding-bottom: 0;
		line-height: 22px;
		font-size: 12px;
	}

	.value :global(.pills) {
		display: inline-flex;
		gap: 6px;
	}
</style>
