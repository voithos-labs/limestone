<script lang="ts">
    /**
     * Todo:
     * - better auto scaling
     * - in-line editing that actually works
     */
    import type View from "$lib/models/View.svelte";
    import type {FilterNode, ViewFace, SortKey, ViewField, ViewFieldType} from "$lib/models/View.svelte";
    import {isLeafActive, isDerived, CREATABLE_FIELD_TYPES} from "$lib/models/View.svelte";
    import {getFieldIcon} from "$lib/views/filterDisplay";
    import {formatDateFriendly, formatDateISO} from "$lib/views/dateFormat";
    import type {SearchResult} from "$lib/types/SearchResult";
    import Menu from "../Menu.svelte";
    import {
        Plus,
        ArrowUpAZ,
        ArrowDownAZ,
        EyeOff,
        Trash2,
        ChevronDown,
        SquareArrowOutUpRight,
        Circle,
        CircleDot
    } from "@lucide/svelte";
    import {getSource, listSources} from "$lib/models/Source";
    import FilterValueEditor from "../FilterValueEditor.svelte";
    import SelectOptionEditor from "../SelectOptionEditor.svelte";
    import LeanScroll from "../LeanScroll.svelte";
    import {invoke} from "@tauri-apps/api/core";
    import {onMount} from "svelte";

    let {view, face, onMeta, onOpenRow}: {
        view: View;
        face: ViewFace;
        onMeta?: (m: { loading: boolean; count: number; elapsedMs: number }) => void;
        onOpenRow?: (rowId: string) => void;
    } = $props();

    const query = $derived((view.state.search as string | undefined) ?? '');

    interface Row {
        id: string;
        title: string;
        rel_path: string;
        created_at: string;
        updated_at: string;
        properties: string;
        source_id: string;
    }

    interface ColumnDef {
        field: ViewField;
    }

    const MIN_COL_WIDTH = 60;

    let rows: Row[] = $state([]);
    let error = $state('');
    let loading = $state(true);
    let elapsedMs = $state(0);

    const columns: ColumnDef[] = $derived(
        face.display_field_ids
            .map((fid) => {
                const f = view.fields.find((ff) => ff.id === fid);
                return f ? {field: f} : null;
            })
            .filter((c): c is ColumnDef => !!c)
    );

    const widths = $derived(face.config.column_widths ?? {});

    // Only a boolean in the FIRST column becomes the compact square checkbox column (ClickUp style)
    const checkColIndex = $derived(columns[0]?.field.type === 'boolean' ? 0 : -1);
    const checkFieldId = $derived(checkColIndex === 0 ? columns[0].field.id : null);
    const lastDataIndex = $derived(
        checkColIndex === columns.length - 1 ? columns.length - 2 : columns.length - 1
    );

    // Fixed table layout: every column has a definite width (stable, no wobble, like notion)
    function defaultWidth(type: ViewFieldType): number {
        switch (type) {
            case 'path':
                return 300;
            case 'text':
                return 200;
            case 'multiselect':
                return 200;
            case 'tags':
                return 200;
            case 'id':
                return 220;
            case 'source':
                return 160;
            case 'select':
                return 150;
            case 'folder':
                return 180;
            case 'date':
            case 'created_at':
            case 'updated_at':
                return 150;
            case 'number':
                return 110;
            default:
                return 160;
        }
    }

    function cellStyle(col: ColumnDef): string {
        if (col.field.id === checkFieldId) {
            return 'width:var(--row-h);max-width:var(--row-h);min-width:var(--row-h)';
        }
        const w = widths[col.field.id];
        if (w) return `width:${w}px;max-width:${w}px;min-width:${w}px`;
        if (col.field.type === 'title') return '';
        return `width:${defaultWidth(col.field.type)}px`;
    }

    async function load() {
        loading = true;
        error = '';
        const start = performance.now();
        try {
            const q = query.trim();
            if (q) {
                const hits = await invoke<SearchResult[]>('search_documents', {query: q});
                const idsInOrder = hits.filter(r => r.kind === 'document').map(r => r.id);
                if (idsInOrder.length === 0) {
                    rows = [];
                } else {
                    const members = await view.getMembers({
                        face,
                        ids_in: idsInOrder,
                        limit: idsInOrder.length
                    }) as Row[];
                    const byId = new Map(members.map(r => [r.id, r]));
                    rows = idsInOrder.map(id => byId.get(id)).filter((r): r is Row => !!r);
                }
            } else {
                rows = await view.getMembers({face, limit: 200}) as Row[];
            }
        } catch (e) {
            error = String(e);
        } finally {
            elapsedMs = performance.now() - start;
            loading = false;
        }
    }

    onMount(load);

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSig: string | null = null;

    function nodeSig(n: FilterNode): string {
        if ('children' in n) {
            return `C|${n.op}|${n.children.map(nodeSig).join(',')}`;
        }
        return isLeafActive(n.op, n.value)
            ? `L|${n.field_id}|${n.op}|${String(n.value)}`
            : '';
    }

    function sortSig(keys: SortKey[]): string {
        return keys.map(k => `${k.field_id}|${k.direction}|${k.nulls ?? 'last'}`).join(',');
    }

    function fullSignature(): string {
        return [
            nodeSig(view.filter),
            nodeSig(face.additive_filter),
            sortSig(face.sort),
            query.trim()
        ].join('#');
    }

    $effect(() => {
        const sig = fullSignature();
        if (lastSig === null) {
            lastSig = sig;
            return;
        }
        if (sig === lastSig) return;
        lastSig = sig;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(load, 100);
    });

    $effect(() => {
        onMeta?.({loading, count: rows.length, elapsedMs});
    });

    function startResize(e: PointerEvent, col: ColumnDef) {
        e.preventDefault();
        e.stopPropagation();
        const fid = col.field.id;
        const startX = e.clientX;
        let startW = widths[fid];
        if (startW === undefined) {
            const th = (e.currentTarget as HTMLElement).closest('th') as HTMLElement | null;
            startW = th ? Math.round(th.getBoundingClientRect().width) : defaultWidth(col.field.type);
        }

        function onMove(ev: PointerEvent) {
            const w = Math.max(MIN_COL_WIDTH, Math.round(startW + (ev.clientX - startX)));
            if (!face.config.column_widths) face.config.column_widths = {};
            face.config.column_widths[fid] = w;
        }

        function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    function resetWidths() {
        face.config.column_widths = {};
    }

    // <!-- ── Column Reorder ───────────────────────────────────────────────────────── -->

    const DRAG_THRESHOLD = 4;
    let headerEls: HTMLElement[] = $state([]);
    let dragFieldId: string | null = $state(null);
    let dragDeltaX = $state(0);
    let dropIndex = $state(-1);
    let dragOriginalIndex = -1;
    let dragStartX = 0;
    let dragArmed = false;
    let didDrag = false;
    let headerLefts: number[] = [];
    let headerWidths: number[] = [];

    function onHeaderPointerDown(e: PointerEvent, index: number) {
        if (e.button !== 0) return;
        const t = e.target as HTMLElement;
        if (t.closest('.resize-handle') || t.closest('.add-btn') || t.closest('.th-rename')) return;
        dragArmed = true;
        didDrag = false;
        dragOriginalIndex = index;
        dragStartX = e.clientX;
        dragDeltaX = 0;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onHeaderPointerMove(e: PointerEvent) {
        if (!dragArmed) return;
        const dx = e.clientX - dragStartX;
        if (!didDrag && Math.abs(dx) < DRAG_THRESHOLD) return;
        if (!didDrag) {
            didDrag = true;
            dragFieldId = columns[dragOriginalIndex].field.id;
            dropIndex = dragOriginalIndex;
            headerLefts = headerEls.map((el) => el?.getBoundingClientRect().left ?? 0);
            headerWidths = headerEls.map((el) => el?.getBoundingClientRect().width ?? 0);
        }
        dragDeltaX = dx;
        const draggedLeft = headerLefts[dragOriginalIndex] + dx;
        const draggedRight = draggedLeft + headerWidths[dragOriginalIndex];
        let ni = dragOriginalIndex;
        for (let i = dragOriginalIndex + 1; i < headerEls.length; i++) {
            if (draggedRight > headerLefts[i] + headerWidths[i] / 2) ni = i;
            else break;
        }
        for (let i = dragOriginalIndex - 1; i >= 0; i--) {
            if (draggedLeft < headerLefts[i] + headerWidths[i] / 2) ni = i;
            else break;
        }
        dropIndex = ni;
    }

    function onHeaderPointerUp(e: PointerEvent, index: number) {
        if (!dragArmed) return;
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* not captured */
        }

        // Snapshot, then reset all drag state up-front so nothing below can leave us stuck mid-drag
        const wasDrag = didDrag;
        const fromIdx = dragOriginalIndex;
        const toIdx = dropIndex;
        dragArmed = false;
        didDrag = false;
        dragFieldId = null;
        dragDeltaX = 0;
        dropIndex = -1;

        if (wasDrag) {
            if (toIdx !== fromIdx && toIdx >= 0) {
                const fromId = columns[fromIdx].field.id;
                const toId = columns[toIdx].field.id;
                const ids = [...face.display_field_ids];
                const fromPos = ids.indexOf(fromId);
                const toPos = ids.indexOf(toId);
                if (fromPos >= 0 && toPos >= 0) {
                    ids.splice(fromPos, 1);
                    ids.splice(toPos, 0, fromId);
                    face.display_field_ids = ids;
                }
            }
        } else {
            openColumnMenu(e, columns[index].field.id);
        }
    }

    function dropEdge(index: number): '' | 'before' | 'after' {
        if (!didDrag || dropIndex === dragOriginalIndex || index !== dropIndex) return '';
        return dropIndex > dragOriginalIndex ? 'after' : 'before';
    }

    let menuOpen = $state(false);
    let menuAnchor: HTMLElement | null = $state(null);
    let menuFieldId: string | undefined = $state(undefined);

    const menuField = $derived(
        menuFieldId ? view.fields.find(f => f.id === menuFieldId) : undefined
    );

    const menuItems = $derived.by(() => {
        if (!menuField) return [];
        const items: any[] = [
            {value: 'sort_asc', label: 'Sort ascending', icon: ArrowUpAZ},
            {value: 'sort_desc', label: 'Sort descending', icon: ArrowDownAZ},
            {kind: 'divider'},
            {value: 'hide', label: 'Hide', icon: EyeOff},
        ];
        if (!isDerived(menuField.type)) {
            items.push({value: 'delete', label: 'Delete', icon: Trash2});
        }
        return items;
    });

    function openColumnMenu(e: MouseEvent, fid: string) {
        menuAnchor = e.currentTarget as HTMLElement;
        menuFieldId = fid;
        const f = view.fields.find(ff => ff.id === fid);
        renameDraft = f ? fieldLabel(f) : '';
        menuOpen = true;
    }

    function onColumnMenuSelect(action: string) {
        const fid = menuFieldId;
        if (!fid) return;
        switch (action) {
            case 'sort_asc':
                face.sort = [{field_id: fid, direction: 'asc'}];
                break;
            case 'sort_desc':
                face.sort = [{field_id: fid, direction: 'desc'}];
                break;
            case 'hide':
                hideField(fid);
                break;
            case 'delete':
                deleteField(fid);
                break;
        }
        menuFieldId = undefined;
    }

    function hideField(fid: string) {
        face.display_field_ids = face.display_field_ids.filter(id => id !== fid);
        if (face.config.column_widths) delete face.config.column_widths[fid];
    }

    function deleteField(fid: string) {
        view.fields = view.fields.filter(f => f.id !== fid);
        face.display_field_ids = face.display_field_ids.filter(id => id !== fid);
        if (face.config.column_widths) delete face.config.column_widths[fid];
    }

    let renameDraft = $state('');
    let renameInput: HTMLInputElement | null = $state(null);
    let isCommitting = false;

    async function commitRename() {
        if (isCommitting) return;
        const fid = menuFieldId;
        if (!fid) return;
        const f = view.fields.find(ff => ff.id === fid);
        if (!f) return;
        const raw = renameDraft.trim();
        if (!raw) return;
        if (isDerived(f.type)) {
            f.name = raw;
            return;
        }

        // Stateful fields: the name is the storage key (views.<slug>.<name>), so
        // it must be a safe identifier, and existing values have to be moved from
        // the old key to the new one across all soursces:
        const newName = raw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        const oldName = f.name;
        if (!newName || newName === oldName) {
            if (newName) f.name = newName;
            return;
        }

        isCommitting = true;
        try {
            const sources = await listSources();
            for (const s of sources) {
                await invoke('bulk_rename_view_field', {
                    sourceId: s.id,
                    sourcePath: s.path,
                    viewSlug: view.slug,
                    oldName,
                    newName
                });
            }
            f.name = newName;
            load();
        } catch (e) {
            error = String(e);
        } finally {
            isCommitting = false;
        }
    }

    $effect(() => {
        if (menuOpen && renameInput) {
            renameInput.focus();
            renameInput.select();
        }
    });

    let addMenuOpen = $state(false);
    let addAnchor: HTMLElement | null = $state(null);

    const hiddenFields = $derived(
        view.fields.filter(f => !face.display_field_ids.includes(f.id))
    );

    const addMenuItems = $derived.by(() => {
        const items: any[] = CREATABLE_FIELD_TYPES.map(t => ({
            value: `new:${t}`,
            label: t.charAt(0).toUpperCase() + t.slice(1),
            icon: getFieldIcon(t)
        }));
        if (hiddenFields.length > 0) {
            items.push({kind: 'divider'});
            items.push({
                value: 'existing',
                label: 'Existing field',
                children: hiddenFields.map(f => ({
                    value: `add:${f.id}`,
                    label: fieldLabel(f),
                    icon: getFieldIcon(f.type)
                }))
            });
        }
        return items;
    });

    function openAddMenu(e: MouseEvent) {
        addAnchor = e.currentTarget as HTMLElement;
        addMenuOpen = true;
    }

    function onAddMenuSelect(value: string) {
        addMenuOpen = false;
        if (value.startsWith('new:')) {
            const field = view.addFieldOfType(value.slice(4) as ViewFieldType);
            face.display_field_ids = [...face.display_field_ids, field.id];
        } else if (value.startsWith('add:')) {
            const fid = value.slice(4);
            if (!face.display_field_ids.includes(fid)) {
                face.display_field_ids = [...face.display_field_ids, fid];
            }
        }
    }

    function valueFor(field: ViewField, row: Row): string {
        switch (field.type) {
            case 'title':
                return row.title;
            case 'path':
                return row.rel_path;
            case 'id':
                return row.id;
            case 'created_at':
                return formatDateFriendly(row.created_at);
            case 'updated_at':
                return formatDateFriendly(row.updated_at);
            case 'date': {
                const v = rawStatefulValue(field, row);
                return v == null ? '' : formatDateFriendly(v as string);
            }
            case 'source':
            case 'tags':
            case 'folder':
                return '—';
            default:
                return statefulValue(field, row);
        }
    }

    function rawArrayValue(field: ViewField, row: Row): string[] {
        const v = rawStatefulValue(field, row);
        if (Array.isArray(v)) return v.map(String);
        if (v === null || v === undefined || v === '') return [];
        return [String(v)];
    }

    function tagClass(field: ViewField, value: string): string {
        const opts = (field.config?.options ?? []) as { value: string; color: number }[];
        const opt = opts.find((o) => o.value === value);
        if (opt) return `tag-c${opt.color}`;
        let h = 0;
        for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
        return `tag-c${h % 16}`;
    }

    function rawStatefulValue(field: ViewField, row: Row): unknown {
        try {
            const props = JSON.parse(row.properties || '{}');
            return props?.views?.[view.slug]?.[field.name] ?? null;
        } catch {
            return null;
        }
    }

    function statefulValue(field: ViewField, row: Row): string {
        const v = rawStatefulValue(field, row);
        if (v === undefined || v === null) return '';
        if (Array.isArray(v)) return v.join(', ');
        if (typeof v === 'boolean') return v ? '✓' : '';
        return String(v);
    }

    const EDITABLE = new Set<string>(CREATABLE_FIELD_TYPES);

    function isEditable(field: ViewField): boolean {
        return EDITABLE.has(field.type);
    }

    let editing: { rowId: string; fieldId: string } | null = $state(null);
    let editAnchor: HTMLElement | null = $state(null);
    let editOpen = $state(false);

    const editingField = $derived(
        editing ? view.fields.find(f => f.id === editing!.fieldId) : undefined
    );
    const editingRow = $derived(
        editing ? rows.find(r => r.id === editing!.rowId) : undefined
    );
    const editingValue = $derived(
        editingField && editingRow ? rawStatefulValue(editingField, editingRow) : null
    );

    $effect(() => {
        if (!editOpen) editing = null;
    });

    function onCellClick(e: MouseEvent, field: ViewField, row: Row) {
        if (!isEditable(field)) return;
        if (field.type === 'boolean') {
            const cur = rawStatefulValue(field, row);
            writeCell(field, row, cur === true ? false : true);
            return;
        }
        editing = {rowId: row.id, fieldId: field.id};
        editAnchor = e.currentTarget as HTMLElement;
        editOpen = true;
    }

    async function writeCell(field: ViewField, row: Row, value: unknown) {
        try {
            const source = await getSource(row.source_id);
            await invoke('bulk_set_view_field', {
                sourceId: row.source_id,
                sourcePath: source.path,
                viewSlug: view.slug,
                fieldName: field.name,
                value,
                docIds: [row.id]
            });
            applyLocal(row.id, field.name, value);
        } catch (e) {
            error = String(e);
        }
    }

    function applyLocal(rowId: string, name: string, value: unknown) {
        rows = rows.map(r => {
            if (r.id !== rowId) return r;
            let props: any;
            try {
                props = JSON.parse(r.properties || '{}');
            } catch {
                props = {};
            }
            props.views ??= {};
            props.views[view.slug] ??= {};
            const empty =
                value === null ||
                value === '' ||
                (Array.isArray(value) && value.length === 0);
            if (empty) {
                delete props.views[view.slug][name];
            } else {
                props.views[view.slug][name] = value;
            }
            return {...r, properties: JSON.stringify(props)};
        });
    }

    function titleFor(field: ViewField, row: Row): string {
        switch (field.type) {
            case 'created_at':
                return formatDateISO(row.created_at);
            case 'updated_at':
                return formatDateISO(row.updated_at);
            default:
                return valueFor(field, row);
        }
    }

    function cellClassFor(type: ViewFieldType): string {
        if (type === 'title') return 'cell-title';
        if (type === 'created_at' || type === 'updated_at') return 'cell-time';
        if (type === 'path' || type === 'id') return 'cell-mono';
        return 'cell-default';
    }

    const PRETTY_FIELD: Record<string, string> = {
        title: 'Title',
        id: 'ID',
        source: 'Source',
        tags: 'Tags',
        folder: 'Folder',
        path: 'Path',
        created_at: 'Created',
        updated_at: 'Updated'
    };

    // Built-in columns show a pretty title by default, once renamed (name no
    // longer equals the type slug) the user's name wins
    function fieldLabel(field: ViewField): string {
        if (field.name === field.type && PRETTY_FIELD[field.type]) return PRETTY_FIELD[field.type];
        return field.name;
    }
</script>

{#if error}
    <p class="error">{error}</p>
{/if}

{#snippet cellInner(field: ViewField, row: Row)}
    {#if field.type === 'boolean'}
        {@const on = rawStatefulValue(field, row) === true}
        <span class="bool" class:on>
            {#if on}<Circle size={15} strokeWidth={2} fill="currentColor"/>{:else}<Circle size={15}
                                                                                          strokeWidth={2}/>{/if}
        </span>
    {:else if field.type === 'select'}
        {@const v = statefulValue(field, row)}
        {#if v}<span class="pill {tagClass(field, v)}">{v}</span>{/if}
    {:else if field.type === 'multiselect'}
        {@const arr = rawArrayValue(field, row)}
        <span class="pills">
            {#each arr as t (t)}<span class="pill {tagClass(field, t)}">{t}</span>{/each}
        </span>
    {:else}
        {valueFor(field, row)}
    {/if}
{/snippet}

<LeanScroll>
    <table class="basic-table">
        <thead>
        <tr>
            {#each columns as col, idx (col.field.id)}
                {@const isAdd = idx === lastDataIndex}
                <th
                        class="col"
                        class:last={isAdd}
                        class:check-col={idx === checkColIndex}
                        class:dragging={dragFieldId === col.field.id}
                        class:drop-before={dropEdge(idx) === 'before'}
                        class:drop-after={dropEdge(idx) === 'after'}
                        bind:this={headerEls[idx]}
                        style={cellStyle(col)}
                        style:transform={dragFieldId === col.field.id ? `translateX(${dragDeltaX}px)` : ''}
                        title={idx === checkColIndex ? fieldLabel(col.field) : undefined}
                        onpointerdown={(e) => onHeaderPointerDown(e, idx)}
                        onpointermove={onHeaderPointerMove}
                        onpointerup={(e) => onHeaderPointerUp(e, idx)}
                >
                    {#if idx === checkColIndex}
                        <span class="th-check-icon"><CircleDot size={15} strokeWidth={2}/></span>
                        <span class="th-chevron"><ChevronDown size={11} strokeWidth={2}/></span>
                    {:else}
                        {@const Icon = getFieldIcon(col.field.type)}
                        <span class="th-inner">
                                <span class="th-icon"><Icon size={15} strokeWidth={1.75}/></span>
                                <span class="th-label">{fieldLabel(col.field)}</span>
                                <span class="th-chevron"><ChevronDown size={11} strokeWidth={2}/></span>
                            </span>
                    {/if}
                    {#if idx !== checkColIndex}
                            <span
                                    class="resize-handle"
                                    onpointerdown={(e) => startResize(e, col)}
                                    ondblclick={resetWidths}
                                    onclick={(e) => e.stopPropagation()}
                            ></span>
                    {/if}
                    {#if isAdd}
                        <button
                                type="button"
                                class="add-btn"
                                aria-label="Add column"
                                onclick={(e) => { e.stopPropagation(); openAddMenu(e); }}
                        >
                            <Plus size={15} strokeWidth={2}/>
                        </button>
                    {/if}
                </th>
            {/each}
        </tr>
        </thead>
        <tbody>
        {#each rows as row (row.id)}
            <tr>
                {#each columns as col, idx (col.field.id)}
                    {@const isLast = idx === lastDataIndex}
                    {@const editable = isEditable(col.field)}
                    {@const isCheck = idx === checkColIndex}
                    <td
                            class={cellClassFor(col.field.type)}
                            class:last-data={isLast}
                            class:editable
                            class:check-col={isCheck}
                            style={cellStyle(col)}
                            title={isCheck ? undefined : titleFor(col.field, row)}
                            onclick={editable ? (e) => onCellClick(e, col.field, row) : undefined}
                    >
                        {#if isLast}
                            <span class="cell-text">{@render cellInner(col.field, row)}</span>
                            {#if onOpenRow}
                                <button
                                        type="button"
                                        class="row-action"
                                        aria-label="Open in tab"
                                        title="Open in tab"
                                        onclick={(e) => { e.stopPropagation(); onOpenRow?.(row.id); }}
                                >
                                    <SquareArrowOutUpRight size={13} strokeWidth={1.75}/>
                                </button>
                            {/if}
                        {:else}
                            {@render cellInner(col.field, row)}
                        {/if}
                    </td>
                {/each}
            </tr>
        {:else}
            {#if !loading}
                <tr>
                    <td colspan={columns.length} class="empty">No documents</td>
                </tr>
            {/if}
        {/each}
        </tbody>
    </table>
</LeanScroll>

{#snippet renameHeader()}
    <input
            class="menu-rename"
            bind:value={renameDraft}
            bind:this={renameInput}
            placeholder="Field name"
            onblur={commitRename}
            onkeydown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { commitRename(); menuOpen = false; }
                else if (e.key === 'Escape') { menuOpen = false; }
            }}
    />
{/snippet}

<Menu
        bind:open={menuOpen}
        anchor={menuAnchor}
        items={menuItems}
        onSelect={onColumnMenuSelect}
        minWidth={180}
        header={renameHeader}
/>

<Menu
        bind:open={addMenuOpen}
        anchor={addAnchor}
        items={addMenuItems}
        onSelect={onAddMenuSelect}
        minWidth={200}
/>

{#if editingField && editingRow}
    {#if editingField.type === 'select' || editingField.type === 'multiselect'}
        <SelectOptionEditor
                bind:open={editOpen}
                anchor={editAnchor}
                field={editingField}
                value={editingValue}
                multiple={editingField.type === 'multiselect'}
                onChange={(v) => { if (editingField && editingRow) writeCell(editingField, editingRow, v); }}
        />
    {:else}
        <FilterValueEditor
                bind:open={editOpen}
                anchor={editAnchor}
                field={editingField}
                value={editingValue}
                onChange={(v) => { if (editingField && editingRow) writeCell(editingField, editingRow, v); editOpen = false; }}
        />
    {/if}
{/if}


<style>
    .error {
        margin: 0 0 12px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--color-accent);
        background: var(--error-bg);
        border-radius: var(--radius-ui);
    }

    .basic-table {
        --row-h: 38px;
        width: calc(100% - 48px);
        margin: 0 24px;
        table-layout: fixed;
        border-collapse: separate;
        border-spacing: 0;
        font-family: var(--font-ui);
        font-size: 13px;
    }

    .basic-table th,
    .basic-table td {
        padding: 0 14px;
        height: var(--row-h);
        line-height: var(--row-h);
        text-align: left;
        border-bottom: 1px solid var(--color-border);
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .basic-table th:first-child,
    .basic-table td:first-child {
        padding-left: 0;
    }

    .basic-table th:last-child,
    .basic-table td:last-child {
        padding-right: 0;
    }

    .basic-table thead th {
        position: sticky;
        top: 0;
        z-index: 2;
        background: var(--color-surface);
        font-weight: 500;
        font-size: 12px;
        color: var(--color-ui-dulled);
    }

    .basic-table thead th.col {
        cursor: pointer;
    }

    .basic-table thead th.col:hover {
        color: var(--color-text-primary);
    }

    .th-inner {
        display: flex;
        align-items: center;
        height: 100%;
        min-width: 0;
    }

    .basic-table thead th.col.dragging {
        z-index: 4;
        opacity: 0.85;
        background: var(--color-surface);
        cursor: grabbing;
    }

    .basic-table thead th.drop-before {
        box-shadow: inset 2px 0 0 var(--color-accent);
    }

    .basic-table thead th.drop-after {
        box-shadow: inset -2px 0 0 var(--color-accent);
    }

    .basic-table th.check-col,
    .basic-table td.check-col {
        width: var(--row-h);
        min-width: var(--row-h);
        max-width: var(--row-h);
        padding-left: 0;
        padding-right: 0;
        text-align: center;
        user-select: none;
    }

    .basic-table thead th {
        user-select: none;
    }

    .basic-table td.check-col .bool {
        justify-content: center;
    }

    .th-check-icon {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        color: var(--color-ui-dulled);
    }

    .basic-table thead th.check-col .th-chevron {
        position: absolute;
        right: 1px;
        top: 50%;
        transform: translateY(-50%);
        margin-left: 0;
    }

    .th-icon {
        display: inline-flex;
        align-items: center;
        margin-right: 6px;
        color: var(--color-ui-muted);
        flex-shrink: 0;
    }

    .th-label {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .th-chevron {
        display: inline-flex;
        align-items: center;
        margin-left: 3px;
        color: var(--color-ui-muted);
        opacity: 0;
        transition: opacity 120ms ease;
        flex-shrink: 0;
    }

    .basic-table thead th.col:hover .th-chevron {
        opacity: 0.55;
    }

    .menu-rename {
        width: 100%;
        padding: 5px 8px;
        font: inherit;
        font-size: 13px;
        color: var(--color-text-primary);
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 5px;
        outline: none;
        box-sizing: border-box;
    }

    .menu-rename:focus {
        border-color: var(--color-ui-muted);
    }

    .resize-handle {
        position: absolute;
        top: 0;
        right: -4px;
        bottom: 0;
        width: 8px;
        cursor: col-resize;
        user-select: none;
        touch-action: none;
        z-index: 1;
    }

    .resize-handle::before {
        content: '';
        position: absolute;
        top: 28%;
        bottom: 28%;
        right: 3px;
        width: 2px;
        border-radius: 1px;
        background: transparent;
        transition: background-color 120ms ease;
    }

    .basic-table thead th.col:hover .resize-handle::before {
        background: var(--color-ui-dulled);
    }

    .resize-handle:hover::before,
    .resize-handle:active::before {
        background: var(--color-ui-muted);
    }

    .basic-table th.last,
    .basic-table td.last-data {
        padding-right: 36px;
    }

    .add-btn {
        position: absolute;
        top: 0;
        bottom: 0;
        right: 8px;
        margin: auto 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        background: transparent;
        border: 0;
        color: var(--color-ui-dulled);
        cursor: pointer;
        transition: color 120ms ease;
        z-index: 2;
    }

    .add-btn:hover {
        color: var(--color-text-primary);
    }

    .basic-table tbody td.last-data {
        overflow: visible;
        position: relative;
    }

    .cell-text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .row-action {
        position: absolute;
        right: 12px;
        top: 0;
        bottom: 0;
        margin: auto 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        background: transparent;
        border: 0;
        color: var(--color-ui-dulled);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease, color 120ms ease;
        z-index: 5;
    }

    .basic-table tbody tr:hover .row-action {
        opacity: 1;
        pointer-events: auto;
    }

    .row-action:hover {
        color: var(--color-text-primary);
    }

    .basic-table tbody tr:hover td {
        background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
    }

    .cell-title {
        max-width: none;
        min-width: 220px;
        font-weight: 500;
    }

    .cell-mono,
    .cell-time {
        color: var(--color-ui-muted);
        font-family: var(--font-mono, monospace);
        font-size: 12px;
    }

    .cell-mono {
        max-width: 480px;
    }

    .cell-default {
        color: var(--color-ui-muted);
    }

    .basic-table tbody td.editable {
        cursor: pointer;
    }

    .basic-table tbody tr:hover td.editable:not(.check-col):hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .bool {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        height: var(--row-h);
        color: var(--color-ui-dulled);
        transition: color 120ms ease;
    }

    .bool.on {
        color: var(--color-accent);
    }

    .pills {
        display: inline-flex;
        gap: 4px;
        overflow: hidden;
        vertical-align: middle;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        max-width: 160px;
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

    .empty {
        padding: 28px 14px;
        text-align: center;
        color: var(--color-ui-muted);
        position: static;
    }
</style>
