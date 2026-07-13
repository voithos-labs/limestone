<script lang="ts">
	import { untrack } from 'svelte';
	import type { Component } from 'svelte';
	import {
		ChevronDown,
		Table,
		Columns3,
		List,
		Calendar,
		Pin,
		Layers,
		Pencil,
		Copy,
		Trash2,
		Plus,
		ArrowLeft,
		ChevronUp,
		NotebookText
	} from '@lucide/svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, ViewFaceType, ViewField, FilterNode } from '$lib/models/View.svelte';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import Menu from './Menu.svelte';
	import FaceFilters from './FaceFilters.svelte';

	let { view, face }: { view: View; face: ViewFace } = $props();

	const FACE_ICON: Record<ViewFaceType, Component> = {
		table: Table,
		kanban: Columns3,
		list: List,
		calendar: Calendar,
		pinned: Pin,
		journal: NotebookText
	};
	const faceIcon = (t: ViewFaceType) => FACE_ICON[t] ?? Table;
	const SwitchIcon = $derived(faceIcon(face.type));

	let anchorEl: HTMLButtonElement | null = $state(null);
	let popEl: HTMLDivElement | null = $state(null);
	let open = $state(false);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });

	let confirmFor: string | null = $state(null);
	let renamingId: string | null = $state(null);
	let renameDraft = $state('');
	let renameInput: HTMLInputElement | null = $state(null);

	let groupEl: HTMLButtonElement | null = $state(null);
	let groupOpen = $state(false);

	const faceFilterCount = $derived(
		face.additive_filter.children.filter((n: FilterNode) => 'field_id' in n).length
	);

	const sourceScopeId = $derived.by(() => {
		for (const n of view.filter.children) {
			if (!('field_id' in n)) continue;
			const f = view.fields.find((ff) => ff.id === n.field_id);
			if (f?.type === 'source' && n.op === 'eq' && typeof n.value === 'string') return n.value;
		}
		return undefined;
	});

	const groupable = $derived(
		view.fields.filter(
			(f: ViewField) => f.type === 'select' || f.type === 'multiselect' || f.type === 'boolean'
		)
	);
	const groupById = $derived((face.config.group_by ?? null) as string | null);
	const groupLabel = $derived.by(() => {
		if (!groupById) return 'None';
		const f = view.fields.find((ff) => ff.id === groupById);
		return f ? fieldLabel(f) : 'None';
	});

	const groupItems = $derived([
		{ value: '', label: 'None' },
		...groupable.map((f: ViewField) => ({
			value: f.id,
			label: fieldLabel(f),
			icon: getFieldIcon(f.type)
		}))
	]);

	let closeOnSwapLeave = false;

	function selectFace(id: string) {
		view.state.active_face_id = id;
		closeOnSwapLeave = true;
	}

	function onPopLeave() {
		if (!closeOnSwapLeave) return;
		if (groupOpen || addFaceOpen || renamingId || confirmFor) return;
		open = false;
	}

	let addFaceOpen = $state(false);
	let addFaceEl: HTMLElement | null = $state(null);
	const ADD_FACE_ITEMS = [
		{ value: 'table', label: 'Table', icon: Table },
		{ value: 'journal', label: 'Journal', icon: NotebookText }
	];

	function addFaceOfType(type: string) {
		addFaceOpen = false;
		const f = view.addFace(type as ViewFaceType);
		view.state.active_face_id = f.id;
		startRename(f);
	}

	function duplicateFace(id: string) {
		const f = view.duplicateFace(id);
		if (f) view.state.active_face_id = f.id;
		open = false;
	}

	function deleteFace(id: string) {
		const fallback = view.faces.find((f) => f.id !== id);
		view.removeFace(id);
		if (fallback && view.state.active_face_id === id) view.state.active_face_id = fallback.id;
		confirmFor = null;
	}

	function moveFace(id: string, dir: -1 | 1) {
		const idx = view.faces.findIndex((f) => f.id === id);
		const next = idx + dir;
		if (idx < 0 || next < 0 || next >= view.faces.length) return;
		const arr = [...view.faces];
		const [f] = arr.splice(idx, 1);
		arr.splice(next, 0, f);
		view.faces = arr;
	}

	function startRename(f: ViewFace) {
		renamingId = f.id;
		renameDraft = f.label;
		queueMicrotask(() => {
			renameInput?.focus();
			renameInput?.select();
		});
	}

	function commitRename(f: ViewFace) {
		const next = renameDraft.trim();
		renamingId = null;
		f.name = next;
	}

	function setGroup(id: string) {
		face.config.group_by = id || null;
		groupOpen = false;
	}

	function position() {
		if (!anchorEl || !popEl) return;
		const a = anchorEl.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		let top = a.bottom + margin;
		let left = a.left;
		if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - margin);
		if (left + m.width > window.innerWidth - 8) left = Math.max(8, a.right - m.width);
		pos = { top, left };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchorEl?.contains(e.target as Node)) return;
		if ((e.target as HTMLElement).closest?.('.menu, .pop')) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape' && !renamingId) {
			open = false;
			e.preventDefault();
		}
	}

	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				confirmFor = null;
				renamingId = null;
				groupOpen = false;
				addFaceOpen = false;
				closeOnSwapLeave = false;
			});
			queueMicrotask(position);
			window.addEventListener('resize', position);
			window.addEventListener('scroll', position, true);
			document.addEventListener('pointerdown', onDocPointerDown);
			document.addEventListener('keydown', onKey);
			return () => {
				window.removeEventListener('resize', position);
				window.removeEventListener('scroll', position, true);
				document.removeEventListener('pointerdown', onDocPointerDown);
				document.removeEventListener('keydown', onKey);
			};
		}
		if (!open) wasOpen = false;
	});
</script>

<button class="face-switch" type="button" bind:this={anchorEl} onclick={() => (open = !open)}>
	<SwitchIcon size={14} strokeWidth={1.75} />
	<span>{face.label}</span>
	<ChevronDown size={13} strokeWidth={2} />
</button>

{#if open}
	<div
		class="pop"
		bind:this={popEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		onmouseleave={onPopLeave}
		role="menu"
		tabindex="-1"
	>
		<div class="pop-label">View Faces</div>
		<div class="list">
			{#each view.faces as f, i (f.id)}
				<div
					class="row"
					class:active={f.id === view.state.active_face_id}
					class:confirming={confirmFor === f.id}
				>
					{#if renamingId === f.id}
						<span class="name as-input">
							<input
								class="rename-input"
								bind:this={renameInput}
								bind:value={renameDraft}
								onblur={() => commitRename(f)}
								onkeydown={(e) => {
									e.stopPropagation();
									if (e.key === 'Enter') {
										e.preventDefault();
										commitRename(f);
									} else if (e.key === 'Escape') {
										e.preventDefault();
										renamingId = null;
									}
								}}
							/>
						</span>
					{:else}
						{@const RowIcon = faceIcon(f.type)}
						<button
							class="name"
							type="button"
							onclick={() => selectFace(f.id)}
							ondblclick={() => startRename(f)}
						>
							<RowIcon size={14} strokeWidth={1.75} />
							<span class="name-text">{f.label}</span>
						</button>
					{/if}

					{#if confirmFor === f.id}
						<button
							class="icon-btn"
							type="button"
							aria-label="Cancel"
							onclick={() => (confirmFor = null)}
						>
							<ArrowLeft size={14} strokeWidth={2} />
						</button>
						<button class="confirm-btn" type="button" onclick={() => deleteFace(f.id)}
							>Delete</button
						>
					{:else}
						<button
							class="icon-btn"
							type="button"
							aria-label="Move up"
							disabled={i === 0}
							onclick={() => moveFace(f.id, -1)}
						>
							<ChevronUp size={14} strokeWidth={2} />
						</button>
						<button
							class="icon-btn"
							type="button"
							aria-label="Move down"
							disabled={i === view.faces.length - 1}
							onclick={() => moveFace(f.id, 1)}
						>
							<ChevronDown size={14} strokeWidth={2} />
						</button>
						<button
							class="icon-btn"
							type="button"
							aria-label="Rename"
							onclick={() => startRename(f)}
						>
							<Pencil size={13} strokeWidth={1.75} />
						</button>
						<button
							class="icon-btn"
							type="button"
							aria-label="Duplicate"
							onclick={() => duplicateFace(f.id)}
						>
							<Copy size={13} strokeWidth={1.75} />
						</button>
						{#if view.faces.length > 1}
							<button
								class="icon-btn"
								type="button"
								aria-label="Delete"
								onclick={() => (confirmFor = f.id)}
							>
								<Trash2 size={13} strokeWidth={1.75} />
							</button>
						{/if}
						<span class="check" class:shown={f.id === view.state.active_face_id}>
							<span class="dot"></span>
						</span>
					{/if}
				</div>
			{/each}
			<button
				class="action add-face"
				type="button"
				bind:this={addFaceEl}
				onclick={() => (addFaceOpen = !addFaceOpen)}
			>
				<Plus size={14} strokeWidth={1.75} />
				<span>Add face</span>
			</button>
			<Menu
				bind:open={addFaceOpen}
				anchor={addFaceEl}
				items={ADD_FACE_ITEMS}
				onSelect={addFaceOfType}
				minWidth={150}
			/>
		</div>

		<div class="divider"></div>

		<div class="pop-label">
			Face Filters{#if faceFilterCount > 0}{' · '}{faceFilterCount}{/if}
		</div>
		<FaceFilters {view} {face} sourceId={sourceScopeId} />

		{#if face.type === 'table'}
			<div class="divider"></div>

			<button
				class="action group-toggle"
				type="button"
				bind:this={groupEl}
				onclick={() => (groupOpen = !groupOpen)}
			>
				<Layers size={14} strokeWidth={1.75} />
				<span>Group by</span>
				<span class="trailing">{groupLabel}</span>
				<ChevronDown size={13} strokeWidth={2} />
			</button>
		{/if}
	</div>

	{#if face.type === 'table'}
		<Menu
			bind:open={groupOpen}
			anchor={groupEl}
			items={groupItems}
			selected={groupById ?? ''}
			onSelect={setGroup}
			minWidth={170}
			placement="right"
		/>
	{/if}
{/if}

<style>
	.face-switch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 9px;
		flex-shrink: 0;
		background: var(--chip-bg);
		border: none;
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.face-switch:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.face-switch :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.pop {
		position: fixed;
		z-index: 1000;
		width: 260px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.pop-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
		padding: 4px 8px 6px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: 5px;
	}

	.row.active,
	.row:hover {
		background: var(--menu-item-hover);
	}

	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: 5px;
	}

	.name.as-input {
		padding: 4px 6px;
	}

	.name :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.name-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rename-input {
		width: 100%;
		padding: 2px 6px;
		border: 1px solid var(--focus-border);
		border-radius: 4px;
		background: var(--color-bg);
		font: inherit;
		font-size: 13px;
		color: var(--color-text-primary);
		outline: none;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-ui-muted);
		cursor: pointer;
		opacity: 0;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.row:hover .icon-btn,
	.row.confirming .icon-btn {
		opacity: 1;
	}

	.icon-btn:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.icon-btn:disabled {
		opacity: 0;
		pointer-events: none;
	}

	.row:hover .icon-btn:disabled {
		opacity: 0.25;
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		flex-shrink: 0;
		visibility: hidden;
	}

	.check.shown {
		visibility: visible;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.row:hover .check {
		display: none;
	}

	.confirm-btn {
		flex-shrink: 0;
		height: 22px;
		padding: 0 10px;
		border: 0;
		border-radius: 5px;
		background: var(--chip-bg);
		color: var(--color-text-primary);
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.confirm-btn:hover {
		background: var(--chip-bg-hover);
	}

	.divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border);
	}

	.action {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: inherit;
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.action:hover {
		background: var(--menu-item-hover);
	}

	.action :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.group-toggle span:first-of-type {
		flex: 1;
	}

	.add-face {
		color: var(--color-ui-muted);
	}

	.add-face:hover {
		color: var(--color-text-primary);
	}

	.trailing {
		font-size: 12px;
		color: var(--color-ui-muted);
	}
</style>
