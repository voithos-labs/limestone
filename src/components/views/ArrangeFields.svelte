<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Check, Hash, Plus, Pencil, Trash2 } from '@lucide/svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, ViewField, ViewFieldType } from '$lib/models/View.svelte';
	import {
		CREATABLE_FIELD_TYPES,
		isBuiltinField,
		isDerived,
		isLockedField
	} from '$lib/models/View.svelte';
	import { fieldLabel } from '$lib/views/fieldValue';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import { listInlineByDefault, listPrefixed } from '$lib/views/listLayout';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import Menu from './Menu.svelte';

	// Arranging and managing a list's fields in one place: drag chips between the lanes of a
	// schematic row (or card), right-click one to rename or delete it, add a new one below
	let {
		open = $bindable(false),
		view,
		face,
		canManage = false,
		onAddField,
		onRename,
		onDelete
	}: {
		open: boolean;
		view: View;
		face: ViewFace;
		canManage?: boolean; // a saved unit view owns its fields; anything else only arranges
		onAddField?: (type: ViewFieldType) => ViewField;
		onRename?: (fieldId: string, name: string) => void;
		onDelete?: (fieldId: string) => void;
	} = $props();

	const cards = $derived(face.config.layout === 'grid');

	type Lane = 'check' | 'left' | 'right' | 'hidden';
	type Model = { check: string | null; left: string[]; right: string[]; hidden: string[] };

	const fieldsById = $derived(new Map(view.fields.map((f) => [f.id, f])));
	const titleId = $derived(view.fields.find((f) => f.type === 'title')?.id);

	// the face's current arrangement, read the same way the list reads it
	function fromFace(): Model {
		const shown = face.display_field_ids
			.map((id) => fieldsById.get(id))
			.filter((f): f is ViewField => !!f && f.type !== 'title');
		const check = shown[0]?.type === 'boolean' ? shown[0].id : null;
		const rest = check ? shown.slice(1) : shown;
		const rightIds = face.config.right as string[] | undefined;
		const isRight = (f: ViewField) =>
			rightIds ? rightIds.includes(f.id) : !listInlineByDefault(f.type);
		const shownSet = new Set(shown.map((f) => f.id));
		return {
			check,
			left: rest.filter((f) => !isRight(f)).map((f) => f.id),
			right: rest.filter(isRight).map((f) => f.id),
			hidden: view.fields.filter((f) => f.type !== 'title' && !shownSet.has(f.id)).map((f) => f.id)
		};
	}

	let model: Model = $state({ check: null, left: [], right: [], hidden: [] });

	function apply(m: Model) {
		face.display_field_ids = [
			...(titleId && face.display_field_ids.includes(titleId) ? [titleId] : []),
			...(m.check ? [m.check] : []),
			...m.left,
			...m.right
		];
		face.config.right = [...m.right];
	}

	// ── Drag ───────────────────────────────────────────────────────────────────
	const DRAG_PX = 4;
	let popEl: HTMLDivElement | null = $state(null);
	let arm: { id: string; x: number; y: number } | null = null;
	let dragId: string | null = $state(null);
	let ghost: { x: number; y: number } = $state({ x: 0, y: 0 });
	let overLane: Lane | null = $state(null);
	let rejected = $state(false);

	const dragField = $derived(dragId ? fieldsById.get(dragId) : undefined);

	function laneOf(id: string, m: Model): Lane {
		if (m.check === id) return 'check';
		if (m.left.includes(id)) return 'left';
		if (m.right.includes(id)) return 'right';
		return 'hidden';
	}

	function without(m: Model, id: string): Model {
		return {
			check: m.check === id ? null : m.check,
			left: m.left.filter((x) => x !== id),
			right: m.right.filter((x) => x !== id),
			hidden: m.hidden.filter((x) => x !== id)
		};
	}

	function armDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		arm = { id, x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('keydown', onKey, true);
	}

	function laneAt(x: number, y: number): Lane | null {
		if (!popEl) return null;
		for (const lane of ['check', 'left', 'right', 'hidden'] as Lane[]) {
			for (const el of popEl.querySelectorAll<HTMLElement>(`[data-lane="${lane}"]`)) {
				const r = el.getBoundingClientRect();
				if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return lane;
			}
		}
		return null;
	}

	// where in a horizontal lane the pointer would insert, by chip midpoints
	function indexAt(lane: Lane, x: number, exclude: string): number {
		if (!popEl) return 0;
		const chips = Array.from(
			popEl.querySelectorAll<HTMLElement>(`[data-lane="${lane}"] [data-id]`)
		).filter((c) => c.dataset.id !== exclude);
		let i = 0;
		for (const c of chips) {
			const r = c.getBoundingClientRect();
			if (x > r.left + r.width / 2) i++;
		}
		return i;
	}

	function onMove(e: PointerEvent) {
		if (!arm) return;
		if (!dragId) {
			if (Math.hypot(e.clientX - arm.x, e.clientY - arm.y) < DRAG_PX) return;
			dragId = arm.id;
		}
		ghost = { x: e.clientX, y: e.clientY };
		const lane = laneAt(e.clientX, e.clientY);
		overLane = lane;
		if (!lane || !dragField) return;
		if (lane === 'check' && dragField.type !== 'boolean') {
			rejected = true;
			return;
		}
		rejected = false;
		const id = dragId;
		const base = without(model, id);
		const next: Model = {
			...base,
			left: [...base.left],
			right: [...base.right],
			hidden: [...base.hidden]
		};
		if (lane === 'check') {
			// a boolean already there steps aside to the front of the left lane
			if (base.check && base.check !== id) next.left.unshift(base.check);
			next.check = id;
		} else {
			next[lane].splice(indexAt(lane, e.clientX, id), 0, id);
		}
		model = next;
	}

	function onUp() {
		if (dragId) apply(model);
		cleanup();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && dragId) {
			e.stopPropagation();
			e.preventDefault();
			model = fromFace();
			cleanup();
		}
	}

	function cleanup() {
		arm = null;
		dragId = null;
		overLane = null;
		rejected = false;
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('keydown', onKey, true);
	}

	// ── Dialog plumbing ────────────────────────────────────────────────────────
	function onDocKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && !dragId) open = false;
	}

	$effect(() => {
		if (!open) return;
		untrack(() => (model = fromFace()));
		document.addEventListener('keydown', onDocKey);
		return () => {
			document.removeEventListener('keydown', onDocKey);
			cleanup();
		};
	});

	const checkField = $derived(model.check ? fieldsById.get(model.check) : undefined);
	const fieldsIn = (ids: string[]) =>
		ids.map((id) => fieldsById.get(id)).filter((f): f is ViewField => !!f);
	// the shelf splits: the view's own fields, and the registry's behind their unit's name
	const hiddenOwn = $derived(fieldsIn(model.hidden).filter((f) => !isBuiltinField(f)));
	const hiddenBuiltin = $derived(fieldsIn(model.hidden).filter(isBuiltinField));
	const unitOf = (f: ViewField) => (f.unit ?? '').replace(/^tag:/, '');

	// ── Manage: rename in place, delete with a second click, add from a type list ─────
	let renamingId: string | null = $state(null);
	let renameDraft = $state('');
	let confirmId: string | null = $state(null);
	let addOpen = $state(false);
	let addEl: HTMLButtonElement | null = $state(null);
	const addItems = CREATABLE_FIELD_TYPES.map((t) => ({
		value: t,
		label: t.charAt(0).toUpperCase() + t.slice(1),
		icon: getFieldIcon(t)
	}));

	function chipMenu(f: ViewField): CtxEntry[] {
		if (!canManage || isLockedField(f)) return [];
		return [
			{ label: 'Rename', icon: Pencil, action: () => startRename(f) },
			{ label: 'Delete', icon: Trash2, danger: true, action: () => (confirmId = f.id) }
		];
	}

	function startRename(f: ViewField) {
		confirmId = null;
		renamingId = f.id;
		renameDraft = f.name;
	}

	function commitRename() {
		const id = renamingId;
		renamingId = null;
		if (id && renameDraft.trim()) onRename?.(id, renameDraft.trim());
	}

	function renameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renamingId = null;
		}
	}

	function focusSelect(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function deleteConfirmed(f: ViewField) {
		confirmId = null;
		model = without(model, f.id);
		apply(model);
		onDelete?.(f.id);
	}

	async function addField(type: string) {
		addOpen = false;
		const f = onAddField?.(type as ViewFieldType);
		if (!f) return;
		await tick();
		model = fromFace();
		startRename(f);
	}
</script>

{#snippet chip(f: ViewField, lane: Lane)}
	{@const Icon = getFieldIcon(f.type)}
	{@const pill = f.type === 'tags' || f.type === 'select' || f.type === 'multiselect'}
	{@const labelled = lane === 'right' && listPrefixed(f.type)}
	{#if confirmId === f.id}
		<button
			class="chip confirm"
			type="button"
			data-id={f.id}
			onclick={(e) => {
				e.stopPropagation();
				deleteConfirmed(f);
			}}
		>
			<Trash2 size={11} strokeWidth={2} />
			<span>delete {fieldLabel(f)}?</span>
		</button>
	{:else}
		<span
			class="chip"
			class:pill
			class:labelled
			class:bare={lane === 'right' && !listPrefixed(f.type)}
			class:ghosted={lane === 'hidden'}
			class:dragging={dragId === f.id}
			class:managed={canManage && !isLockedField(f)}
			data-id={f.id}
			role="presentation"
			use:ctxMenu={() => chipMenu(f)}
			onpointerdown={(e) => {
				if (renamingId !== f.id) armDrag(e, f.id);
			}}
			ondblclick={() => {
				if (canManage && !isLockedField(f)) startRename(f);
			}}
		>
			{#if f.type === 'tags'}
				<Hash size={11} strokeWidth={2} />
			{:else if lane === 'hidden' || pill || (labelled && isDerived(f.type))}
				<Icon size={12} strokeWidth={1.75} />
			{/if}
			{#if isBuiltinField(f)}<span class="from">{unitOf(f)}:</span>{/if}
			{#if renamingId === f.id}
				<span class="rename">
					<span class="rename-ghost">{renameDraft || ' '}</span>
					<input
						class="rename-input"
						bind:value={renameDraft}
						use:focusSelect
						onblur={commitRename}
						onkeydown={renameKey}
						onpointerdown={(e) => e.stopPropagation()}
						spellcheck="false"
					/>
				</span>
			{:else}
				<span>{fieldLabel(f)}</span>
			{/if}
			{#if labelled && f.type === 'boolean'}<span class="box"></span>{/if}
		</span>
	{/if}
{/snippet}

{#if open}
	<div
		class="overlay"
		role="presentation"
		onclick={() => {
			if (!dragId) open = false;
		}}
	>
		<div
			class="dialog"
			class:dragging={!!dragId}
			bind:this={popEl}
			role="dialog"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h3 class="title-h">Drag to arrange fields</h3>

			<div class="mock" class:card={cards} onclick={() => (confirmId = null)} role="presentation">
				{#if cards}
					<div class="card-head">
						{@render checkSlot()}
						<span class="title">Title</span>
					</div>
					<div class="card-preview"><span></span><span></span><span class="short"></span></div>
					<div class="card-foot">
						<div class="lane left" class:over={overLane === 'left'} data-lane="left">
							{#each fieldsIn(model.left) as f (f.id)}
								{@render chip(f, 'left')}
							{/each}
						</div>
						<div class="lane right" class:over={overLane === 'right'} data-lane="right">
							{#each fieldsIn(model.right) as f (f.id)}
								{@render chip(f, 'right')}
							{/each}
						</div>
					</div>
				{:else}
					{@render checkSlot()}
					<span class="title">Title</span>
					<div class="lane left" class:over={overLane === 'left'} data-lane="left">
						{#each fieldsIn(model.left) as f (f.id)}
							{@render chip(f, 'left')}
						{/each}
					</div>
					<div class="lane right" class:over={overLane === 'right'} data-lane="right">
						{#each fieldsIn(model.right) as f (f.id)}
							{@render chip(f, 'right')}
						{/each}
					</div>
				{/if}
			</div>

			<div class="legend" class:card={cards}>
				<span class="lg check">check</span>
				<span class="lg title"></span>
				<span class="lg left">{cards ? 'foot left' : 'after title'}</span>
				<span class="lg right">{cards ? 'foot right' : 'right'}</span>
			</div>
			{#snippet checkSlot()}
				<div
					class="slot check"
					class:over={overLane === 'check' && !rejected}
					class:rejected={overLane === 'check' && rejected}
					data-lane="check"
				>
					{#if checkField}
						<span
							class="chip checkbox"
							class:dragging={dragId === checkField.id}
							data-id={checkField.id}
							role="presentation"
							onpointerdown={(e) => armDrag(e, checkField.id)}
						>
							<span class="box"><Check size={10} strokeWidth={3} /></span>
						</span>
					{:else}
						<span class="box empty"></span>
					{/if}
				</div>
			{/snippet}

			{#if (overLane === 'check' && rejected) || checkField}
				<div class="hint">
					{#if overLane === 'check' && rejected}
						<span class="note bad">Only a checkbox can go here</span>
					{:else if checkField}
						<span class="note">
							<span class="box tiny"><Check size={9} strokeWidth={3} /></span>
							<b>{fieldLabel(checkField)}</b> shown as a checkbox
						</span>
					{/if}
				</div>
			{/if}

			<div class="shelf" class:over={overLane === 'hidden'} data-lane="hidden">
				<span class="shelf-label">other fields</span>
				{#each hiddenOwn as f (f.id)}
					{@render chip(f, 'hidden')}
				{:else}
					{#if !canManage}<span class="shelf-empty">everything is shown</span>{/if}
				{/each}
				{#if canManage}
					<button
						class="add"
						type="button"
						bind:this={addEl}
						onclick={(e) => {
							e.stopPropagation();
							addOpen = !addOpen;
						}}
					>
						<Plus size={12} strokeWidth={2} />
						<span>New field</span>
					</button>
				{/if}
			</div>

			{#if hiddenBuiltin.length > 0}
				<div class="shelf builtin" class:over={overLane === 'hidden'} data-lane="hidden">
					<span class="shelf-label">built-in fields</span>
					{#each hiddenBuiltin as f (f.id)}
						{@render chip(f, 'hidden')}
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<Menu bind:open={addOpen} anchor={addEl} items={addItems} onSelect={addField} minWidth={160} />

	{#if dragField}
		<div class="ghost" style:top="{ghost.y}px" style:left="{ghost.x}px">
			{@render chip(dragField, laneOf(dragField.id, model))}
		</div>
	{/if}
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 900;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.4);
	}

	.dialog {
		width: 560px;
		max-width: calc(100vw - 32px);
		padding: 24px 20px 20px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: var(--menu-shadow);
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
		user-select: none;
	}

	.dialog.dragging,
	.dialog.dragging * {
		cursor: grabbing;
	}

	.title-h {
		margin: 0 4px 20px;
		font-size: 16px;
		font-weight: 600;
	}

	/* the schematic row: a real list row, just labelled */
	.mock {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 56px;
		margin: 0 4px;
		padding: 0 12px;
		border-radius: 8px;
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
	}

	.slot,
	.lane {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		border: 1.5px dashed transparent;
		border-radius: 7px;
		transition:
			border-color 100ms ease,
			background-color 100ms ease;
	}

	.slot.check {
		width: 32px;
		height: 32px;
		justify-content: center;
		flex: 0 0 auto;
	}

	/* each lane is a whole half of the row, so there's a lot to aim at */
	.lane {
		flex: 1 1 0;
		min-width: 0;
		padding: 0 6px;
	}

	.lane.right {
		justify-content: flex-end;
	}

	.dialog.dragging .slot,
	.dialog.dragging .lane,
	.dialog.dragging .shelf {
		border-color: var(--color-border);
	}

	.slot.over,
	.lane.over,
	.shelf.over {
		border-color: var(--color-accent) !important;
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.slot.rejected {
		border-color: var(--error-fg) !important;
		background: color-mix(in srgb, var(--error-fg) 10%, transparent);
	}

	.title {
		flex: 0 0 auto;
		font-size: 15px;
	}

	/* the card variant: a tile with the head, a preview window and a two-lane foot */
	.mock.card {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		height: auto;
		width: 300px;
		margin: 0 auto;
		padding: 14px;
		background: var(--chip-bg);
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.card-preview {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 2px 0;
	}

	.card-preview span {
		height: 7px;
		border-radius: 4px;
		background: var(--color-border);
		opacity: 0.6;
	}

	.card-preview .short {
		width: 55%;
	}

	.card-foot {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.legend.card {
		display: none;
	}

	.chip.managed {
		cursor: grab;
	}

	.chip.confirm {
		gap: 5px;
		border: none;
		background: var(--error-bg);
		color: var(--error-fg);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.rename {
		position: relative;
		display: inline-grid;
	}

	.rename-ghost {
		visibility: hidden;
		white-space: pre;
		grid-area: 1 / 1;
	}

	.rename-input {
		grid-area: 1 / 1;
		width: 0;
		min-width: 100%;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		color: inherit;
		outline: none;
	}

	.add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px 0 6px;
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.add:hover {
		color: var(--color-text-primary);
		border-color: var(--color-ui-muted);
	}

	/* chips drawn as the list draws them */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 8px;
		border-radius: 6px;
		background: var(--chip-bg);
		font-size: 12px;
		color: var(--color-text-secondary);
		white-space: nowrap;
		cursor: grab;
		transition:
			opacity 100ms ease,
			transform 100ms ease;
	}

	.chip.pill {
		border-radius: 999px;
		padding: 0 9px 0 7px;
	}

	.chip.bare {
		background: transparent;
		padding: 0;
		color: var(--color-ui-muted);
	}

	.chip.ghosted {
		opacity: 0.55;
	}

	.chip.dragging {
		opacity: 0.25;
	}

	.chip.checkbox {
		padding: 0;
		background: transparent;
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
	}

	.chip.checkbox .box {
		width: 18px;
		height: 18px;
		border-radius: 5px;
	}

	.box.empty {
		opacity: 0.35;
	}

	.legend {
		display: flex;
		gap: 10px;
		margin: 6px 4px 0;
		padding: 0 12px;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.02em;
		color: var(--color-ui-muted);
	}

	.lg.check {
		width: 32px;
		text-align: center;
		flex: 0 0 auto;
	}

	.lg.title {
		width: 34px;
		flex: 0 0 auto;
	}

	.lg.left,
	.lg.right {
		flex: 1 1 0;
	}

	.lg.right {
		text-align: right;
	}

	.hint {
		margin: 10px 16px 0;
		font-size: 12px;
	}

	.note {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
		font-size: 12px;
	}

	.note b {
		font-weight: 600;
	}

	.note .box.tiny {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: #fff;
	}

	.note.bad {
		background: color-mix(in srgb, var(--error-fg) 12%, transparent);
		color: var(--error-fg);
	}

	.shelf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 12px 4px 0;
		padding: 12px;
		min-height: 56px;
		border: 1.5px dashed transparent;
		border-radius: 8px;
		transition:
			border-color 100ms ease,
			background-color 100ms ease;
	}

	.shelf.builtin {
		margin-top: 8px;
		min-height: 0;
	}

	.chip .from {
		margin-right: -2px;
		color: var(--color-ui-muted);
	}

	.shelf-label {
		width: 100%;
		margin-bottom: 2px;
		font-size: 10px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.shelf-empty {
		font-size: 12px;
		color: var(--color-ui-muted);
		opacity: 0.6;
	}

	.ghost {
		position: fixed;
		z-index: 901;
		pointer-events: none;
		transform: translate(-50%, -50%) rotate(-2deg) scale(1.05);
		filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.25));
	}

	.ghost .chip {
		opacity: 1;
		cursor: grabbing;
	}
</style>
