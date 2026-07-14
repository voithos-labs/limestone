<script lang="ts">
	import type DocHandle from '$lib/models/DocHandle';
	import View from '$lib/models/View.svelte';
	import type { ViewField, MemberRow } from '$lib/models/View.svelte';
	import { isDerived, describeBulkFailure } from '$lib/models/View.svelte';
	import { toasts } from '$lib/toasts.svelte';
	import { fieldLabel, withStatefulValue, rawStatefulValue } from '$lib/views/fieldValue';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import CellValue from './CellValue.svelte';
	import CellEditor from './CellEditor.svelte';
	import CellTextEditor from './CellTextEditor.svelte';
	import { registerFlush } from '$lib/util/flush';
	import { Box } from '@lucide/svelte';
	import { onMount, onDestroy } from 'svelte';

	// The toggle lives in the document header's meta bar, so open state and the
	// field count are owned by the parent; this renders the panel only.
	let {
		handle,
		open = false,
		onCount
	}: { handle: DocHandle; open?: boolean; onCount?: (n: number) => void } = $props();

	type Entry = { view: View; fields: ViewField[] };

	let entries: Entry[] = $state([]);
	let row: MemberRow | null = $state(null);

	const fieldCount = $derived(entries.reduce((n, e) => n + e.fields.length, 0));

	$effect(() => {
		onCount?.(fieldCount);
	});

	async function load() {
		try {
			const saved = await View.listSaved();
			const found: Entry[] = [];
			let hit: MemberRow | null = null;
			for (const view of saved) {
				const fields = view.fields.filter((f) => !isDerived(f.type));
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

	// These View instances are our own copies, so nothing else persists them. The
	// option editors mutate field.config directly (creating, renaming and deleting
	// select values), so mirror ViewPage's autosave or those edits are lost.
	const sigs = new Map<string, string>();
	const pending = new Map<string, View>();
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function flushSaves() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		const views = [...pending.values()];
		pending.clear();
		for (const v of views) v.save().catch((e) => console.error('save view failed', e));
	}

	$effect(() => {
		for (const entry of entries) {
			const view = entry.view;
			const sig = JSON.stringify(view.toJSON());
			const prev = sigs.get(view.id);
			sigs.set(view.id, sig);
			if (prev === undefined || prev === sig) continue;
			pending.set(view.id, view);
		}
		if (pending.size === 0) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSaves, 250);
	});

	// A pending save must never be dropped: the value is already in the document's
	// frontmatter, so losing the view's option list leaves the pill with a hashed
	// colour instead of the option's, and no option to pick on other rows.
	const unregisterFlush = registerFlush(flushSaves);

	onDestroy(() => {
		flushSaves();
		unregisterFlush();
	});

	// ── Editing ────────────────────────────────────────────────────────────────
	let editing: { viewId: string; fieldId: string } | null = $state(null);
	let editAnchor: HTMLElement | null = $state(null);
	let editOpen = $state(false);

	const editingEntry = $derived(entries.find((e) => e.view.id === editing?.viewId));
	const editingField = $derived(
		editingEntry?.fields.find((f) => f.id === editing?.fieldId)
	);
	const editingValue = $derived.by(() => {
		if (!editingEntry || !editingField || !row) return null;
		return rawStatefulValue(row, editingEntry.view.slug, editingField.name);
	});

	async function writeCell(view: View, field: ViewField, value: unknown) {
		if (!row) return;
		const current = row;
		try {
			row = {
				...current,
				properties: withStatefulValue(current.properties, view.slug, field.name, value)
			};
			const result = await view.writeFieldValue(current.source_id, field, value, [current.id]);
			if (result.failed > 0) {
				toasts.push(describeBulkFailure(result), {
					action: { label: 'Retry', run: () => writeCell(view, field, value) }
				});
			}
		} catch (e) {
			console.error('write property failed', e);
			row = current;
		}
	}

	function onCellClick(e: MouseEvent, view: View, field: ViewField) {
		if (!row) return;
		if (field.type === 'boolean') {
			const cur = rawStatefulValue(row, view.slug, field.name);
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
	<div class="doc-props">
		<div class="props-body">
			{#each entries as entry (entry.view.id)}
				<div class="view-group">
					<div class="view-label">
						{#if entry.view.emoji}
							<span class="view-emoji">{entry.view.emoji}</span>
						{:else}
							<Box size={12} strokeWidth={1.75} />
						{/if}
						<span class="view-name">{entry.view.slug}</span>
					</div>
					<div class="group-rows">
						{#each entry.fields as field (field.id)}
							{@const Icon = getFieldIcon(field.type)}
							<div class="prop-row">
								<span class="prop-name">
									<span class="prop-icon"><Icon size={12} strokeWidth={1.75} /></span>
									<span class="prop-label">{fieldLabel(field)}</span>
								</span>
								<button
									class="prop-value"
									type="button"
									onclick={(e) => onCellClick(e, entry.view, field)}
								>
									<CellValue {field} row={row!} viewSlug={entry.view.slug} />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
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
			sourceId={row.source_id}
			onChange={(v) => {
				if (editingEntry && editingField) writeCell(editingEntry.view, editingField, v);
			}}
			onRenameOption={(oldV, newV) => {
				if (editingEntry && editingField)
					editingEntry.view.renameOption(editingField, oldV, newV).catch(console.error);
			}}
		/>
	{/if}
{/if}

<style>
	.doc-props {
		margin-top: 10px;
		font-family: var(--font-ui);
	}

	.props-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 6px;
	}

	.view-group {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	/* Guide line dropping from the view's icon down past its properties, the way a
	   nested folder tree carries its parent's line. Inset at both ends so it doesn't
	   run the full height of the rows. */
	.group-rows {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-left: 5px;
		padding-left: 12px;
	}

	.group-rows::before {
		content: '';
		position: absolute;
		left: 0;
		top: 6px;
		bottom: 6px;
		width: 1px;
		border-radius: 999px;
		background: var(--color-border);
	}

	/* Lean section header: names the view the properties below belong to */
	.view-label {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-bottom: 5px;
		font-size: 11px;
		color: var(--color-ui-dulled);
	}

	.view-label :global(svg) {
		flex-shrink: 0;
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

	.prop-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 26px;
	}

	.prop-name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: 0 0 160px;
		min-width: 0;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.prop-icon {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.prop-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.prop-value {
		--row-h: 20px;
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
		height: 26px;
		padding: 0 8px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-text-secondary);
		text-align: left;
		cursor: pointer;
	}

	.prop-value:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
