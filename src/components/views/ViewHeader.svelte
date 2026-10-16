<script lang="ts">
	import { reportError } from '#lib/overlays.svelte.js';
	import { mark } from '#lib/overlays.svelte.js';
	import type View from '#lib/models/View.svelte.js';
	import type { ViewField, ViewFieldType } from '#lib/models/View.svelte.js';
	import { sanitizeName } from '#lib/models/View.svelte.js';
	import Folder, { folderId, folderIdSource, folderIdPath } from '#lib/models/Folder.js';
	import Tag, { tagSlug } from '#lib/models/Tag.js';
	import FaceSwitcher from './FaceSwitcher.svelte';
	import ViewManageMenu from './ViewManageMenu.svelte';
	import ArrangeFields from './ArrangeFields.svelte';
	import FilterEditor from './FilterEditor.svelte';
	import EmojiPicker from './editors/EmojiPicker.svelte';
	import DocPickerPanel from './DocPicker.svelte';
	import type { DocPicker } from '#lib/views/project.svelte.js';
	import { getFaceIcon, fieldMenuEntries, getFieldIcon } from '#lib/views/filterDisplay.js';
	import { fieldLabel } from '#lib/views/fieldValue.js';
	import { VIEW_FIELD_SORTABLE, MANUAL_SORT } from '#lib/models/View.svelte.js';
	import type { MenuEntry } from '#lib/overlays.svelte.js';
	import Menu from '../ui/Menu.svelte';
	import {
		Funnel,
		ChevronDown,
		Plus,
		Search,
		EllipsisVertical,
		Columns3Cog,
		X,
		ArrowDownUp,
		ArrowUpAZ,
		ArrowDownAZ,
		GripVertical,
		Globe,
		ChevronRight,
		SquareArrowOutUpRight,
		BetweenHorizontalStart,
		BetweenVerticalEnd
	} from '@lucide/svelte';
	import { tick, untrack } from 'svelte';
	import { ctxMenu } from '#lib/overlays.svelte.js';
	import { nameGuard, type NameKind } from '#lib/util/paths.js';
	import QuickFilterBar from './QuickFilterBar.svelte';

	let {
		view,
		hasCover = false,
		docPicker,
		onMore,
		onOpenNewTab,
		titleProblem = () => null
	}: {
		view: View;
		hasCover?: boolean;
		docPicker?: DocPicker;
		onMore?: (anchor: HTMLElement) => void;
		onOpenNewTab?: (id: string, name: string) => void;
		titleProblem?: (name: string) => string | null;
	} = $props();

	const activeFace = $derived(
		view.faces.find((f) => f.id === view.state.active_face_id) ?? view.faces[0]
	);
	const quickField = $derived(view.quickFilterField(activeFace));

	// ── Fields (columns shown in the active face; a journal's body is the face) ───
	const fieldTarget = $derived(
		activeFace?.type === 'journal' ? (activeFace.body ?? activeFace) : activeFace
	);
	let fieldsEl: HTMLButtonElement | null = $state(null);
	let fieldsOpen = $state(false);

	// arranging fields is a list-face thing; the control sits in a quiet strip under the bar
	// and only shows itself when the pointer is there
	let arrangeOpen = $state(false);

	function toggleColumn(id: string) {
		const t = fieldTarget;
		if (!t) return;
		t.display_field_ids = t.display_field_ids.includes(id)
			? t.display_field_ids.filter((fid) => fid !== id)
			: [...t.display_field_ids, id];
	}

	function addField(type: ViewFieldType): ViewField {
		const field = view.addFieldOfType(type);
		if (fieldTarget) fieldTarget.display_field_ids = [...fieldTarget.display_field_ids, field.id];
		return field;
	}

	function renameField(fieldId: string, raw: string) {
		const f = view.fields.find((ff) => ff.id === fieldId);
		if (!f) return;
		const newName = sanitizeName(raw);
		if (!newName || newName === f.name) return;
		view
			.renameField(f, newName)
			.catch((e) => reportError(e, `The field "${f.name}" couldn't be renamed.`));
	}

	// A doc face draws one document, so its search picks which one, a dropdown under this bar
	// instead of filtering rows in place. A journal searches in place (its hits list) even
	// with a doc body, so only a bare doc face picks
	const picking = $derived(activeFace?.type === 'doc' ? docPicker : undefined);

	let searchChipEl: HTMLElement | null = $state(null);
	$effect(() => {
		if (picking) picking.anchor = searchChipEl;
	});

	$effect(() => {
		if (!picking && docPicker?.open) docPicker.open = false;
	});

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (view.state.search) view.state.search = '';
			else if (picking?.open) picking.open = false;
			else (e.currentTarget as HTMLInputElement).blur();
			return;
		}
		if (!picking) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			const first = picking.results[0];
			if (first) picking.pick(first.id);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			picking.open = true;
		}
	}

	// ── Group: a list groups by anything groupable or nothing; a board's columns need a select or boolean ──
	const groupTarget = $derived(
		fieldTarget && (fieldTarget.type === 'list' || fieldTarget.type === 'kanban') ? fieldTarget : null
	);
	let groupEl: HTMLButtonElement | null = $state(null);
	let groupOpen = $state(false);
	const groupById = $derived((groupTarget?.config.group_by ?? null) as string | null);
	const groupLabel = $derived.by(() => {
		const f = groupById ? view.fields.find((ff) => ff.id === groupById) : null;
		return f ? fieldLabel(f) : 'None';
	});
	const groupItems = $derived.by((): MenuEntry[] => {
		const kinds: ViewFieldType[] =
			groupTarget?.type === 'kanban'
				? ['select', 'boolean']
				: ['select', 'multiselect', 'boolean', 'folder'];
		const fields = fieldMenuEntries(view.fields.filter((f: ViewField) => kinds.includes(f.type)));
		return groupTarget?.type === 'kanban'
			? fields
			: [{ value: '', label: "Don't group", icon: X }, { kind: 'divider' }, ...fields];
	});

	function setGroup(id: string) {
		if (groupTarget) groupTarget.config.group_by = id || null;
		groupOpen = false;
	}

	// ── Filters popover: view filters and the active face's subfilters ─────────
	let filtersEl: HTMLButtonElement | null = $state(null);
	let filtersPopEl: HTMLDivElement | null = $state(null);
	let filtersOpen = $state(false);

	// ── Sort: lives with the filters, it's the same question (what rows, in what order) ──
	const sortTarget = $derived(
		activeFace && activeFace.type !== 'dashboard'
			? activeFace.type === 'journal'
				? (activeFace.body ?? null)
				: activeFace
			: null
	);
	const sortKeys = $derived(sortTarget?.sort ?? []);
	let sortEl: HTMLButtonElement | null = $state(null);
	let sortOpen = $state(false);
	let sortAt = $state(0);
	const sortItems = $derived.by((): MenuEntry[] => {
		const used = new Set(sortKeys.map((k, i) => (i === sortAt ? '' : k.field_id)));
		const fields = fieldMenuEntries(
			view.fields.filter((f) => VIEW_FIELD_SORTABLE.has(f.type) && !used.has(f.id))
		);
		if (sortAt > 0) return fields;
		return [
			{ value: '', label: 'Default', icon: ArrowDownUp },
			{ value: MANUAL_SORT, label: 'Manual', icon: GripVertical },
			...fields
		];
	});
	const sortable = $derived(view.fields.filter((f) => VIEW_FIELD_SORTABLE.has(f.type)).length);

	// under the manual sort, rows go where they were dragged; any other sort snaps them back
	const manualOrder = $derived(sortKeys[0]?.field_id === MANUAL_SORT);

	function openSort(e: MouseEvent, at: number) {
		sortEl = e.currentTarget as HTMLButtonElement;
		sortAt = at;
		sortOpen = true;
	}

	function sortName(fid: string): string {
		if (fid === MANUAL_SORT) return 'Manual';
		const f = view.fields.find((x) => x.id === fid);
		return f ? fieldLabel(f) : fid;
	}

	function sortIcon(fid: string) {
		if (fid === MANUAL_SORT) return GripVertical;
		const f = view.fields.find((x) => x.id === fid);
		return f ? getFieldIcon(f.type) : ArrowDownUp;
	}

	function setSortField(v: string) {
		sortOpen = false;
		if (!sortTarget) return;
		if (!v) sortTarget.sort = [];
		else if (v === MANUAL_SORT) sortTarget.sort = [{ field_id: v, direction: 'asc' }];
		else {
			const next = [...sortKeys].filter((k) => k.field_id !== MANUAL_SORT);
			const dir = next[sortAt]?.direction ?? 'desc';
			next[Math.min(sortAt, next.length)] = { field_id: v, direction: dir };
			sortTarget.sort = next;
		}
	}

	function flipSort(i: number) {
		if (!sortTarget) return;
		sortTarget.sort = sortKeys.map((k, j) =>
			j === i ? { ...k, direction: k.direction === 'asc' ? 'desc' : 'asc' } : k
		);
	}

	function removeSort(i: number) {
		if (sortTarget) sortTarget.sort = sortKeys.filter((_, j) => j !== i);
	}

	let filtersPos: { top: number; left: number } = $state({ top: 0, left: 0 });

	function positionFilters() {
		if (!filtersEl || !filtersPopEl) return;
		const a = filtersEl.getBoundingClientRect();
		const m = filtersPopEl.getBoundingClientRect();
		let left = a.left;
		if (left + m.width > window.innerWidth - 8) left = Math.max(8, a.right - m.width);
		filtersPos = { top: a.bottom + 4, left };
	}

	function onFiltersPointerDown(e: PointerEvent) {
		if (!filtersOpen) return;
		const t = e.target as HTMLElement;
		if (filtersPopEl?.contains(t) || filtersEl?.contains(t)) return;
		if (t.closest?.('.menu, .pop')) return;
		filtersOpen = false;
	}

	$effect(() => {
		if (!filtersOpen) return;
		queueMicrotask(positionFilters);
		window.addEventListener('resize', positionFilters);
		document.addEventListener('pointerdown', onFiltersPointerDown);
		return () => {
			window.removeEventListener('resize', positionFilters);
			document.removeEventListener('pointerdown', onFiltersPointerDown);
		};
	});

	// ── Inline view-title editing, type-in-place. A unit view is named by its unit ────
	let slugDraft = $state(untrack(() => view.slug));
	let titleEl: HTMLInputElement | null = $state(null);

	export async function focusTitle() {
		if (view.subfolder) {
			view.state.folder = undefined;
			await tick();
		}
		titleEl?.focus();
		titleEl?.select();
	}

	const crumbs = $derived.by(() => {
		const sub = view.subfolder;
		const unit = view.unit;
		if (!sub || !unit) return [];
		const base = folderIdPath(unit);
		const parts = folderIdPath(sub)
			.slice(base ? base.length + 1 : 0)
			.split('/');
		return parts.map((slug, i) => ({
			slug,
			id: folderId(folderIdSource(unit), [base, ...parts.slice(0, i + 1)].filter(Boolean).join('/'))
		}));
	});

	const crumbMenu = (id: string, name: string) => () =>
		onOpenNewTab
			? [
					{
						label: 'Open in new tab',
						icon: SquareArrowOutUpRight,
						action: () => onOpenNewTab(id, name)
					}
				]
			: [];
	const slugEmpty = $derived(!sanitizeName(slugDraft));
	const slugTrouble = $derived(
		slugDraft.trim() === view.slug ? null : titleProblem(sanitizeName(slugDraft))
	);
	const titleKind = $derived<NameKind>(
		view.unit?.startsWith('folder:') ? 'project' : view.unit?.startsWith('tag:') ? 'tag' : 'ident'
	);

	$effect(() => {
		if (view.temporary && !view.unit) {
			const next = sanitizeName(slugDraft);
			if (next) view.slug = next;
		}
	});

	function commitSlug() {
		const next = sanitizeName(slugDraft);
		if (next && !slugTrouble) {
			if (view.unit) void renameUnit(view.unit, next);
			else view.renameSlug(next);
		}
		slugDraft = view.slug;
	}

	// a unit view is named by its unit, so renaming the title renames the folder or tag
	async function renameUnit(unit: string, name: string) {
		if (name === view.slug) return;
		try {
			if (unit.startsWith('folder:')) {
				const sourceId = folderIdSource(unit);
				const path = folderIdPath(unit);
				if (!path) return;
				const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
				const newId = await Folder.move(sourceId, path, `${parent}${name}`);
				view.retarget(unit, newId, true);
				view.slug = (await Folder.fromID(newId)).slug;
			} else if (unit.startsWith('tag:')) {
				const tag = await Tag.fromID(unit);
				const newId = await Tag.rename(tag, name);
				view.retarget(unit, newId);
				view.slug = tagSlug(name);
			}
		} catch (e) {
			const report = unit.startsWith('tag:') ? reportError : Folder.reportOpError;
			const kind = unit.startsWith('tag:') ? 'tag' : 'folder';
			report(e, `${mark(kind, view.slug)} couldn't be renamed.`, () => renameUnit(unit, name));
		}
		slugDraft = view.slug;
	}

	function slugKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'Escape') {
			slugDraft = view.slug;
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	// ── Emoji ─────────────────────────────────────────────────────────────────
	let emojiOpen = $state(false);
	let emojiAnchor: HTMLElement | null = $state(null);

	function setEmoji(emoji: string) {
		view.emoji = emoji;
	}
</script>

{#snippet titleBlock()}
	{#if !view.temporary}
		<button
			class="view-emoji"
			bind:this={emojiAnchor}
			title="Set an emoji"
			onclick={() => (emojiOpen = !emojiOpen)}
		>
			{#if view.emoji}{view.emoji}{:else}<Globe size={16} strokeWidth={1.75} />{/if}
		</button>
	{/if}
	{#if crumbs.length > 0}
		<span class="title-field">
			<span class="title-ghost">{view.slug}</span>
			<button
				class="title-input title-root"
				type="button"
				onclick={() => (view.state.folder = undefined)}
				use:ctxMenu={crumbMenu(view.unit ?? '', view.slug)}>{view.slug}</button
			>
		</span>
		<span class="crumbs">
			{#each crumbs as c, i (c.id)}
				<ChevronRight size={15} strokeWidth={2} class="crumb-sep" />
				{#if i === crumbs.length - 1}
					<span class="crumb current" use:ctxMenu={crumbMenu(c.id, c.slug)}>{c.slug}</span>
				{:else}
					<button
						class="crumb"
						type="button"
						onclick={() => (view.state.folder = c.id)}
						use:ctxMenu={crumbMenu(c.id, c.slug)}>{c.slug}</button
					>
				{/if}
			{/each}
		</span>
	{:else}
		<span class="title-field">
			<span class="title-ghost">{slugDraft || ' '}</span>
			<input
				class="title-input"
				class:invalid={slugEmpty || slugTrouble}
				title={slugTrouble ?? undefined}
				bind:this={titleEl}
				bind:value={slugDraft}
				use:nameGuard={titleKind}
				onblur={commitSlug}
				onkeydown={slugKey}
				spellcheck="false"
			/>
		</span>
	{/if}
{/snippet}

{#snippet saveButton()}
	<span class="save-actions">
		<button
			class="save-view"
			type="button"
			onclick={() =>
				view.save().catch((e) => reportError(e, "This view's changes couldn't be saved."))}
		>
			<span>Save as view</span>
		</button>
		{#if view.isDirty}
			<span class="save-sep" aria-hidden="true">|</span>
			<button
				class="save-view"
				type="button"
				onclick={() => {
					view.revert();
					slugDraft = view.slug;
				}}
			>
				<span>Revert</span>
			</button>
		{/if}
	</span>
{/snippet}

{#snippet moreButton()}
	<button
		class="more-btn"
		type="button"
		aria-label="More"
		onclick={(e) => onMore?.(e.currentTarget as HTMLElement)}
	>
		<EllipsisVertical size={16} />
	</button>
{/snippet}

{#snippet actionButton()}
	{#if view.temporary && !view.unit}
		{@render saveButton()}
	{:else if !hasCover}
		{@render moreButton()}
	{/if}
{/snippet}

{#if hasCover}
	<header class="view-header has-cover">
		<div class="title-block on-cover">
			{@render titleBlock()}
		</div>
		{@render actionButton()}
	</header>
{/if}

<EmojiPicker bind:open={emojiOpen} anchor={emojiAnchor} onPick={setEmoji} />

<div class="filter-bar" class:covered={hasCover}>
	{#if !hasCover}
		<div class="title-inline">
			{@render titleBlock()}
		</div>
		<div class="title-divider"></div>
	{/if}

	<FaceSwitcher {view} face={activeFace} />

	{#if fieldTarget}
		<button
			class="collapse-toggle"
			type="button"
			aria-label="Fields"
			title="Fields"
			bind:this={fieldsEl}
			onclick={() => {
				if (['list', 'kanban', 'masonry'].includes(fieldTarget.type)) arrangeOpen = true;
				else fieldsOpen = !fieldsOpen;
			}}
		>
			<Columns3Cog size={15} strokeWidth={1.75} />
		</button>
		<ViewManageMenu
			bind:open={fieldsOpen}
			anchor={fieldsEl}
			title={view.unit ? `${view.slug} fields` : 'Fields'}
			fields={view.fields}
			shownIds={fieldTarget.display_field_ids}
			canAddFields={!view.temporary && !!view.unit}
			canToggle={fieldTarget.type !== 'doc' && fieldTarget.type !== 'dashboard'}
			onToggleVisible={toggleColumn}
			onDelete={(id) => view.removeField(id)}
			onAddField={addField}
			onRename={renameField}
		/>
	{/if}

	<button
		class="collapse-toggle"
		type="button"
		aria-label="Filters"
		title="Filters"
		bind:this={filtersEl}
		onclick={() => (filtersOpen = !filtersOpen)}
	>
		<Funnel size={15} strokeWidth={1.75} />
	</button>

	{#if filtersOpen}
		<div
			class="pop filters-pop"
			bind:this={filtersPopEl}
			style:top="{filtersPos.top}px"
			style:left="{filtersPos.left}px"
			role="menu"
			tabindex="-1"
		>
			<FilterEditor {view} filter={view.filter} label="Filters" showUnit />
			{#if activeFace}
				<div class="divider"></div>
				<FilterEditor
					{view}
					filter={activeFace.additive_filter}
					label="{activeFace.label} subfilters"
					icon={getFaceIcon(activeFace)}
				/>
			{/if}
			{#if sortTarget}
				<div class="divider"></div>
				<div class="sort-head">
					<span class="sort-label"><ArrowDownUp size={12} strokeWidth={1.75} />Sort</span>
					{#if sortKeys.length > 0 && !manualOrder && sortKeys.length < sortable}
						<button
							class="sort-add"
							type="button"
							aria-label="Then sort by"
							title="Then by"
							onclick={(e) => openSort(e, sortKeys.length)}
						>
							<Plus size={14} strokeWidth={2} />
						</button>
					{/if}
				</div>
				<div class="sort-list">
					{#if sortKeys.length === 0}
						<div class="sort-chip">
							<button class="seg seg-field" type="button" onclick={(e) => openSort(e, 0)}>
								<ArrowDownUp size={12} strokeWidth={2} />
								<span class="seg-label">Default</span>
								<ChevronDown size={11} strokeWidth={2} />
							</button>
						</div>
					{:else}
						{#each sortKeys as k, i (k.field_id)}
							{@const Icon = sortIcon(k.field_id)}
							<div class="sort-chip">
								<button class="seg seg-field" type="button" onclick={(e) => openSort(e, i)}>
									<Icon size={12} strokeWidth={2} />
									<span class="seg-label">{sortName(k.field_id)}</span>
									<ChevronDown size={11} strokeWidth={2} />
								</button>
								{#if k.field_id !== MANUAL_SORT}
									<button
										class="seg seg-dir"
										type="button"
										title={k.direction === 'asc' ? 'Ascending' : 'Descending'}
										onclick={() => flipSort(i)}
									>
										{#if k.direction === 'asc'}
											<ArrowUpAZ size={13} strokeWidth={1.75} />
										{:else}
											<ArrowDownAZ size={13} strokeWidth={1.75} />
										{/if}
									</button>
									<button
										class="seg seg-remove"
										type="button"
										aria-label="Remove sort"
										onclick={() => removeSort(i)}
									>
										<X size={12} strokeWidth={2} />
									</button>
								{/if}
							</div>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
		<Menu
			bind:open={sortOpen}
			anchor={sortEl}
			items={sortItems}
			selectedValues={[sortKeys[sortAt]?.field_id ?? '']}
			onSelect={setSortField}
			minWidth={170}
		/>
	{/if}

	{#if groupTarget}
		<button
			class="collapse-toggle"
			class:on={!!groupById}
			type="button"
			aria-label={groupTarget.type === 'kanban' ? 'Columns' : 'Group by'}
			title={groupTarget.type === 'kanban' ? `Columns: ${groupLabel}` : `Group by: ${groupLabel}`}
			bind:this={groupEl}
			onclick={() => (groupOpen = !groupOpen)}
		>
			{#if groupTarget.type === 'kanban'}
				<BetweenVerticalEnd size={15} strokeWidth={1.75} />
			{:else}
				<BetweenHorizontalStart size={15} strokeWidth={1.75} />
			{/if}
		</button>
		<Menu
			bind:open={groupOpen}
			anchor={groupEl}
			items={groupItems}
			selected={groupById ?? ''}
			onSelect={setGroup}
			minWidth={170}
		>
			{#snippet header()}
				<span class="menu-title">{groupTarget.type === 'kanban' ? 'Columns' : 'Group by'}</span>
			{/snippet}
		</Menu>
	{/if}

	<label class="search-chip" bind:this={searchChipEl}>
		<Search size={14} strokeWidth={1.75} />
		<input
			type="text"
			class="search-input"
			placeholder={picking ? 'Find a document' : 'Search'}
			value={view.state.search ?? ''}
			oninput={(e) => {
				view.state.search = (e.currentTarget as HTMLInputElement).value;
				if (picking) picking.open = true;
			}}
			onfocus={() => picking && (picking.open = true)}
			onkeydown={onSearchKey}
		/>
		{#if view.state.search}
			<button
				class="search-clear"
				type="button"
				title="Clear"
				onclick={() => (view.state.search = '')}
			>
				<X size={12} strokeWidth={2} />
			</button>
		{/if}
		{#if picking}
			<button
				class="search-toggle"
				type="button"
				aria-label="Browse documents"
				onclick={(e) => {
					e.preventDefault();
					picking.open = !picking.open;
				}}
			>
				<ChevronDown size={13} strokeWidth={2} />
			</button>
		{/if}
	</label>

	{#if !hasCover && (!view.temporary || view.unit)}
		{@render moreButton()}
	{/if}
</div>

{#if quickField && activeFace && activeFace.type !== 'journal' && activeFace.type !== 'doc'}
	<div class="quick" class:covered={hasCover}>
		<QuickFilterBar {view} face={activeFace} field={quickField} />
	</div>
{/if}

{#if fieldTarget}
	<ArrangeFields
		bind:open={arrangeOpen}
		{view}
		face={fieldTarget}
		canManage={!view.temporary && !!view.unit}
		onAddField={addField}
		onRename={renameField}
		onDelete={(id) => view.removeField(id)}
	/>
{/if}

{#if !hasCover && view.temporary && !view.unit}
	<div class="save-row">
		{@render saveButton()}
	</div>
{/if}

{#if picking}
	<DocPickerPanel picker={picking} query={view.state.search ?? ''} />
{/if}

<style>
	.view-header {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		margin-bottom: 12px;
		padding-right: 24px;
		flex-shrink: 0;
	}

	.title-inline {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		margin-right: 5px;
		max-width: 40%;
	}

	.title-divider {
		width: 1px;
		height: 22px;
		margin-right: 6px;
		background: var(--color-border);
		border-radius: 999px;
		flex-shrink: 0;
	}

	.title-inline .view-emoji {
		width: 24px;
		height: 24px;
		margin-left: -5px;
		font-size: 16px;
		border-radius: 5px;
	}

	.title-inline .title-ghost,
	.title-inline .title-input {
		font-size: 18px;
	}

	.title-inline .title-field {
		transform: none;
	}

	.title-block.on-cover {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		position: relative;
		z-index: 1;
		margin-top: -32px;
		margin-left: -6px;
		padding: 8px 20px 6px 6px;
		background: var(--color-surface);
		border-radius: 0 10px 0 0;
	}

	.view-emoji {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6em;
		height: 1.6em;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		font-size: 18px;
		line-height: 1;
		color: var(--color-text-primary);
		cursor: pointer;
		flex-shrink: 0;
		align-self: center;
	}

	.view-emoji:hover {
		background: var(--chip-bg);
	}

	.view-emoji :global(svg) {
		color: var(--color-ui-dulled);
	}

	.view-emoji:hover :global(svg) {
		color: var(--color-ui-muted);
	}

	.title-field {
		position: relative;
		display: inline-block;
		max-width: 100%;
		transform: translateY(-1px);
	}

	.title-ghost,
	.title-input {
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.01em;
		padding: 0;
	}

	.title-ghost {
		white-space: pre;
		visibility: hidden;
	}

	.title-input {
		position: absolute;
		inset: 0;
		width: 100%;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
	}

	.title-input.invalid {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.title-root {
		text-align: left;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.title-root:hover {
		color: var(--color-text-primary);
	}

	.crumbs {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		transform: translateY(-1px);
	}

	.title-inline .crumbs {
		transform: none;
	}

	.crumb {
		padding: 0 3px;
		border: none;
		border-radius: 5px;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.01em;
		color: var(--color-ui-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	button.crumb:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.crumb.current {
		color: var(--color-text-primary);
		cursor: default;
	}

	.crumbs :global(.crumb-sep) {
		flex-shrink: 0;
		color: var(--color-ui-dulled);
	}

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		margin-left: -6px;
		margin-right: 24px;
		padding-left: 6px;
		flex-shrink: 0;
		/* Scroll horizontally in place when the row is too wide, no visible bar */
		overflow-x: auto;
		scrollbar-width: none;
	}

	.filter-bar::-webkit-scrollbar {
		display: none;
	}

	.quick {
		margin-left: -6px;
		padding-left: 6px;
	}

	.quick.covered {
		padding-left: 0;
	}

	/* under a cover the title sits in its own block above; the bar's leading room for the
	   emoji button isn't needed, so the face switcher lines up with the title's edge */
	.filter-bar.covered {
		padding-left: 0;
	}

	/* the two icon buttons stay quiet between the bar's anchors: the face on the left,
	   the search on the right */
	.collapse-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		width: 32px;
		height: 32px;
		padding: 0;
		flex-shrink: 0;
		background: transparent;
		border: none;
		border-radius: 8px;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.collapse-toggle:hover {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.menu-title {
		display: block;
		padding: 2px 6px 0;
		font-family: var(--font-ui);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-dulled);
	}

	.collapse-toggle.on {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.sort-head {
		display: flex;
		align-items: center;
		height: 26px;
		padding: 2px 4px 0 8px;
	}

	.sort-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.sort-add:hover {
		background: var(--menu-item-hover);
		color: var(--color-text-primary);
	}

	.sort-list {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 5px;
		padding: 2px 2px 4px;
	}

	.sort-chip {
		display: flex;
		align-items: stretch;
		height: 28px;
		border-radius: 6px;
		background: var(--chip-bg);
		font-size: 12px;
		line-height: 1.45;
		color: var(--color-ui-muted);
		overflow: hidden;
		transition: background-color 100ms ease;
	}

	.sort-chip:hover {
		background: var(--chip-bg-hover);
	}

	.seg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 9px;
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color 100ms ease,
			color 100ms ease;
	}

	.seg:hover {
		background: var(--chip-seg-hover);
		color: var(--color-text-secondary);
	}

	.seg:active {
		background: var(--chip-seg-active);
	}

	.seg-field {
		flex: 1 1 auto;
		min-width: 0;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.seg-field .seg-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}

	.seg-field :global(svg) {
		color: var(--color-ui-muted);
		flex-shrink: 0;
	}

	.seg-dir {
		padding-left: 8px;
		padding-right: 8px;
	}

	.seg-remove {
		padding: 0 7px;
	}

	.seg-remove:hover {
		color: var(--color-text-primary);
	}

	.sort-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ui-muted);
	}

	.pop.filters-pop {
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

	.filters-pop .divider {
		height: 1px;
		margin: 10px 6px 4px;
		background: var(--color-border);
	}

	.more-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-left: auto;
		width: 32px;
		height: 32px;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.more-btn:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}

	.save-row {
		display: flex;
		justify-content: center;
		margin-bottom: 14px;
		padding-right: 24px;
	}

	.save-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.save-sep {
		color: var(--color-border);
		font-size: 12px;
		user-select: none;
	}

	.save-view {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: none;
		border: none;
		padding: 0;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.save-view:hover {
		color: var(--color-text-primary);
		text-decoration: underline;
	}

	.search-chip {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 13px;
		flex: 1;
		min-width: 80px;
		background: var(--chip-bg);
		border-radius: 999px;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 13px;
		line-height: 1.45;
		transition:
			background-color 120ms ease,
			color 120ms ease;
		cursor: text;
	}

	.search-chip:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-secondary);
	}

	.search-chip:focus-within,
	.search-chip:has(.search-input:not(:placeholder-shown)) {
		background: var(--chip-bg-hover);
		color: var(--color-text-secondary);
	}

	.search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		outline: none;
		font: inherit;
		color: var(--color-text-primary);
		padding: 0;
	}

	.search-input::placeholder {
		color: var(--color-ui-muted);
	}

	.search-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.search-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.search-toggle:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg-hover);
	}

	.search-clear:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg-hover);
	}
</style>
