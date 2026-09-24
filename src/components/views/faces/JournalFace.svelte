<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type View from '$lib/models/View.svelte';
	import { ViewFace, type FilterNode } from '$lib/models/View.svelte';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import { rawStatefulValue } from '$lib/views/fieldValue';
	import { wallClockToMs } from '$lib/views/dateFormat';
	import type { DocPicker } from '$lib/views/docPicker.svelte';
	import DateValueEditor from '../DateValueEditor.svelte';
	import DocFace from './DocFace.svelte';
	import ListFace from './ListFace.svelte';
	import MasonryFace from './MasonryFace.svelte';
	import { onSourceReconciled } from '$lib/models/Source';

	let {
		view,
		face,
		flow = false,
		onOpenRow,
		createSignal = 0,
		docPicker,
		tab,
		editor,
		settings,
		findBarAnchor,
		dockTarget
	}: {
		view: View;
		face: ViewFace;
		flow?: boolean;
		onOpenRow?: (rowId: string, newTab?: boolean) => void;
		createSignal?: number;
		docPicker?: DocPicker;
		tab?: TabState;
		editor?: EditorState;
		settings: SettingsState;
		/** The page's own box for the find bar, passed on to a day's entry. */
		findBarAnchor?: HTMLElement | null;
		dockTarget?: HTMLElement | null;
	} = $props();

	const DAY_SIZE = 46;
	const DAY_GAP = 12;
	const DAY_STEP = DAY_SIZE + DAY_GAP;
	const TODAY_W = 140;
	const PAST_DAYS = 365;
	const FUTURE_DAYS = 365;
	const WINDOW_DAYS = PAST_DAYS + FUTURE_DAYS + 2;
	const JUMP_MARGIN = 180;
	const SNAP_PX = 24;
	const STRIP_PAD = 8; // the strip runs under the card's side padding so its fade ends at the edge
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
		const d = new Date(parts[0], parts[1] - 1, parts[2]);
		return isNaN(d.getTime()) ? null : d;
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

	// The one place the journal's date field is resolved. The day strip and the SQL day
	// scope MUST agree on it, so they both read this: a config pointing at a deleted
	// field falls back to created_at here, once, rather than in each of them.
	const dateField = $derived(
		(dateFieldKey === 'created_at' || dateFieldKey === 'updated_at'
			? view.fields.find((f) => f.type === dateFieldKey)
			: view.fields.find((f) => f.id === dateFieldKey)) ??
			view.fields.find((f) => f.type === 'created_at')
	);

	function rowDate(r: any): Date | null {
		const field = dateField;
		if (!field) return null;
		let raw: unknown;
		if (field.type === 'created_at') raw = r.created_at;
		else if (field.type === 'updated_at') raw = r.updated_at;
		else raw = rawStatefulValue(r, field);
		if (raw == null || raw === '') return null;
		// A date-only string ("2026-07-13") parses as UTC via `new Date`, which lands on
		// the previous day west of UTC and disagrees with the SQL day scope. wallClockToMs
		// reads it as local, matching how the filter compiles it.
		const ms = wallClockToMs(raw);
		if (ms === null) return null;
		const d = new Date(ms);
		return isNaN(d.getTime()) ? null : startOfDay(d);
	}

	// The rows are only the activity timeline's input: which days have entries. The
	// body face runs its own scoped query for the selected day.
	async function loadRows() {
		if (!showActivity) {
			rows = [];
			return;
		}
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

	$effect(() => onSourceReconciled(() => loadRows()));

	const entries = $derived.by(() => {
		const set = new Set<string>();
		for (const r of rows) {
			const d = rowDate(r);
			if (d) set.add(dayKey(d));
		}
		return set;
	});

	// ── Compound body (doc / table / grid) ────────────────────────────────────
	// A journal is only ever the day navigator around a nested face. Its scope (the
	// journal's own filters AND the selected day) is passed down as a value.
	const bodyFace = $derived(face.body);

	const bodyScope = $derived.by((): FilterNode => {
		const children: FilterNode[] = [face.additive_filter];
		// date-only bounds compare correctly both as ms (created_at/updated_at) and
		// as wall-clock strings (stateful date fields)
		if (dateField) {
			children.push({
				op: 'and',
				children: [
					{ field_id: dateField.id, op: 'on_or_after', value: isoDay(selected) },
					{ field_id: dateField.id, op: 'before', value: isoDay(addDays(selected, 1)) }
				]
			});
		}
		return { op: 'and', children };
	});

	const showActivity = $derived(face.config.show_activity === true);

	// ── Sticky: the card is only a floating surface once it's actually pinned, so the shadow
	// comes and goes with the scroll ──────────────────────────────────────────────────
	let navEl: HTMLElement | null = $state(null);
	let stuck = $state(false);
	let scrollerEl: HTMLElement | null = $state(null);
	$effect(() => {
		const el = navEl;
		if (!el) return;
		let scroller: HTMLElement | null = el.parentElement;
		while (scroller) {
			const oy = getComputedStyle(scroller).overflowY;
			if (oy === 'auto' || oy === 'scroll') break;
			scroller = scroller.parentElement;
		}
		scrollerEl = scroller;
		if (!scroller) return;
		const update = () => {
			const top = scroller!.getBoundingClientRect().top + 12;
			stuck = scroller!.scrollTop > 0 && el.getBoundingClientRect().top <= top + 0.5;
		};
		update();
		scroller.addEventListener('scroll', update, { passive: true });
		return () => scroller!.removeEventListener('scroll', update);
	});

	// ── Two modes across a day switch. Bar floating: the new day starts right under it, at
	// the float point. Bar in the page: nothing moves. One day's depth never carries to another
	let entryEl: HTMLElement | null = $state(null);
	let journalEl: HTMLElement | null = $state(null);
	let wasStuck = false;
	$effect.pre(() => {
		void selected;
		untrack(() => (wasStuck = stuck));
	});
	let firstDay = true;
	$effect(() => {
		void selected;
		if (firstDay) {
			firstDay = false;
			return;
		}
		untrack(() => {
			const scroller = scrollerEl;
			const host = journalEl;
			if (!wasStuck || !scroller || !host) return;
			// the float point is where the page's chrome has just scrolled away: the gap under
			// the filter bar is the 12px the bar floats at
			const chrome = scroller.querySelector('.view-chrome') ?? host;
			const floatPoint =
				chrome.getBoundingClientRect().bottom -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop;
			scroller.scrollTop = Math.ceil(floatPoint);
		});
	});

	// the entry is never shorter than the scroller's viewport: a short day can't pull the page
	// up, and at worst lands exactly where the day bar floats
	$effect(() => {
		const scroller = scrollerEl;
		const entry = entryEl;
		if (!scroller || !entry) return;
		const fit = () => (entry.style.minHeight = `${scroller.clientHeight}px`);
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(scroller);
		return () => {
			ro.disconnect();
			entry.style.minHeight = '';
		};
	});

	// ── Search: the navigator steps aside for a flat list of hits across every day; picking
	// one jumps the journal to that day and clears the search ──────────────────────────
	const searching = $derived(!!(view.state.search as string | undefined)?.trim());
	const searchFace = ViewFace.create('list');
	$effect(() => {
		const byType = (t: string) => view.fields.find((f) => f.type === t)?.id ?? '';
		const titleId = byType('title');
		const tagsId = byType('tags');
		searchFace.display_field_ids = [titleId, tagsId, dateField?.id ?? ''].filter(Boolean);
		searchFace.config.right = [tagsId, dateField?.id ?? ''].filter(Boolean);
		searchFace.additive_filter = face.additive_filter;
		searchFace.sort = dateField ? [{ field_id: dateField.id, direction: 'desc' }] : [];
		searchFace.config.keep_sort = true;
	});

	async function jumpToHit(id: string, newTab?: boolean) {
		if (newTab) {
			onOpenRow?.(id, true);
			return;
		}
		let d: Date | null = null;
		try {
			const [r] = await view.getMembers({ face: searchFace, ids_in: [id] });
			d = r ? rowDate(r) : null;
		} catch (e) {
			console.error('journal jump failed', e);
		}
		view.state.search = '';
		await tick();
		if (d) {
			selectDay(d);
			scrollBarTo(d);
		} else if (sparkEl) sparkEl.scrollLeft = sparkEl.scrollWidth;
		docPicker?.pick(id);
	}
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

	function windowStartFor(d: Date): Date {
		const lo = addDays(d, JUMP_MARGIN + 1 - WINDOW_DAYS);
		const hi = addDays(d, -JUMP_MARGIN);
		const def = addDays(today, -PAST_DAYS);
		if (def.getTime() < lo.getTime()) return lo;
		if (def.getTime() > hi.getTime()) return hi;
		return def;
	}

	let stripStart = $state(untrack(() => windowStartFor(initSelected)));
	const stripEnd = $derived(addDays(stripStart, WINDOW_DAYS - 1));
	const todayIndex = $derived(dayOffset(today));
	const todayInWindow = $derived(todayIndex >= 0 && todayIndex < WINDOW_DAYS);

	function inWindow(d: Date): boolean {
		return d.getTime() >= stripStart.getTime() && d.getTime() <= stripEnd.getTime();
	}

	const sparkEnd = $derived(todayInWindow ? tomorrow : stripEnd);
	const sparkDayCount = $derived(
		Math.round((sparkEnd.getTime() - stripStart.getTime()) / 86400000) + 1
	);
	const sparkContentW = $derived(sparkDayCount * SPARK_CELL + (sparkDayCount - 1) * SPARK_GAP);

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
		const todayLeft = todayInWindow ? sparkContentW - SPARK_STEP - TODAY_LABEL_W : Infinity;
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
	let sparkW = $state(0);

	// Right-anchor the activity timeline across width changes, same as the date strip.
	let prevSparkW = 0;
	$effect(() => {
		const w = sparkW;
		const el = sparkEl;
		if (el && prevSparkW > 0 && w > 0 && w !== prevSparkW) {
			el.scrollLeft += prevSparkW - w;
		}
		prevSparkW = w;
	});
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

	const stripDays = $derived.by(() => {
		const out: Date[] = [];
		for (let i = 0; i < WINDOW_DAYS; i++) out.push(addDays(stripStart, i));
		return out;
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

	// Keep the strip right-anchored across width changes: when the viewport grows or
	// shrinks, hold the right edge (today) fixed relative to the window rather than the
	// browser default of anchoring the left edge (which pushes today off-screen).
	let prevStripW = 0;
	$effect(() => {
		const w = stripW;
		const el = stripEl;
		if (el && prevStripW > 0 && w > 0 && w !== prevStripW) {
			el.scrollLeft += prevStripW - w;
		}
		prevStripW = w;
	});

	function dayOffset(d: Date): number {
		return Math.round((d.getTime() - stripStart.getTime()) / 86400000);
	}

	function cellLeft(i: number): number {
		const ti = todayIndex;
		if (ti < 0 || i <= ti) return STRIP_PAD + i * DAY_STEP;
		return STRIP_PAD + ti * DAY_STEP + TODAY_W + DAY_GAP + (i - ti - 1) * DAY_STEP;
	}

	function cellWidth(i: number): number {
		return i === todayIndex ? TODAY_W : DAY_SIZE;
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
		if (!stripW || !stripEl) return null;
		const stripLeft = stripEl.getBoundingClientRect().left;
		const first = Math.max(0, Math.floor(stripScrollLeft / DAY_STEP) - 2);
		const last = Math.min(
			stripDays.length - 1,
			Math.ceil((stripScrollLeft + stripW) / DAY_STEP) + 2
		);
		for (let i = first; i <= last; i++) {
			const d = stripDays[i];
			if (d.getDate() !== 1) continue;
			const btn = stripEl.children[i] as HTMLElement | undefined;
			if (!btn) continue;
			const x = btn.getBoundingClientRect().left - stripLeft - DAY_GAP / 2;
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

	// the strip scrolls to the selected day whenever it (re)mounts: first paint, and again
	// after a search swapped it out for the hits list
	$effect(() => {
		if (!stripEl) return;
		scrollStripTo(untrack(() => selected));
	});

	function selectDay(d: Date) {
		selected = d;
		if (!inWindow(d)) stripStart = windowStartFor(d);
		scrollStripTo(d);
	}

	const atPresent = $derived(sameDay(selected, today) && stripAtPresent && sparkAtEnd);

	function returnToPresent() {
		selected = today;
		stripStart = windowStartFor(today);
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

	async function onDocPicked(id: string) {
		try {
			const [r] = await view.getMembers({ face, ids_in: [id] });
			const d = r ? rowDate(r) : null;
			if (d && !sameDay(d, selected)) selectDay(d);
		} catch (e) {
			console.error('journal pick failed', e);
		}
	}

	// a doc body creates the day's entry itself; it just borrows the journal's naming
	const docLabels = $derived({
		newTitle: `${isoDay(selected)} ${selected.toLocaleDateString(undefined, { weekday: 'long' })}`,
		empty: 'No entry for this day',
		create: 'Create entry'
	});
</script>

<div
	class="journal"
	class:flow
	class:sticky={face.config.sticky_days !== false}
	bind:this={journalEl}
>
	{#if searching}
		<div class="hits">
			<ListFace {view} face={searchFace} onOpenRow={jumpToHit} />
		</div>
	{:else}
		<div class="day-nav" class:stuck bind:this={navEl}>
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
					bind:clientWidth={sparkW}
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
							{#if todayInWindow}
								<span class="spark-mlabel today" style="right: {SPARK_STEP}px">Today</span>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
		<div class="controls">
			<span class="util" class:pinned={!atPresent} bind:clientWidth={utilW}>
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
					<button class="return-present" type="button" onclick={returnToPresent}
						>Back to today</button
					>
				{/if}
			</span>
			{#if monthMarker}
				<span
					class="month-marker"
					class:pinned={!atPresent}
					style="left: {monthMarker.x}px; --fade: {monthMarker.fade}">{monthMarker.label}</span
				>
			{/if}
		</div>

		<div class="entry" bind:this={entryEl}>
			{#if bodyFace}
				<div class="body-face" class:doc={bodyFace.type === 'doc'}>
					{#key bodyFace.id}
						{#if bodyFace.type === 'doc'}
							<DocFace
								{view}
								face={bodyFace}
								{flow}
								scope={bodyScope}
								queryScope={face.additive_filter}
								labels={docLabels}
								picker={docPicker}
								{tab}
								{editor}
								{settings}
								{findBarAnchor}
								{dockTarget}
								onCreated={loadRows}
								onPicked={onDocPicked}
							/>
						{:else if bodyFace.type === 'list'}
							<ListFace {view} face={bodyFace} {onOpenRow} {createSignal} scope={bodyScope} />
						{:else}
							<MasonryFace {view} face={bodyFace} {onOpenRow} {createSignal} scope={bodyScope} />
						{/if}
					{/key}
				</div>
			{/if}
		</div>
	{/if}
</div>

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

	/* the whole navigator rides on one card: strip, spark line and month controls */
	/* the navigator stays put while the entry scrolls under it; the chip tint is layered on
	   the page colour so nothing shows through */
	/* the card lines up with the bar above it: its left bleeds like the bar's emoji lead-in,
	   its right edge stops where the search field's does */
	.day-nav {
		margin: -4px 0 0 -6px;
		padding: 6px 8px;
		border-radius: 8px;
		background: linear-gradient(var(--chip-bg), var(--chip-bg)), var(--color-surface);
	}

	.journal.sticky .day-nav {
		position: sticky;
		top: 12px;
		z-index: 3;
		transition: box-shadow 120ms ease;
	}

	.journal.sticky .day-nav.stuck {
		box-shadow: var(--menu-shadow);
	}

	.spark {
		padding: 12px 0 0;
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
		background: var(--accent-a9);
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

	.entry {
		position: relative;
	}

	/* Body faces bring their own 24px gutter; cancel the journal's so it isn't doubled */
	.body-face {
		margin: 24px -24px 0;
	}

	/* the list brings its own 24px gutter */
	.hits {
		margin: 0 -24px;
	}

	/* a document body reads as the day itself, so it sits tight under the strip */
	.body-face.doc {
		margin-top: 8px;
	}

	.controls {
		position: relative;
		display: flex;
		align-items: center;
		padding: 6px 0 0;
	}

	.util {
		display: inline-flex;
		align-items: center;
		height: 20px;
		border-radius: 5px;
		transition: background-color 120ms ease;
	}

	/* away from today it becomes a small card holding the month and the way back */
	.util.pinned {
		padding: 0;
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

	.day-nav:hover + .controls .nav-year,
	.controls:hover .nav-year {
		opacity: 1;
	}

	/* runs to the card's edges so the fade ends at them, not at the padding */
	.days {
		display: flex;
		gap: 12px;
		margin: 0 -8px;
		padding: 0 8px;
		overflow-x: auto;
		scrollbar-width: none;
		touch-action: none;
		user-select: none;
		-webkit-mask-image: linear-gradient(
			to right,
			transparent,
			#000 14px,
			#000 calc(100% - 14px),
			transparent
		);
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 14px,
			#000 calc(100% - 14px),
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
		border-radius: 8px;
	}

	.day.selected .dow {
		color: var(--accent-contrast-a72);
	}

	.day.selected .num {
		color: var(--color-accent-contrast);
	}

	.day:not(.selected):hover {
		border-radius: 6px;
		background: var(--chip-bg);
	}
</style>
