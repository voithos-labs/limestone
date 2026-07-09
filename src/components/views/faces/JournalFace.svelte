<script lang="ts">
	import { untrack } from 'svelte';
	import type View from '$lib/models/View.svelte';
	import type { ViewFace } from '$lib/models/View.svelte';
	import { rawStatefulValue, fieldLabel } from '$lib/views/fieldValue';
	import { TabState } from '$lib/state/EditorState.svelte';
	import DocHandle from '$lib/models/DocHandle';
	import { listSources } from '$lib/models/Source';
	import { deriveCreateContext, folderPath, folderLinkChain } from '$lib/views/createDefaults';
	import Group, { GroupType } from '$lib/models/Group';
	import Menu from '../Menu.svelte';
	import type { MenuEntry } from '$lib/views/menuTypes';
	import DateValueEditor from '../DateValueEditor.svelte';
	import MarkdownEditor from '../../editor/MarkdownEditor.svelte';
	import {
		ChevronLeft,
		ChevronRight,
		SlidersHorizontal,
		ScanBarcode,
		ScanLine
	} from '@lucide/svelte';

	let { view, face, flow = false }: { view: View; face: ViewFace; flow?: boolean } = $props();

	const DAY_W = 84;
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

	const today = startOfDay(new Date());
	const yesterday = addDays(today, -1);
	const tomorrow = addDays(today, 1);

	function dayLabel(d: Date): string {
		if (sameDay(d, today)) return 'Today';
		if (sameDay(d, yesterday)) return 'Yesterday';
		return WEEKDAY[d.getDay()];
	}

	function isSpecial(d: Date): boolean {
		return sameDay(d, today) || sameDay(d, yesterday);
	}

	function fullDate(d: Date): string {
		return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	}

	const initSelected = parseDay(untrack(() => face.config.selected_day)) ?? today;
	let selected = $state(initSelected);
	let windowEndDays = $state(0);
	let cardW = $state(0);
	let rows = $state<any[]>([]);

	const dateFieldKey = $derived((face.config.date_field as string) ?? 'created_at');

	const GAP = 16;

	// Fill the strip with DAY_W-wide days (no special reservation, so the row never
	// leaves a trailing gap); the cells then flex to fit, specials a touch wider.
	const visibleCount = $derived(Math.max(3, Math.floor((cardW + GAP) / (DAY_W + GAP))));

	// Right edge as a day offset from tomorrow (0 = today second-to-last). Arrows
	// snap to a page grid so they never drift; drag moves it day-by-day.
	const windowEnd = $derived(addDays(tomorrow, windowEndDays));

	// Once the strip is measured, grid-snap the window to the restored day so it
	// lands in a consistent page (not forced second-to-last).
	let didInitWindow = false;
	$effect(() => {
		if (didInitWindow || cardW === 0) return;
		didInitWindow = true;
		const dt = Math.round((initSelected.getTime() - tomorrow.getTime()) / 86400000);
		windowEndDays = Math.ceil(dt / visibleCount) * visibleCount;
	});

	const visibleDays = $derived.by(() => {
		const n = visibleCount;
		const out: Date[] = [];
		for (let i = n - 1; i >= 0; i--) out.push(addDays(windowEnd, -i));
		return out;
	});

	function rowDate(r: any, key: string): Date | null {
		let raw: unknown;
		if (key === 'created_at') raw = r.created_at;
		else if (key === 'updated_at') raw = r.updated_at;
		else {
			const field = view.fields.find((f) => f.id === key);
			if (!field) return null;
			raw = rawStatefulValue(r, view.slug, field.name);
		}
		if (raw == null || raw === '') return null;
		const d = new Date(raw as string);
		return isNaN(d.getTime()) ? null : startOfDay(d);
	}

	async function loadRows() {
		try {
			rows = await view.getMembers({ face, limit: 5000 });
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

	const selectedRow = $derived.by(() => {
		for (const r of rows) {
			const d = rowDate(r, dateFieldKey);
			if (d && sameDay(d, selected)) return r;
		}
		return null;
	});

	let docTab: TabState | null = $state(null);
	$effect(() => {
		const row = selectedRow;
		if (!row) {
			docTab = null;
			return;
		}
		let cancelled = false;
		DocHandle.fromID(row.id)
			.then((h) => {
				if (!cancelled) docTab = TabState.forDoc(h);
			})
			.catch((e) => console.error('open journal doc failed', e));
		return () => {
			cancelled = true;
		};
	});

	let optOpen = $state(false);
	let optEl: HTMLElement | null = $state(null);

	const dateFieldItems = $derived.by(() => {
		const items: { value: string; label: string }[] = [
			{ value: 'created_at', label: 'Created' },
			{ value: 'updated_at', label: 'Updated' }
		];
		for (const f of view.fields) {
			if (f.type === 'date') items.push({ value: f.id, label: fieldLabel(f) });
		}
		return items;
	});

	const showActivity = $derived(face.config.show_activity !== false);
	let jumpOpen = $state(false);

	const menuItems = $derived.by((): MenuEntry[] => [
		{ kind: 'divider', section: 'Date field' },
		...dateFieldItems,
		{ kind: 'divider' },
		{ value: '__activity', label: 'Activity timeline', icon: showActivity ? ScanLine : ScanBarcode }
	]);

	function onOpt(value: string) {
		if (value === '__activity') face.config.show_activity = !showActivity;
		else face.config.date_field = value;
		optOpen = false;
	}

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
	// Timeline covers the current year up to tomorrow; years are traversed via the
	// year field and date picker, not by scrolling the bar (keeps it short/snappy).
	const sparkStart = new Date(today.getFullYear(), 0, 1);
	const SPARK_DAYS = Math.round((tomorrow.getTime() - sparkStart.getTime()) / 86400000) + 1;
	const sparkContentW = SPARK_DAYS * SPARK_CELL + (SPARK_DAYS - 1) * SPARK_GAP;

	const sparkDays = $derived.by(() => {
		const set = entries;
		const out: { date: Date; on: boolean; first: boolean; label: string }[] = [];
		for (let i = 0; i < SPARK_DAYS; i++) {
			const cur = addDays(sparkStart, i);
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
		const TODAY_W = 36;
		const todayLeft = sparkContentW - SPARK_STEP - TODAY_W;
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
	function sparkPointerDown(e: PointerEvent) {
		if (e.button !== 0 || !sparkEl) return;
		dragMoved = false;
		const el = sparkEl;
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

	function selectDay(d: Date) {
		selected = d;
		// Snap to the same page grid as the arrows so the window stays consistent
		// (the date lands wherever it falls in that page, not always second-to-last).
		const dt = Math.round((d.getTime() - tomorrow.getTime()) / 86400000);
		windowEndDays = Math.ceil(dt / visibleCount) * visibleCount;
	}

	const atPresent = $derived(sameDay(selected, today) && windowEndDays === 0 && sparkAtEnd);

	function returnToPresent() {
		selectDay(today);
		if (sparkEl) sparkEl.scrollLeft = sparkEl.scrollWidth;
	}

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
		const diff = Math.round((d.getTime() - sparkStart.getTime()) / 86400000);
		if (diff < 0 || diff >= SPARK_DAYS) return;
		const el = sparkEl;
		requestAnimationFrame(() => {
			el.scrollLeft = 3 + diff * SPARK_STEP + SPARK_CELL - el.clientWidth;
		});
	}

	$effect(() => {
		face.config.selected_day = isoDay(selected);
	});

	function page(dir: number) {
		const cur = Math.round(windowEndDays / visibleCount);
		windowEndDays = (cur + dir) * visibleCount;
	}

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
			source = source ?? sources[0];
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
		<div class="strip">
			<div class="days" bind:clientWidth={cardW}>
				{#each visibleDays as d (dayKey(d))}
					<button
						class="day"
						class:selected={sameDay(d, selected)}
						class:today={sameDay(d, today)}
						class:wide={isSpecial(d)}
						class:has-entry={entries.has(dayKey(d))}
						type="button"
						onclick={() => (selected = d)}
					>
						<span class="dow"
							>{isSpecial(d)
								? fullDate(d)
								: sameDay(d, tomorrow)
									? 'Tomorrow'
									: WEEKDAY[d.getDay()]}</span
						>
						<span class="num">{isSpecial(d) ? dayLabel(d) : d.getDate()}</span>
					</button>
				{/each}
			</div>

			<button
				class="ctl nav-left"
				type="button"
				aria-label="Previous days"
				onclick={() => page(-1)}
			>
				<ChevronLeft size={18} strokeWidth={2} />
			</button>
			<button class="ctl nav-right" type="button" aria-label="Next days" onclick={() => page(1)}>
				<ChevronRight size={18} strokeWidth={2} />
			</button>
		</div>

		{#if showActivity}
			<div
				class="spark"
				bind:this={sparkEl}
				onpointerdown={sparkPointerDown}
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
			<button
				class="nav-year"
				class:pinned={!atPresent}
				type="button"
				aria-label="Jump to date"
				onclick={(e) => openPicker(e.currentTarget)}
				>{selected.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</button
			>
			{#if !atPresent}
				<span class="nav-sep">·</span>
				<button class="return-present" type="button" onclick={returnToPresent}>Today</button>
			{/if}
			<button
				class="ctl opt"
				type="button"
				aria-label="Journal options"
				bind:this={optEl}
				onclick={() => (optOpen = !optOpen)}
			>
				<SlidersHorizontal size={14} strokeWidth={1.75} />
			</button>
		</div>
	</div>

	<div class="entry">
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
	</div>
</div>

<Menu
	bind:open={optOpen}
	anchor={optEl}
	items={menuItems}
	onSelect={onOpt}
	selected={dateFieldKey}
	minWidth={170}
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

	.strip {
		position: relative;
	}

	.nav-left,
	.nav-right {
		position: absolute;
		top: 0;
		bottom: 0;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.nav-left {
		left: -20px;
	}

	.nav-right {
		right: -20px;
	}

	.controls {
		display: flex;
		align-items: center;
		padding-top: 4px;
	}

	.controls .ctl {
		margin-left: auto;
		opacity: 0;
		transition: opacity 120ms ease;
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

	.day-nav:hover .nav-left,
	.day-nav:hover .nav-right,
	.day-nav:hover .nav-year,
	.day-nav:hover .controls .ctl {
		opacity: 1;
	}

	.ctl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
	}

	.ctl:hover {
		color: var(--color-text-primary);
	}

	.days {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 16px;
		border-radius: 4px;
	}

	.day {
		position: relative;
		flex: 1 1 84px;
		min-width: 64px;
		max-width: 120px;
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

	.day.wide {
		flex: 0 1 140px;
		min-width: 110px;
		max-width: none;
	}

	.day:not(:first-child)::before {
		content: '';
		position: absolute;
		left: -8px;
		top: 50%;
		transform: translateY(-50%);
		width: 1px;
		height: 18px;
		border-radius: 999px;
		background: var(--color-border);
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

	.day.has-entry::after {
		content: '';
		position: absolute;
		bottom: 1px;
		left: 50%;
		transform: translateX(-50%);
		width: 18px;
		height: 2px;
		border-radius: 999px;
		background: var(--color-accent);
	}

	.day.selected {
		background: var(--chip-bg);
		border-radius: 6px;
	}

	.day:not(.selected):hover {
		border-radius: 6px;
		box-shadow: inset 0 0 0 1px var(--color-border);
	}
</style>
