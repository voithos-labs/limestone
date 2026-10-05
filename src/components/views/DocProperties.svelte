<script lang="ts">
	import { reportError, type ReportError } from '$lib/errors';
	import type DocHandle from '$lib/models/DocHandle';
	import View from '$lib/models/View.svelte';
	import type { ViewField, MemberRow } from '$lib/models/View.svelte';
	import {
		BUILTIN_UNITS,
		isBuiltinUnit,
		isDerived,
		describeBulkFailure
	} from '$lib/models/View.svelte';
	import { fieldLabel, withStatefulValue, rawStatefulValue } from '$lib/views/fieldValue';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import CellValue from './CellValue.svelte';
	import CellEditor from './CellEditor.svelte';
	import CellTextEditor from './CellTextEditor.svelte';
	import { registerFlush } from '$lib/util/flush';
	import { Box } from '@lucide/svelte';
	import { onMount, onDestroy, untrack } from 'svelte';

	// The toggle lives in the document header's meta bar, so open state and the
	// field count are owned by the parent; this renders the panel only.
	let {
		handle,
		open = false,
		inline = false,
		onCount,
		onError = reportError
	}: {
		handle: DocHandle;
		open?: boolean;
		inline?: boolean;
		onCount?: (n: number) => void;
		onError?: ReportError;
	} = $props();

	type Entry = { view: View; fields: ViewField[] };

	let entries: Entry[] = $state([]);
	let row: MemberRow | null = $state(null);

	const fieldCount = $derived(entries.reduce((n, e) => n + e.fields.length, 0));

	$effect(() => {
		onCount?.(fieldCount);
	});

	async function load() {
		try {
			// saved views show their own fields; a built-in unit shows its registry fields once,
			// and only when the note is a member
			const views = [
				...(await View.listSaved()),
				...(await Promise.all(
					Object.keys(BUILTIN_UNITS).map((id) => View.forUnit(id, id.slice('tag:'.length)))
				))
			];
			const found: Entry[] = [];
			let hit: MemberRow | null = null;
			for (const view of views) {
				if (view.unit === 'tag:todo') continue; // the hero's todo card draws these
				const own = view.unit && isBuiltinUnit(view.unit) ? view.fields : view.ownFields;
				const fields = own.filter((f) => !isDerived(f.type));
				if (fields.length === 0) continue;
				const members = (await view.getMembers({ ids_in: [handle.id] })) as MemberRow[];
				if (members.length === 0) continue;
				hit ??= members[0];
				found.push({ view, fields });
			}
			entries = found;
			row = hit;
		} catch (e) {
			console.error('load doc properties failed', e);
		}
	}

	onMount(load);

	// ── Editing ────────────────────────────────────────────────────────────────
	let editing: { viewId: string; fieldId: string } | null = $state(null);
	let editAnchor: HTMLElement | null = $state(null);
	let editOpen = $state(false);

	const editingEntry = $derived(entries.find((e) => e.view.id === editing?.viewId));
	const editingField = $derived(editingEntry?.fields.find((f) => f.id === editing?.fieldId));
	const editingValue = $derived.by(() => {
		if (!editingEntry || !editingField || !row) return null;
		return rawStatefulValue(row, editingField);
	});

	// save on editor destruct (close)
	let wasEditOpen = false;

	function saveEditedView(): Promise<void> | void {
		const entry = untrack(() => editingEntry);
		if (!entry || entry.view.temporary) return;
		return entry.view.save().catch((e) => reportError(e, "This view's changes couldn't be saved."));
	}

	$effect(() => {
		const open = editOpen;
		if (!open && wasEditOpen) saveEditedView();
		wasEditOpen = open;
	});

	// flush edited
	const unregisterFlush = registerFlush(() => (editOpen ? saveEditedView() : undefined));

	onDestroy(unregisterFlush);

	async function writeCell(view: View, field: ViewField, value: unknown) {
		if (!row) return;
		const current = row;
		try {
			row = {
				...current,
				properties: withStatefulValue(current.properties, field, value)
			};
			const result = await view.writeFieldValue(handle.source.id, field, value, [current.id]);
			if (result.failed > 0)
				onError(null, describeBulkFailure(result), () => writeCell(view, field, value));
		} catch (e) {
			row = current;
			onError(e, "The property couldn't be saved.", () => writeCell(view, field, value));
		}
	}

	function onCellClick(e: MouseEvent, view: View, field: ViewField) {
		if (!row) return;
		if (field.type === 'boolean') {
			const cur = rawStatefulValue(row, field);
			writeCell(view, field, cur === true ? false : true);
			return;
		}
		if (editOpen && editing?.viewId === view.id && editing?.fieldId === field.id) {
			editOpen = false;
			return;
		}
		editing = { viewId: view.id, fieldId: field.id };
		editAnchor = e.currentTarget as HTMLElement;
		editOpen = true;
	}
</script>

{#if open && entries.length > 0 && row}
	<div class="doc-props" class:inline>
		{#each entries as entry (entry.view.id)}
			{#if inline}<span class="row-sep" data-sep></span>{/if}
			<div class="view-row">
				<span class="view-label">
					{#if entry.view.emoji}
						<span class="view-emoji">{entry.view.emoji}</span>
					{:else}
						<Box size={12} strokeWidth={1.75} />
					{/if}
					<span class="view-name">{entry.view.slug}</span>
				</span>
				{#each entry.fields as field (field.id)}
					{@const Icon = getFieldIcon(field.type)}
					<span class="sep"></span>
					<button
						class="prop"
						type="button"
						title={fieldLabel(field)}
						onclick={(e) => onCellClick(e, entry.view, field)}
					>
						<Icon size={12} strokeWidth={1.75} />
						<span class="prop-label">{fieldLabel(field)}</span>
						<span class="prop-value"><CellValue {field} row={row!} /></span>
					</button>
				{/each}
			</div>
		{/each}
	</div>
{/if}

{#if editingField && editingEntry && row}
	{#if editingField.type === 'text'}
		<CellTextEditor
			bind:open={editOpen}
			anchor={editAnchor}
			value={editingValue == null ? '' : String(editingValue)}
			onCommit={(v) => {
				if (editingEntry && editingField) writeCell(editingEntry.view, editingField, v);
			}}
		/>
	{:else}
		<CellEditor
			bind:open={editOpen}
			anchor={editAnchor}
			field={editingField}
			value={editingValue}
			sourceId={handle.source.id}
			onChange={(v) => {
				if (editingEntry && editingField) writeCell(editingEntry.view, editingField, v);
			}}
			onRenameOption={(oldV, newV) => {
				if (editingEntry && editingField)
					editingEntry.view
						.renameOption(editingField, oldV, newV)
						.catch((e) => reportError(e, `The option "${oldV}" couldn't be renamed.`));
			}}
		/>
	{/if}
{/if}

<style>
	.doc-props {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		margin-top: 10px;
		font-family: var(--font-ui);
	}

	.doc-props.inline {
		display: contents;
	}

	.row-sep {
		flex-shrink: 0;
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--color-border);
	}

	.view-row {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		max-width: 100%;
		min-height: 24px;
		border-radius: 6px;
		background: var(--chip-bg);
		font-size: 12px;
	}

	.view-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px;
		color: var(--color-ui-muted);
		font-weight: 600;
	}

	.view-label :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.view-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.view-emoji {
		font-size: 11px;
		line-height: 1;
	}

	.sep {
		flex-shrink: 0;
		width: 1px;
		height: 14px;
		margin: 0 4px;
		background: var(--chip-divider);
	}

	.prop {
		--row-h: 20px;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		height: 24px;
		padding: 0 8px 0 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		color: var(--color-text-secondary);
		white-space: nowrap;
		cursor: pointer;
	}

	.prop > :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.prop-label {
		color: var(--color-ui-muted);
	}

	.prop-value {
		display: inline-flex;
		align-items: center;
		min-width: 0;
	}

	.prop-value :global(.pill) {
		padding: 0 8px;
		border-radius: 6px;
	}

	.prop:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
