<script lang="ts">
	import type View from '#lib/models/View.svelte.js';
	import type { FilterNode, MemberRow, ViewFace } from '#lib/models/View.svelte.js';
	import { isStatusField, saveStatuses } from '#lib/models/View.svelte.js';
	import { contextMenu, type CtxEntry } from '#lib/overlays.svelte.js';
	import { statusOf } from '#lib/views/fieldValue.js';
	import { history, PreviewCache, type Preview } from '#lib/views/FaceRows.svelte.js';
	import { onSourceReconciled } from '#lib/models/Source.js';
	import { FaceRows } from '#lib/views/FaceRows.svelte.js';
	import {
		rawStatefulValue,
		statefulValue,
		fieldLabel,
		tagClass,
		statusColor
	} from '#lib/views/fieldValue.js';
	import NoteCard from '../NoteCard.svelte';
	import RowEditors from '../editors/RowEditors.svelte';
	import Pill from '../Pill.svelte';
	import ScrollThumb from '../../ui/ScrollThumb.svelte';
	import {
		Plus,
		CornerDownLeft,
		ChevronDown,
		Ellipsis,
		Pencil,
		Check,
		Trash2,
		FoldHorizontal,
		UnfoldHorizontal
	} from '@lucide/svelte';
	import { nameGuard } from '#lib/util/paths.js';
	import { onMount, tick } from 'svelte';

	let {
		view,
		face,
		onOpenRow,
		createSignal = 0,
		scope = null,
		editable = true
	}: {
		view: View;
		face: ViewFace;
		onOpenRow?: (rowId: string, newTab?: boolean | 'side') => void;
		createSignal?: number;
		scope?: FilterNode | null;
		editable?: boolean;
	} = $props();

	const rows = new FaceRows(
		() => view,
		() => face,
		() => scope
	);
	let editors: RowEditors = $state()!;

	// ── Columns: one per option of a select field, or the two sides of a boolean ──
	const TODO_DONE = 'tag:todo/done';

	const colField = $derived.by(() => {
		const id = (face.config.group_by ?? null) as string | null;
		const f = id ? (view.fields.find((f) => f.id === id) ?? null) : null;
		return f && (f.type === 'select' || f.type === 'boolean') ? f : null;
	});

	type Col = { key: string; label: string; value: unknown; items: MemberRow[] };

	function colOf(row: MemberRow): string {
		const f = colField!;
		if (f.type === 'boolean') return rawStatefulValue(row, f) === true ? '1' : '0';
		return isStatusField(f) ? statusOf(row, f) : statefulValue(row, f);
	}

	const columns = $derived.by((): Col[] => {
		const f = colField;
		if (!f) return [];
		const cols: Col[] = [];
		if (f.type === 'boolean') {
			const todo = f.id === TODO_DONE;
			cols.push({
				key: '0',
				label: todo ? 'Todo' : `Not ${fieldLabel(f).toLowerCase()}`,
				value: false,
				items: []
			});
			cols.push({ key: '1', label: todo ? 'Done' : fieldLabel(f), value: true, items: [] });
		} else {
			for (const o of (f.config?.options ?? []) as { value: string }[])
				cols.push({ key: o.value, label: o.value, value: o.value, items: [] });
		}
		const byKey = new Map(cols.map((c) => [c.key, c]));
		const none: Col = {
			key: '',
			label: `No ${fieldLabel(f).toLowerCase()}`,
			value: null,
			items: []
		};
		for (const row of rows.rows) {
			const k = colOf(row);
			const c = byKey.get(k);
			if (c) c.items.push(row);
			else if (k === '') none.items.push(row);
			else {
				// a value typed into a file that isn't among the options yet
				const extra: Col = { key: k, label: k, value: k, items: [row] };
				byKey.set(k, extra);
				cols.push(extra);
			}
		}
		if (none.items.length) cols.push(none);
		return cols;
	});

	const collapsed = $derived(new Set((face.config.collapsed_groups ?? []) as string[]));

	// the column wears its option's colour as a faint area; anything without one is grey
	function areaClass(col: Col): string {
		const f = colField;
		if (!f || f.type !== 'select' || !col.key) return 'tag-c0';
		return isStatusField(f) ? `tag-c${statusColor(f, col.key)}` : tagClass(f, col.key);
	}

	const previewCache = new PreviewCache();
	let previews: Record<string, Preview> = $state({});
	$effect(() => {
		const list = rows.rows;
		const sources = rows.sources;
		if (list.length === 0 || sources.length === 0) return;
		let live = true;
		previewCache.fetch(list, sources).then((p) => {
			if (live) previews = p;
		});
		return () => {
			live = false;
		};
	});

	function toggleCol(key: string) {
		const next = new Set(collapsed);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		face.config.collapsed_groups = [...next];
	}

	// ── Column menu: the option behind a column is edited where the column is ──
	type Opt = { value: string; color: number; done?: boolean };
	const options = $derived((colField?.config?.options ?? []) as Opt[]);
	const status = $derived(!!colField && isStatusField(colField));
	const optionOf = (col: Col) => options.find((o) => o.value === col.key);

	function setOptions(next: Opt[]) {
		if (!colField) return;
		if (status) saveStatuses(next.map((o) => ({ ...o, done: !!o.done })));
		else colField.config.options = next;
	}

	let menuFor: string | null = $state(null);
	let confirmDelete: string | null = $state(null);
	$effect(() => {
		if (!contextMenu.open) {
			menuFor = null;
			confirmDelete = null;
		}
	});

	function colMenu(col: Col): CtxEntry[] {
		const opt = optionOf(col);
		const isCollapsed = collapsed.has(col.key);
		const common: CtxEntry[] = [
			{ label: makesTodo ? 'New todo' : 'New note', icon: Plus, action: () => summon(col.key) },
			{
				label: isCollapsed ? 'Expand' : 'Collapse',
				icon: isCollapsed ? UnfoldHorizontal : FoldHorizontal,
				action: () => toggleCol(col.key)
			}
		];
		if (!opt) return common;
		return [
			...common,
			{ divider: true },
			{ label: 'Rename', icon: Pencil, action: () => startRename(col) },
			{ divider: true, label: 'Color' },
			{ swatches: { active: opt.color, pick: (c) => setColor(opt.value, c) } },
			{ divider: true },
			...(status
				? [
						{
							label: 'Counts as done',
							icon: Check,
							checked: !!opt.done,
							keepOpen: true,
							action: () => toggleDone(opt)
						}
					]
				: []),
			{ label: 'Add column', icon: Plus, action: () => addColumn(opt) },
			confirmDelete === col.key
				? { label: 'Confirm delete', icon: Trash2, danger: true, action: () => removeOption(opt) }
				: {
						label: 'Delete column',
						icon: Trash2,
						keepOpen: true,
						action: () => (confirmDelete = col.key)
					}
		];
	}

	function openColMenu(e: MouseEvent, col: Col) {
		e.preventDefault();
		e.stopPropagation();
		menuFor = col.key;
		contextMenu.show(e.clientX, e.clientY, () => colMenu(col));
	}

	function showColMenu(anchor: HTMLElement, col: Col) {
		menuFor = col.key;
		contextMenu.showAt(anchor, () => colMenu(col));
	}

	function setColor(value: string, color: number) {
		setOptions(options.map((o) => (o.value === value ? { ...o, color } : o)));
	}

	// each side of done keeps at least one option; the flipped one lands at the end of its side
	function toggleDone(opt: Opt) {
		if (options.filter((o) => !!o.done === !!opt.done).length <= 1) return;
		const flipped = { ...opt, done: !opt.done };
		const rest = options.filter((o) => o.value !== opt.value);
		const firstDone = rest.findIndex((o) => o.done);
		rest.splice(flipped.done || firstDone < 0 ? rest.length : firstDone, 0, flipped);
		setOptions(rest);
	}

	function nextColor(): number {
		const used = new Set(options.map((o) => o.color));
		for (let i = 0; i < 16; i++) if (!used.has(i)) return i;
		return options.length % 16;
	}

	// a new column lands after this one with a placeholder name, already being renamed; leaving
	// the name alone takes it away again
	const NEW_COL = 'New column';
	let placeholderCol: string | null = null;

	async function addColumn(after: Opt) {
		let name = NEW_COL;
		for (let i = 2; options.some((o) => o.value === name); i++) name = `${NEW_COL} ${i}`;
		const next = [...options];
		const idx = next.findIndex((o) => o.value === after.value);
		next.splice(idx + 1, 0, { value: name, color: nextColor(), done: after.done });
		setOptions(next);
		placeholderCol = name;
		await tick();
		startRename({ key: name, label: name, value: name, items: [] });
	}

	async function removeOption(opt: Opt) {
		if (!colField) return;
		if (status) {
			const peers = options.filter((o) => o.value !== opt.value && !!o.done === !!opt.done);
			if (peers.length === 0) return;
			await view.renameOption(colField, opt.value, peers[0].value);
		}
		setOptions(options.filter((o) => o.value !== opt.value));
		if (status) await rows.load(true);
	}

	let renamingKey: string | null = $state(null);
	let renameDraft = $state('');
	let renameEl: HTMLInputElement | null = $state(null);

	function startRename(col: Col) {
		renamingKey = col.key;
		renameDraft = col.key;
		queueMicrotask(() => {
			renameEl?.focus();
			renameEl?.select();
		});
	}

	async function commitRename() {
		const f = colField;
		const old = renamingKey;
		const next = renameDraft.trim();
		renamingKey = null;
		if (!f || old === null) return;
		if (old === placeholderCol && (!next || next === old)) {
			placeholderCol = null;
			setOptions(options.filter((o) => o.value !== old));
			return;
		}
		placeholderCol = null;
		if (!next || next === old || options.some((o) => o.value === next)) return;
		setOptions(options.map((o) => (o.value === old ? { ...o, value: next } : o)));
		if (collapsed.has(old))
			face.config.collapsed_groups = [...collapsed].map((k) => (k === old ? next : k));
		await view.renameOption(f, old, next);
		await rows.load(true);
	}

	function onRenameKey(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renameDraft = renamingKey ?? '';
			commitRename();
		}
	}

	// the column already says what the card's value is
	const lanes = $derived.by(() => {
		const l = rows.lanes;
		const id = colField?.id;
		return { inline: l.inline.filter((f) => f.id !== id), meta: l.meta.filter((f) => f.id !== id) };
	});
	const checkField = $derived(rows.checkField);
	// the draft only claims to be a todo when a card made here will carry the tag
	const makesTodo = $derived(rows.createCtx.tagGroupIds.includes('tag:todo'));

	// ── Create: a column's "+" summons a draft card at its top ──────────────────
	let summoned: string | null = $state(null);
	let newTitle = $state('');
	let newEl: HTMLInputElement | null = $state(null);
	let creating = false;

	function seedFor(col: Col): Record<string, unknown> {
		const f = colField;
		if (!f) return {};
		if (f.type === 'boolean') return { [f.name]: col.value };
		return col.key ? { [f.name]: col.key } : {};
	}

	async function summon(key: string) {
		if (collapsed.has(key)) toggleCol(key);
		summoned = key;
		await tick();
		newEl?.focus();
	}

	async function createCard(title: string, open: boolean, values: Record<string, unknown> = {}) {
		if (creating) return;
		creating = true;
		try {
			const id = await rows.create(title, values);
			if (!id) return;
			newTitle = '';
			if (open) onOpenRow?.(id);
			else {
				await tick();
				newEl?.focus();
			}
		} finally {
			creating = false;
		}
	}

	let titleTaken = $state(false);
	let takenTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const title = newTitle.trim();
		if (takenTimer) clearTimeout(takenTimer);
		if (!title) {
			titleTaken = false;
			return;
		}
		takenTimer = setTimeout(async () => {
			const taken = await rows.titleTaken(title);
			if (newTitle.trim() === title) titleTaken = taken;
		}, 150);
	});

	function onNewKey(e: KeyboardEvent, values: Record<string, unknown>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (newTitle.trim()) createCard(newTitle, false, values);
		} else if (e.key === 'Escape') {
			newTitle = '';
			(e.currentTarget as HTMLInputElement).blur();
		}
	}

	// the bar's "+" still creates and opens
	let lastCreateSignal = -1;
	$effect(() => {
		const sig = createSignal;
		if (lastCreateSignal === -1) {
			lastCreateSignal = sig;
			return;
		}
		if (sig !== lastCreateSignal) {
			lastCreateSignal = sig;
			createCard('', true);
		}
	});

	// ── Loading ────────────────────────────────────────────────────────────────
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSig: string | null = null;
	let lastFaceId: string | null = null;

	$effect(() => {
		const sig = rows.signature();
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
		if (reloadTimer) clearTimeout(reloadTimer);
		if (faceChanged) rows.load(true);
		else reloadTimer = setTimeout(() => rows.load(true), 100);
	});

	$effect(() => onSourceReconciled(() => rows.load(true)));

	// ── Fit: the board fills what's left of the page, and its columns scroll ────
	let boardEl: HTMLDivElement | null = $state(null);
	let boardH = $state(0);
	let wide = $state(false);
	let avail = $state(Infinity);
	const need = $derived(columns.reduce((w, c) => w + (collapsed.has(c.key) ? 36 : 220) + 12, -12));
	const tight = $derived(need > avail);
	let bodyEls: Record<string, HTMLElement> = $state({});

	// a column with more above or below fades at that edge; one that fits shows no fade
	function edgeFade(node: HTMLElement) {
		const update = () => {
			const more = node.scrollHeight - node.clientHeight;
			node.style.setProperty('--fade-top', node.scrollTop > 1 ? '20px' : '0px');
			node.style.setProperty('--fade-bottom', more - node.scrollTop > 1 ? '20px' : '0px');
		};
		node.addEventListener('scroll', update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(node);
		const mo = new MutationObserver(update);
		mo.observe(node, { childList: true, subtree: true });
		update();
		return {
			destroy() {
				node.removeEventListener('scroll', update);
				ro.disconnect();
				mo.disconnect();
			}
		};
	}

	// a plain wheel over the board runs it sideways, unless it's over a column with more to show
	function onWheel(e: WheelEvent) {
		if (!boardEl || e.deltaX !== 0 || e.shiftKey || e.ctrlKey) return;
		const body = (e.target as HTMLElement).closest<HTMLElement>('.col-body');
		if (body && body.scrollHeight > body.clientHeight) return;
		if (boardEl.scrollWidth <= boardEl.clientWidth) return;
		e.preventDefault();
		boardEl.scrollLeft += e.deltaY;
	}

	function scrollerOf(el: HTMLElement): HTMLElement {
		for (let p = el.parentElement; p; p = p.parentElement) {
			const o = getComputedStyle(p).overflowY;
			if (o === 'auto' || o === 'scroll') return p;
		}
		return document.scrollingElement as HTMLElement;
	}

	function fit() {
		if (!boardEl) return;
		const s = scrollerOf(boardEl);
		const r = boardEl.getBoundingClientRect();
		const top =
			s === document.scrollingElement
				? r.top + window.scrollY
				: r.top - s.getBoundingClientRect().top + s.scrollTop;
		const h = s === document.scrollingElement ? window.innerHeight : s.clientHeight;
		boardH = Math.max(240, h - top - 16);
		const box = boardEl.parentElement;
		const column = box?.parentElement?.parentElement;
		if (box && column) {
			wide = box.getBoundingClientRect().left < column.getBoundingClientRect().left + 47;
			avail = Math.max(column.clientWidth - 96, s.clientWidth - 48);
		}
	}

	onMount(() => {
		rows.load();
		rows.init();
		fit();
		const ro = new ResizeObserver(fit);
		if (boardEl) {
			ro.observe(scrollerOf(boardEl));
			if (boardEl.parentElement) ro.observe(boardEl.parentElement);
		}
		return () => {
			ro.disconnect();
			if (reloadTimer) clearTimeout(reloadTimer);
			if (drag) cancelAnimationFrame(drag.frame);
			drag = null;
			stopListening();
		};
	});

	// ── Drag: a card lifts out of its column and follows the pointer; a hole opens in
	// whichever column it's over. Dropping elsewhere writes the column's value ────
	const DRAG_PX = 6;
	const EDGE_PX = 48;
	const SETTLE_MS = 180;

	type Drag = {
		row: MemberRow;
		el: HTMLElement;
		home: string;
		homeIndex: number;
		dx: number;
		dy: number;
		x: number;
		y: number;
		frame: number;
	};

	let press: { row: MemberRow; el: HTMLElement; x: number; y: number } | null = null;
	let drag: Drag | null = null;
	let dragId: string | null = $state(null);
	let hole: { col: string; index: number } | null = $state(null);
	let holeH = $state(0);
	let swallowClick = false;
	let downAt: { x: number; y: number } | null = null;

	function indexIn(col: string, row: MemberRow): number {
		const items = columns.find((c) => c.key === col)?.items ?? [];
		return Math.max(
			0,
			items.findIndex((r) => r.id === row.id)
		);
	}

	function armDrag(e: PointerEvent) {
		if (dragId || e.button !== 0) return;
		const t = e.target as HTMLElement;
		if (t.closest('button, input, a, .value, .rename-wrap')) return;
		const el = t.closest<HTMLElement>('.card[data-id]');
		if (!el) return;
		const row = rows.rows.find((r) => r.id === el.dataset.id);
		if (!row) return;
		press = { row, el, x: e.clientX, y: e.clientY };
		window.addEventListener('pointermove', onDragMove);
		window.addEventListener('pointerup', onDragUp);
		window.addEventListener('pointercancel', onDragCancel);
		window.addEventListener('keydown', onDragKey, true);
	}

	function stopListening() {
		press = null;
		window.removeEventListener('pointermove', onDragMove);
		window.removeEventListener('pointerup', onDragUp);
		window.removeEventListener('pointercancel', onDragCancel);
		window.removeEventListener('keydown', onDragKey, true);
	}

	function startDrag(p: NonNullable<typeof press>, e: PointerEvent) {
		const r = p.el.getBoundingClientRect();
		const home = colOf(p.row);
		drag = {
			row: p.row,
			el: p.el,
			home,
			homeIndex: indexIn(home, p.row),
			dx: p.x - r.left,
			dy: p.y - r.top,
			x: e.clientX,
			y: e.clientY,
			frame: 0
		};
		holeH = r.height;
		hole = { col: home, index: drag.homeIndex };
		dragId = p.row.id;
		const s = p.el.style;
		s.position = 'fixed';
		s.zIndex = '5';
		s.width = `${r.width}px`;
		s.left = `${r.left}px`;
		s.top = `${r.top}px`;
		s.pointerEvents = 'none';
		s.boxShadow = 'var(--menu-shadow)';
		s.background = 'var(--chip-bg-hover)';
		const body = p.el.closest<HTMLElement>('.col-body');
		if (body) {
			body.style.setProperty('mask-image', 'none');
			body.style.setProperty('-webkit-mask-image', 'none');
		}
		(document.activeElement as HTMLElement | null)?.blur();
		window.getSelection()?.removeAllRanges();
		document.body.style.cursor = 'grabbing';
		drag.frame = requestAnimationFrame(dragFrame);
	}

	function onDragMove(e: PointerEvent) {
		if (drag) {
			drag.x = e.clientX;
			drag.y = e.clientY;
			return;
		}
		const p = press;
		if (!p) return;
		if (Math.max(Math.abs(e.clientX - p.x), Math.abs(e.clientY - p.y)) < DRAG_PX) return;
		startDrag(p, e);
	}

	function scrollToward(el: HTMLElement, pos: number, lo: number, hi: number, axis: 'x' | 'y') {
		const over =
			pos < lo + EDGE_PX ? pos - lo - EDGE_PX : pos > hi - EDGE_PX ? pos - hi + EDGE_PX : 0;
		if (!over) return;
		const step = Math.sign(over) * Math.ceil(Math.min(1, Math.abs(over) / EDGE_PX) * 16);
		if (axis === 'y') el.scrollTop += step;
		else el.scrollLeft += step;
	}

	function dragFrame() {
		const d = drag;
		if (!d || !boardEl) return;
		if (!d.el.isConnected) {
			finishDrag(false);
			return;
		}
		d.el.style.left = `${d.x - d.dx}px`;
		d.el.style.top = `${d.y - d.dy}px`;

		const br = boardEl.getBoundingClientRect();
		scrollToward(boardEl, d.x, br.left, br.right, 'x');

		for (const colEl of boardEl.querySelectorAll<HTMLElement>('.col[data-col]')) {
			const r = colEl.getBoundingClientRect();
			if (d.x < r.left - 8 || d.x > r.right + 8) continue;
			const key = colEl.dataset.col!;
			const body = colEl.querySelector<HTMLElement>('.col-body');
			if (!body) {
				if (hole?.col !== key) hole = { col: key, index: -1 };
				break;
			}
			const b = body.getBoundingClientRect();
			scrollToward(body, d.y, b.top, b.bottom, 'y');
			let idx = 0;
			for (const c of body.querySelectorAll<HTMLElement>('.card[data-id]')) {
				if (c.dataset.id === d.row.id) continue;
				const cr = c.getBoundingClientRect();
				if (cr.top + cr.height / 2 < d.y) idx++;
				else break;
			}
			if (!hole || hole.col !== key || hole.index !== idx) hole = { col: key, index: idx };
			break;
		}
		d.frame = requestAnimationFrame(dragFrame);
	}

	function applyDrop(d: Drag, to: { col: string; index: number }) {
		const col = columns.find((c) => c.key === to.col);
		if (!col || !colField) return;
		const peers = col.items.filter((r) => r.id !== d.row.id);
		const i = to.index < 0 ? peers.length : to.index;
		const ids = rows.rows.map((r) => r.id).filter((id) => id !== d.row.id);
		const below = peers[i]?.id;
		const prev = peers[i - 1]?.id;
		const at = below ? ids.indexOf(below) : prev ? ids.indexOf(prev) + 1 : ids.length;
		ids.splice(at, 0, d.row.id);
		const prevIds = rows.rows.map((r) => r.id);
		const prevOrder = face.config.order ? [...(face.config.order as string[])] : undefined;
		const apply = async (list: string[], order: string[] | undefined) => {
			rows.reorder(list);
			face.config.order = order;
		};
		history.group(view.id, () => {
			history.push(view.id, {
				back: () => apply(prevIds, prevOrder),
				forward: () => apply(ids, ids)
			});
			rows.reorder(ids);
			face.config.order = ids;
			if (to.col !== d.home) {
				const row = rows.rows.find((r) => r.id === d.row.id) ?? d.row;
				rows.writeCell(row, colField, col.value);
			}
		});
	}

	async function finishDrag(commit: boolean) {
		stopListening();
		const d = drag;
		if (!d) return;
		drag = null;
		cancelAnimationFrame(d.frame);
		document.body.style.cursor = '';
		swallowClick = true;
		const from = d.el.getBoundingClientRect();
		const body = d.el.closest<HTMLElement>('.col-body');
		body?.style.removeProperty('mask-image');
		body?.style.removeProperty('-webkit-mask-image');
		const to = commit ? hole : null;
		hole = null;
		const s = d.el.style;
		for (const k of [
			'position',
			'zIndex',
			'width',
			'left',
			'top',
			'pointerEvents',
			'boxShadow',
			'background'
		] as const)
			s[k] = '';
		if (to && (to.col !== d.home || to.index !== d.homeIndex)) applyDrop(d, to);
		await tick();
		const el = boardEl?.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(d.row.id)}"]`);
		if (el) {
			const now = el.getBoundingClientRect();
			el.style.transition = 'none';
			el.style.transform = `translate(${from.left - now.left}px, ${from.top - now.top}px)`;
			void el.offsetHeight;
			el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
			el.style.transform = '';
		}
		setTimeout(() => {
			if (el) el.style.transition = '';
			if (dragId === d.row.id) dragId = null;
		}, SETTLE_MS);
	}

	const onDragUp = () => finishDrag(true);
	const onDragCancel = () => finishDrag(false);

	function onDragKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !drag) return;
		e.stopPropagation();
		e.preventDefault();
		finishDrag(false);
	}

	function onBoardPointerDown(e: PointerEvent) {
		swallowClick = false;
		downAt = { x: e.clientX, y: e.clientY };
	}

	function onBoardClickCapture(e: MouseEvent) {
		const dragged =
			e.detail > 0 &&
			!!downAt &&
			Math.max(Math.abs(e.clientX - downAt.x), Math.abs(e.clientY - downAt.y)) >= DRAG_PX;
		downAt = null;
		if (!swallowClick && !dragged) return;
		swallowClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// the cells a column draws: its cards, with the hole where a lifted card would land
	type Cell = { key: string; row: MemberRow | null };
	function cells(col: Col): Cell[] {
		const out: Cell[] = [];
		const h = hole?.col === col.key ? hole.index : null;
		let n = 0;
		for (const row of col.items) {
			if (row.id === dragId) {
				out.push({ key: row.id, row });
				continue;
			}
			if (h === n) out.push({ key: '__hole', row: null });
			out.push({ key: row.id, row });
			n++;
		}
		if (h !== null && (h < 0 || h >= n)) out.push({ key: '__hole', row: null });
		return out;
	}

	// ── Keyboard: up/down walk a column, left/right hop columns, Enter opens, Space ticks ──
	function keyboardBusy(): boolean {
		const a = document.activeElement as HTMLElement | null;
		if (a && (a.matches('input, textarea, select') || a.isContentEditable)) return true;
		return !!document.querySelector('.menu, .pop, .overlay, .ctx-menu, [role="dialog"]');
	}

	function focusCard(el: HTMLElement | undefined | null) {
		if (!el) return;
		el.focus({ preventScroll: true });
		el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	function onBoardKey(e: KeyboardEvent) {
		if (keyboardBusy() || !boardEl) return;
		const a = document.activeElement as HTMLElement | null;
		const cur = a?.closest<HTMLElement>('.card[data-id]') ?? null;
		const colBodies = Array.from(boardEl.querySelectorAll<HTMLElement>('.col-body'));
		const cardsIn = (b: HTMLElement) =>
			Array.from(b.querySelectorAll<HTMLElement>('.card[data-id]'));
		const body = cur?.closest<HTMLElement>('.col-body') ?? null;
		const siblings = body ? cardsIn(body) : [];
		const i = cur ? siblings.indexOf(cur) : -1;
		const ci = body ? colBodies.indexOf(body) : -1;
		const hop = (dir: 1 | -1) => {
			for (let k = ci + dir; k >= 0 && k < colBodies.length; k += dir) {
				const cards = cardsIn(colBodies[k]);
				if (cards.length) return cards[Math.min(Math.max(i, 0), cards.length - 1)];
			}
			return null;
		};
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (!cur) focusCard(boardEl.querySelector<HTMLElement>('.card[data-id]'));
				else focusCard(siblings[i + 1]);
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (cur) focusCard(siblings[i - 1]);
				break;
			case 'ArrowRight':
				e.preventDefault();
				if (!cur) focusCard(boardEl.querySelector<HTMLElement>('.card[data-id]'));
				else focusCard(hop(1));
				break;
			case 'ArrowLeft':
				e.preventDefault();
				if (cur) focusCard(hop(-1));
				break;
			case 'Enter':
				if (!cur) return;
				e.preventDefault();
				onOpenRow?.(cur.dataset.id!);
				break;
			case ' ': {
				if (!cur || !checkField) return;
				e.preventDefault();
				const row = rows.rows.find((r) => r.id === cur.dataset.id);
				if (row && rows.memberOf(row, checkField)) rows.toggle(row, checkField);
				break;
			}
			case 'Escape':
				a?.blur();
				break;
		}
	}
</script>

{#if rows.error}
	<p class="error">{rows.error}</p>
{/if}

<div class="board-wrap" class:tight>
	<div class="board-box">
		{#if wide}
			<div class="rule"></div>
		{/if}
		<div
			class="board"
			class:dragging={!!dragId}
			bind:this={boardEl}
			style:height="{boardH}px"
			role="list"
			tabindex="-1"
			onkeydown={onBoardKey}
			onwheel={onWheel}
			onpointerdowncapture={onBoardPointerDown}
			onclickcapture={onBoardClickCapture}
		>
			{#if !colField}
				<div class="empty">Pick a select field for the columns under Options.</div>
			{:else}
				<div class="cols">
					{#each columns as col (col.key)}
						{@const n = col.items.length}
						{#if collapsed.has(col.key)}
							<section
								class="col collapsed {areaClass(col)}"
								data-col={col.key}
								role="presentation"
								oncontextmenu={(e) => openColMenu(e, col)}
							>
								<button class="strip" type="button" onclick={() => toggleCol(col.key)}>
									<span class="strip-label">
										{#if colField.type === 'select' && col.key}
											<Pill field={colField} value={col.key} />
										{:else}
											<span class="title">{col.label}</span>
										{/if}
									</span>
									<span class="count">{n}</span>
								</button>
							</section>
						{:else}
							<section class="col {areaClass(col)}" data-col={col.key}>
								<header
									class="col-head"
									role="presentation"
									oncontextmenu={(e) => openColMenu(e, col)}
								>
									{#if renamingKey === col.key}
										<input
											class="rename-input"
											type="text"
											bind:this={renameEl}
											bind:value={renameDraft}
											use:nameGuard
											onblur={commitRename}
											onkeydown={onRenameKey}
										/>
									{:else}
										<button class="head" type="button" onclick={() => toggleCol(col.key)}>
											{#if colField.type === 'select' && col.key}
												<Pill field={colField} value={col.key} />
											{:else}
												<span class="title">{col.label}</span>
											{/if}
											<span class="count">{n}</span>
											<span class="caret"><ChevronDown size={12} strokeWidth={2} /></span>
										</button>
									{/if}
									<span class="grow"></span>
									<button
										class="col-more"
										class:open={menuFor === col.key}
										type="button"
										tabindex="-1"
										aria-label="Column options"
										onclick={(e) => {
											e.stopPropagation();
											showColMenu(e.currentTarget as HTMLElement, col);
										}}
									>
										<Ellipsis size={14} strokeWidth={1.75} />
									</button>
								</header>
								<div
									class="col-body"
									role="presentation"
									bind:this={bodyEls[col.key]}
									use:edgeFade
									onpointerdown={armDrag}
								>
									{#each cells(col) as cell (cell.key)}
										{#if cell.row}
											<NoteCard
												row={cell.row}
												{rows}
												{editors}
												{checkField}
												inline={lanes.inline}
												meta={lanes.meta}
												editMode={editable}
												body="brief"
												preview={previews[cell.row.id]}
												onOpen={onOpenRow}
											/>
										{:else}
											<div class="hole" style:height="{holeH}px"></div>
										{/if}
									{/each}
									{#if summoned === col.key && !rows.loading}
										{@const values = seedFor(col)}
										<label class="card new">
											<span class="new-mark">
												{#if makesTodo}<span class="dashed"></span>{:else}<Plus
														size={16}
														strokeWidth={1.75}
													/>{/if}
											</span>
											<span class="new-field">
												<span class="new-ghost"
													>{newTitle || (makesTodo ? 'New todo' : 'New note')}</span
												>
												<input
													class="new-input"
													class:taken={titleTaken}
													type="text"
													placeholder={makesTodo ? 'New todo' : 'New note'}
													bind:value={newTitle}
													bind:this={newEl}
													use:nameGuard
													onkeydown={(e) => onNewKey(e, values)}
													onblur={() => {
														if (!newTitle.trim()) summoned = null;
													}}
												/>
											</span>
											{#if newTitle.trim() && !titleTaken}
												<span class="new-hint"><CornerDownLeft size={12} strokeWidth={1.75} /></span
												>
											{/if}
										</label>
									{/if}
								</div>
								{#if !rows.loading}
									<button
										class="new-row"
										class:open={summoned === col.key}
										type="button"
										tabindex="-1"
										onclick={() => summon(col.key)}
									>
										<Plus size={14} strokeWidth={2} />
										<span>New</span>
									</button>
								{/if}
								<ScrollThumb scroller={bodyEls[col.key]} top={40} />
							</section>
						{/if}
					{/each}
				</div>

				{#if !rows.loading && rows.rows.length === 0 && rows.query}
					<div class="foot">No matches</div>
				{:else if !rows.loading && rows.total > rows.rows.length}
					<button
						class="foot more"
						type="button"
						disabled={rows.loadingMore}
						onclick={() => rows.loadMore()}
					>
						<ChevronDown size={14} strokeWidth={1.75} />
						<span>{rows.loadingMore ? 'Loading' : `${rows.total - rows.rows.length} more`}</span>
					</button>
				{/if}
			{/if}
		</div>
		<ScrollThumb scroller={boardEl} axis="x" top={0} />
	</div>
</div>

<RowEditors bind:this={editors} {view} {rows} onOpen={onOpenRow} />

<style>
	.error {
		margin: 0 24px 12px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--color-accent);
		background: var(--error-bg);
		border-radius: var(--radius-ui);
	}

	/* the board sits in the page's column like any face, but once the pane is wider than the
	   column it may grow out past the header on both sides, up to the pane's own padding */
	.board-wrap {
		--ext: 0px;
		margin: 0 calc(24px - var(--ext));
	}

	@supports (width: 1cqw) {
		.board-wrap {
			--ext: max(0px, (100cqw - var(--view-max-width, 1200px)) / 2 + 24px);
		}
	}

	.board-wrap.tight {
		margin-right: calc(-24px - max(0px, var(--ext) - 24px));
	}

	.board-box {
		position: relative;
		width: fit-content;
		min-width: calc(100% - 2 * var(--ext));
		max-width: 100%;
		margin: 0 auto;
	}

	.rule {
		height: 1px;
		margin: 4px 0 20px;
		background: var(--chip-divider);
	}

	/* native bars are hidden; each column and the board's bottom edge draw a hairline thumb */
	.board {
		display: flex;
		flex-direction: column;
		font-family: var(--font-ui);
		outline: none;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.board::-webkit-scrollbar,
	.col-body::-webkit-scrollbar {
		display: none;
	}

	.board.dragging {
		cursor: grabbing;
		user-select: none;
	}

	/* while a card is in the air nothing under the pointer reacts: no hover fills, no shadows,
	   no empty-field placeholders blinking on as it passes; drop targets are measured, not hit */
	.board.dragging .col-body,
	.board.dragging .new-row,
	.board.dragging .col-head {
		pointer-events: none;
	}

	.empty {
		padding: 48px 14px;
		text-align: center;
		font-size: 13px;
		color: var(--color-ui-muted);
	}

	/* columns start at the top and grow with their cards, up to the board's height; past that
	   a column's body scrolls inside its area while its head and New row stay put */
	.cols {
		flex: 0 0 auto;
		display: flex;
		align-items: flex-start;
		height: 100%;
		gap: 12px;
		padding-bottom: 14px;
	}

	/* each column is an area in its option's colour, cards on the page colour inside it */
	.col {
		position: relative;
		flex: 0 1 auto;
		display: flex;
		flex-direction: column;
		width: 272px;
		min-width: 220px;
		min-height: 0;
		max-height: 100%;
		border-radius: 12px;
		background: hsl(var(--tag-h, 0) var(--tag-s, 0%) var(--tag-bg-l, 90%) / var(--area-alpha, 0.4));
	}

	.col.collapsed {
		flex-shrink: 0;
		width: 36px;
		min-width: 0;
	}

	.col-head {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 32px;
		padding: 0 6px 0 10px;
		margin: 6px 0 2px;
	}

	.head {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 0;
		border: none;
		background: transparent;
		font: inherit;
		cursor: pointer;
	}

	.title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
	}

	.count {
		font-size: 12px;
		color: var(--color-ui-muted);
		font-variant-numeric: tabular-nums;
	}

	.caret {
		display: inline-flex;
		color: var(--color-ui-muted);
		opacity: 0;
		transition: opacity 80ms ease;
	}

	.grow {
		flex: 1;
	}

	/* the column's menu: hidden until the head is hovered or the menu is open */
	.col-more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		opacity: 0;
		cursor: pointer;
		transition:
			opacity 80ms ease,
			color 80ms ease,
			background-color 80ms ease;
	}

	.col-head:hover .col-more,
	.col-more.open {
		opacity: 1;
	}

	.col-more:hover,
	.col-more.open {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}

	.rename-input {
		flex: 1 1 auto;
		min-width: 0;
		height: 24px;
		padding: 0 6px;
		border: 0;
		border-radius: 6px;
		background: var(--chip-bg);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
		outline: none;
	}

	.col-head:hover .caret {
		opacity: 1;
	}

	.col-body {
		flex: 0 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 2px 8px 0;
		overflow-y: auto;
		scrollbar-width: none;
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent,
			#000 var(--fade-top, 0px),
			#000 calc(100% - var(--fade-bottom, 0px)),
			transparent
		);
		mask-image: linear-gradient(
			to bottom,
			transparent,
			#000 var(--fade-top, 0px),
			#000 calc(100% - var(--fade-bottom, 0px)),
			transparent
		);
	}

	.col-body:empty {
		padding-top: 0;
	}

	/* the column's add: a quiet row at its foot, where the card will land */
	.new-row {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		margin: 6px 8px 8px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		font: inherit;
		font-size: 13px;
		color: var(--color-ui-muted);
		cursor: pointer;
		transition:
			background-color 80ms ease,
			color 80ms ease;
	}

	.new-row:hover,
	.new-row.open {
		background: var(--chip-bg);
		color: var(--color-text-primary);
	}

	.col .col-body :global(.card) {
		background: var(--card-bg);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		transition:
			background-color 80ms ease,
			box-shadow 80ms ease;
	}

	.col .col-body :global(.card:hover),
	.col .col-body :global(.card:focus-within) {
		background: var(--card-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.hole {
		flex: 0 0 auto;
		box-sizing: border-box;
		border: 1.5px dashed var(--color-border);
		border-radius: 10px;
	}

	/* a collapsed column is a strip with its name read downward */
	.strip {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 0;
		border: 0;
		border-radius: 12px;
		background: transparent;
		font: inherit;
		cursor: pointer;
		transition: background-color 80ms ease;
	}

	.strip:hover {
		background: var(--chip-bg-hover);
	}

	.strip-label {
		writing-mode: vertical-rl;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.strip-label :global(.pill) {
		writing-mode: vertical-rl;
	}

	/* the draft card: a card-shaped row with a dashed mark and a bare input */
	.card.new {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 48px;
		padding: 0 14px;
		border-radius: 10px;
		background: var(--chip-bg);
		cursor: text;
	}

	.new-mark {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		color: var(--color-ui-muted);
	}

	.dashed {
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		border: 1.5px dashed var(--color-ui-muted);
		border-radius: 4px;
	}

	.card.new:focus-within .dashed {
		border-color: var(--color-text-secondary);
	}

	.new-field {
		position: relative;
		display: inline-flex;
		align-items: center;
		flex: 1 1 auto;
		min-width: 0;
		height: 100%;
	}

	.new-ghost {
		font-size: 14px;
		white-space: pre;
		visibility: hidden;
	}

	.new-input {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		font-size: 14px;
		letter-spacing: -0.005em;
		color: var(--color-text-primary);
		outline: none;
	}

	.new-input::placeholder {
		color: var(--color-ui-muted);
	}

	.new-input.taken {
		text-decoration: underline;
		text-decoration-color: var(--error-fg);
		text-underline-offset: 3px;
	}

	.new-hint {
		flex: 0 0 auto;
		display: inline-flex;
		color: var(--color-ui-dulled);
	}

	.foot {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		font: inherit;
		font-family: var(--font-ui);
		font-size: 12.5px;
		color: var(--color-ui-dulled);
	}

	.more {
		cursor: pointer;
	}

	.more:hover:not(:disabled) {
		background: var(--row-hover-bg, rgba(127, 127, 127, 0.06));
		color: var(--color-text-secondary);
	}

	.more:disabled {
		cursor: default;
	}
</style>
