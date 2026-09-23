<script lang="ts">
	import { untrack } from 'svelte';
	import { flip } from 'svelte/animate';
	import {
		ChevronDown,
		List,
		Layers,
		Rows3,
		Tags,
		Pencil,
		Copy,
		Trash2,
		Plus,
		ArrowLeft,
		NotebookText,
		FileText,
		LayoutDashboard,
		LayoutGrid,
		LayoutPanelTop,
		CalendarClock,
		ScanLine,
		Pin,
		ScanBarcode,
		ChevronRight
	} from '@lucide/svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, ViewFaceType, ViewField, FilterNode } from '$lib/models/View.svelte';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import { getFaceIcon, getFieldIcon } from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import Menu from './Menu.svelte';
	import { dashboardSections, DASH_SECTION_LABEL } from '$lib/views/dashboard';

	let { view, face }: { view: View; face: ViewFace } = $props();

	const faceIcon = getFaceIcon;
	const SwitchIcon = $derived(faceIcon(face));

	// A journal is a day navigator around a body face, so the options that belong to
	// what's actually drawn (fields, sort, grouping) act on the body.
	const target = $derived(face.type === 'journal' ? (face.body ?? face) : face);

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

	// ── Journal (compound face) ──────────────────────────────────────────────
	let bodyEl: HTMLButtonElement | null = $state(null);
	let bodyOpen = $state(false);

	const bodyValue = $derived(face.body?.type ?? 'doc');
	const BODY_ITEMS = [
		{ value: 'doc', label: 'Document', icon: FileText },
		{ value: 'list', label: 'List', icon: List },
		{ value: 'masonry', label: 'Masonry', icon: LayoutDashboard }
	];
	const bodyLabel = $derived(BODY_ITEMS.find((i) => i.value === bodyValue)?.label ?? 'Document');
	const BodyIcon = $derived(BODY_ITEMS.find((i) => i.value === bodyValue)?.icon ?? FileText);

	function setBody(v: string) {
		if (v !== bodyValue) view.setFaceBody(face, v as ViewFaceType);
		bodyOpen = false;
	}

	let dateFieldEl: HTMLButtonElement | null = $state(null);
	let dateFieldOpen = $state(false);

	const dateFieldKey = $derived((face.config.date_field as string) ?? 'created_at');
	const dateFieldItems = $derived([
		{ value: 'created_at', label: 'Created', icon: getFieldIcon('created_at') },
		{ value: 'updated_at', label: 'Updated', icon: getFieldIcon('updated_at') },
		...view.fields
			.filter((f: ViewField) => f.type === 'date')
			.map((f: ViewField) => ({ value: f.id, label: fieldLabel(f), icon: getFieldIcon(f.type) }))
	]);
	const dateFieldLabel = $derived(
		dateFieldItems.find((i) => i.value === dateFieldKey)?.label ?? 'Created'
	);

	function setDateField(v: string) {
		face.config.date_field = v;
		dateFieldOpen = false;
	}

	const showActivity = $derived(face.config.show_activity === true);
	const stickyDays = $derived(face.config.sticky_days !== false);

	// a project face's sections: which ones show
	let sectionsEl: HTMLButtonElement | null = $state(null);
	let sectionsOpen = $state(false);
	const sectionItems = $derived(
		dashboardSections(target).map((s) => ({
			value: s.id,
			label: DASH_SECTION_LABEL[s.id],
			keepOpen: true
		}))
	);
	const shownSections = $derived(
		dashboardSections(target)
			.filter((s) => !s.hidden)
			.map((s) => s.id)
	);
	function toggleSection(id: string) {
		const all = dashboardSections(target);
		const next = all.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s));
		if (next.every((s) => s.hidden)) return;
		target.config.sections = next;
	}

	function toggleActivity() {
		face.config.show_activity = !showActivity;
	}

	const groupable = $derived(
		view.fields.filter(
			(f: ViewField) =>
				f.type === 'select' ||
				f.type === 'multiselect' ||
				f.type === 'boolean' ||
				f.type === 'folder'
		)
	);
	const groupById = $derived((target.config.group_by ?? null) as string | null);
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
		if (justDragged) return;
		view.state.active_face_id = id;
		closeOnSwapLeave = true;
	}

	function onPopLeave() {
		if (dragId) return;
		if (!closeOnSwapLeave) return;
		if (groupOpen || addFaceOpen || renamingId || confirmFor) return;
		if (bodyOpen || dateFieldOpen) return;
		open = false;
	}

	let addFaceOpen = $state(false);
	let addFaceEl: HTMLElement | null = $state(null);
	const ADD_FACE_ITEMS = [
		{ value: 'dashboard', label: 'Dashboard', icon: LayoutPanelTop },
		{ value: 'list', label: 'List', icon: List },
		{ value: 'grid', label: 'Grid', icon: LayoutGrid },
		{ value: 'masonry', label: 'Masonry', icon: LayoutDashboard },
		{ value: 'doc', label: 'Document', icon: FileText },
		{ value: 'journal', label: 'Journal', icon: NotebookText }
	];

	// a grid is a list face that starts in cards
	function addFaceOfType(type: string) {
		addFaceOpen = false;
		const f = view.addFace((type === 'grid' ? 'list' : type) as ViewFaceType);
		if (type === 'grid') f.config.layout = 'grid';
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

	const DRAG_PX = 4;
	let dragArm: { id: string; x: number; y: number } | null = null;
	let dragId: string | null = $state(null);
	let dragOrder: string[] | null = $state(null);
	let justDragged = false;

	const displayFaces = $derived.by(() => {
		if (!dragOrder) return view.faces;
		return dragOrder
			.map((id) => view.faces.find((f) => f.id === id))
			.filter((f): f is ViewFace => !!f);
	});

	function armDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		if (renamingId || confirmFor) return;
		if ((e.target as HTMLElement).closest('.icon-btn, .confirm-btn, input')) return;
		dragArm = { id, x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
		window.addEventListener('keydown', onDragKey, true);
	}

	function onDragMove(e: PointerEvent) {
		if (!dragArm) return;
		if (!dragId) {
			if (Math.hypot(e.clientX - dragArm.x, e.clientY - dragArm.y) < DRAG_PX) return;
			dragId = dragArm.id;
			dragOrder = view.faces.map((f) => f.id);
		}
		if (!dragOrder) return;
		const rows = popEl ? Array.from(popEl.querySelectorAll<HTMLElement>('.list > .row')) : [];
		const cur = dragOrder.indexOf(dragId);
		if (cur < 0 || rows.length !== dragOrder.length) return;
		let next = cur;
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i].getBoundingClientRect();
			const mid = r.top + r.height / 2;
			if (i < cur && e.clientY < mid) {
				next = i;
				break;
			}
			if (i > cur && e.clientY > mid) next = i;
		}
		if (next !== cur) {
			const order = [...dragOrder];
			order.splice(cur, 1);
			order.splice(next, 0, dragId);
			dragOrder = order;
		}
	}

	function onDragUp() {
		if (dragId && dragOrder) {
			const order = dragOrder;
			if (order.some((id, i) => view.faces[i]?.id !== id))
				view.faces = order
					.map((id) => view.faces.find((f) => f.id === id))
					.filter((f): f is ViewFace => !!f);
			justDragged = true;
			setTimeout(() => (justDragged = false), 0);
		}
		dragCleanup();
	}

	function onDragKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && dragId) {
			e.stopPropagation();
			e.preventDefault();
			dragCleanup();
		}
	}

	function dragCleanup() {
		dragArm = null;
		dragId = null;
		dragOrder = null;
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
		window.removeEventListener('keydown', onDragKey, true);
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
		target.config.group_by = id || null;
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

	function anyFlyoutOpen(): boolean {
		return (
			addFaceOpen ||
			sectionsOpen ||
			groupOpen ||
			bodyOpen ||
			dateFieldOpen ||
			!!renamingId ||
			!!confirmFor
		);
	}

	function navEls(): HTMLElement[] {
		return popEl
			? Array.from(popEl.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])'))
			: [];
	}

	function focusRel(delta: number) {
		const els = navEls();
		if (els.length === 0) return;
		const cur = els.indexOf(document.activeElement as HTMLElement);
		const base = cur === -1 ? (delta > 0 ? -1 : 0) : cur;
		els[(base + delta + els.length) % els.length].focus();
	}

	function focusFirstNav() {
		const els = navEls();
		(els.find((el) => el.closest('.row.active')) ?? els[0])?.focus();
	}

	function onKey(e: KeyboardEvent) {
		if (!open || anyFlyoutOpen()) return;
		if (e.key === 'Escape') {
			open = false;
			e.preventDefault();
		} else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
			focusRel(1);
			e.preventDefault();
		} else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
			focusRel(-1);
			e.preventDefault();
		} else if (e.key === 'ArrowRight') {
			const el = document.activeElement as HTMLElement | null;
			if (el?.hasAttribute('data-flyout')) {
				el.click();
				e.preventDefault();
			}
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
				sectionsOpen = false;
				closeOnSwapLeave = false;
			});
			queueMicrotask(() => {
				position();
				focusFirstNav();
			});
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
		if (!open) {
			wasOpen = false;
			dragCleanup();
		}
	});
</script>

<button class="face-switch" type="button" bind:this={anchorEl} onclick={() => (open = !open)}>
	<SwitchIcon size={15} strokeWidth={1.75} />
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
		<div class="list" class:dragging={!!dragId}>
			{#each displayFaces as f (f.id)}
				<div
					class="row"
					class:active={f.id === view.state.active_face_id}
					class:confirming={confirmFor === f.id}
					class:drag-src={dragId === f.id}
					animate:flip={{ duration: 160 }}
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
						{@const RowIcon = faceIcon(f)}
						<button
							class="name"
							type="button"
							data-nav
							onpointerdown={(e) => armDrag(e, f.id)}
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
							>Confirm</button
						>
					{:else}
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
				data-nav
				data-flyout
				bind:this={addFaceEl}
				onclick={() => (addFaceOpen = !addFaceOpen)}
			>
				<Plus size={14} strokeWidth={1.75} />
				<span>Add face</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>
			<Menu
				bind:open={addFaceOpen}
				anchor={addFaceEl}
				items={ADD_FACE_ITEMS}
				onSelect={addFaceOfType}
				minWidth={150}
				placement="right"
			/>
		</div>

		<div class="divider edge"></div>

		<div class="face-scope">
			<SwitchIcon size={13} strokeWidth={2} />
			<span class="face-scope-name">{face.label}</span>
			<span class="face-scope-tag">Options</span>
		</div>

		{#if target.type === 'dashboard'}
			<button
				class="action group-toggle"
				type="button"
				data-nav
				onclick={() => (target.config.hide_chips = !target.config.hide_chips)}
			>
				<Tags size={14} strokeWidth={1.75} />
				<span>Quick filters</span>
				<span class="trailing">{target.config.hide_chips ? 'Off' : 'On'}</span>
			</button>
			<button
				class="action group-toggle"
				type="button"
				data-nav
				data-flyout
				bind:this={sectionsEl}
				onclick={() => (sectionsOpen = !sectionsOpen)}
			>
				<Rows3 size={14} strokeWidth={1.75} />
				<span>Sections</span>
				<span class="trailing">{shownSections.length} of {sectionItems.length}</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>
		{/if}

		{#if target.type === 'list'}
			<button
				class="action group-toggle"
				type="button"
				data-nav
				data-flyout
				bind:this={groupEl}
				onclick={() => (groupOpen = !groupOpen)}
			>
				<Layers size={14} strokeWidth={1.75} />
				<span>Group by</span>
				<span class="trailing">{groupLabel}</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>
		{/if}

		{#if face.type === 'journal'}
			<button
				class="action group-toggle"
				type="button"
				data-nav
				data-flyout
				bind:this={bodyEl}
				onclick={() => (bodyOpen = !bodyOpen)}
			>
				<BodyIcon size={14} strokeWidth={1.75} />
				<span>Day shows</span>
				<span class="trailing">{bodyLabel}</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>

			<button
				class="action group-toggle"
				type="button"
				data-nav
				data-flyout
				bind:this={dateFieldEl}
				onclick={() => (dateFieldOpen = !dateFieldOpen)}
			>
				<CalendarClock size={14} strokeWidth={1.75} />
				<span>Date field</span>
				<span class="trailing">{dateFieldLabel}</span>
				<ChevronRight size={13} strokeWidth={2} />
			</button>

			<button class="action group-toggle" type="button" data-nav onclick={toggleActivity}>
				{#if showActivity}
					<ScanLine size={14} strokeWidth={1.75} />
				{:else}
					<ScanBarcode size={14} strokeWidth={1.75} />
				{/if}
				<span>Activity timeline</span>
				<span class="trailing">{showActivity ? 'On' : 'Off'}</span>
			</button>
			<button
				class="action group-toggle"
				type="button"
				data-nav
				onclick={() => (face.config.sticky_days = !stickyDays)}
			>
				<Pin size={14} strokeWidth={1.75} />
				<span>Sticky date bar</span>
				<span class="trailing">{stickyDays ? 'On' : 'Off'}</span>
			</button>
		{/if}
	</div>

	{#if target.type === 'dashboard'}
		<Menu
			bind:open={sectionsOpen}
			anchor={sectionsEl}
			items={sectionItems}
			multiple
			selectedValues={shownSections}
			onSelect={toggleSection}
			minWidth={170}
			placement="right"
		/>
	{/if}

	{#if target.type === 'list'}
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

	{#if face.type === 'journal'}
		<Menu
			bind:open={bodyOpen}
			anchor={bodyEl}
			items={BODY_ITEMS}
			selected={bodyValue}
			onSelect={setBody}
			minWidth={150}
			placement="right"
		/>
		<Menu
			bind:open={dateFieldOpen}
			anchor={dateFieldEl}
			items={dateFieldItems}
			selected={dateFieldKey}
			onSelect={setDateField}
			minWidth={160}
			placement="right"
		/>
	{/if}
{/if}

<style>
	.face-switch {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 11px 0 10px;
		flex-shrink: 0;
		background: var(--chip-bg);
		border: none;
		border-radius: 8px;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
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
		width: 240px;
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

	.face-scope {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 7px 2px;
		padding: 5px 9px;
		background: var(--chip-bg);
		border-radius: 6px;
	}

	.face-scope :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.face-scope-name {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--color-ui-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.face-scope-tag {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-dulled);
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

	.list.dragging,
	.list.dragging * {
		cursor: grabbing;
	}

	.list.dragging .row:hover {
		background: transparent;
	}

	.list.dragging .row:hover .icon-btn {
		opacity: 0;
	}

	.row.drag-src,
	.list.dragging .row.drag-src:hover {
		background: var(--menu-item-hover);
		opacity: 0.65;
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
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.row:hover .check {
		display: none;
	}

	.confirm-btn {
		flex-shrink: 0;
		align-self: center;
		height: 24px;
		padding: 0 10px;
		border: 0;
		border-radius: 5px;
		background: var(--error-bg);
		color: var(--error-fg);
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.confirm-btn:hover {
		background: var(--error-a18);
	}

	.divider {
		height: 1px;
		margin: 4px 6px;
		background: var(--color-border);
	}

	/* Edge-to-edge divider between major sections (bleeds past the pop's padding) */
	.divider.edge {
		margin: 6px -4px;
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

	.pop [data-nav]:focus-visible {
		outline: none;
		box-shadow: none;
	}

	.pop .action:focus-visible {
		background: var(--menu-item-hover);
	}

	.pop .row:has(.name:focus-visible) {
		background: var(--menu-item-hover);
	}

	.action :global(svg) {
		flex-shrink: 0;
		color: var(--color-ui-muted);
	}

	.group-toggle span:first-of-type,
	.add-face span:first-of-type {
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
