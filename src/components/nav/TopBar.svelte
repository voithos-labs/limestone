<script lang="ts">
	import type EditorState from '$lib/models/EditorState.svelte.js';
	import type { FocusTarget, TabState } from '$lib/models/EditorState.svelte.js';
	import { getCurrentWindow } from '@tauri-apps/api/window';

	import {
		Settings,
		Search,
		Cone,
		Library,
		Bookmark,
		ChevronDown,
		Box,
		Hash,
		Folder,
		Folders,
		X,
		GripVertical,
		Plus,
		TextSearch,
		TextAlignStart,
		Pin,
		PinOff,
		CircleX
	} from '@lucide/svelte';
	import type { SettingsState } from '$lib/models/Settings.svelte';
	import { ctxMenu, type CtxEntry } from '$lib/contextMenu.svelte';
	import type View from '$lib/models/View.svelte';

	function viewTabIcon(view: View) {
		const typesById = new Map(view.fields.map((f) => [f.id, f.type]));
		const scoped = new Set(
			view.filter.children
				.filter((n) => 'field_id' in n)
				.map((n) => typesById.get((n as { field_id: string }).field_id))
		);
		if (scoped.has('tags')) return Hash;
		if (scoped.has('folder')) return Folder;
		if (scoped.has('source')) return Folders;
		return Box;
	}

	let { editor, settings }: { editor: EditorState; settings: SettingsState } = $props();

	let compactTabs = $derived(settings.get<boolean>('appearance.compact_tabs') ?? false);

	// Collapse pinned tabs to just their icon
	let collapsePinned = $derived(settings.get<boolean>('appearance.collapse_pinned_tabs') ?? true);

	const settingsTab: FocusTarget = { kind: 'settings' };
	const searchTab: FocusTarget = { kind: 'search' };

	// ── Tab drag and drop ───────────────────────────────────────────────────────
	let dragDocId: string | null = $state(null);
	let dragDeltaX = $state(0);
	let dropIndex = $state(-1);
	let suppressTransition = $state(false);
	let originalIndex = -1;
	let dragStartX = 0;
	let tabWidths: number[] = [];
	let tabLefts: number[] = [];
	let tabEls: HTMLElement[] = $state([]);

	// Pinned tabs occupy the front of the strip; a divider separates them from the
	// open tabs. Dragging reorders within a zone only — pinning is deliberate (the
	// tab context menu), never an accident of dragging.
	let pinnedCount = $derived(editor.tabs.filter((t) => t.pinned).length);

	function onPointerDown(e: PointerEvent, index: number) {
		if ((e.target as HTMLElement).closest('.close-btn')) return;
		if (e.button !== 0) return;
		const el = tabEls[index];
		if (!el) return;

		e.preventDefault();
		el.setPointerCapture(e.pointerId);

		dragDocId = editor.tabs[index].id;
		dragStartX = e.clientX;
		dragDeltaX = 0;
		originalIndex = index;
		dropIndex = index;

		tabWidths = tabEls.map((t) => t?.getBoundingClientRect().width ?? 0);
		tabLefts = tabEls.map((t) => t?.getBoundingClientRect().left ?? 0);
	}

	function onPointerMove(e: PointerEvent) {
		if (dragDocId === null) return;

		// A tab reorders only within its own pinned/unpinned zone
		const draggedPinned = editor.tabs[originalIndex].pinned;
		const zoneStart = draggedPinned ? 0 : pinnedCount;
		const zoneEnd = draggedPinned ? pinnedCount - 1 : tabWidths.length - 1;

		const minDelta = tabLefts[zoneStart] - tabLefts[originalIndex];
		const maxDelta =
			tabLefts[zoneEnd] + tabWidths[zoneEnd] - (tabLefts[originalIndex] + tabWidths[originalIndex]);
		dragDeltaX = Math.max(minDelta, Math.min(maxDelta, e.clientX - dragStartX));

		const draggedLeft = tabLefts[originalIndex] + dragDeltaX;
		const draggedRight = draggedLeft + tabWidths[originalIndex];

		let newIndex = originalIndex;
		for (let i = originalIndex + 1; i <= zoneEnd; i++) {
			if (draggedRight > tabLefts[i] + tabWidths[i] / 2) newIndex = i;
			else break;
		}
		for (let i = originalIndex - 1; i >= zoneStart; i--) {
			if (draggedLeft < tabLefts[i] + tabWidths[i] / 2) newIndex = i;
			else break;
		}
		dropIndex = newIndex;
	}

	function tabTransform(index: number): string {
		if (dragDocId === null) return '';
		if (index === originalIndex) return `translateX(${dragDeltaX}px)`;

		const gap = 6;
		const shift = tabWidths[originalIndex] + gap;

		if (dropIndex > originalIndex && index > originalIndex && index <= dropIndex) {
			return `translateX(-${shift}px)`;
		}
		if (dropIndex < originalIndex && index < originalIndex && index >= dropIndex) {
			return `translateX(${shift}px)`;
		}
		return '';
	}

	function endDrag() {
		dragDocId = null;
		dragDeltaX = 0;
		dropIndex = -1;
	}

	function onPointerUp() {
		if (dragDocId !== null && dropIndex !== originalIndex) {
			suppressTransition = true;
			editor.moveTab(originalIndex, dropIndex);
			requestAnimationFrame(() => {
				suppressTransition = false;
			});
		}
		endDrag();
	}

	// ── Per-tab context menu ─────────────────────────────────────────────────────
	function tabMenu(tab: TabState): CtxEntry[] {
		const pinned = tab.pinned;
		return [
			{
				label: pinned ? 'Unpin' : 'Pin',
				icon: pinned ? PinOff : Pin,
				action: () => editor.togglePin(tab.id)
			},
			{ divider: true },
			{ label: 'Close', icon: X, action: () => editor.closeTab(tab.id) },
			{
				label: 'Close all',
				icon: CircleX,
				action: () => editor.closeUnpinned(),
				disabled: editor.tabs.every((t) => t.pinned)
			}
		];
	}

	// ── Window controls ─────────────────────────────────────────────────────────
	// todo:
	//  - move this into another component
	//  - macOS version, adjustable in settings on linux
	const appWindow = getCurrentWindow();
	let isMaximized = $state(false);

	// Check initial maximized state
	appWindow.isMaximized().then((v) => (isMaximized = v));

	// Track state changes from every path (drag-restore, snap, Win+arrows)
	let maxCheckTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		let unlisten: (() => void) | undefined;
		appWindow
			.onResized(() => {
				if (maxCheckTimer) clearTimeout(maxCheckTimer);
				maxCheckTimer = setTimeout(async () => {
					isMaximized = await appWindow.isMaximized();
				}, 80);
			})
			.then((u) => (unlisten = u));
		return () => {
			if (maxCheckTimer) clearTimeout(maxCheckTimer);
			unlisten?.();
		};
	});

	async function minimize() {
		await appWindow.minimize();
	}

	async function toggleMaximize() {
		await appWindow.toggleMaximize();
		isMaximized = await appWindow.isMaximized();
	}

	async function close() {
		await appWindow.close();
	}

	function handleDrag(e: MouseEvent) {
		// Don't drag if clicking on interactive elements
		const target = e.target as HTMLElement;
		if (target.closest('button, .tab, .dropdown-btn')) return;
		appWindow.startDragging();
	}
</script>

<nav class="nav-bar" onmousedown={handleDrag}>
	<!-- Drag handle -->
	<div class="drag-handle">
		<GripVertical size={16} />
	</div>

	<!-- Pinned icon tabs -->
	<div
		class="tab icon-tab"
		class:active={editor.isTabFocused(settingsTab)}
		onclick={() => editor.focusTab(settingsTab)}
		role="button"
		tabindex="0"
	>
		<Settings size={16} />
	</div>
	<div
		class="tab icon-tab"
		class:active={editor.isTabFocused(searchTab)}
		onclick={() => editor.focusTab(searchTab)}
		role="button"
		tabindex="0"
	>
		<Library size={16} />
	</div>

	<!-- Bookmarks dropdown -->
	<!--    <button class="dropdown-btn" title="Bookmarks">-->
	<!--        <Bookmark size={16}/>-->
	<!--        <ChevronDown size={12}/>-->
	<!--    </button>-->

	<!-- Divider -->
	<div class="divider"></div>

	<!-- Tabs -->
	<div class="tabs-scroll">
		{#each editor.tabs as d, i (d.id)}
			{@const target: FocusTarget = {kind: 'tab', id: d.id}}
			{#if i === pinnedCount && pinnedCount > 0}
				<div class="pin-divider"></div>
			{/if}
			{@const collapsed = d.pinned && collapsePinned}
			<div
				class="tab"
				class:active={editor.isTabFocused(target)}
				class:pinned={d.pinned}
				class:collapsed
				class:dragging={dragDocId === d.id}
				class:no-transition={suppressTransition}
				style:transform={tabTransform(i)}
				title={collapsed ? d.title : null}
				use:ctxMenu={() => tabMenu(d)}
				onclick={() => editor.focusTab(target)}
				onpointerdown={(e) => onPointerDown(e, i)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
				onlostpointercapture={onPointerUp}
				bind:this={tabEls[i]}
				role="button"
				tabindex="0"
			>
				{#if d.content.type === 'view'}
					{#if d.content.view.emoji}
						<span class="tab-emoji">{d.content.view.emoji}</span>
					{:else}
						{@const TabIcon = viewTabIcon(d.content.view)}
						<TabIcon size={13} />
					{/if}
				{:else if d.content.type === 'new'}
					<TextSearch size={13} />
				{:else if !compactTabs || collapsed}
					<TextAlignStart class="doc-icon" size={13} />
				{/if}
				<span class="tab-label">{d.content.type === 'new' ? 'New' : d.title}</span>
				<span class="tab-fade"></span>
				<span class="close-zone">
					<button
						class="close-btn"
						title="Close tab"
						onclick={(e) => {
							e.stopPropagation();
							editor.closeTab(d.id);
						}}
					>
						<X size={12} />
					</button>
				</span>
			</div>
		{/each}
		<button class="new-tab-btn" title="New tab" onclick={() => editor.openNewTab()}>
			<Plus size={15} />
		</button>
	</div>

	<!-- Window controls -->
	<div class="window-controls">
		<button class="caption-btn" title="Minimize" onclick={minimize}>
			<span class="caption-icon">&#xE921;</span>
		</button>
		<button
			class="caption-btn"
			title={isMaximized ? 'Restore' : 'Maximize'}
			onclick={toggleMaximize}
		>
			<span class="caption-icon">{isMaximized ? '\uE923' : '\uE922'}</span>
		</button>
		<button class="caption-btn close" title="Close" onclick={close}>
			<span class="caption-icon">&#xE8BB;</span>
		</button>
	</div>
</nav>

<style>
	.nav-bar {
		display: flex;
		align-items: flex-end;
		height: 42px;
		width: 100%;
		background: transparent;
		padding-left: 8px;
		gap: 6px;
		overflow: hidden;
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

	.tabs-scroll .tab {
		flex-shrink: 1;
		min-width: 32px;
		max-width: 240px;
		padding: 0 13px 0 12px;
	}

	.tab.icon-tab {
		padding: 0 10px;
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

	.tab.icon-tab:not(.active):hover::after {
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
		transform: translateY(-1px);
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
		padding-right: 6px;
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

	/* ── Window controls ── */
	.window-controls {
		display: flex;
		flex-shrink: 0;
		height: 100%;
		margin-left: auto;
	}

	.caption-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 46px;
		height: 100%;
		border: none;
		background: transparent;
		color: var(--color-ui-dulled);
		cursor: pointer;
	}

	.caption-btn:hover {
		background: rgba(0, 0, 0, 0.06);
	}

	.caption-btn:active {
		background: rgba(0, 0, 0, 0.1);
	}

	.caption-btn.close:hover {
		background: #c42b1c;
		color: white;
	}

	.caption-btn.close:active {
		background: #b32a1b;
		color: white;
	}

	.caption-icon {
		font-family: 'Segoe MDL2 Assets', 'Segoe Fluent Icons', sans-serif;
		font-size: 10px;
		line-height: 1;
	}
</style>
