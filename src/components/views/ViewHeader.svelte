<script lang="ts">
	import type View from '$lib/models/View.svelte';
	import type { ViewField, ViewFieldType } from '$lib/models/View.svelte';
	import { sanitizeName } from '$lib/models/View.svelte';
	import Folder, { folderIdSource, folderIdPath } from '$lib/models/Folder';
	import Tag, { tagSlug } from '$lib/models/Tag';
	import { toasts } from '$lib/toasts.svelte';
	import FaceSwitcher from './FaceSwitcher.svelte';
	import ViewManageMenu from './ViewManageMenu.svelte';
	import ArrangeFields from './ArrangeFields.svelte';
	import FilterEditor from './FilterEditor.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import DocPickerPanel from './DocPicker.svelte';
	import type { DocPicker } from '$lib/views/docPicker.svelte';
	import { getFaceIcon, getFieldIcon } from '$lib/views/filterDisplay';
	import { fieldLabel } from '$lib/views/fieldValue';
	import { VIEW_FIELD_SORTABLE } from '$lib/models/View.svelte';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import Menu from './Menu.svelte';
	import {
		Funnel,
		ChevronDown,
		Search,
		EllipsisVertical,
		Columns3Cog,
		X,
		TextCursorInput,
		ArrowDownUp,
		ArrowUpAZ,
		ArrowDownAZ,
		RotateCcw
	} from '@lucide/svelte';
	import { untrack } from 'svelte';

	let {
		view,
		hasCover = false,
		docPicker,
		onMore
	}: {
		view: View;
		hasCover?: boolean;
		docPicker?: DocPicker;
		onMore?: (anchor: HTMLElement) => void;
	} = $props();

	const activeFace = $derived(
		view.faces.find((f) => f.id === view.state.active_face_id) ?? view.faces[0]
	);

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
		view.renameField(f, newName).catch((e) => console.error('rename field failed', e));
	}

	// a journal searches whatever it renders for the day
	const effectiveType = $derived(
		activeFace?.type === 'journal' ? activeFace.body?.type : activeFace?.type
	);

	const searchMode = $derived(effectiveType === 'table' ? 'title' : 'hybrid');

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
		if (!picking) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (view.state.search) view.state.search = '';
			else picking.open = false;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const first = picking.results[0];
			if (first) picking.pick(first.id);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			picking.open = true;
		}
	}

	// ── Filters popover: view filters and the active face's subfilters ─────────
	let filtersEl: HTMLButtonElement | null = $state(null);
	let filtersPopEl: HTMLDivElement | null = $state(null);
	let filtersOpen = $state(false);

	// ── Sort: lives with the filters, it's the same question (what rows, in what order) ──
	const sortTarget = $derived(
		activeFace && activeFace.type !== 'table' && activeFace.type !== 'dashboard'
			? activeFace.type === 'journal'
				? (activeFace.body ?? null)
				: activeFace
			: null
	);
	const sortFieldId = $derived(sortTarget?.sort[0]?.field_id ?? '');
	const sortDir = $derived(sortTarget?.sort[0]?.direction ?? 'desc');
	const sortField = $derived(view.fields.find((f) => f.id === sortFieldId));
	let sortEl: HTMLButtonElement | null = $state(null);
	let sortOpen = $state(false);
	const sortItems = $derived.by((): MenuEntry[] => [
		{ value: '', label: 'Default', icon: ArrowDownUp },
		...view.fields
			.filter((f) => VIEW_FIELD_SORTABLE.has(f.type))
			.map((f) => ({ value: f.id, label: fieldLabel(f), icon: getFieldIcon(f.type) }))
	]);

	// a hand-made order (rows dragged in the list) overrides the sort until the sort is
	// touched again or reset here
	const manualOrder = $derived(
		((sortTarget?.config.order as string[] | undefined) ?? []).length > 0
	);

	function setSortField(v: string) {
		sortOpen = false;
		if (!sortTarget) return;
		sortTarget.config.order = undefined;
		sortTarget.sort = v ? [{ field_id: v, direction: sortDir }] : [];
	}

	function flipSort() {
		if (!sortTarget) return;
		sortTarget.config.order = undefined;
		const fid = sortFieldId || view.fields.find((f) => f.type === 'updated_at')?.id;
		if (fid) sortTarget.sort = [{ field_id: fid, direction: sortDir === 'asc' ? 'desc' : 'asc' }];
	}

	function resetOrder() {
		if (sortTarget) sortTarget.config.order = undefined;
	}

	const editInPlace = $derived(fieldTarget?.config.edit_in_place === true);
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

	export function focusTitle() {
		titleEl?.focus();
		titleEl?.select();
	}
	const slugEmpty = $derived(!sanitizeName(slugDraft));

	$effect(() => {
		if (view.temporary && !view.unit) {
			const next = sanitizeName(slugDraft);
			if (next) view.slug = next;
		}
	});

	function commitSlug() {
		const next = sanitizeName(slugDraft);
		if (next && view.unit) void renameUnit(view.unit, next);
		else if (next) view.renameSlug(next);
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
			toasts.push(Folder.describeOpError(e, "That couldn't be renamed."));
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
			{#if view.emoji}{view.emoji}{:else}<span class="view-emoji-empty">☆</span>{/if}
		</button>
	{/if}
	<span class="title-field">
		<span class="title-ghost">{slugDraft || ' '}</span>
		<input
			class="title-input"
			class:invalid={slugEmpty}
			bind:this={titleEl}
			bind:value={slugDraft}
			onblur={commitSlug}
			onkeydown={slugKey}
			spellcheck="false"
		/>
	</span>
{/snippet}

{#snippet saveButton()}
	<span class="save-actions">
		<button
			class="save-view"
			type="button"
			onclick={() => view.save().catch((e) => console.error('save view failed', e))}
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
	{:else if !view.cover}
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

<div class="filter-bar">
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
				if (fieldTarget.type === 'list') arrangeOpen = true;
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
			canToggle={fieldTarget.type !== 'doc'}
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
				<div class="sort-row">
					<span class="sort-label"><ArrowDownUp size={12} strokeWidth={1.75} />Sort</span>
					<button
						class="sort-field"
						type="button"
						bind:this={sortEl}
						onclick={() => (sortOpen = !sortOpen)}
					>
						{manualOrder ? 'Manual' : sortField ? fieldLabel(sortField) : 'Default'}
						<ChevronDown size={12} strokeWidth={2} />
					</button>
					{#if manualOrder}
						<button class="sort-dir" type="button" title="Reset order" onclick={resetOrder}>
							<RotateCcw size={13} strokeWidth={1.75} />
						</button>
					{/if}
					<button
						class="sort-dir"
						type="button"
						title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
						onclick={flipSort}
					>
						{#if sortDir === 'asc'}
							<ArrowUpAZ size={14} strokeWidth={1.75} />
						{:else}
							<ArrowDownAZ size={14} strokeWidth={1.75} />
						{/if}
					</button>
				</div>
			{/if}
		</div>
		<Menu
			bind:open={sortOpen}
			anchor={sortEl}
			items={sortItems}
			selectedValues={[sortFieldId]}
			onSelect={setSortField}
			minWidth={170}
		/>
	{/if}

	{#if fieldTarget?.type === 'list'}
		<button
			class="collapse-toggle"
			class:on={editInPlace}
			type="button"
			aria-label="Edit in place"
			title="Edit in place"
			onclick={() => {
				if (fieldTarget) fieldTarget.config.edit_in_place = !editInPlace;
			}}
		>
			<TextCursorInput size={15} strokeWidth={1.75} />
		</button>
	{/if}

	<label class="search-chip" bind:this={searchChipEl}>
		<Search size={14} strokeWidth={1.75} />
		<input
			type="text"
			class="search-input"
			placeholder={picking
				? 'Find a document'
				: searchMode === 'hybrid'
					? 'Search'
					: 'Search titles'}
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
		margin-left: -24px;
		padding: 8px 20px 6px 24px;
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

	.view-emoji-empty {
		color: var(--color-ui-dulled);
		opacity: 0.6;
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

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		margin-left: -6px;
		padding-left: 6px;
		padding-right: 24px;
		flex-shrink: 0;
		/* Scroll horizontally in place when the row is too wide, no visible bar */
		overflow-x: auto;
		scrollbar-width: none;
	}

	.filter-bar::-webkit-scrollbar {
		display: none;
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

	.collapse-toggle.on {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.sort-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px 4px 8px;
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

	.sort-field {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		height: 22px;
		padding: 0 6px 0 8px;
		border: 0;
		border-radius: 5px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 12px;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.sort-field:hover {
		background: var(--chip-bg-hover);
	}

	.sort-dir {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.sort-dir:hover {
		background: var(--chip-bg-hover);
		color: var(--color-text-primary);
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
