<script lang="ts">
    /**
     * Todo:
     * - better auto scaling
     * - in-line editing that actually works
     *
     * this file is cursed FYI
     */
    import type View from "$lib/models/View.svelte";
    import type {FilterNode, ViewFace, SortKey, ViewField, ViewFieldType, MemberRow} from "$lib/models/View.svelte";
    import {isLeafActive, isDerived, CREATABLE_FIELD_TYPES, sanitizeName} from "$lib/models/View.svelte";
    import {getFieldIcon} from "$lib/views/filterDisplay";
    import {
        rawStatefulValue as rawStateful, statefulValue as stateful, rawArrayValue as rawArray,
        tagClass as tagClassOf, valueFor as valueOf, titleFor as titleOf, folderDir, fileName,
        sourceName as sourceNameOf, isEditable, isMetaField, fieldLabel, withStatefulValue
    } from "$lib/views/fieldValue";
    import {sqlToWallClock, toSqlDateTime} from "$lib/views/dateFormat";
    import {searchDocuments} from "$lib/search";
    import Menu from "../Menu.svelte";
    import IconAddColumnRight from "~icons/material-symbols/add-column-right";
    import {
        Plus,
        ArrowUpAZ,
        ArrowDownAZ,
        EyeOff,
        Trash2,
        ChevronDown,
        SquareArrowOutUpRight,
        SquareCheck,
        Folder,
        Database,
        Ellipsis,
        X
    } from "@lucide/svelte";
    import {listSources, type Source} from "$lib/models/Source";
    import Group, {GroupType} from "$lib/models/Group";
    import DocHandle from "$lib/models/DocHandle";
    import {deriveCreateContext, folderLinkChain, folderPath} from "$lib/views/createDefaults";
    import FolderValueEditor from "../FolderValueEditor.svelte";
    import CellEditor from "../CellEditor.svelte";
    import CellTextEditor from "../CellTextEditor.svelte";
    import CellValue from "../CellValue.svelte";
    import FolderCrumb from "../FolderCrumb.svelte";
    import LeanScroll from "../LeanScroll.svelte";
    import {onMount} from "svelte";

    let {view, face, onMeta, onOpenRow, createSignal = 0}: {
        view: View;
        face: ViewFace;
        onMeta?: (m: { loading: boolean; count: number; total: number; elapsedMs: number }) => void;
        onOpenRow?: (rowId: string) => void;
        createSignal?: number;
    } = $props();

    const query = $derived((view.state.search as string | undefined) ?? '');

    type Row = MemberRow;

    interface ColumnDef {
        field: ViewField;
    }

    const MIN_COL_WIDTH = 60;

    const PERF = true;
    const tInit = performance.now();

    let rows: Row[] = $state([]);
    let total = $state(0);
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

    // ── Group by (presentation only, over the already-loaded rows) ──────────────
    const groupField = $derived.by(() => {
        const id = (face.config.group_by ?? null) as string | null;
        return id ? view.fields.find(f => f.id === id) ?? null : null;
    });

    function groupKey(row: Row): string {
        if (!groupField) return '';
        const v = valueFor(groupField, row);
        return v === '' ? '(empty)' : v;
    }

    // raw stored value of the group field on a row (to seed new notes in a group)
    function groupValue(row: Row): unknown {
        if (!groupField) return null;
        return rawStatefulValue(groupField, row);
    }

    type RenderItem =
        | { kind: 'header'; label: string; count: number; first: boolean }
        | { kind: 'row'; row: Row; idx: number }
        | { kind: 'footer'; key: string; value: unknown };

    // group keys in display order: the user's saved order (face.config.group_order)
    // first, then any new groups in first-seen order
    const orderedGroupKeys = $derived.by(() => {
        if (!groupField) return [];
        const seen: string[] = [];
        const set = new Set<string>();
        for (const row of rows) {
            const k = groupKey(row);
            if (!set.has(k)) {
                set.add(k);
                seen.push(k);
            }
        }
        const order = (face.config.group_order ?? []) as string[];
        const ordered = order.filter(k => set.has(k));
        const rest = seen.filter(k => !ordered.includes(k));
        return [...ordered, ...rest];
    });

    // flat render list: a header before each group, its rows, then an add footer
    const renderItems = $derived.by(() => {
        if (!groupField) {
            return rows.map((row, i) => ({kind: 'row' as const, row, idx: i}));
        }
        const groups = new Map<string, { row: Row; idx: number }[]>();
        rows.forEach((row, i) => {
            const k = groupKey(row);
            (groups.get(k) ?? groups.set(k, []).get(k)!).push({row, idx: i});
        });
        const out: RenderItem[] = [];
        let first = true;
        for (const label of orderedGroupKeys) {
            const items = groups.get(label);
            if (!items) continue;
            out.push({kind: 'header', label, count: items.length, first});
            for (const it of items) out.push({kind: 'row', row: it.row, idx: it.idx});
            out.push({kind: 'footer', key: label, value: groupValue(items[0].row)});
            first = false;
        }
        return out;
    });

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

    const CHECK_COL_PX = 38;
    const TITLE_MIN_PX = 220;

    function cellStyle(col: ColumnDef): string {
        if (col.field.id === checkFieldId) {
            return `width:${CHECK_COL_PX}px;max-width:${CHECK_COL_PX}px;min-width:${CHECK_COL_PX}px`;
        }
        const w = widths[col.field.id];
        if (w) return `width:${w}px;max-width:${w}px;min-width:${w}px`;
        if (col.field.type === 'title') return '';
        return `width:${defaultWidth(col.field.type)}px`;
    }

    const tableMinWidth = $derived(
        columns.reduce((sum, col) => {
            if (col.field.id === checkFieldId) return sum + CHECK_COL_PX;
            if (col.field.type === 'title') return sum + TITLE_MIN_PX;
            return sum + (widths[col.field.id] ?? defaultWidth(col.field.type));
        }, 0)
    );

    async function load(silent = false) {
        if (!silent) loading = true;
        error = '';
        const start = performance.now();
        try {
            const q = query.trim();
            if (q) {
                const hits = await searchDocuments(q);
                const idsInOrder = hits.filter(r => r.kind === 'document').map(r => r.id).slice(0, 100);
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
                total = rows.length;
            } else {
                rows = await view.getMembers({face, limit: 100}) as Row[];
                total = await view.countMembers({face});
            }
        } catch (e) {
            error = String(e);
        } finally {
            elapsedMs = performance.now() - start;
            loading = false;
        }
    }

    function fieldAffectsView(fieldId: string): boolean {
        const hit = (n: FilterNode): boolean =>
            'children' in n ? n.children.some(hit) : n.field_id === fieldId && isLeafActive(n.op, n.value);
        if (hit(view.filter) || hit(face.additive_filter)) return true;
        return face.sort.some(s => s.field_id === fieldId);
    }

    let folders: Group[] = $state([]);

    let didInitFocus = false;

    let sources: Source[] = $state([]);

    onMount(() => {
        if (PERF) {
            const warm = rows.length > 0;
            const tMount = performance.now();
            requestAnimationFrame(() => {
                const tFrame = performance.now();
                console.log(
                    `[perf] TableFace warm=${warm} rows=${rows.length} cols=${columns.length}` +
                    ` | init→mount ${(tMount - tInit).toFixed(1)}ms` +
                    ` | mount→frame ${(tFrame - tMount).toFixed(1)}ms`
                );
            });
        }
        load();
        Group.list()
            .then((gs) => (folders = gs.filter((g) => g.groupType === GroupType.Folder)))
            .catch(() => {
            });
        listSources()
            .then((ss) => (sources = ss))
            .catch(() => {
            });
        document.addEventListener('keydown', onTableKeydown);
        return () => document.removeEventListener('keydown', onTableKeydown);
    });

    $effect(() => {
        if (didInitFocus || loading || rows.length === 0 || columns.length === 0) return;
        didInitFocus = true;
        if (!face.config.active_cell) setActiveCell({row: visualRowOrder[0] ?? 0, col: 0});
        focusTable();
    });

    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSig: string | null = null;
    let lastFaceId: string | null = null;

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
            view.slug,
            nodeSig(view.filter),
            nodeSig(face.additive_filter),
            sortSig(face.sort),
            query.trim()
        ].join('#');
    }

    $effect(() => {
        const sig = fullSignature();
        const faceId = face.id;
        if (lastSig === null) {
            lastSig = sig;
            lastFaceId = faceId;
            return;
        }
        if (sig === lastSig) {
            lastFaceId = faceId;
            return;
        }
        const faceChanged = faceId !== lastFaceId;
        lastSig = sig;
        lastFaceId = faceId;
        // Filter/sort/search changed the row set is about to change out from
        // under the active cell, so reset it to the top-left rather than letting
        // it point at an unrelated row
        if (face.config.active_cell) face.config.active_cell = {row: 0, col: 0};
        if (reloadTimer) clearTimeout(reloadTimer);
        // A face switch (incl. hover preview) should reload immediately so the
        // rows don't reshuffle ~100ms after the first paint; the debounce only
        // exists to coalesce rapid filter/sort/search edits within one face.
        if (faceChanged) load(true);
        else reloadTimer = setTimeout(() => load(true), 100);
    });

    $effect(() => {
        onMeta?.({loading, count: rows.length, total, elapsedMs});
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

        // Coalesce pointer moves to one state write
        let pendingW = startW;
        let rafId: number | null = null;

        function flush() {
            rafId = null;
            if (!face.config.column_widths) face.config.column_widths = {};
            face.config.column_widths[fid] = pendingW;
        }

        function onMove(ev: PointerEvent) {
            pendingW = Math.max(MIN_COL_WIDTH, Math.round(startW + (ev.clientX - startX)));
            if (rafId === null) rafId = requestAnimationFrame(flush);
        }

        function onUp() {
            if (rafId !== null) cancelAnimationFrame(rafId);
            flush();
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
        if (t.closest('.resize-handle') || t.closest('.th-rename') || t.closest('.col-add')) return;
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

    // ── Group drag-reorder (persisted in face.config.group_order) ────────────────
    let dragGroupKey: string | null = $state(null);
    let dropTargetKey: string | null = $state(null);
    let dropAfter = $state(false);

    function onGroupPointerDown(e: PointerEvent, label: string) {
        if (e.button !== 0) return;
        const startY = e.clientY;
        let started = false;

        function move(ev: PointerEvent) {
            if (!started) {
                if (Math.abs(ev.clientY - startY) < 4) return;
                started = true;
                dragGroupKey = label;
            }
            const headers = [...(tableEl?.querySelectorAll('tr.group-header[data-group-key]') ?? [])] as HTMLElement[];
            if (!headers.length) return;
            const tops = headers.map(h => h.getBoundingClientRect().top);
            const tableBottom = tableEl?.getBoundingClientRect().bottom ?? 0;
            let gi = headers.length - 1;
            for (let i = 0; i < headers.length; i++) {
                const bottom = i + 1 < headers.length ? tops[i + 1] : tableBottom;
                if (ev.clientY < bottom) {
                    gi = i;
                    break;
                }
            }
            const top = tops[gi];
            const bottom = gi + 1 < headers.length ? tops[gi + 1] : tableBottom;
            dropTargetKey = headers[gi].dataset.groupKey ?? null;
            dropAfter = ev.clientY - top > (bottom - top) / 2;
        }

        function up() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (started && dragGroupKey && dropTargetKey) commitGroupReorder(dragGroupKey, dropTargetKey, dropAfter);
            dragGroupKey = null;
            dropTargetKey = null;
        }

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    function commitGroupReorder(key: string, targetKey: string, after: boolean) {
        if (key === targetKey) return;
        const order = orderedGroupKeys.filter(k => k !== key);
        let to = order.indexOf(targetKey);
        if (to < 0) return;
        if (after) to += 1;
        order.splice(to, 0, key);
        face.config.group_order = order;
    }

    let menuOpen = $state(false);
    let menuAnchor: HTMLElement | null = $state(null);
    let menuFieldId: string | undefined = $state(undefined);

    const menuField = $derived(
        menuFieldId ? view.fields.find(f => f.id === menuFieldId) : undefined
    );

    let confirmingDelete = $state(false);

    const menuItems = $derived.by(() => {
        if (!menuField) return [];
        const items: any[] = [
            {value: 'sort_asc', label: 'Sort ascending', icon: ArrowUpAZ},
            {value: 'sort_desc', label: 'Sort descending', icon: ArrowDownAZ},
            {kind: 'divider'},
            {value: 'hide', label: 'Hide', icon: EyeOff},
        ];
        if (!isDerived(menuField.type)) {
            items.push(confirmingDelete
                ? {value: 'delete_confirm', label: 'Confirm delete', icon: Trash2}
                : {value: 'delete', label: 'Delete', icon: Trash2});
        }
        return items;
    });

    // ── Add-column menu (header plus): re-show hidden fields + create new ones ──
    let addColOpen = $state(false);
    let addColEl: HTMLElement | null = $state(null);

    const addColItems = $derived.by(() => {
        const items: any[] = view.fields
            .filter(f => !face.display_field_ids.includes(f.id))
            .map(f => ({value: `show:${f.id}`, label: fieldLabel(f), icon: getFieldIcon(f.type)}));
        if (!view.temporary) {
            if (items.length) items.push({kind: 'divider'});
            for (const t of CREATABLE_FIELD_TYPES) {
                items.push({value: `new:${t}`, label: `New ${t}`, icon: getFieldIcon(t)});
            }
        }
        if (items.length === 0) {
            items.push({value: 'noop', label: view.temporary ? 'Save the view to add fields' : 'All fields shown'});
        }
        return items;
    });

    function onAddColSelect(action: string) {
        addColOpen = false;
        if (action.startsWith('show:')) {
            const id = action.slice(5);
            if (!face.display_field_ids.includes(id)) face.display_field_ids = [...face.display_field_ids, id];
        } else if (action.startsWith('new:')) {
            const type = action.slice(4) as ViewFieldType;
            const field = view.addFieldOfType(type);
            face.display_field_ids = [...face.display_field_ids, field.id];
            openRenameFor(field.id);
        }
    }

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
        // delete is a two-step confirm; only this branch keeps the menu open
        if (action === 'delete') {
            confirmingDelete = true;
            return;
        }
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
            case 'delete_confirm':
                deleteField(fid);
                break;
        }
        confirmingDelete = false;
        menuFieldId = undefined;
    }

    function hideField(fid: string) {
        face.display_field_ids = face.display_field_ids.filter(id => id !== fid);
        if (face.config.column_widths) delete face.config.column_widths[fid];
    }

    // remove a field from the view entirely, plus every face's columns + filters
    function deleteField(fid: string) {
        view.fields = view.fields.filter(f => f.id !== fid);
        for (const f of view.faces) {
            f.display_field_ids = f.display_field_ids.filter(id => id !== fid);
            if (f.config.column_widths) delete f.config.column_widths[fid];
        }
        view.filter.children = view.filter.children.filter(
            (n) => !('field_id' in n) || n.field_id !== fid
        );
    }

    let renameDraft = $state('');
    let renameInput: HTMLInputElement | null = $state(null);
    let isCommitting = false;

    // reassign through view.fields so every face's derived columns re-run
    function setFieldName(fid: string, name: string) {
        view.fields = view.fields.map(ff => ff.id === fid ? {...ff, name} : ff);
    }

    async function commitRename() {
        if (isCommitting) return;
        const fid = menuFieldId;
        if (!fid) return;
        const f = view.fields.find(ff => ff.id === fid);
        if (!f) return;
        const raw = renameDraft.trim();
        if (!raw) return;
        if (isDerived(f.type)) {
            setFieldName(fid, raw);
            return;
        }

        // Stateful fields: the name is the storage key (views.<slug>.<name>), so
        // it must be a safe identifier, and existing values have to be moved from
        // the old key to the new one across all soursces:
        const newName = sanitizeName(raw);
        const oldName = f.name;
        if (!newName || newName === oldName) {
            if (newName) setFieldName(fid, newName);
            return;
        }

        isCommitting = true;
        try {
            await view.renameField(f, newName);
            load();
        } catch (e) {
            error = String(e);
        } finally {
            isCommitting = false;
        }
    }

    async function renameOption(field: ViewField, oldValue: string, newValue: string) {
        try {
            await view.renameOption(field, oldValue, newValue);
            load();
        } catch (e) {
            error = String(e);
        }
    }

    $effect(() => {
        if (menuOpen && renameInput) {
            renameInput.focus();
            renameInput.select();
        }
        if (!menuOpen) confirmingDelete = false;
    });


    function openRenameFor(fid: string) {
        const idx = columns.findIndex(c => c.field.id === fid);
        const th = idx >= 0 ? headerEls[idx] : null;
        if (!th) return;
        menuAnchor = th;
        menuFieldId = fid;
        const f = view.fields.find(ff => ff.id === fid);
        renameDraft = f ? fieldLabel(f) : '';
        menuOpen = true;
    }

    // thin wrappers binding this view's slug / sources to the shared helpers
    const rawStatefulValue = (field: ViewField, row: Row) => rawStateful(row, view.slug, field.name);
    const statefulValue = (field: ViewField, row: Row) => stateful(row, view.slug, field.name);
    const rawArrayValue = (field: ViewField, row: Row) => rawArray(row, view.slug, field.name);
    const tagClass = tagClassOf;
    const valueFor = (field: ViewField, row: Row) => valueOf(field, row, view.slug);
    const sourceName = (id: string) => sourceNameOf(sources, id);

    // ── Draft (new-row) state ───────────────────────────────────────────────────
    // Declared before the editing block so editingRow can resolve the draft row.

    const DRAFT_ID = '__draft__';

    let creating = $state(false);
    let floatTop = $state(false);
    let creatingGroupKey: string | null = $state(null);
    // createdAt captured once per draft so prefilled date columns are stable
    let draft: { title: string; values: Record<string, unknown>; createdAt: string } = $state({
        title: '',
        values: {},
        createdAt: ''
    });

    const createCtx = $derived(deriveCreateContext(view, face, folders));

    // Synthetic row so the draft renders through the same cell machinery as real rows
    const draftRow: Row = $derived.by(() => ({
        id: DRAFT_ID,
        title: draft.title,
        rel_path: '',
        created_at: draft.createdAt,
        updated_at: draft.createdAt,
        properties: JSON.stringify({views: {[view.slug]: draft.values}}),
        source_id: createCtx.sourceId ?? ''
    }));

    let editing: { rowId: string; fieldId: string } | null = $state(null);
    let editAnchor: HTMLElement | null = $state(null);
    let editOpen = $state(false);

    // ── Inline title editing ────────────────────────────────────────────────────
    let titleEditRowId: string | null = $state(null);
    let titleDraft = $state('');
    let titleInput: HTMLInputElement | null = $state(null);
    let titleSaving = false;

    function startTitleEdit(row: Row) {
        titleEditRowId = row.id;
        titleDraft = row.title;
        queueMicrotask(() => {
            titleInput?.focus();
            titleInput?.select();
        });
    }

    async function commitTitle(row: Row) {
        if (titleSaving) return;
        const next = titleDraft.trim();
        titleEditRowId = null;
        if (!next || next === row.title) return;
        titleSaving = true;
        try {
            const doc = await DocHandle.fromID(row.id);
            await doc.rename(`${next}.md`);
            rows = rows.map(r => r.id === row.id ? {...r, title: next, rel_path: doc.relPath} : r);
        } catch (e) {
            error = String(e);
        } finally {
            titleSaving = false;
        }
    }

    function onTitleKey(e: KeyboardEvent, row: Row) {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            commitTitle(row);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            titleEditRowId = null;
        }
    }

    // ── Per-row context menu (⋯) ────────────────────────────────────────────────
    let rowMenuOpen = $state(false);
    let rowMenuAnchor: HTMLElement | null = $state(null);
    let rowMenuRowId: string | null = $state(null);

    const rowMenuItems = [
        {value: 'delete', label: 'Delete', icon: Trash2}
    ];

    function openRowMenu(e: MouseEvent, rowId: string) {
        rowMenuAnchor = e.currentTarget as HTMLElement;
        rowMenuRowId = rowId;
        rowMenuOpen = true;
    }

    async function onRowMenuSelect(value: string) {
        rowMenuOpen = false;
        const rowId = rowMenuRowId;
        rowMenuRowId = null;
        if (!rowId) return;
        if (value === 'delete') await deleteRow(rowId);
    }

    async function deleteRow(rowId: string) {
        const row = rows.find(r => r.id === rowId);
        if (!row) return;
        try {
            const doc = await DocHandle.fromID(rowId);
            await doc.delete();
            rows = rows.filter(r => r.id !== rowId);
        } catch (e) {
            error = String(e);
        }
    }

    const editingField = $derived(
        editing ? view.fields.find(f => f.id === editing!.fieldId) : undefined
    );
    const editingRow = $derived.by(() => {
        if (!editing) return undefined;
        const rid = editing.rowId;
        return rid === DRAFT_ID ? draftRow : rows.find(r => r.id === rid);
    });
    const editingValue = $derived.by(() => {
        if (!editingField || !editingRow) return null;
        if (isMetaField(editingField.type)) {
            const sql = editingField.type === 'created_at' ? editingRow.created_at : editingRow.updated_at;
            return sqlToWallClock(sql);
        }
        if (editingField.type === 'folder') {
            return folderIdForPath(editingRow.rel_path, editingRow.source_id);
        }
        return rawStatefulValue(editingField, editingRow);
    });

    // Resolve the deepest folder group matching a document's directory path
    function folderIdForPath(relPath: string, sourceId: string): string | null {
        const dir = folderDir(relPath);
        if (!dir) return null;
        const match = folders.find(
            (f) => f.sourceId === sourceId && folderPath(f.id, folders) === dir
        );
        return match?.id ?? null;
    }


    let wasEditOpen = false;
    $effect(() => {
        const open = editOpen;
        if (!open && wasEditOpen) {
            editing = null;
            if (activeCell) focusTable();
        }
        wasEditOpen = open;
    });

    function onCellClick(e: MouseEvent, field: ViewField, row: Row) {
        if (!isEditable(field)) return;
        if (field.type === 'boolean') {
            const cur = rawStatefulValue(field, row);
            writeCell(field, row, cur === true ? false : true);
            return;
        }
        // Clicking the cell that's already being edited toggles the popup closed
        if (editOpen && editing && editing.rowId === row.id && editing.fieldId === field.id) {
            editOpen = false;
            return;
        }
        editing = {rowId: row.id, fieldId: field.id};
        editAnchor = e.currentTarget as HTMLElement;
        editOpen = true;
    }

    // ── Keyboard navigation (active cell over data rows) ────────────────────────

    let tableEl: HTMLTableElement | null = $state(null);

    // Active cell is persisted in face.config so it survives app tab switches,
    // but is reset on filter/sort/search change (see the reload effect).
    const activeCell = $derived(
        (face.config.active_cell ?? null) as { row: number; col: number } | null
    );

    function setActiveCell(cell: { row: number; col: number } | null) {
        face.config.active_cell = cell;
    }

    function isActive(rowIdx: number, colIdx: number): boolean {
        return !!activeCell && activeCell.row === rowIdx && activeCell.col === colIdx;
    }

    function focusTable() {
        queueMicrotask(() => tableEl?.focus());
    }

    // A committed face switch hands focus back to the grid so keyboard nav keeps working
    let prevFaceId: string | undefined;
    $effect(() => {
        const id = view.state.active_face_id;
        const prev = prevFaceId;
        prevFaceId = id;
        if (prev === undefined || prev === id) return;
        const a = document.activeElement as HTMLElement | null;
        const inField = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
        if (!inField) focusTable();
    });

    // Keep the active cell in bounds across reloads / column changes
    $effect(() => {
        if (!activeCell) return;
        if (rows.length === 0 || columns.length === 0) {
            setActiveCell(null);
        } else if (activeCell.row >= rows.length || activeCell.col >= columns.length) {
            setActiveCell({
                row: Math.min(activeCell.row, rows.length - 1),
                col: Math.min(activeCell.col, columns.length - 1)
            });
        }
    });

    let scrollOnNext = false;

    $effect(() => {
        if (!activeCell) return;
        const sel = `td[data-cell="${activeCell.row}-${activeCell.col}"]`;
        if (!scrollOnNext) return;
        scrollOnNext = false;
        queueMicrotask(() => {
            const td = tableEl?.querySelector(sel) as HTMLElement | null;
            if (td) td.scrollIntoView({block: 'nearest', inline: 'nearest'});
        });
    });

    // rows-array indices in the order they're actually rendered (grouping + manual
    // reorder decouple this from rows order), so vertical nav follows what's on screen
    const visualRowOrder = $derived(
        renderItems.filter((i) => i.kind === 'row').map((i) => (i as { idx: number }).idx)
    );

    function moveActive(dRow: number, dCol: number, wrap = false) {
        if (rows.length === 0 || columns.length === 0 || !activeCell) return;
        scrollOnNext = true;
        const order = visualRowOrder;
        let pos = order.indexOf(activeCell.row);
        if (pos < 0) pos = 0;
        pos += dRow;
        let col = activeCell.col + dCol;
        if (wrap) {
            while (col >= columns.length) {
                col -= columns.length;
                pos += 1;
            }
            while (col < 0) {
                col += columns.length;
                pos -= 1;
            }
        } else {
            col = Math.max(0, Math.min(columns.length - 1, col));
        }
        pos = Math.max(0, Math.min(order.length - 1, pos));
        col = Math.max(0, Math.min(columns.length - 1, col));
        setActiveCell({row: order[pos] ?? activeCell.row, col});
    }

    function beginEditActive() {
        if (!activeCell) return;
        const row = rows[activeCell.row];
        const col = columns[activeCell.col];
        if (!row || !col || !isEditable(col.field)) return;
        if (col.field.type === 'boolean') {
            const cur = rawStatefulValue(col.field, row);
            writeCell(col.field, row, cur === true ? false : true);
            return;
        }
        const td = tableEl?.querySelector(
            `td[data-cell="${activeCell.row}-${activeCell.col}"]`
        ) as HTMLElement | null;
        if (!td) return;
        editing = {rowId: row.id, fieldId: col.field.id};
        editAnchor = td;
        editOpen = true;
    }

    function onTableKeydown(e: KeyboardEvent) {
        // The draft row owns the keyboard entirely while creating.
        if (creating) return;
        if (editOpen) return;
        const t = e.target as HTMLElement | null;

        const isEdit = e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        const isArrow = arrows.includes(e.key);
        const navKey = isArrow || isEdit || e.key === 'Tab' || e.key === 'Escape';
        if (!navKey || rows.length === 0 || columns.length === 0) return;

        // Never hijack typing or menu/listbox/dialog key handling.
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
            || t.closest('[role="menu"], [role="listbox"], [role="dialog"]'))) return;

        const inTable = !t || t === tableEl || !!tableEl?.contains(t);

        // Focus loose in the view: any arrow key arms the grid at the first cell.
        if (!inTable) {
            if (!isArrow) return;
            scrollOnNext = true;
            setActiveCell({row: visualRowOrder[0] ?? 0, col: 0});
            focusTable();
            e.preventDefault();
            return;
        }

        if (!activeCell) {
            // First nav keypress (incl. Tab) arms the grid at the top-left rather
            // than letting Tab move focus out of the view.
            if (e.key !== 'Escape') {
                scrollOnNext = true;
                setActiveCell({row: visualRowOrder[0] ?? 0, col: 0});
                focusTable();
                e.preventDefault();
            }
            return;
        }
        if (isEdit) {
            beginEditActive();
            e.preventDefault();
            return;
        }
        switch (e.key) {
            case 'ArrowUp':
                moveActive(-1, 0);
                e.preventDefault();
                break;
            case 'ArrowDown':
                moveActive(1, 0);
                e.preventDefault();
                break;
            case 'ArrowLeft':
                moveActive(0, -1);
                e.preventDefault();
                break;
            case 'ArrowRight':
                moveActive(0, 1);
                e.preventDefault();
                break;
            case 'Tab':
                moveActive(0, e.shiftKey ? -1 : 1, true);
                e.preventDefault();
                break;
            case 'Escape':
                setActiveCell(null);
                e.preventDefault();
                break;
        }
    }

    function onCellPointer(e: MouseEvent, rowIdx: number, colIdx: number, field: ViewField, row: Row) {
        setActiveCell({row: rowIdx, col: colIdx});
        if (isEditable(field)) {
            onCellClick(e, field, row);
            if (!editOpen) focusTable();
        } else {
            focusTable();
        }
    }

    async function writeCell(field: ViewField, row: Row, value: unknown) {
        if (field.type === 'created_at' || field.type === 'updated_at') {
            await writeMetaCell(field.type, row, value);
            return;
        }
        if (field.type === 'folder') {
            await moveRowToFolder(row, typeof value === 'string' ? value : null);
            return;
        }
        if (row.id === DRAFT_ID) {
            setDraftValue(field.name, value);
            return;
        }
        try {
            await view.writeFieldValue(row.source_id, field, value, [row.id]);
            applyLocal(row.id, field.name, value);
            // if this field is filtered/sorted on, re-pull so membership and
            // order stay correct. silent so no loading flash, keyed rows just diff
            if (fieldAffectsView(field.id)) load(true);
        } catch (e) {
            error = String(e);
        }
    }

    // Folder is a derived field whose edit is a filesystem move: relocate the doc
    // into the chosen folder group's path (or the source root when cleared).
    async function moveRowToFolder(row: Row, groupId: string | null) {
        if (row.id === DRAFT_ID) {
            folderOverride = groupId;
            return;
        }
        const dir = groupId ? folderPath(groupId, folders) : '';
        const file = fileName(row.rel_path);
        const newRel = dir ? `${dir}/${file}` : file;
        if (newRel === row.rel_path) return;
        try {
            const doc = await DocHandle.fromID(row.id);
            await doc.moveToPath(newRel);
            rows = rows.map(r => r.id === row.id ? {...r, rel_path: newRel} : r);
        } catch (e) {
            error = String(e);
        }
    }

    // created_at / updated_at are real document columns!
    async function writeMetaCell(type: 'created_at' | 'updated_at', row: Row, value: unknown) {
        // init sane defaults
        if (value === null || value === undefined || value === '') return;
        const date = new Date(String(value));
        if (isNaN(date.getTime())) return;

        if (row.id === DRAFT_ID) {
            draft = {...draft, createdAt: date.toISOString()};
            return;
        }
        try {
            const doc = await DocHandle.fromID(row.id);
            await doc.saveMeta(type === 'created_at' ? {createdAt: date} : {updatedAt: date});
            rows = rows.map(r => r.id === row.id ? {...r, [type]: toSqlDateTime(date)} : r);
        } catch (e) {
            error = String(e);
        }
    }

    function applyLocal(rowId: string, name: string, value: unknown) {
        rows = rows.map(r =>
            r.id === rowId
                ? {...r, properties: withStatefulValue(r.properties, view.slug, name, value)}
                : r
        );
    }

    const titleFor = (field: ViewField, row: Row) => titleOf(field, row, view.slug);

    function cellClassFor(type: ViewFieldType): string {
        if (type === 'title') return 'cell-title';
        if (type === 'created_at' || type === 'updated_at') return 'cell-time';
        if (type === 'path' || type === 'id') return 'cell-mono';
        // Pill cells clip cleanly at the edge rather than appending a "…"
        if (type === 'select' || type === 'multiselect' || type === 'tags') return 'cell-default cell-pill';
        return 'cell-default';
    }

    // ── New row ─────────────────────────────────────────────────────────────────

    let newTitleInput: HTMLInputElement | null = $state(null);
    let newRowEl: HTMLTableRowElement | null = $state(null);
    let folderOverride: string | null | undefined = $state(undefined);
    let folderPickerOpen = $state(false);
    let folderAnchor: HTMLElement | null = $state(null);
    let saving = false;

    const effectiveFolderId = $derived(
        folderOverride !== undefined ? folderOverride : createCtx.folderGroupId
    );
    const needsFolderChoice = $derived(createCtx.ambiguous && effectiveFolderId === null);
    const hasFolderColumn = $derived(columns.some(c => c.field.type === 'folder'));
    const folderDirLabel = $derived(
        effectiveFolderId ? folderPath(effectiveFolderId, folders) : ''
    );

    // Warn (red border) when the draft title would collide with an existing note
    // and get silently renamed to "<name> 2" on save.
    let titleCollision = $state(false);
    $effect(() => {
        const title = draft.title.trim();
        const dir = folderDirLabel;
        let sid = createCtx.sourceId;
        if (!sid && effectiveFolderId) sid = folders.find(f => f.id === effectiveFolderId)?.sourceId ?? null;
        if (!sid && sources.length === 1) sid = sources[0].id;
        if (!creating || !title || !sid) {
            titleCollision = false;
            return;
        }
        const base = title.replace(/[\\/]/g, '-');
        const candidate = dir ? `${dir}/${base}.md` : `${base}.md`;
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const exists = await DocHandle.pathExists(sid, candidate);
                if (!cancelled) titleCollision = exists;
            } catch {
                /* ignore */
            }
        }, 150);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    });

    // For the "root" case the location is the source itself; show its name
    const createSourceName = $derived.by(() => {
        let sid = createCtx.sourceId;
        if (!sid && effectiveFolderId) sid = folders.find(f => f.id === effectiveFolderId)?.sourceId ?? null;
        const s = sid ? sources.find(x => x.id === sid) : (sources.length === 1 ? sources[0] : undefined);
        return s ? sourceName(s.id) : 'Source root';
    });

    function startNew(opts?: { floatTop?: boolean; groupValue?: unknown; groupKey?: string }) {
        creating = true;
        floatTop = opts?.floatTop ?? false;
        creatingGroupKey = opts?.groupKey ?? null;
        const values: Record<string, unknown> = {...createCtx.fieldValues};
        // when adding inside a group, seed that group's value for the new note
        if (groupField && opts && 'groupValue' in opts) {
            const v = opts.groupValue;
            if (v === null || v === undefined || v === '') delete values[groupField.name];
            else values[groupField.name] = v;
        }
        draft = {title: '', values, createdAt: new Date().toISOString()};
        folderOverride = undefined;
        queueMicrotask(() => newTitleInput?.focus());
    }

    // Top toolbar "+ New": float the draft row at the top (Notion-style) so capture
    // works without scrolling a long list to the bottom.
    let lastCreateSignal = -1;
    $effect(() => {
        const sig = createSignal;
        if (lastCreateSignal === -1) {
            lastCreateSignal = sig;
            return;
        }
        if (sig !== lastCreateSignal) {
            lastCreateSignal = sig;
            startNew({floatTop: true});
        }
    });

    function setDraftValue(name: string, value: unknown) {
        const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);
        const next = {...draft.values};
        if (empty) delete next[name];
        else next[name] = value;
        draft = {...draft, values: next};
    }

    // -─ Draft-row keyboard nav: locked to the row, Tab/arrows loop the fields ──
    function draftFieldIndices(): number[] {
        const out: number[] = [];
        columns.forEach((col, idx) => {
            if (col.field.type === 'title' || col.field.type === 'folder' || isEditable(col.field)) out.push(idx);
        });
        return out;
    }

    function focusDraftIdx(idx: number) {
        const el = newRowEl?.querySelector(`[data-draft-idx="${idx}"]`) as HTMLElement | null;
        if (!el) return;
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
    }

    function currentDraftIdx(): number {
        const active = document.activeElement as HTMLElement | null;
        const host = active?.closest('[data-draft-idx]') as HTMLElement | null;
        return host ? Number(host.dataset.draftIdx) : -1;
    }

    function moveDraftFocus(delta: number) {
        const idxs = draftFieldIndices();
        if (idxs.length === 0) return;
        const pos = idxs.indexOf(currentDraftIdx());
        const next = idxs[(pos + delta + idxs.length) % idxs.length];
        focusDraftIdx(next);
    }

    function openDraftField(idx: number) {
        const col = columns[idx];
        const el = newRowEl?.querySelector(`[data-draft-idx="${idx}"]`) as HTMLElement | null;
        if (!col || !el) return;
        if (col.field.type === 'folder') {
            folderAnchor = el;
            folderPickerOpen = true;
        } else if (col.field.type === 'boolean') {
            const cur = rawStatefulValue(col.field, draftRow);
            setDraftValue(col.field.name, cur === true ? false : true);
        } else if (isEditable(col.field)) {
            editing = {rowId: DRAFT_ID, fieldId: col.field.id};
            editAnchor = el;
            editOpen = true;
        }
    }

    function onDraftRowKey(e: KeyboardEvent) {
        if (editOpen || folderPickerOpen) return;
        const isText = (e.target as HTMLElement).tagName === 'INPUT';
        if (e.key === 'Escape') {
            e.preventDefault();
            creating = false;
            return;
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            moveDraftFocus(e.shiftKey ? -1 : 1);
            return;
        }
        if (e.key === 'ArrowDown' || (!isText && e.key === 'ArrowRight')) {
            e.preventDefault();
            moveDraftFocus(1);
            return;
        }
        if (e.key === 'ArrowUp' || (!isText && e.key === 'ArrowLeft')) {
            e.preventDefault();
            moveDraftFocus(-1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            // Title commits; other focused fields open their editor/toggle
            if (isText) commitNew();
            else openDraftField(currentDraftIdx());
        }
    }

    function onNewBlur() {
        queueMicrotask(() => {
            if (folderPickerOpen || editOpen) return;
            const active = document.activeElement;
            if (active && newRowEl?.contains(active)) return;
            if (!draft.title.trim() && Object.keys(draft.values).length === 0) creating = false;
        });
    }

    function openFolderPicker(e: MouseEvent) {
        folderAnchor = e.currentTarget as HTMLElement;
        folderPickerOpen = true;
    }

    async function resolveCreateSource(): Promise<Source> {
        const sources = await listSources();
        if (createCtx.sourceId) {
            const s = sources.find((s) => s.id === createCtx.sourceId);
            if (s) return s;
        }
        if (effectiveFolderId) {
            const g = folders.find((f) => f.id === effectiveFolderId);
            const s = g?.sourceId ? sources.find((s) => s.id === g.sourceId) : undefined;
            if (s) return s;
        }
        if (sources.length === 0) throw new Error('No source available to create in');
        return sources[0];
    }

    async function commitNew() {
        if (saving) return;
        const title = draft.title.trim();
        if (!title) {
            creating = false;
            return;
        }
        if (needsFolderChoice) {
            folderPickerOpen = true;
            return;
        }
        saving = true;
        try {
            const source = await resolveCreateSource();
            const dir = effectiveFolderId ? folderPath(effectiveFolderId, folders) : '';
            const groupIds = [
                ...(effectiveFolderId ? folderLinkChain(effectiveFolderId, folders) : []),
                ...createCtx.tagGroupIds
            ];
            const props = Object.keys(draft.values).length
                ? {views: {[view.slug]: draft.values}}
                : {};
            await DocHandle.createFromTitle(source, {title, dir, groupIds, properties: props});
            await load();
            const wasFloat = floatTop;
            const groupKey = creatingGroupKey;
            const gv = groupField && groupKey !== null ? draft.values[groupField.name] : undefined;
            queueMicrotask(() => startNew(
                groupKey !== null
                    ? {groupValue: gv, groupKey}
                    : {floatTop: wasFloat}
            ));
        } catch (e) {
            error = String(e);
        } finally {
            saving = false;
        }
    }
</script>

{#if error}
    <p class="error">{error}</p>
{/if}

{#snippet cellInner(field: ViewField, row: Row)}
    <CellValue {field} {row} viewSlug={view.slug} {sources}/>
{/snippet}

<LeanScroll>
    <table
            class="basic-table"
            bind:this={tableEl}
            role="grid"
            tabindex="0"
            style:min-width="{tableMinWidth}px"
    >
        {#snippet draftRow_(sticky = false)}
            <tr class="new-row creating" class:float-top={sticky} bind:this={newRowEl} onkeydown={onDraftRowKey}
                onfocusout={onNewBlur}>
                {#each columns as col, idx (col.field.id)}
                    {@const isLast = idx === lastDataIndex}
                    {@const isCheck = idx === checkColIndex}
                    {@const editable = isEditable(col.field)}
                    <td
                            class={cellClassFor(col.field.type)}
                            class:last-data={isLast}
                            class:check-col={isCheck}
                            class:editable
                            class:nr-divider={idx !== columns.length - 1}
                            style={cellStyle(col)}
                    >
                        {#if col.field.type === 'title'}
                            <input
                                    class="nr-title"
                                    class:collision={titleCollision}
                                    data-draft-idx={idx}
                                    bind:this={newTitleInput}
                                    bind:value={draft.title}
                                    placeholder="Untitled"
                                    title={titleCollision ? 'A note with this name already exists here' : undefined}
                            />
                        {:else if col.field.type === 'folder'}
                            <button
                                    class="nr-folder-cell"
                                    class:needs={needsFolderChoice}
                                    data-draft-idx={idx}
                                    bind:this={folderAnchor}
                                    onmousedown={(e) => e.preventDefault()}
                                    onclick={openFolderPicker}
                            >
                                {#if needsFolderChoice}
                                    <span class="crumb-choose">Choose folder…</span>
                                {:else}
                                    <FolderCrumb dir={folderDirLabel} rootLabel={createSourceName}/>
                                {/if}
                            </button>
                        {:else if editable}
                            <div
                                    class="nr-edit"
                                    role="button"
                                    tabindex="-1"
                                    data-draft-idx={idx}
                                    onmousedown={(e) => e.preventDefault()}
                                    onclick={(e) => onCellClick(e, col.field, draftRow)}
                            >
                                {@render cellInner(col.field, draftRow)}
                            </div>
                        {:else}
                            <span class="nr-empty"></span>
                        {/if}

                        {#if isLast}
                            {#if !hasFolderColumn}
                                <button
                                        type="button"
                                        class="nr-folder-float"
                                        class:needs={needsFolderChoice}
                                        bind:this={folderAnchor}
                                        title="Create location"
                                        onmousedown={(e) => e.preventDefault()}
                                        onclick={openFolderPicker}
                                >
                                    {#if folderDirLabel}
                                        <Folder size={13} strokeWidth={1.75}/>
                                    {:else}
                                        <Database size={13} strokeWidth={1.75}/>
                                    {/if}
                                    <span class="nr-float-label">
                                        {needsFolderChoice ? 'Choose…' : (folderDirLabel.split('/').pop() || createSourceName)}
                                    </span>
                                </button>
                            {/if}
                            <button
                                    type="button"
                                    class="nr-cancel"
                                    class:with-float={!hasFolderColumn}
                                    aria-label="Cancel new entry"
                                    title="Cancel"
                                    onmousedown={(e) => e.preventDefault()}
                                    onclick={() => creating = false}
                            >
                                <X size={14} strokeWidth={2}/>
                            </button>
                        {/if}
                    </td>
                {/each}
            </tr>
        {/snippet}

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
                        <span class="th-check-icon"><SquareCheck size={15} strokeWidth={2}/></span>
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
                                class="col-add"
                                type="button"
                                aria-label="Add column"
                                bind:this={addColEl}
                                onclick={(e) => { e.stopPropagation(); addColOpen = !addColOpen; }}
                        >
                            <IconAddColumnRight width={16} height={16}/>
                        </button>
                    {/if}
                </th>
            {/each}
        </tr>
        </thead>
        <tbody>
        {#if creating && floatTop}
            {@render draftRow_(true)}
        {/if}
        {#each renderItems as item, ri (item.kind === 'row' ? item.row.id : item.kind === 'header' ? 'h:' + item.label : 'f:' + item.key)}
            {#if item.kind === 'header'}
                <tr
                        class="group-header"
                        class:first={item.first}
                        class:group-dragging={dragGroupKey === item.label}
                        class:drop-before-group={dragGroupKey !== null && dragGroupKey !== item.label && dropTargetKey === item.label && !dropAfter}
                        data-group-key={item.label}
                        onpointerdown={(e) => onGroupPointerDown(e, item.label)}
                >
                    <td colspan={Math.max(1, columns.length)}>
                        <span class="group-pill">
                            <span class="group-label">{item.label}</span>
                            <span class="group-count">{item.count}</span>
                        </span>
                    </td>
                </tr>
            {:else if item.kind === 'footer'}
                {#if creating && creatingGroupKey === item.key}
                    {@render draftRow_()}
                {:else}
                    <tr class="new-row group-add"
                        class:drop-after-group={dragGroupKey !== null && dragGroupKey !== item.key && dropTargetKey === item.key && dropAfter}>
                        <td colspan={Math.max(1, columns.length)} class="nr-trigger-cell">
                            <button type="button" class="new-trigger"
                                    onclick={() => startNew({groupValue: item.value, groupKey: item.key})}>
                                <Plus size={15} strokeWidth={2}/>
                                <span>New</span>
                            </button>
                        </td>
                    </tr>
                {/if}
            {:else}
                {@const row = item.row}
                {@const rowIdx = item.idx}
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
                                class:active-cell={isActive(rowIdx, idx)}
                                data-cell={`${rowIdx}-${idx}`}
                                style={cellStyle(col)}
                                title={isCheck ? undefined : titleFor(col.field, row)}
                                onclick={(e) => onCellPointer(e, rowIdx, idx, col.field, row)}
                        >
                            {#if col.field.type === 'title'}
                                {#if titleEditRowId === row.id}
                                    <input
                                            class="title-input"
                                            bind:this={titleInput}
                                            bind:value={titleDraft}
                                            onkeydown={(e) => onTitleKey(e, row)}
                                            onblur={() => commitTitle(row)}
                                            onclick={(e) => e.stopPropagation()}
                                    />
                                {:else}
                                <span
                                        class="cell-text title-text"
                                        role="textbox"
                                        tabindex="-1"
                                        onclick={(e) => { e.stopPropagation(); startTitleEdit(row); }}
                                >{@render cellInner(col.field, row)}</span>
                                {/if}
                            {:else if isLast}
                                <span class="cell-text">{@render cellInner(col.field, row)}</span>
                                <div class="row-actions">
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
                                    <button
                                            type="button"
                                            class="row-action row-menu-btn"
                                            aria-label="Row actions"
                                            title="Actions"
                                            onclick={(e) => { e.stopPropagation(); openRowMenu(e, row.id); }}
                                    >
                                        <Ellipsis size={15} strokeWidth={1.75}/>
                                    </button>
                                </div>
                            {:else}
                                {@render cellInner(col.field, row)}
                            {/if}
                        </td>
                    {/each}
                </tr>
            {/if}
        {:else}
            {#if !loading}
                <tr>
                    <td colspan={Math.max(1, columns.length)} class="empty">No documents</td>
                </tr>
            {/if}
        {/each}
        {#if creating && !floatTop && creatingGroupKey === null}
            {@render draftRow_()}
        {:else if !creating && !groupField}
            <tr class="new-row">
                <td colspan={Math.max(1, columns.length)} class="nr-trigger-cell">
                    <button type="button" class="new-trigger" onclick={() => startNew()}>
                        <Plus size={15} strokeWidth={2}/>
                        <span>New</span>
                    </button>
                </td>
            </tr>
        {/if}
        </tbody>
    </table>
    <div class="tf-footer">
        {#if loading}loading...
        {:else if total > rows.length}showing {rows.length} of {total}{:else}{rows.length}docs
        {/if}
    </div>
</LeanScroll>

<FolderValueEditor
        bind:open={folderPickerOpen}
        anchor={folderAnchor}
        value={effectiveFolderId}
        sourceId={createCtx.sourceId ?? undefined}
        onChange={(id) => {
            folderOverride = id;
            queueMicrotask(() => newTitleInput?.focus());
        }}
/>

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
        bind:open={rowMenuOpen}
        anchor={rowMenuAnchor}
        items={rowMenuItems}
        onSelect={onRowMenuSelect}
        minWidth={150}
/>

<Menu
        bind:open={addColOpen}
        anchor={addColEl}
        items={addColItems}
        onSelect={onAddColSelect}
        minWidth={170}
/>

{#if editingField && editingRow}
    {#if editingField.type === 'text'}
        <CellTextEditor
                bind:open={editOpen}
                anchor={editAnchor}
                value={editingValue == null ? '' : String(editingValue)}
                onCommit={(v) => { if (editingField && editingRow) writeCell(editingField, editingRow, v); }}
        />
    {:else}
        <CellEditor
                bind:open={editOpen}
                anchor={editAnchor}
                field={editingField}
                value={editingValue}
                sourceId={editingRow.source_id}
                onChange={(v) => { if (editingField && editingRow) writeCell(editingField, editingRow, v); }}
                onRenameOption={(oldV, newV) => { if (editingField) renameOption(editingField, oldV, newV); }}
        />
    {/if}
{/if}


<style>
    .tf-footer {
        padding: 8px 16px 16px;
        font-family: var(--font-ui);
        font-size: 11px;
        color: var(--color-ui-muted);
        text-align: right;
    }

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
        outline: none;
    }

    /* The grid signals focus via the active-cell background, not a ring.
       !important to override the global :focus-visible utility in app.css. */
    .basic-table:focus,
    .basic-table:focus-visible {
        outline: none !important;
        box-shadow: none !important;
    }

    .basic-table tbody td.active-cell,
    .basic-table tbody tr:hover td.active-cell {
        background: transparent;
        position: relative;
    }

    .basic-table tbody td {
        scroll-margin-top: var(--row-h);
    }

    .basic-table:focus-within tbody td.active-cell::after {
        content: '';
        position: absolute;
        inset: 4px 1px;
        border-radius: 7px;
        background: var(--cell-active-bg, rgba(127, 127, 127, 0.16));
        pointer-events: none;
    }

    .basic-table th,
    .basic-table td {
        padding: 0 11px;
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
        width: 38px;
        min-width: 38px;
        max-width: 38px;
        padding-left: 0;
        padding-right: 0;
        text-align: center;
        user-select: none;
    }

    .basic-table thead th {
        user-select: none;
    }

    .basic-table td.check-col :global(.bool) {
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

    /* Overlays the header at the far right (like the row ellipsis), no reserved column */
    .col-add {
        position: absolute;
        right: 10px;
        top: 0;
        bottom: 0;
        margin: auto 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        background: transparent;
        border-radius: 5px;
        color: var(--color-ui-dulled);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
        z-index: 6;
    }

    .basic-table thead:hover .col-add {
        opacity: 1;
        pointer-events: auto;
    }

    .col-add:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .th-icon {
        display: inline-flex;
        align-items: center;
        margin-right: 4px;
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
        padding-right: 60px;
    }

    .basic-table tbody td.last-data,
    .basic-table tbody td.cell-title {
        overflow: visible;
        position: relative;
    }

    .cell-text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .row-actions {
        position: absolute;
        right: 12px;
        top: 0;
        bottom: 0;
        margin: auto 0;
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
        z-index: 5;
    }

    .basic-table tbody tr:hover .row-actions {
        opacity: 1;
        pointer-events: auto;
    }

    .row-action {
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
        transition: color 120ms ease;
    }

    .row-action:hover {
        color: var(--color-text-primary);
    }

    .title-text {
        cursor: text;
    }

    .title-input {
        box-sizing: border-box;
        display: inline-block;
        vertical-align: middle;
        width: 100%;
        height: auto;
        margin: 0;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        font: inherit;
        font-weight: 500;
        line-height: 1.4;
        color: var(--color-text-primary);
        outline: none;
    }

    .basic-table tbody tr:hover td {
        background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
    }

    .cell-title {
        max-width: none;
        min-width: 220px;
        font-weight: 500;
    }

    /* Small left inset for title/text values, including when they're the first
       column (which otherwise has padding-left:0). Excludes the compact check
       column, which centers its icon and must keep zero padding. */
    .basic-table td.cell-title:not(.check-col),
    .basic-table td.cell-default:not(.check-col),
    .basic-table td.cell-time:not(.check-col) {
        padding-left: 8px;
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

    .basic-table td.cell-pill {
        text-overflow: clip;
    }

    .empty {
        padding: 28px 14px;
        text-align: center;
        color: var(--color-ui-muted);
        position: static;
    }

    .basic-table tbody tr.group-header td {
        padding: 32px 0 8px;
        height: auto;
        line-height: 1;
        border-bottom: 0;
        background: transparent;
        cursor: grab;
        user-select: none;
    }

    .basic-table tbody tr.group-header.group-dragging {
        opacity: 0.45;
    }

    .basic-table tbody tr.group-header.drop-before-group td {
        box-shadow: inset 0 2px 0 var(--color-accent);
    }

    .basic-table tbody tr.new-row.group-add.drop-after-group td {
        box-shadow: inset 0 -2px 0 var(--color-accent);
    }

    .basic-table tbody tr.group-header.first td {
        padding-top: 28px;
    }

    .group-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 3px 10px;
        border-radius: 6px;
        background: var(--chip-bg);
    }

    .group-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .group-count {
        font-size: 11px;
        color: var(--color-ui-muted);
    }

    /* New row: trigger (collapsed) */
    .basic-table td.nr-trigger-cell {
        padding: 0;
        border-bottom: 0;
    }

    .nr-cancel {
        position: absolute;
        right: 10px;
        top: 0;
        bottom: 0;
        margin: auto 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--color-ui-dulled);
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
        z-index: 6;
    }

    /* leave room for the folder-location chip to its left */
    .nr-cancel.with-float {
        right: 8px;
    }

    .nr-cancel:hover {
        background: var(--chip-bg-hover);
        color: var(--color-text-primary);
    }

    .new-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: var(--row-h);
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        color: var(--color-ui-dulled);
        cursor: pointer;
        transition: color 120ms ease;
    }

    .new-trigger:hover {
        color: var(--color-text-primary);
    }

    /* New row: draft (multi-cell) */
    .basic-table tbody tr.new-row.creating td {
        padding: 0;
        height: var(--row-h);
    }

    /* Top-floating draft (toolbar "+ New"): pinned just under the sticky header.
       Relies on the cell's own border-bottom */
    .basic-table tbody tr.new-row.float-top td {
        position: sticky;
        top: var(--row-h);
        z-index: 3;
        background: var(--color-bg);
    }

    .basic-table tbody tr.new-row.creating td.nr-divider {
        border-right: 1px solid var(--color-border);
    }

    .basic-table tbody tr.new-row:hover td {
        background: transparent;
    }

    .nr-title {
        width: 100%;
        height: var(--row-h);
        padding: 0 14px 0 8px;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
        outline: none;
    }

    .nr-title.collision {
        box-shadow: inset 0 0 0 1.5px var(--error-fg);
        border-radius: 5px;
    }

    .nr-title::placeholder {
        color: var(--color-ui-dulled);
    }

    .nr-edit {
        display: flex;
        align-items: center;
        height: var(--row-h);
        padding: 0 14px 0 8px;
        cursor: pointer;
    }

    .nr-edit:hover {
        background: var(--chip-bg-hover);
    }

    .basic-table tbody tr.new-row.creating td.check-col .nr-edit {
        padding: 0;
        justify-content: center;
    }

    .nr-empty {
        display: block;
        height: var(--row-h);
    }

    .nr-folder-cell {
        display: flex;
        align-items: center;
        width: 100%;
        height: var(--row-h);
        padding: 0 14px;
        border: 0;
        background: transparent;
        font: inherit;
        color: var(--color-ui-muted);
        cursor: pointer;
        text-align: left;
    }

    .nr-folder-cell:hover {
        background: var(--chip-bg-hover);
    }

    .nr-folder-cell.needs {
        color: var(--color-accent);
    }

    /* Floating location chip when there is no folder column */
    .nr-folder-float {
        position: absolute;
        right: 38px;
        top: 0;
        bottom: 0;
        margin: auto 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 220px;
        height: 24px;
        padding: 0 8px;
        border: 0;
        border-radius: 5px;
        background: var(--color-bg);
        box-shadow: 0 0 0 1px var(--color-border);
        color: var(--color-ui-muted);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 120ms ease, color 120ms ease;
        z-index: 5;
    }

    .nr-folder-float:hover {
        color: var(--color-text-primary);
        background: linear-gradient(var(--chip-bg-hover), var(--chip-bg-hover)), var(--color-bg);
    }

    .nr-folder-float.needs {
        color: var(--color-accent);
    }

    .nr-folder-float :global(svg) {
        flex-shrink: 0;
    }

    .nr-float-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Folder breadcrumb (read + draft) */
    .crumb-choose {
        color: var(--color-ui-dulled);
    }
</style>
