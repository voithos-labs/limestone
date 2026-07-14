<script lang="ts">
	import { untrack } from 'svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace, FilterNode } from '$lib/models/View.svelte';
	import { rawStatefulValue } from '$lib/views/fieldValue';
	import { wallClockToMs } from '$lib/views/dateFormat';
	import { TabState } from '$lib/models/EditorState.svelte.js';
	import DocHandle from '$lib/models/DocHandle';
	import { getDefaultSourceId, listSources, pickCreationSource } from '$lib/models/Source';
	import { deriveCreateContext, folderPath, folderLinkChain } from '$lib/views/createDefaults';
	import Group, { GroupType } from '$lib/models/Group';
	import Menu from '../Menu.svelte';
	import DateValueEditor from '../DateValueEditor.svelte';
	import MarkdownEditor from '../../editor/MarkdownEditor.svelte';
	import TableFace from './TableFace.svelte';
	import ListFace from './ListFace.svelte';
	import { ChevronDown } from '@lucide/svelte';

	let {
		view,
		face,
		flow = false,
		onOpenRow,
		createSignal = 0
	}: {
		view: View;
		face: ViewFace;
		flow?: boolean;
		onOpenRow?: (rowId: string) => void;
		createSignal?: number;
	} = $props();

	const DAY_SIZE = 46;
	const DAY_GAP = 12;
	const DAY_STEP = DAY_SIZE + DAY_GAP;
	const TODAY_W = 140;
	const FUTURE_DAYS = 365;
	const SNAP_PX = 24;
	const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	function startOfDay(d: Date): Date {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate());
	}

	function addDays(d: Date, n: number): Date {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
	}

	function parseDay(s: unknown): Date | null {
		if (typeof s !== 'string') return null;
		const parts = s.split('-').map(Number);
		if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
		return new Date(parts[0], parts[1] - 1, parts[2]);
	}

	function dayKey(d: Date): string {
		return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
	}

	function sameDay(a: Date, b: Date): boolean {
		return a.getTime() === b.getTime();
	}

	let today = $state(startOfDay(new Date()));
	const yesterday = $derived(addDays(today, -1));
	const tomorrow = $derived(addDays(today, 1));

	function dayDow(d: Date): string {
		if (sameDay(d, today)) return fullDate(d);
		if (sameDay(d, yesterday)) return 'Yesterday';
		if (sameDay(d, tomorrow)) return 'Tomorrow';
		return WEEKDAY[d.getDay()];
	}

	function fullDate(d: Date): string {
		return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	}

	const initSelected = parseDay(untrack(() => face.config.selected_day)) ?? untrack(() => today);
	let selected = $state(initSelected);
	let rows = $state<any[]>([]);

	const dateFieldKey = $derived((face.config.date_field as string) ?? 'created_at');

	function rowDate(r: any, key: string): Date | null {
		let raw: unknown;
		if (key === 'created_at') raw = r.created_at;
		else if (key === 'updated_at') raw = r.updated_at;
		else {
			const field = view.fields.find((f) => f.id === key);
			// Deleted date field: fall back to created_at, matching dayScopeNode
			raw = field ? rawStatefulValue(r, view.slug, field.name) : r.created_at;
		}
		if (raw == null || raw === '') return null;
		// A date-only string ("2026-07-13") parses as UTC via `new Date`, which lands on
		// the previous day west of UTC and disagrees with the SQL day scope. wallClockToMs
		// reads it as local, matching how the filter compiles it.
		const ms = wallClockToMs(raw);
		if (ms === null) return null;
		const d = new Date(ms);
		return isNaN(d.getTime()) ? null : startOfDay(d);
	}

	async function loadRows() {
		const perfT0 = performance.now();
		try {
			rows = await view.getMembers({ face, limit: 5000 });
			const perfQuery = performance.now();
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					console.log(
						`[perf] JournalFace load: query ${(perfQuery - perfT0).toFixed(1)}ms, render ${(performance.now() - perfQuery).toFixed(1)}ms, rows ${rows.length}`
					);
				})
			);
		} catch (e) {
			console.error('journal load failed', e);
		}
	}

	$effect(() => {
		loadRows();
	});

	const entries = $derived.by(() => {
		const set = new Set<string>();
		for (const r of rows) {
			const d = rowDate(r, dateFieldKey);
			if (d) set.add(dayKey(d));
		}
		return set;
	});

	const sortBy = $derived((face.config.sort_by as string) ?? 'created_at');

	const dayRows = $derived.by(() => {
		const out = rows.filter((r) => {
			const d = rowDate(r, dateFieldKey);
			return d && sameDay(d, selected);
		});
		if (sortBy === 'title') {
			out.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
		} else if (sortBy === 'updated_at') {
			out.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
		} else {
			out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
		}
		return out;
	});

	let dayDocId = $state<string | null>(null);

	$effect(() => {
		void selected;
		dayDocId = null;
	});

	const selectedRow = $derived(dayRows.find((r) => r.id === dayDocId) ?? dayRows[0] ?? null);

	let pickOpen = $state(false);
	let pickEl: HTMLElement | null = $state(null);

	const dayDocItems = $derived(
		dayRows.map((r) => ({ value: r.id, label: String(r.title ?? 'untitled') }))
	);

	// ── Compound body (table / grid) ──────────────────────────────────────────
	// The body is a nested face; the journal owns its additive_filter so the rows
	// it loads are the journal's own filters AND the selected day.
	const bodyFace = $derived(face.body);

	function dayScopeNode(): FilterNode | null {
		const key = dateFieldKey;
		// Fall back to created_at rather than returning null: a null scope would leave the
		// body unfiltered, showing every document in the view on every day.
		const field =
			(key === 'created_at' || key === 'updated_at'
				? view.fields.find((f) => f.type === key)
				: view.fields.find((f) => f.id === key)) ??
			view.fields.find((f) => f.type === 'created_at');
		if (!field) return null;
		// date-only bounds compare correctly both as ms (created_at/updated_at) and
		// as wall-clock strings (stateful date fields)
		return {
			op: 'and',
			children: [
				{ field_id: field.id, op: 'on_or_after', value: isoDay(selected) },
				{ field_id: field.id, op: 'before', value: isoDay(addDays(selected, 1)) }
			]
		};
	}

	$effect(() => {
		const body = bodyFace;
		if (!body) return;
		const scope = dayScopeNode();
		body.additive_filter = {
			op: 'and',
			children: scope ? [face.additive_filter, scope] : [face.additive_filter]
		};
	});

	let docTab: TabState | null = $state(null);
	$effect(() => {
		if (bodyFace) {
			docTab = null;
			return;
		}
		const row = selectedRow;
		if (!row) {
			docTab = null;
			return;
		}
		let cancelled = false;
		DocHandle.fromID(row.id)
			.then((h) => {
				if (cancelled) return;
				const t = TabState.forDoc(h);
				const prevScroll = docTab?.state.scrollTop;
				if (prevScroll !== undefined) t.state.scrollTop = prevScroll;
				docTab = t;
			})
			.catch((e) => console.error('open journal doc failed', e));
		return () => {
			cancelled = true;
		};
	});

	const showActivity = $derived(face.config.show_activity !== false);
	let jumpOpen = $state(false);

	function onJumpDate(v: string | null) {
		if (!v) return;
		const [y, m, d] = v.split('-').map(Number);
		if (y && m && d) {
			const dt = startOfDay(new Date(y, m - 1, d));
			selectDay(dt);
			scrollBarTo(dt);
		}
	}

	const SPARK_CELL = 8;
	const SPARK_GAP = 3;
	const SPARK_STEP = SPARK_CELL + SPARK_GAP;
	const stripDefaultStart = untrack(
		() => new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
	);
	let stripStart = $state(
		initSelected.getTime() < stripDefaultStart.getTime()
			? addDays(initSelected, -7)
			: stripDefaultStart
	);
	const sparkDayCount = $derived(
		Math.round((tomorrow.getTime() - stripStart.getTime()) / 86400000) + 1
	);
	const sparkContentW = $derived(
		sparkDayCount * SPARK_CELL + (sparkDayCount - 1) * SPARK_GAP
	);

	const sparkDays = $derived.by(() => {
		const set = entries;
		const out: { date: Date; on: boolean; first: boolean; label: string }[] = [];
		for (let i = 0; i < sparkDayCount; i++) {
			const cur = addDays(stripStart, i);
			const first = cur.getDate() === 1;
			out.push({
				date: cur,
				on: set.has(dayKey(cur)),
				first,
				label: first ? cur.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
			});
		}
		return out;
	});

	const sparkMonths = $derived.by(() => {
		const LABEL_W = 38;
		const TODAY_LABEL_W = 36;
		const todayLeft = sparkContentW - SPARK_STEP - TODAY_LABEL_W;
		const out: { leftPx: number; label: string }[] = [];
		let lastRight = -Infinity;
		sparkDays.forEach((d, i) => {
			if (!d.first) return;
			const left = i * SPARK_STEP;
			if (left < lastRight) return;
			if (left + LABEL_W > todayLeft) return;
			out.push({ leftPx: left, label: d.label });
			lastRight = left + LABEL_W;
		});
		return out;
	});

	// Drag scrolls the activity bar itself; the strip above stays the fine view.
	let sparkEl: HTMLElement | null = $state(null);
	let sparkAtEnd = $state(true);
	let dragMoved = false;
	function dragScroll(el: HTMLElement, e: PointerEvent, onUp?: () => void) {
		if (e.button !== 0) return;
		dragMoved = false;
		const baseX = e.clientX;
		const baseScroll = el.scrollLeft;
		function move(ev: PointerEvent) {
			const dx = ev.clientX - baseX;
			if (Math.abs(dx) > 3) dragMoved = true;
			el.scrollLeft = baseScroll - dx;
		}
		function up() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			onUp?.();
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// Start scrolled to today (right edge) when the bar appears.
	$effect(() => {
		if (!showActivity || !sparkEl) return;
		const el = sparkEl;
		requestAnimationFrame(() => {
			el.scrollLeft = el.scrollWidth;
		});
	});

	let stripEl: HTMLElement | null = $state(null);
	let stripAtPresent = $state(true);
	const initBeyond =
		Math.round((initSelected.getTime() - untrack(() => tomorrow).getTime()) / 86400000) -
		FUTURE_DAYS;
	let stripEndExtra = $state(initBeyond > 0 ? initBeyond + 7 : 0);

	const stripDays = $derived.by(() => {
		const end = addDays(tomorrow, FUTURE_DAYS + stripEndExtra);
		const n = Math.round((end.getTime() - stripStart.getTime()) / 86400000) + 1;
		const out: Date[] = [];
		for (let i = 0; i < n; i++) out.push(addDays(stripStart, i));
		return out;
	});

	$effect(() => {
		if (stripEndExtra && selected.getTime() <= tomorrow.getTime()) stripEndExtra = 0;
	});

	function presentDelta(): number | null {
		if (!stripEl) return null;
		const cell = stripEl.children[dayOffset(tomorrow)] as HTMLElement | undefined;
		if (!cell) return null;
		return cell.getBoundingClientRect().right - stripEl.getBoundingClientRect().right;
	}

	function snapStrip(force = false) {
		if (!stripEl) return;
		const cell = stripEl.children[dayOffset(tomorrow)] as HTMLElement | undefined;
		if (!cell) return;
		const rect = cell.getBoundingClientRect();
		const delta = rect.right - stripEl.getBoundingClientRect().right;
		if (delta === 0) return;
		if (!force && (delta < -SNAP_PX || delta > rect.width / 2)) return;
		stripEl.scrollTo({ left: stripEl.scrollLeft + delta, behavior: 'smooth' });
	}

	let snapTimer: ReturnType<typeof setTimeout>;
	function stripWheel(e: WheelEvent) {
		if (!stripEl) return;
		e.preventDefault();
		stripEl.scrollLeft += e.deltaY + e.deltaX;
		clearTimeout(snapTimer);
		snapTimer = setTimeout(snapStrip, 150);
	}

	function stripScroll() {
		if (!stripEl) return;
		const delta = presentDelta();
		stripAtPresent = delta != null && Math.abs(delta) < 2;
		stripScrollLeft = stripEl.scrollLeft;
	}

	let stripScrollLeft = $state(0);
	let stripW = $state(0);

	function dayOffset(d: Date): number {
		return Math.round((d.getTime() - stripStart.getTime()) / 86400000);
	}

	function cellLeft(i: number): number {
		const ti = dayOffset(today);
		if (i <= ti) return i * DAY_STEP;
		return ti * DAY_STEP + TODAY_W + DAY_GAP + (i - ti - 1) * DAY_STEP;
	}

	function cellWidth(i: number): number {
		return i === dayOffset(today) ? TODAY_W : DAY_SIZE;
	}

	const headerDate = $derived.by(() => {
		if (!stripW) return selected;
		const i = dayOffset(selected);
		const left = cellLeft(i);
		const right = left + cellWidth(i);
		if (right > stripScrollLeft && left < stripScrollLeft + stripW) return selected;
		let j = Math.floor(stripScrollLeft / DAY_STEP);
		if (j * DAY_STEP + DAY_SIZE <= stripScrollLeft) j++;
		j = Math.max(0, Math.min(j, stripDays.length - 1));
		return stripDays[j] ?? selected;
	});

	let utilW = $state(0);

	const monthMarker = $derived.by(() => {
		if (!stripW) return null;
		const first = Math.max(0, Math.floor(stripScrollLeft / DAY_STEP));
		const last = Math.min(stripDays.length - 1, Math.ceil((stripScrollLeft + stripW) / DAY_STEP));
		for (let i = first; i <= last; i++) {
			const d = stripDays[i];
			if (d.getDate() !== 1) continue;
			const x = cellLeft(i) - DAY_GAP / 2 - stripScrollLeft;
			const fade = Math.min(1, (x - (utilW + 16)) / 12, (stripW - 72 - x) / 12);
			if (fade <= 0) continue;
			return { x, fade, label: `${d.toLocaleDateString(undefined, { month: 'short' })} 1st` };
		}
		return null;
	});

	function scrollStripTo(d: Date) {
		if (!stripEl) return;
		const el = stripEl;
		const i = dayOffset(d);
		if (i < 0) return;
		const pin = d.getTime() >= today.getTime() && d.getTime() <= tomorrow.getTime();
		requestAnimationFrame(() => {
			if (pin) {
				const delta = presentDelta();
				el.scrollLeft = delta == null ? el.scrollWidth : el.scrollLeft + delta;
			} else {
				el.scrollLeft = cellLeft(i) + cellWidth(i) / 2 - el.clientWidth / 2;
			}
		});
	}

	let didInitStrip = false;
	$effect(() => {
		if (!stripEl || didInitStrip) return;
		didInitStrip = true;
		scrollStripTo(selected);
	});

	function selectDay(d: Date) {
		selected = d;
		if (d.getTime() < stripStart.getTime()) stripStart = addDays(d, -7);
		const beyond = Math.round((d.getTime() - tomorrow.getTime()) / 86400000) - FUTURE_DAYS;
		if (beyond > 0 && beyond + 7 > stripEndExtra) stripEndExtra = beyond + 7;
		scrollStripTo(d);
	}

	const atPresent = $derived(sameDay(selected, today) && stripAtPresent && sparkAtEnd);

	function returnToPresent() {
		selected = today;
		scrollStripTo(today);
		if (sparkEl) sparkEl.scrollLeft = sparkEl.scrollWidth;
	}

	function refreshToday() {
		const t = startOfDay(new Date());
		if (sameDay(t, today)) return;
		const wasAtPresent = stripAtPresent;
		today = t;
		if (!wasAtPresent) return;
		const spark = sparkEl;
		scrollStripTo(t);
		requestAnimationFrame(() => {
			if (spark) spark.scrollLeft = spark.scrollWidth;
		});
	}

	$effect(() => {
		void today;
		const now = new Date();
		const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		const id = setTimeout(refreshToday, midnight.getTime() - now.getTime() + 1000);
		return () => clearTimeout(id);
	});

	$effect(() => {
		document.addEventListener('visibilitychange', refreshToday);
		window.addEventListener('focus', refreshToday);
		return () => {
			document.removeEventListener('visibilitychange', refreshToday);
			window.removeEventListener('focus', refreshToday);
		};
	});

	let pickerAnchor: HTMLElement | null = $state(null);
	function openPicker(el: HTMLElement) {
		pickerAnchor = el;
		jumpOpen = true;
	}

	function sparkWheel(e: WheelEvent) {
		if (!sparkEl) return;
		e.preventDefault();
		sparkEl.scrollLeft += e.deltaY + e.deltaX;
	}

	function sparkScroll() {
		if (!sparkEl) return;
		sparkAtEnd = sparkEl.scrollLeft >= sparkEl.scrollWidth - sparkEl.clientWidth - 2;
	}

	function scrollBarTo(d: Date) {
		if (!sparkEl) return;
		const diff = Math.round((d.getTime() - stripStart.getTime()) / 86400000);
		if (diff < 0) return;
		const clamped = Math.min(diff, sparkDayCount - 1);
		const el = sparkEl;
		requestAnimationFrame(() => {
			el.scrollLeft = 3 + clamped * SPARK_STEP + SPARK_CELL - el.clientWidth;
		});
	}

	$effect(() => {
		face.config.selected_day = isoDay(selected);
	});

	function isoDay(d: Date): string {
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${m}-${day}`;
	}

	function entryName(d: Date): string {
		return `${isoDay(d)} ${d.toLocaleDateString(undefined, { weekday: 'long' })}`;
	}

	let folders = $state<Group[]>([]);
	Group.list()
		.then((gs) => (folders = gs.filter((g) => g.groupType === GroupType.Folder)))
		.catch(() => {});

	let creating = $state(false);
	async function createEntry() {
		if (creating) return;
		creating = true;
		try {
			const ctx = deriveCreateContext(view, face, folders);
			const folderId = ctx.folderGroupId;
			const sources = await listSources();
			let source = ctx.sourceId ? sources.find((s) => s.id === ctx.sourceId) : undefined;
			if (!source && folderId) {
				const g = folders.find((f) => f.id === folderId);
				source = g?.sourceId ? sources.find((s) => s.id === g.sourceId) : undefined;
			}
			source = source ?? pickCreationSource(sources, await getDefaultSourceId());
			if (!source) return;

			const dir = folderId ? folderPath(folderId, folders) : '';
			const groupIds = [
				...(folderId ? folderLinkChain(folderId, folders) : []),
				...ctx.tagGroupIds
			];
			const values: Record<string, unknown> = { ...ctx.fieldValues };
			const key = dateFieldKey;
			if (key !== 'created_at' && key !== 'updated_at') {
				const field = view.fields.find((f) => f.id === key);
				if (field) values[field.name] = isoDay(selected);
			}
			const properties = Object.keys(values).length ? { views: { [view.slug]: values } } : {};

			const doc = await DocHandle.createFromTitle(source, {
				title: entryName(selected),
				dir,
				groupIds,
				properties
			});
			if (source.use_frontmatter) {
				if (key === 'created_at') await doc.saveMeta({ createdAt: selected });
				else if (key === 'updated_at') await doc.saveMeta({ updatedAt: selected });
			}
			if (folderId) folders.find((f) => f.id === folderId)?.touch().catch(() => {});
			await loadRows();
		} catch (e) {
			console.error('create entry failed', e);
		} finally {
			creating = false;
		}
	}
</script>

<div class="journal" class:flow>
	<div class="day-nav">
		<div
			class="days"
			bind:this={stripEl}
			bind:clientWidth={stripW}
			onpointerdown={(e) => stripEl && dragScroll(stripEl, e, snapStrip)}
			onwheel={stripWheel}
			onscroll={stripScroll}
			role="presentation"
		>
			{#each stripDays as d (dayKey(d))}
				<button
					class="day"
					class:selected={sameDay(d, selected)}
					class:today={sameDay(d, today)}
					class:wide={sameDay(d, today)}
					class:near={sameDay(d, yesterday) || sameDay(d, tomorrow)}
					type="button"
					onclick={() => {
						if (dragMoved) return;
						selected = d;
						if (sameDay(d, today)) snapStrip(true);
					}}
				>
					<span class="dow">{dayDow(d)}</span>
					<span class="num">{sameDay(d, today) ? 'Today' : d.getDate()}</span>
				</button>
			{/each}
		</div>

		{#if showActivity}
			<div
				class="spark"
				bind:this={sparkEl}
				onpointerdown={(e) => sparkEl && dragScroll(sparkEl, e)}
				onwheel={sparkWheel}
				onscroll={sparkScroll}
				role="presentation"
			>
				<div class="spark-inner" style="width: {sparkContentW + 6}px">
					<div class="spark-row">
						{#each sparkDays as d (dayKey(d.date))}
							<button
								class="spark-cell"
								class:on={d.on}
								class:sel={sameDay(d.date, selected)}
								type="button"
								title={fullDate(d.date)}
								aria-label={fullDate(d.date)}
								onclick={() => {
									if (!dragMoved) selectDay(d.date);
								}}
							></button>
						{/each}
					</div>
					<div class="spark-months">
						{#each sparkMonths as m (m.leftPx)}
							<span class="spark-mlabel" style="left: {m.leftPx}px">{m.label}</span>
						{/each}
						<span class="spark-mlabel today" style="right: {SPARK_STEP}px">Today</span>
					</div>
				</div>
			</div>
		{/if}

		<div class="controls">
			<span class="util" bind:clientWidth={utilW}>
				<button
					class="nav-year"
					class:pinned={!atPresent}
					type="button"
					aria-label="Jump to date"
					onclick={(e) => openPicker(e.currentTarget)}
					>{headerDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</button
				>
				{#if !atPresent}
					<span class="nav-sep">·</span>
					<button class="return-present" type="button" onclick={returnToPresent}>Today</button>
				{/if}
			</span>
			{#if monthMarker}
				<span
					class="month-marker"
					class:pinned={!atPresent}
					style="left: {monthMarker.x}px; --fade: {monthMarker.fade}"
					>{monthMarker.label}</span
				>
			{/if}
		</div>
	</div>

	<div class="entry" class:doc-body={!bodyFace}>
		{#if bodyFace}
			<div class="body-face">
				{#key bodyFace.id}
					{#if bodyFace.type === 'list'}
						<ListFace {view} face={bodyFace} {onOpenRow} {createSignal} />
					{:else}
						<TableFace {view} face={bodyFace} {onOpenRow} {flow} />
					{/if}
				{/key}
			</div>
		{:else}
			{#if dayRows.length > 0}
				<button
					class="doc-pick"
					class:multi={dayRows.length > 1}
					type="button"
					title="Documents on this day"
					bind:this={pickEl}
					onclick={() => (pickOpen = !pickOpen)}
				>
					<ChevronDown size={15} strokeWidth={2} />
					{#if dayRows.length > 1}
						<span class="doc-pick-count">{dayRows.length}</span>
					{/if}
				</button>
			{/if}
			{#if docTab}
				{#key docTab.id}
					<MarkdownEditor tab={docTab} {flow} />
				{/key}
			{:else}
				<div class="entry-empty">
					<p>No entry for this day</p>
					<button class="create-entry" type="button" disabled={creating} onclick={createEntry}
						>Create entry</button
					>
				</div>
			{/if}
		{/if}
	</div>
</div>

<Menu
	bind:open={pickOpen}
	anchor={pickEl}
	items={dayDocItems}
	onSelect={(id) => {
		dayDocId = id;
		pickOpen = false;
	}}
	selected={selectedRow?.id}
	searchable
	placeholder="Search this day…"
	minWidth={220}
/>
<DateValueEditor
	bind:open={jumpOpen}
	anchor={pickerAnchor}
	value={isoDay(selected)}
	allowTime={false}
	onChange={onJumpDate}
/>

<style>
	.journal {
		padding: 0 24px;
	}

	.journal:not(.flow) {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.day-nav {
		padding-top: 1px;
	}

	.spark {
		padding: 12px 0 2px;
		overflow-x: auto;
		scrollbar-width: none;
		touch-action: none;
		user-select: none;
	}

	.spark::-webkit-scrollbar {
		display: none;
	}

	.spark-inner {
		position: relative;
		box-sizing: border-box;
		padding: 0 3px;
	}

	.spark-row {
		display: flex;
		gap: 3px;
	}

	.spark-cell {
		width: 8px;
		height: 8px;
		flex: none;
		padding: 0;
		border: none;
		border-radius: 2px;
		background: color-mix(in srgb, var(--color-accent) 9%, transparent);
		cursor: inherit;
	}

	.spark-cell.on {
		background: var(--color-accent);
	}

	.spark-cell:hover {
		box-shadow: 0 0 0 1px var(--color-ui-muted);
	}

	.spark-cell.sel {
		outline: 1px solid var(--color-text-primary);
		outline-offset: 1px;
		z-index: 1;
	}

	.spark-months {
		position: relative;
		height: 12px;
		margin-top: 4px;
	}

	.spark-mlabel {
		position: absolute;
		top: 0;
		font-size: 9px;
		line-height: 1;
		color: var(--color-ui-muted);
		white-space: nowrap;
		transform: translateX(-1px);
		pointer-events: none;
	}

	.spark-mlabel.today {
		transform: none;
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.entry {
		margin-top: 8px;
	}

	.journal:not(.flow) .entry {
		flex: 1;
		min-height: 0;
	}

	.journal.flow .entry.doc-body {
		min-height: calc(100vh - 180px);
	}

	.entry {
		position: relative;
	}

	/* Body faces bring their own 24px gutter; cancel the journal's so it isn't doubled */
	.body-face {
		margin: 0 -24px;
	}

	.doc-pick {
		position: absolute;
		top: 15px;
		left: -23px;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 1px;
		padding: 3px;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-ui-dulled);
		font-family: var(--font-ui);
		font-size: 11px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.journal:not(.flow) .doc-pick {
		top: 39px;
		left: 3px;
	}

	.entry:hover .doc-pick,
	.doc-pick.multi {
		opacity: 1;
	}

	.doc-pick:hover {
		color: var(--color-text-primary);
	}

	.doc-pick-count {
		line-height: 1;
	}

	.entry-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding-top: 40px;
		color: var(--color-ui-muted);
	}

	.entry-empty p {
		margin: 0;
		font-size: 13px;
	}

	.create-entry {
		padding: 7px 14px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 13px;
		cursor: pointer;
	}

	.create-entry:hover {
		color: var(--color-text-primary);
		background: var(--chip-bg);
	}

	.create-entry:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.controls {
		position: relative;
		display: flex;
		align-items: center;
		padding-top: 4px;
	}

	.util {
		display: inline-flex;
		align-items: center;
	}

	.month-marker {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		align-items: center;
		height: 15px;
		margin-top: 2px;
		padding-left: 7px;
		border-left: 1px solid var(--color-ui-muted);
		font-size: 11px;
		color: var(--color-ui-muted);
		white-space: nowrap;
		pointer-events: none;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.month-marker.pinned,
	.day-nav:hover .month-marker {
		opacity: var(--fade, 1);
	}

	.nav-year {
		padding: 0;
		margin: 0;
		border: none;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.nav-year.pinned {
		opacity: 1;
	}

	.nav-year:hover {
		text-decoration: underline;
		color: var(--color-text-secondary);
	}

	.nav-sep {
		margin: 0 6px;
		color: var(--color-ui-dulled);
		font-size: 11px;
	}

	.return-present {
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 11px;
		cursor: pointer;
		white-space: nowrap;
	}

	.return-present:hover {
		text-decoration: underline;
		color: var(--color-text-secondary);
	}

	.day-nav:hover .nav-year {
		opacity: 1;
	}

	.days {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		scrollbar-width: none;
		touch-action: none;
		user-select: none;
		-webkit-mask-image: linear-gradient(
			to right,
			transparent,
			#000 6px,
			#000 calc(100% - 6px),
			transparent
		);
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 6px,
			#000 calc(100% - 6px),
			transparent
		);
	}

	.day:first-child {
		margin-left: auto;
	}

	.days::-webkit-scrollbar {
		display: none;
	}

	.day {
		position: relative;
		flex: none;
		width: 46px;
		height: 42px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.day.near {
		width: auto;
		padding: 0 10px;
	}

	.day.wide {
		width: 140px;
	}

	.dow {
		font-size: 10px;
		font-weight: 500;
		color: var(--color-ui-muted);
		white-space: nowrap;
	}

	.num {
		font-size: 13px;
		line-height: 1;
		color: var(--color-text-primary);
	}

	.day.selected {
		background: var(--color-accent);
		border-radius: 6px;
	}

	.day.selected .dow {
		color: color-mix(in srgb, var(--color-accent-contrast) 72%, transparent);
	}

	.day.selected .num {
		color: var(--color-accent-contrast);
	}

	.day:not(.selected):hover {
		border-radius: 6px;
		background: var(--chip-bg);
	}
</style>
