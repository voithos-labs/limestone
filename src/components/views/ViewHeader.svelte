<script lang="ts">
    import type View from "$lib/models/View.svelte";
    import type {FilterNode, FilterLeaf, ViewField, ViewFieldType} from "$lib/models/View.svelte";
    import {VIEW_FIELD_OPS, sanitizeName} from "$lib/models/View.svelte";
    import Group from "$lib/models/Group";
    import {getSource, sourceName} from "$lib/models/Source";
    import FilterChipIsland from "./FilterChipIsland.svelte";
    import Menu from "./Menu.svelte";
    import ViewManageMenu from "./ViewManageMenu.svelte";
    import FaceSwitcher from "./FaceSwitcher.svelte";
    import EmojiPicker from "./EmojiPicker.svelte";
    import {getFieldIcon, getOpLabel, opHasValue, formatFilterValue, opsFor} from "$lib/views/filterDisplay";
    import {fieldLabel} from "$lib/views/fieldValue";
    import {ListFilterPlus, Funnel, ChevronLeft, ChevronRight, Search, Columns3Cog} from "@lucide/svelte";
    import IconAddNotes from "~icons/material-symbols/add-notes";
    import {onMount} from "svelte";

    let {view, onNew}: {
        view: View;
        onNew?: () => void;
    } = $props();

    const activeFace = $derived(
        view.faces.find(f => f.id === view.state.active_face_id) ?? view.faces[0]
    );

    const fieldsById = $derived(new Map(view.fields.map((f: ViewField) => [f.id, f])));

    const leafFilters: FilterLeaf[] = $derived(
        view.filter.children.filter((n: FilterNode): n is FilterLeaf => 'field_id' in n)
    );

    const sourceScopeId: string | undefined = $derived.by(() => {
        for (const leaf of leafFilters) {
            const field = fieldsById.get(leaf.field_id);
            if (field?.type === 'source' && leaf.op === 'eq' && typeof leaf.value === 'string') {
                return leaf.value;
            }
        }
        return undefined;
    });

    let groupNames: Record<string, string> = $state({});
    let sourceNames: Record<string, string> = $state({});

    $effect(() => {
        const groupIds = new Set<string>();
        const sourceIds = new Set<string>();
        for (const leaf of leafFilters) {
            const field = fieldsById.get(leaf.field_id);
            if (!field) continue;
            if (field.type === 'folder') {
                if (typeof leaf.value === 'string') groupIds.add(leaf.value);
            } else if (field.type === 'tags') {
                if (Array.isArray(leaf.value)) {
                    for (const v of leaf.value) if (typeof v === 'string') groupIds.add(v);
                }
            } else if (field.type === 'source') {
                if (typeof leaf.value === 'string') sourceIds.add(leaf.value);
            }
        }
        for (const id of groupIds) {
            if (id in groupNames) continue;
            Group.fromID(id)
                .then(g => {
                    groupNames = {...groupNames, [id]: g.slug};
                })
                .catch(() => {
                    groupNames = {...groupNames, [id]: id};
                });
        }
        for (const id of sourceIds) {
            if (id in sourceNames) continue;
            getSource(id)
                .then(s => {
                    sourceNames = {...sourceNames, [id]: sourceName(s)};
                })
                .catch(() => {
                    sourceNames = {...sourceNames, [id]: id};
                });
        }
    });

    function displayValue(leaf: FilterLeaf, field: ViewField | undefined): string | undefined {
        if (!opHasValue(leaf.op)) return undefined;
        if (!field) return formatFilterValue(leaf.value);
        if (field.type === 'tags') {
            const arr = Array.isArray(leaf.value) ? leaf.value : [];
            if (arr.length === 0) return '';
            return arr.map(id => groupNames[String(id)] ?? String(id)).join(', ');
        }
        if (field.type === 'folder') {
            if (typeof leaf.value !== 'string') return '';
            return groupNames[leaf.value] ?? leaf.value;
        }
        if (field.type === 'source') {
            if (typeof leaf.value !== 'string') return '';
            return sourceNames[leaf.value] ?? leaf.value;
        }
        if (field.type === 'boolean') {
            return leaf.value ? 'Checked' : 'Unchecked';
        }
        return formatFilterValue(leaf.value);
    }

    function valuePillsFor(leaf: FilterLeaf, field: ViewField | undefined) {
        if (!field || (leaf.op !== 'any_of' && leaf.op !== 'has_all')) return undefined;
        const vals = Array.isArray(leaf.value) ? leaf.value.filter((v): v is string => typeof v === 'string') : [];
        if (vals.length === 0) return undefined;
        const opts = (field.config?.options ?? []) as { value: string; color: number }[];
        return vals.map((v) => ({label: v, color: opts.find(o => o.value === v)?.color ?? 0}));
    }

    function removeFilter(node: FilterLeaf) {
        const i = view.filter.children.indexOf(node);
        if (i >= 0) view.filter.children.splice(i, 1);
    }

    function changeOp(node: FilterLeaf, newOp: string) {
        const wasArray = node.op === 'any_of' || node.op === 'has_all';
        const isArray = newOp === 'any_of' || newOp === 'has_all';
        node.op = newOp;
        if (wasArray !== isArray) node.value = isArray ? [] : null;
    }

    function changeValue(node: FilterLeaf, newValue: unknown) {
        node.value = newValue;
    }

    function defaultValueFor(field: ViewField): unknown {
        return field.type === 'tags' ? [] : null;
    }

    let addFilterEl: HTMLButtonElement | null = $state(null);
    let addFilterOpen = $state(false);

    const fieldPickerItems = $derived(view.fields.map((f: ViewField) => ({
        value: f.id,
        label: fieldLabel(f),
        icon: getFieldIcon(f.type)
    })));

    let pendingFocusLeaf: FilterLeaf | null = $state(null);

    function addFilterByField(fieldId: string) {
        const field = view.fields.find(f => f.id === fieldId);
        if (!field) return;
        const ops = VIEW_FIELD_OPS[field.type] ?? [];
        const op = ops[0] ?? 'eq';
        view.filter.children.push({
            field_id: field.id,
            op,
            value: defaultValueFor(field)
        });
        pendingFocusLeaf = view.filter.children[view.filter.children.length - 1] as FilterLeaf;
        if (view.state.filters_collapsed) view.state.filters_collapsed = false;
    }

    let chipsWidth = $state(0);
    let hasMounted = $state(false);
    onMount(() => {
        hasMounted = true;
    });

    // Translate vertical wheel into horizontal scroll over the overflowing bar
    function onFilterWheel(e: WheelEvent) {
        const el = e.currentTarget as HTMLElement;
        if (el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        el.scrollLeft += e.deltaY;
        e.preventDefault();
    }

    // ── View management menu ─────────────────────────────────────────────────
    let manageEl: HTMLButtonElement | null = $state(null);
    let manageOpen = $state(false);

    function deleteField(id: string) {
        view.fields = view.fields.filter((f: ViewField) => f.id !== id);
        // Drop it from every face's displayed columns + filters referencing it
        for (const face of view.faces) {
            face.display_field_ids = face.display_field_ids.filter((fid: string) => fid !== id);
        }
        view.filter.children = view.filter.children.filter(
            (n: FilterNode) => !('field_id' in n) || n.field_id !== id
        );
    }

    function addField(type: ViewFieldType) {
        const field = view.addFieldOfType(type);
        // Surface the new column in the active face
        if (activeFace) activeFace.display_field_ids = [...activeFace.display_field_ids, field.id];
    }

    // ── Inline view-title (slug) editing — type-in-place, saved views only ────
    let slugDraft = $state(view.slug);

    async function commitSlug() {
        const next = sanitizeName(slugDraft);
        if (!next || next === view.slug) {
            slugDraft = view.slug;
            return;
        }
        try {
            await view.renameSlug(next);
            slugDraft = view.slug;
        } catch (e) {
            console.error(e);
            slugDraft = view.slug;
        }
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
        if (!view.temporary) view.save().catch(err => console.error('save view failed', err));
    }

    function toggleColumn(id: string) {
        if (!activeFace) return;
        if (activeFace.display_field_ids.includes(id)) {
            activeFace.display_field_ids = activeFace.display_field_ids.filter((fid: string) => fid !== id);
        } else {
            activeFace.display_field_ids = [...activeFace.display_field_ids, id];
        }
    }
</script>

<header class="view-header">
    <button class="view-emoji" bind:this={emojiAnchor} title="Set an emoji" onclick={() => emojiOpen = !emojiOpen}>
        {#if view.emoji}{view.emoji}{:else}<span class="view-emoji-empty">☆</span>{/if}
    </button>
    {#if view.temporary}
        <h2 class="view-title">{view.slug}</h2>
    {:else}
        <span class="title-field">
            <span class="title-ghost">{slugDraft || ' '}</span>
            <input
                    class="title-input"
                    bind:value={slugDraft}
                    onblur={commitSlug}
                    onkeydown={slugKey}
                    spellcheck="false"
            />
        </span>
    {/if}
    {#if view.temporary}
        <button class="save-view" type="button" onclick={() => view.save().catch(e => console.error('save view failed', e))}>
            <span>Save as view</span>
        </button>
    {/if}
</header>

<EmojiPicker bind:open={emojiOpen} anchor={emojiAnchor} onPick={setEmoji}/>

<div class="filter-bar" onwheel={onFilterWheel}>
    <FaceSwitcher {view} face={activeFace}/>

    <button
            class="manage-view"
            type="button"
            aria-label="Manage view"
            bind:this={manageEl}
            onclick={() => manageOpen = !manageOpen}
    >
        <Columns3Cog size={14} strokeWidth={1.75}/>
    </button>

    {#if leafFilters.length > 0}
        <button
                class="collapse-toggle"
                type="button"
                aria-label={view.state.filters_collapsed ? 'Show filters' : 'Hide filters'}
                onclick={() => view.state.filters_collapsed = !view.state.filters_collapsed}
        >
            <Funnel size={13} strokeWidth={1.75}/>
            {#if view.state.filters_collapsed}
                <ChevronRight size={13} strokeWidth={2}/>
            {:else}
                <ChevronLeft size={13} strokeWidth={2}/>
            {/if}
        </button>
    {/if}

    <div
            class="chips-wrap"
            class:collapsed={view.state.filters_collapsed}
            class:animate={hasMounted}
            style:max-width={view.state.filters_collapsed ? '0px' : chipsWidth + 'px'}
    >
        <div class="chips-inner" bind:clientWidth={chipsWidth}>
            {#each leafFilters as leaf (leaf)}
                {@const field = fieldsById.get(leaf.field_id)}
                <FilterChipIsland
                        icon={getFieldIcon(field?.type)}
                        fieldName={field ? fieldLabel(field) : 'unknown'}
                        operator={getOpLabel(leaf.op)}
                        opValue={leaf.op}
                        opOptions={opsFor(field?.type)}
                        value={displayValue(leaf, field)}
                        valuePills={valuePillsFor(leaf, field)}
                        rawValue={leaf.value}
                        {field}
                        sourceId={sourceScopeId}
                        autoOpenValue={leaf === pendingFocusLeaf}
                        onOpChange={(op) => changeOp(leaf, op)}
                        onValueChange={(v) => changeValue(leaf, v)}
                        onRemove={() => removeFilter(leaf)}
                />
            {/each}
            <button
                    class="add-filter"
                    type="button"
                    aria-label="Add filter"
                    bind:this={addFilterEl}
                    onclick={() => addFilterOpen = !addFilterOpen}
            >
                <ListFilterPlus size={14} strokeWidth={2}/>
            </button>
        </div>
    </div>
    <Menu
            bind:open={addFilterOpen}
            anchor={addFilterEl}
            items={fieldPickerItems}
            onSelect={addFilterByField}
            searchable={fieldPickerItems.length > 7}
            placeholder="Search fields…"
    />

    <label class="search-chip">
        <Search size={13} strokeWidth={1.75}/>
        <input
                type="text"
                class="search-input"
                placeholder="Search…"
                value={(view.state.search ?? '')}
                oninput={(e) => view.state.search = (e.currentTarget as HTMLInputElement).value}
        />
    </label>


    <button class="new-entry" type="button" onclick={() => onNew?.()}>
        <IconAddNotes width={17} height={17}/>
        <!--        <span>New</span>-->
    </button>
    <ViewManageMenu
            bind:open={manageOpen}
            anchor={manageEl}
            fields={view.fields}
            shownIds={activeFace.display_field_ids}
            canAddFields={!view.temporary}
            onToggleVisible={toggleColumn}
            onDelete={deleteField}
            onAddField={addField}
    />
</div>

<style>
    .view-header {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 12px;
        padding-right: 24px;
        flex-shrink: 0;
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

    .view-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.2;
        color: var(--color-text-primary);
        transform: translateY(-1px);
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

    .filter-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        padding-right: 24px;
        flex-shrink: 0;
        /* Scroll horizontally in place when the row is too wide, no visible bar */
        overflow-x: auto;
        scrollbar-width: none;
    }

    .filter-bar::-webkit-scrollbar {
        display: none;
    }

    .collapse-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        height: 28px;
        padding: 0 7px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .collapse-toggle:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .chips-wrap {
        overflow: hidden;
        flex-shrink: 0;
    }

    .chips-wrap.collapsed {
        margin-left: -6px;
    }

    .chips-wrap.animate {
        transition: max-width 240ms ease, margin-left 240ms ease;
    }

    .chips-inner {
        display: flex;
        gap: 6px;
        width: max-content;
    }

    .chips-wrap.animate .chips-inner {
        transition: transform 240ms ease, opacity 160ms ease;
    }

    .chips-wrap.collapsed .chips-inner {
        opacity: 0;
        transform: translateX(-10px);
    }

    .add-filter {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0 10px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .add-filter:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .new-entry {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 11px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .new-entry:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .save-view {
        margin-left: auto;
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

    .manage-view {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        padding: 0 10px;
        flex-shrink: 0;
        background: var(--chip-bg);
        border: none;
        border-radius: 6px;
        color: var(--color-ui-muted);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
    }

    .manage-view:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .search-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 9px;
        flex: 1;
        min-width: 80px;
        background: transparent;
        border-radius: 6px;
        color: var(--color-ui-muted);
        font-family: var(--font-ui);
        font-size: 12px;
        line-height: 1.45;
        transition: background-color 120ms ease, color 120ms ease;
        cursor: text;
    }

    .search-chip:hover {
        background: var(--chip-bg);
        color: var(--color-text-secondary);
    }

    .search-chip:focus-within {
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
</style>
