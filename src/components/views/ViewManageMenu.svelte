<script lang="ts">
	import { untrack } from 'svelte';
	import {
		ArrowLeft,
		Trash2,
		Plus,
		ChevronRight,
		Check,
		CircleSlash,
		Triangle,
		Eye,
		EyeOff
	} from '@lucide/svelte';
	import type { ViewField, ViewFieldType } from '$lib/models/View.svelte';
	import { CREATABLE_FIELD_TYPES, isDerived } from '$lib/models/View.svelte';
	import { getFieldIcon } from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import Menu from './Menu.svelte';

	let {
		open = $bindable(false),
		anchor,
		fields,
		shownIds,
		canAddFields = true,
		placement = 'bottom',
		onToggleVisible,
		onDelete,
		onAddField
	}: {
		open: boolean;
		anchor: HTMLElement | null;
		fields: ViewField[];
		shownIds: string[];
		canAddFields?: boolean;
		placement?: 'bottom' | 'right';
		onToggleVisible: (fieldId: string) => void;
		onDelete: (fieldId: string) => void;
		onAddField: (type: ViewFieldType) => void;
	} = $props();

	const defaults = $derived(fields.filter((f) => isDerived(f.type)));
	const custom = $derived(fields.filter((f) => !isDerived(f.type)));
	const ordered = $derived([...defaults, ...custom]);
	const shownSet = $derived(new Set(shownIds));

	let popEl: HTMLDivElement | null = $state(null);
	let pos: { top: number; left: number } = $state({ top: 0, left: 0 });
	let activeIndex = $state(0);
	let confirmFor: string | null = $state(null);

	let addEl: HTMLButtonElement | null = $state(null);
	let addOpen = $state(false);

	const addItems = CREATABLE_FIELD_TYPES.map((t) => ({
		value: t,
		label: t.charAt(0).toUpperCase() + t.slice(1),
		icon: getFieldIcon(t)
	}));

	function addField(type: ViewFieldType) {
		addOpen = false;
		onAddField(type);
		open = false;
	}

	$effect(() => {
		ordered;
		if (activeIndex >= ordered.length) activeIndex = 0;
	});

	function position() {
		if (!anchor || !popEl) return;
		const a = anchor.getBoundingClientRect();
		const m = popEl.getBoundingClientRect();
		const margin = 4;
		let top: number;
		let left: number;
		if (placement === 'right') {
			top = a.top;
			left = a.right + margin;
			if (left + m.width > window.innerWidth - 8) left = Math.max(8, a.left - m.width - margin);
			if (top + m.height > window.innerHeight - 8)
				top = Math.max(8, window.innerHeight - 8 - m.height);
		} else {
			top = a.bottom + margin;
			left = a.left;
			if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - margin);
			if (left + m.width > window.innerWidth - 8) left = Math.max(8, a.right - m.width);
		}
		pos = { top, left };
	}

	function onDocPointerDown(e: PointerEvent) {
		if (!open) return;
		if (popEl?.contains(e.target as Node)) return;
		if (anchor?.contains(e.target as Node)) return;
		// the Add field flyout renders outside popEl, keep it from closing us
		if ((e.target as HTMLElement).closest?.('.menu')) return;
		open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		const n = ordered.length;
		if (e.key === 'Escape') {
			open = false;
			e.preventDefault();
		} else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
			e.preventDefault();
			if (n > 0) activeIndex = (activeIndex + 1) % n;
		} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
			e.preventDefault();
			if (n > 0) activeIndex = (activeIndex - 1 + n) % n;
		}
	}

	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			wasOpen = true;
			untrack(() => {
				confirmFor = null;
				activeIndex = 0;
				addOpen = false;
				defaultFor = null;
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
		if (!isOpen && wasOpen) wasOpen = false;
	});

	function confirmDelete(fieldId: string) {
		onDelete(fieldId);
		confirmFor = null;
	}

	// ── Per-field default (select / multiselect) ───────────────────────────────
	let defaultFor: string | null = $state(null);

	function hasDefaultSupport(f: ViewField): boolean {
		return f.type === 'select' || f.type === 'multiselect';
	}

	function fieldOptions(f: ViewField): { value: string; color: number }[] {
		return (f.config?.options ?? []) as { value: string; color: number }[];
	}

	function currentDefault(f: ViewField): string | null {
		const d = f.config?.default;
		if (Array.isArray(d)) return d[0] ?? null;
		return typeof d === 'string' ? d : null;
	}

	function setDefault(f: ViewField, value: string | null) {
		if (value === null) delete f.config.default;
		else f.config.default = f.type === 'multiselect' ? [value] : value;
		defaultFor = null;
	}
</script>

{#if open}
	<div
		class="pop"
		bind:this={popEl}
		style:top="{pos.top}px"
		style:left="{pos.left}px"
		role="menu"
		tabindex="-1"
	>
		<div class="pop-label">Fields</div>
		<div class="list">
			{#snippet fieldRow(field: ViewField, i: number, isShown: boolean)}
				{@const Icon = getFieldIcon(field.type)}
				<div
					class="row"
					class:active={i === activeIndex}
					class:confirming={confirmFor === field.id}
				>
					<span class="name" onmouseenter={() => (activeIndex = i)} role="presentation">
						<Icon size={14} strokeWidth={1.75} />
						<span class="name-text">{fieldLabel(field)}</span>
					</span>
					{#if confirmFor === field.id}
						<button
							class="icon-btn"
							type="button"
							tabindex="-1"
							aria-label="Cancel"
							onclick={(e) => {
								e.stopPropagation();
								confirmFor = null;
							}}
						>
							<ArrowLeft size={14} strokeWidth={2} />
						</button>
						<button
							class="confirm-btn"
							type="button"
							tabindex="-1"
							onclick={(e) => {
								e.stopPropagation();
								confirmDelete(field.id);
							}}
						>
							Confirm
						</button>
					{:else}
						{#if i === activeIndex}
							{#if hasDefaultSupport(field)}
								<button
									class="icon-btn"
									type="button"
									tabindex="-1"
									aria-label="Set default"
									title="Set default value"
									onclick={(e) => {
										e.stopPropagation();
										defaultFor = defaultFor === field.id ? null : field.id;
									}}
								>
									<Triangle size={14} strokeWidth={1.75} />
								</button>
							{/if}
							{#if !isDerived(field.type)}
								<button
									class="icon-btn danger"
									type="button"
									tabindex="-1"
									aria-label="Delete field"
									onclick={(e) => {
										e.stopPropagation();
										confirmFor = field.id;
									}}
								>
									<Trash2 size={14} strokeWidth={1.75} />
								</button>
							{/if}
						{/if}
						<button
							class="icon-btn vis"
							type="button"
							tabindex="-1"
							aria-label={isShown ? 'Hide in this face' : 'Show in this face'}
							title={isShown ? 'Hide' : 'Show'}
							onclick={(e) => {
								e.stopPropagation();
								onToggleVisible(field.id);
							}}
						>
							{#if isShown}<Eye size={14} strokeWidth={1.75} />{:else}<EyeOff
									size={14}
									strokeWidth={1.75}
								/>{/if}
						</button>
					{/if}
				</div>
				{#if defaultFor === field.id}
					<div class="default-panel">
						<div class="panel-label">Default value</div>
						<button
							class="default-opt"
							class:selected={currentDefault(field) === null}
							type="button"
							onclick={() => setDefault(field, null)}
						>
							<CircleSlash size={13} strokeWidth={1.75} />
							<span class="none-label">None</span>
							{#if currentDefault(field) === null}<Check size={13} strokeWidth={2} />{/if}
						</button>
						{#each fieldOptions(field) as opt (opt.value)}
							<button
								class="default-opt"
								class:selected={currentDefault(field) === opt.value}
								type="button"
								onclick={() => setDefault(field, opt.value)}
							>
								<span class="pill tag-c{opt.color}">{opt.value}</span>
								{#if currentDefault(field) === opt.value}<Check size={13} strokeWidth={2} />{/if}
							</button>
						{/each}
					</div>
				{/if}
			{/snippet}

			<div class="section-label">Default</div>
			{#each defaults as field, i (field.id)}
				{@render fieldRow(field, i, shownSet.has(field.id))}
			{/each}

			<div class="section-label">User fields</div>
			{#each custom as field, j (field.id)}
				{@render fieldRow(field, defaults.length + j, shownSet.has(field.id))}
			{:else}
				<div class="empty">No custom fields yet</div>
			{/each}
		</div>

		<div class="divider"></div>

		{#if canAddFields}
			<button
				class="add-toggle"
				type="button"
				bind:this={addEl}
				onclick={() => (addOpen = !addOpen)}
			>
				<Plus size={14} strokeWidth={1.75} />
				<span>Add field</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>
		{:else}
			<div class="add-hint">Save the view to add fields</div>
		{/if}
	</div>

	{#if canAddFields}
		<Menu
			bind:open={addOpen}
			anchor={addEl}
			items={addItems}
			onSelect={(v) => addField(v as ViewFieldType)}
			minWidth={160}
			placement="right"
		/>
	{/if}
{/if}

<style>
	.pop {
		position: fixed;
		z-index: 1000;
		min-width: 240px;
		max-width: 320px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: var(--menu-shadow);
		padding: 4px;
		font-family: var(--font-ui);
		font-size: 13px;
		color: var(--color-text-primary);
		max-height: 420px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.pop-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
		padding: 4px 8px 6px;
	}

	.list {
		overflow-y: auto;
		flex: 1;
		scrollbar-width: thin;
		scrollbar-color: var(--menu-scrollbar-thumb) transparent;
	}

	.section-label {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
		padding: 8px 8px 4px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-right: 4px;
		border-radius: 5px;
	}

	.row.active {
		background: var(--menu-item-hover);
	}

	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 8px;
		color: inherit;
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

	.row.confirming .name-text {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		align-self: center;
		width: 24px;
		height: 24px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.icon-btn:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
	}

	.icon-btn.vis {
		color: var(--color-ui-dulled);
	}

	.row.active .icon-btn.vis {
		color: var(--color-ui-muted);
	}

	.confirm-btn {
		flex-shrink: 0;
		align-self: center;
		height: 24px;
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

	.empty {
		padding: 8px 10px;
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border);
	}

	.add-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: var(--color-text-primary);
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.add-toggle:hover {
		background: var(--menu-item-hover);
	}

	.add-hint {
		padding: 6px 8px;
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.add-toggle :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.add-toggle span {
		flex: 1;
	}

	.default-panel {
		padding: 2px 4px 6px 22px;
	}

	.panel-label {
		font-size: 11px;
		font-weight: 500;
		color: var(--color-ui-muted);
		padding: 2px 4px 4px;
	}

	.default-opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 8px;
		border: 0;
		background: transparent;
		border-radius: 5px;
		color: inherit;
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.default-opt:hover {
		background: var(--menu-item-hover);
	}

	.default-opt :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.default-opt.selected :global(svg:last-child) {
		color: var(--color-accent);
		margin-left: auto;
	}

	.none-label {
		color: var(--color-ui-muted);
	}

	.default-opt .pill {
		display: inline-flex;
		align-items: center;
		max-width: 180px;
		padding: 1px 8px;
		border-radius: 4px;
		font-size: 11px;
		line-height: 1.55;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%));
		color: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-fg-l, 30%));
	}
</style>
