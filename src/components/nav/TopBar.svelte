<script lang="ts">
	import { getViewIcon, getUnitIcon } from '$lib/views/filterDisplay';
	import { palette } from '$lib/palette.svelte';
	import { openProjectSetup } from '$lib/views/projectSetup';
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import { TabState, type FocusTarget } from '$lib/models/EditorState.svelte.js';
	import type Session from '$lib/models/Session.svelte.js';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import WindowControls from './WindowControls.svelte';
	import { hostWindowStyle, resolveWindowStyle } from '$lib/services/platform';

	import {
		Settings,
		Search,
		Cone,
		Bookmark,
		ChevronDown,
		X,
		Plus,
		TextSearch,
		GripVertical,
		House,
		TextAlignStart,
		Pin,
		PinOff,
		CircleX,
		Scale,
		Blocks,
		Columns2
	} from '@lucide/svelte';
	import { ctxMenu, contextMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import { listSources, sourceName, type Source } from '$lib/models/Source';
	import { folderId } from '$lib/models/Folder';
	import View, { BUILTIN_UNITS } from '$lib/models/View.svelte';
	import { FolderInput, SquareArrowOutUpRight } from '@lucide/svelte';

	let { session, onAddSource }: { session: Session; onAddSource?: () => void } = $props();

	const settings = $derived(session.settings);
	const editor = $derived(session.editors[0]);

	let compactTabs = $derived(settings.get<boolean>('appearance.compact_tabs') ?? false);

	// Collapse pinned tabs to just their icon
	let collapsePinned = $derived(settings.get<boolean>('appearance.collapse_pinned_tabs') ?? true);

	const settingsTab: FocusTarget = { kind: 'settings' };
	const searchTab: FocusTarget = { kind: 'search' };

	// ── Bookmarks: not a tab, a menu of places. Sources in a flyout, then the saved views ──
	let bmSources: Source[] = $state([]);
	let bmViews: View[] = $state([]);

	// the bookmark shows its pick on a transient surface, not a tab: gone once you go elsewhere
	function openUnitView(unitId: string, name: string, newTab = false) {
		const target = newTab ? editor.aside : editor;
		const existing = target.tabs.find(
			(t) => t.content.type === 'view' && t.content.view.unit === unitId
		);
		if (existing) return target.focusTab({ kind: 'tab', id: existing.id });
		View.forUnit(unitId, name)
			.then((v) => (newTab ? target.openView(v) : editor.showPreview(TabState.forView(v))))
			.catch(console.error);
	}

	function bookmarkEntries(): CtxEntry[] {
		return [
			{
				label: 'Sources',
				icon: FolderInput,
				children: [
					...bmSources.map((s): CtxEntry => ({
						label: sourceName(s),
						icon: FolderInput,
						action: () => openUnitView(folderId(s.id, ''), sourceName(s)),
						aux: {
							icon: SquareArrowOutUpRight,
							label: 'Open in new tab',
							action: () => openUnitView(folderId(s.id, ''), sourceName(s), true)
						}
					})),
					...(bmSources.length ? [{ divider: true } as CtxEntry] : []),
					{ label: 'Add source', icon: Plus, action: () => onAddSource?.() }
				]
			},
			{
				label: 'Built-in',
				icon: Blocks,
				children: [
					{ label: 'Home', icon: House, action: () => editor.openHome() },
					...Object.values(BUILTIN_UNITS)
						.filter((u) => !bmViews.some((v) => v.unit === u.unit))
						.map((u): CtxEntry => {
							const name = u.unit.slice('tag:'.length);
							return {
								label: name,
								icon: getUnitIcon(u.unit),
								action: () => openUnitView(u.unit, name),
								aux: {
									icon: SquareArrowOutUpRight,
									label: 'Open in new tab',
									action: () => openUnitView(u.unit, name, true)
								}
							};
						})
				]
			},
			{ divider: true },
			...bmViews.map((v): CtxEntry => ({
				label: v.slug,
				icon: getViewIcon(v),
				emoji: v.emoji || undefined,
				aux: {
					icon: SquareArrowOutUpRight,
					label: 'Open in new tab',
					action: () => editor.aside.openView(v)
				},
				action: () => editor.showPreview(TabState.forView(v))
			})),
			...(bmViews.length ? [{ divider: true } as CtxEntry] : []),
			{ label: 'New project', icon: Plus, action: () => openProjectSetup(editor) }
		];
	}

	async function openBookmarks(e: MouseEvent) {
		session.activate(editor, true);
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		try {
			[bmSources, bmViews] = await Promise.all([listSources(), View.listSaved()]);
			bmViews.sort((a, b) => b.accessedAt.getTime() - a.accessedAt.getTime());
		} catch (err) {
			console.error('bookmarks load failed', err);
		}
		contextMenu.show(r.left, r.bottom + 6, () => bookmarkEntries(), { minWidth: 220 });
	}

	// ── Tab drag and drop ───────────────────────────────────────────────────────
	// Pinned tabs occupy the front of the strip; a divider separates them from the
	// open tabs. Dragging reorders within a zone only — pinning is deliberate (the
	// tab context menu), never an accident of dragging.
	type Box = { left: number; top: number; width: number; height: number };

	let navEl: HTMLElement | null = $state(null);
	let dragFrom: EditorState | null = $state(null);
	let dragTab: TabState | null = $state(null);
	let dragDeltaX = $state(0);
	let dropIndex = $state(-1);
	let suppressTransition = $state(false);
	let dragActive = $state(false);
	let ghost: Box | null = $state(null);
	let drop: { editor: EditorState | null; index: number; box: Box } | null = $state(null);
	let originalIndex = -1;
	let homeIndex = -1;
	let dragStartX = 0;
	let dragStartY = 0;
	let stripRects: DOMRect[] = [];
	let tabRects: DOMRect[][] = [];
	let paneRects: DOMRect[] = [];

	const DRAG_THRESHOLD = 4;
	const DETACH_SLOP = 12;

	function rectsOf(root: ParentNode, selector: string): DOMRect[] {
		return [...root.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
	}

	function onPointerDown(e: PointerEvent, from: EditorState, index: number) {
		if ((e.target as HTMLElement).closest('.close-btn')) return;
		if (e.button !== 0 || !navEl) return;

		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		session.activate(from, true);

		dragFrom = from;
		dragTab = from.tabs[index];
		dragStartX = e.clientX;
		dragStartY = e.clientY;
		dragDeltaX = 0;
		dragActive = false;
		originalIndex = index;
		homeIndex = session.editors.indexOf(from);
		dropIndex = index;

		stripRects = rectsOf(navEl, '.strip');
		tabRects = [...navEl.querySelectorAll('.strip')].map((s) => rectsOf(s, '.tabs-scroll > .tab'));
		paneRects = rectsOf(document, '.content-area');
	}

	function dropAt(x: number, y: number): typeof drop {
		if (!dragFrom || !dragTab) return null;
		const over = (rects: DOMRect[]) => rects.findIndex((r) => x >= r.left && x <= r.right);

		if (y <= stripRects[homeIndex].bottom) {
			const s = over(stripRects);
			const target = session.editors[s];
			const tabs = tabRects[s];
			if (!target || target === dragFrom || !tabs.length) return null;
			const pinned = target.pinnedCount;
			const raw = tabs.filter((r) => x > r.left + r.width / 2).length;
			const index = dragTab.pinned && s === 0 ? Math.min(raw, pinned) : Math.max(raw, pinned);
			const edge = tabs[index]?.left ?? tabs[tabs.length - 1].right + 6;
			const box = { left: edge - 4, top: stripRects[s].top + 10, width: 2, height: 24 };
			return { editor: target, index, box };
		}

		if (paneRects.length === 1) {
			const r = paneRects[0];
			if (dragFrom.tabs.length < 2 || x < r.left + r.width / 2) return null;
			const box = { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
			return { editor: null, index: 0, box };
		}

		const p = over(paneRects);
		const target = session.editors[p];
		if (!target || target === dragFrom) return null;
		return { editor: target, index: target.tabs.length, box: paneRects[p] };
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragFrom || !dragTab) return;

		if (!dragActive) {
			if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_THRESHOLD) return;
			dragActive = true;
		}

		const home = stripRects[homeIndex];
		const own = tabRects[homeIndex];

		if (e.clientY > home.bottom + DETACH_SLOP || e.clientX < home.left || e.clientX > home.right) {
			const r = own[originalIndex];
			ghost = {
				left: r.left + e.clientX - dragStartX,
				top: r.top + e.clientY - dragStartY,
				width: r.width,
				height: r.height
			};
			drop = dropAt(e.clientX, e.clientY);
			dragDeltaX = 0;
			dropIndex = originalIndex;
			return;
		}
		ghost = null;
		drop = null;

		// A tab reorders only within its own pinned/unpinned zone
		const pinnedCount = dragFrom.pinnedCount;
		const zoneStart = dragTab.pinned ? 0 : pinnedCount;
		const zoneEnd = dragTab.pinned ? pinnedCount - 1 : dragFrom.tabs.length - 1;

		const minDelta = own[zoneStart].left - own[originalIndex].left;
		const maxDelta = own[zoneEnd].right - own[originalIndex].right;
		dragDeltaX = Math.max(minDelta, Math.min(maxDelta, e.clientX - dragStartX));

		const draggedLeft = own[originalIndex].left + dragDeltaX;
		const draggedRight = draggedLeft + own[originalIndex].width;

		let newIndex = originalIndex;
		for (let i = originalIndex + 1; i <= zoneEnd; i++) {
			if (draggedRight > own[i].left + own[i].width / 2) newIndex = i;
			else break;
		}
		for (let i = originalIndex - 1; i >= zoneStart; i--) {
			if (draggedLeft < own[i].left + own[i].width / 2) newIndex = i;
			else break;
		}
		dropIndex = newIndex;
	}

	function tabTransform(from: EditorState, index: number): string {
		if (from !== dragFrom || !dragActive) return '';
		if (index === originalIndex) return `translateX(${dragDeltaX}px)`;

		const gap = 6;
		const shift = tabRects[homeIndex][originalIndex].width + gap;

		if (dropIndex > originalIndex && index > originalIndex && index <= dropIndex) {
			return `translateX(-${shift}px)`;
		}
		if (dropIndex < originalIndex && index < originalIndex && index >= dropIndex) {
			return `translateX(${shift}px)`;
		}
		return '';
	}

	function endDrag() {
		dragFrom = null;
		dragTab = null;
		dragDeltaX = 0;
		dragActive = false;
		dropIndex = -1;
		ghost = null;
		drop = null;
	}

	function onPointerUp() {
		if (dragFrom && dragTab && drop) {
			session.moveTab(dragTab, dragFrom, drop.editor ?? session.beside(dragFrom), drop.index);
		} else if (dragFrom && dropIndex !== originalIndex) {
			suppressTransition = true;
			dragFrom.moveTab(originalIndex, dropIndex);
			requestAnimationFrame(() => {
				suppressTransition = false;
			});
		}
		endDrag();
	}

	// ── Per-tab context menu ─────────────────────────────────────────────────────
	function tabMenu(from: EditorState, tab: TabState): CtxEntry[] {
		const pinned = tab.pinned;
		const split = session.editors.length > 1;
		const pin: CtxEntry = {
			label: pinned ? 'Unpin' : 'Pin',
			icon: pinned ? PinOff : Pin,
			action: () => from.togglePin(tab.id)
		};
		return [
			...(pinned || from === session.editors[0] ? [pin] : []),
			{
				label: split ? 'Move to other side' : 'Open to the side',
				icon: Columns2,
				action: () => session.moveTab(tab, from, session.beside(from)),
				disabled: !split && from.tabs.length < 2
			},
			{ divider: true },
			{ label: 'Close', icon: X, action: () => from.closeTab(tab.id) },
			{
				label: 'Close all',
				icon: CircleX,
				action: () => from.closeUnpinned(),
				disabled: from.tabs.every((t) => t.pinned)
			}
		];
	}

	// ── Window controls ─────────────────────────────────────────────────────────
	// Platform decides where the logo and the controls sit; the setting overrides it
	// so a style can be forced (and previewed) on any host.
	let windowStyle = $derived(resolveWindowStyle(settings.get<string>('appearance.window_style')));
	let isMac = $derived(windowStyle === 'macos');
	const nativeLights = hostWindowStyle() === 'macos';

	const appWindow = getCurrentWindow();

	function handleDrag(e: MouseEvent) {
		// Don't drag if clicking on interactive elements
		const target = e.target as HTMLElement;
		if (target.closest('button, .tab, .dropdown-btn')) return;
		appWindow.startDragging();
	}
</script>

{#snippet grip()}
	<div class="drag-handle" class:trailing={isMac}>
		<GripVertical size={16} />
	</div>
{/snippet}

{#snippet face(d: TabState, collapsed: boolean)}
	{#if d.origin.type === 'view'}
		{#if d.origin.view.emoji}
			<span class="tab-emoji">{d.origin.view.emoji}</span>
		{:else}
			{@const TabIcon = getViewIcon(d.origin.view)}
			<TabIcon size={13} />
		{/if}
	{:else if d.origin.type === 'new'}
		<Bookmark size={13} />
	{:else if d.origin.type === 'home'}
		<House size={13} />
	{:else if d.origin.type === 'licenses'}
		<Scale size={13} />
	{:else if !compactTabs || collapsed}
		<TextAlignStart class="doc-icon" size={13} />
	{/if}
	<span class="tab-label">{d.origin.type === 'new' ? 'New project' : d.title}</span>
{/snippet}

<nav class="nav-bar" class:mac={isMac} onmousedown={handleDrag} bind:this={navEl}>
	{#each session.editors as ed, s (ed)}
		{@const pinnedCount = ed.pinnedCount}
		<div class="strip" class:inactive={session.editors.length > 1 && session.active !== ed}>
			{#if s === 0}
				<!-- Leading: traffic lights on macOS, the logo drag handle elsewhere -->
				{#if isMac}
					<WindowControls style={windowStyle} native={nativeLights} />
				{:else}
					{@render grip()}
				{/if}

				<!-- Pinned icon tabs -->
				<div
					class="tab icon-tab"
					class:active={ed.isTabFocused(settingsTab)}
					onclick={() => {
						session.activate(ed, true);
						ed.focusTab(settingsTab);
					}}
					role="button"
					tabindex="-1"
				>
					<Settings size={16} />
				</div>
				<!-- Bookmarks: a menu of places, not a tab -->
				<div
					class="tab icon-tab bookmarks"
					class:active={ed.focused?.kind === 'preview'}
					onclick={openBookmarks}
					role="button"
					tabindex="-1"
				>
					<Bookmark size={16} />
					<ChevronDown size={12} strokeWidth={2} />
				</div>

				<!-- Divider -->
				<div class="divider"></div>
			{/if}

			<!-- Tabs -->
			<div class="tabs-scroll">
				{#each ed.tabs as d, i (d.id)}
					{@const target: FocusTarget = {kind: 'tab', id: d.id}}
					{#if i === pinnedCount && pinnedCount > 0}
						<div class="pin-divider"></div>
					{/if}
					{@const collapsed = d.pinned && collapsePinned}
					<div
						class="tab"
						class:active={ed.isTabFocused(target)}
						class:pinned={d.pinned}
						class:collapsed
						class:dragging={dragActive && dragTab === d}
						class:lifted={!!ghost && dragTab === d}
						class:no-transition={suppressTransition}
						style:transform={tabTransform(ed, i)}
						title={collapsed ? d.title : null}
						use:ctxMenu={() => tabMenu(ed, d)}
						onclick={() => {
							if (ed.tabs.includes(d)) ed.focusTab(target);
						}}
						onpointerdown={(e) => onPointerDown(e, ed, i)}
						onpointermove={onPointerMove}
						onpointerup={onPointerUp}
						onpointercancel={onPointerUp}
						onlostpointercapture={onPointerUp}
						role="button"
						tabindex="-1"
					>
						{@render face(d, collapsed)}
						<span class="tab-fade"></span>
						<span class="close-zone">
							<button
								class="close-btn"
								title="Close tab"
								tabindex="-1"
								onclick={(e) => {
									e.stopPropagation();
									ed.closeTab(d.id);
								}}
							>
								<X size={12} />
							</button>
						</span>
					</div>
				{/each}
				<button
					class="new-tab-btn"
					title="New"
					tabindex="-1"
					onclick={() => {
						session.activate(ed);
						palette.show();
					}}
				>
					<Plus size={15} />
				</button>
			</div>

			{#if s === session.editors.length - 1}
				<!-- Trailing: the logo is right-justified on macOS, controls elsewhere -->
				{#if isMac}
					{@render grip()}
				{:else}
					<WindowControls style={windowStyle} />
				{/if}
			{/if}
		</div>
	{/each}
</nav>

{#if ghost && dragTab}
	{@const collapsed = dragTab.pinned && collapsePinned}
	<div
		class="tab ghost"
		class:collapsed
		style:left="{ghost.left}px"
		style:top="{ghost.top}px"
		style:width="{ghost.width}px"
	>
		{@render face(dragTab, collapsed)}
	</div>
{/if}
{#if drop}
	<div
		class="drop-zone"
		style:left="{drop.box.left}px"
		style:top="{drop.box.top}px"
		style:width="{drop.box.width}px"
		style:height="{drop.box.height}px"
	></div>
{/if}

<style>
	.nav-bar {
		display: grid;
		grid-template-columns: var(--pane-cols, 1fr);
		height: 42px;
		width: 100%;
		background: transparent;
		overflow: hidden;
	}

	.strip {
		display: flex;
		align-items: flex-end;
		min-width: 0;
		padding-left: 3px;
		gap: 6px;
		overflow: hidden;
	}

	.strip:not(:first-child) .tabs-scroll {
		padding-left: 0;
	}

	.strip:not(:first-child) .tab.active:first-child::before {
		display: none;
	}

	.strip:first-child {
		padding-left: 10px;
	}

	.strip:not(:last-child) {
		padding-right: 12px;
	}

	/* ── Drag handle ── */
	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 32px;
		margin-bottom: 4px;
		flex-shrink: 0;
		color: var(--color-ui-muted);
		cursor: grab;
	}

	/* macOS: the logo trades places with the window controls */
	.drag-handle.trailing {
		width: auto;
		padding: 0 14px 0 10px;
		margin-left: auto;
	}

	.nav-bar.mac .strip:first-child {
		padding-left: 12px;
	}

	/* ── Divider ── */
	.divider {
		width: 1px;
		height: 22px;
		margin: 0 -6px 9px 2px;
		background: var(--color-border);
		border-radius: 999px;
		flex-shrink: 0;
	}

	/* ── Pinned/open separator (within the tab strip) ── */
	.pin-divider {
		width: 1px;
		height: 22px;
		margin: 0 3px 9px;
		background: var(--color-border);
		border-radius: 999px;
		flex-shrink: 0;
		align-self: flex-end;
	}

	/* ── Tabs scroll container ── */
	.tabs-scroll {
		display: flex;
		align-items: flex-end;
		flex: 1;
		min-width: 0;
		gap: 6px;
		padding-left: 8px;
		overflow-x: hidden;
		overflow-y: hidden;
	}

	/* ── Tab ── */
	.tab {
		position: relative;
		display: flex;
		align-items: center;
		height: 32px;
		margin-bottom: 4px;
		padding: 0 12px;
		border: none;
		border-radius: 6px;
		background: var(--color-surface);
		color: var(--color-ui-muted);
		font-size: 13px;
		font-family: inherit;
		white-space: nowrap;
		flex-shrink: 0;
		cursor: pointer;
		gap: 6px;
		transition: transform 150ms ease;
	}

	.tab :global(svg) {
		display: block;
		flex-shrink: 0;
	}

	.tab.no-transition {
		transition: none;
	}

	.tab.dragging {
		z-index: 10;
		opacity: 0.9;
		transition: none;
		cursor: grabbing;
	}

	.tab.lifted {
		opacity: 0.35;
	}

	.tab.ghost {
		position: fixed;
		z-index: 60;
		margin: 0;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		opacity: 0.9;
		pointer-events: none;
	}

	.tab.ghost.collapsed {
		padding: 0;
		justify-content: center;
	}

	.drop-zone {
		position: fixed;
		z-index: 59;
		border-radius: 8px;
		background: var(--accent-a14);
		box-shadow: inset 0 0 0 1.5px var(--color-accent);
		pointer-events: none;
	}

	.strip.inactive .tab.active {
		color: var(--color-ui-muted);
	}

	.tabs-scroll .tab {
		flex-shrink: 1;
		min-width: 36px;
		max-width: 240px;
		padding: 0 13px 0 12px;
	}

	.tab.icon-tab {
		padding: 0 10px;
	}

	.tab.bookmarks {
		gap: 4px;
		padding: 0 8px 0 10px;
	}

	/* Collapsed pinned tabs: fixed-width icon-only anchors */
	.tabs-scroll .tab.collapsed {
		width: 34px;
		min-width: 34px;
		max-width: none;
		padding-left: 0;
		padding-right: 0;
		justify-content: center;
	}

	.tab.collapsed .tab-label {
		display: none;
	}

	/* an even icon in an even box: 13px would leave a half pixel on each side and round */
	.tabs-scroll .tab.collapsed :global(svg) {
		width: 14px;
		height: 14px;
	}

	.tab-emoji {
		font-size: 14px;
		line-height: 1;
		flex-shrink: 0;
	}

	/* ── New tab button ── */
	.new-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin-bottom: 6px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: var(--color-ui-muted);
		cursor: pointer;
		flex-shrink: 0;
	}

	.new-tab-btn:hover {
		background: var(--color-surface);
		color: var(--color-text-secondary);
	}

	:global(.doc-icon) {
		margin-right: 2px;
		color: currentColor;
	}

	.tab:hover {
		color: var(--color-ui-dulled);
	}

	.tab:not(.active):hover::after {
		content: '';
		position: absolute;
		bottom: -3px;
		left: 50%;
		transform: translateX(-50%);
		width: 20px;
		height: 1px;
		background: var(--color-border);
	}

	.tab.active {
		height: 36px;
		margin-bottom: 0;
		padding-bottom: 4px;
		border-radius: 6px 6px 0 0;
		color: var(--color-text-secondary);
	}

	/* Concave corners on active tab */
	.tab.active::before,
	.tab.active::after {
		content: '';
		position: absolute;
		bottom: 0;
		width: 5px;
		height: 5px;
	}

	.tab.active::before {
		left: -5px;
		border-bottom-right-radius: 5px;
		box-shadow: 2.5px 0 0 0 var(--color-surface);
	}

	.tab.active::after {
		right: -5px;
		border-bottom-left-radius: 5px;
		box-shadow: -2.5px 0 0 0 var(--color-surface);
	}

	.tab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		line-height: 1.5;
		transform: translateY(1px);
		user-select: none;
	}

	.tab-fade {
		display: none;
	}

	/* ── Close zone + button ── */
	.close-zone {
		position: absolute;
		right: 0;
		top: 0;
		width: 40px; /*Played with this for like 10 mins this is perf*/
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 4px;
		border-radius: 0 6px 6px 0;
		background: transparent;
		pointer-events: none;
		opacity: 0;
		transition: opacity 100ms ease;
	}

	.tab.active .close-zone {
		border-radius: 0 6px 0 0;
		padding-bottom: 4px;
	}

	.tab:hover .close-zone {
		background: linear-gradient(to right, transparent, var(--color-surface) 50%);
		opacity: 1;
	}

	/* Pinned tabs can't be closed directly;;;; unpin to close */
	.tab.pinned .close-zone {
		display: none;
	}

	.close-btn {
		display: flex;
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
		pointer-events: auto;
	}

	.close-btn:hover {
		color: var(--color-text-primary);
	}
</style>
