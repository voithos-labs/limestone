<script lang="ts">
	import { Check, X, Calendar, CalendarClock } from '@lucide/svelte';
	import View from '$lib/models/View.svelte';
	import type { MemberRow, ViewField } from '$lib/models/View.svelte';
	import { describeBulkFailure } from '$lib/models/View.svelte';
	import type DocHandle from '$lib/models/DocHandle';
	import { rawStatefulValue, withStatefulValue } from '$lib/views/fieldValue';
	import { formatDateCompact } from '$lib/views/dateFormat';
	import { toasts } from '$lib/toasts.svelte';
	import CellEditor from './views/CellEditor.svelte';

	// A note that is a todo wears its todo-ness as one card under the title: the checkbox,
	// its dates, and the way out. The registry defines the fields; this only draws them
	let { handle, onRemove }: { handle: DocHandle; onRemove: () => void } = $props();

	const TODO = 'tag:todo';
	let view = $state<View | null>(null);
	let row = $state<MemberRow | null>(null);

	const doneField = $derived(view?.fields.find((f) => f.id === `${TODO}/done`) ?? null);
	const dueField = $derived(view?.fields.find((f) => f.id === `${TODO}/due`) ?? null);
	const schedField = $derived(view?.fields.find((f) => f.id === `${TODO}/scheduled`) ?? null);
	const done = $derived(!!row && !!doneField && rawStatefulValue(row, doneField) === true);

	function dateOf(f: ViewField | null): string {
		if (!row || !f) return '';
		const v = rawStatefulValue(row, f);
		return v ? formatDateCompact(v as string) : '';
	}

	$effect(() => {
		void handle.id;
		let live = true;
		View.forUnit(TODO, 'todo')
			.then(async (v) => {
				const [r] = await v.getMembers({ ids_in: [handle.id] });
				if (!live) return;
				view = v;
				row = (r as MemberRow) ?? null;
			})
			.catch((e) => console.error('todo card load failed', e));
		return () => {
			live = false;
		};
	});

	async function write(field: ViewField, value: unknown) {
		if (!view || !row) return;
		const before = row;
		row = { ...before, properties: withStatefulValue(before.properties, field, value) };
		try {
			const result = await view.writeFieldValue(handle.source.id, field, value, [before.id]);
			if (result.failed > 0) toasts.push(describeBulkFailure(result));
		} catch (e) {
			console.error('todo write failed', e);
			row = before;
		}
	}

	let editing: ViewField | null = $state(null);
	let editAnchor: HTMLElement | null = $state(null);
	let editOpen = $state(false);

	function edit(e: MouseEvent, f: ViewField | null) {
		if (!f) return;
		editing = f;
		editAnchor = e.currentTarget as HTMLElement;
		editOpen = true;
	}
</script>

{#if view && row}
	<div class="todo" class:done>
		<button
			class="check"
			type="button"
			role="checkbox"
			aria-checked={done}
			aria-label={done ? 'Mark not done' : 'Mark done'}
			onclick={() => doneField && write(doneField, !done)}
		>
			<span class="box"><Check size={12} strokeWidth={3} /></span>
		</button>
		<span class="label">{done ? 'Done' : 'Todo'}</span>
		<span class="sep"></span>
		<button
			class="date"
			class:set={!!dateOf(dueField)}
			type="button"
			onclick={(e) => edit(e, dueField)}
		>
			<Calendar size={13} strokeWidth={1.75} />
			<span class="date-label">Due</span>
			{#if dateOf(dueField)}<span class="date-value">{dateOf(dueField)}</span>{/if}
		</button>
		<button
			class="date"
			class:set={!!dateOf(schedField)}
			type="button"
			onclick={(e) => edit(e, schedField)}
		>
			<CalendarClock size={13} strokeWidth={1.75} />
			<span class="date-label">Scheduled</span>
			{#if dateOf(schedField)}<span class="date-value">{dateOf(schedField)}</span>{/if}
		</button>
		<button
			class="remove"
			type="button"
			title="Remove from todo"
			aria-label="Remove from todo"
			onclick={onRemove}
		>
			<X size={13} strokeWidth={2} />
		</button>
	</div>
	{#if editing}
		<CellEditor
			bind:open={editOpen}
			anchor={editAnchor}
			field={editing}
			value={rawStatefulValue(row, editing)}
			sourceId={handle.source.id}
			onChange={(v) => editing && write(editing, v)}
		/>
	{/if}
{/if}

<style>
	/* a small floating bar, in the register of the view header's controls */
	.todo {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 4px 0 0;
		border-radius: 8px;
		background: var(--chip-bg);
		font-family: var(--font-ui);
		font-size: 12.5px;
		color: var(--color-text-primary);
	}

	/* the checkbox is the card's end cap, dipped on hover like a row's open button */
	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: stretch;
		width: 36px;
		margin-right: 4px;
		padding: 0;
		border: none;
		border-radius: 8px 0 0 8px;
		background: transparent;
		color: inherit;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.check:hover {
		background: var(--chip-bg-hover);
	}

	.label {
		font-weight: 600;
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 1.5px solid var(--color-ui-muted);
		border-radius: 5px;
		color: transparent;
		transition:
			background-color 80ms ease,
			border-color 80ms ease,
			color 80ms ease;
	}

	.todo.done .box {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}

	.todo.done .label {
		color: var(--color-ui-muted);
	}

	.sep {
		width: 1px;
		height: 16px;
		margin: 0 4px;
		background: var(--chip-divider);
	}

	.date {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 24px;
		padding: 0 8px 0 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		color: var(--color-text-secondary);
		cursor: pointer;
		white-space: nowrap;
	}

	.date :global(svg) {
		color: var(--color-ui-muted);
	}

	.date-label {
		color: var(--color-ui-muted);
	}

	.date-value {
		font-weight: 500;
	}

	.date:not(.set) {
		color: var(--color-ui-dulled);
	}

	.date:not(.set) .date-label,
	.date:not(.set) :global(svg) {
		color: var(--color-ui-dulled);
	}

	.date:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		margin-left: 0;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
	}

	.remove:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}
</style>
