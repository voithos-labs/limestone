<script lang="ts">
	import { onMount } from 'svelte';
	import { listen } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import TopBar from '../components/nav/TopBar.svelte';
	import { flushAll } from '$lib/util/flush';
	import Session from '$lib/models/Session.svelte.js';
	import LibraryPage from '../components/pages/LibraryPage.svelte';
	import SettingsPage from '../components/pages/SettingsPage.svelte';
	import ViewPage from '../components/pages/ViewPage.svelte';
	import NewTabPage from '../components/pages/NewTabPage.svelte';
	import LicensesPage from '../components/pages/LicensesPage.svelte';
	import DocumentEditor from '../components/editor/DocumentEditor.svelte';
	import ContextMenu from '../components/ContextMenu.svelte';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import { actionForKey, keyCapture, specFromEvent } from '$lib/actions';
	import { inEditorContent, isEditorReservedChord } from '$lib/editor-chords';
	import { runStartupUpdateCheck, notePostUpdate } from '$lib/services/updater.svelte';
	import { toasts } from '$lib/toasts.svelte';

	let session = $state<Session>();
	let tab: TabState | undefined = $state();

	Session.init().then((s) => (session = s));

	let updateChecked = false;
	$effect(() => {
		if (!session || updateChecked) return;
		updateChecked = true;
		void notePostUpdate();
		const auto = session.settings.get<boolean>('updates.auto_install') ?? false;
		const s = session;
		void runStartupUpdateCheck(auto, () => {
			const vt = s.getViewTab('settings');
			if (!vt.state) vt.state = {};
			vt.state.activeSection = 'general';
			s.editors[0]?.focusTab({ kind: 'settings' });
		});
	});

	$effect(() => {
		tab = session?.editors[0]?.focusedTab;
	});

	$effect(() => {
		const percent = session?.settings.get<number>('appearance.ui_scale_percent');
		if (percent && percent > 0) getCurrentWebview().setZoom(percent / 100);
	});

	$effect(() => {
		const maxWidth = session?.settings.get<number>('appearance.max_page_width');
		if (maxWidth && maxWidth > 0) {
			document.documentElement.style.setProperty('--page-max-width', maxWidth + 'px');
		}
	});

	$effect(() => {
		const compact = session?.settings.get<boolean>('appearance.compact_doc_header') ?? true;
		document.documentElement.dataset.docHeader = compact ? 'compact' : 'full';
	});

	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (!session) return;
		$state.snapshot(session.toJSON());
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => session!.persist(), 200);
	});

	// todo: start collecting launch actionables here
	function reportScanSkips(count: number) {
		if (count === 0) return;
		toasts.push(
			`${count} ${count === 1 ? 'note' : 'notes'} couldn't be indexed: unsupported title encoding`,
			{ timeout: 5000 }
		);
	}

	onMount(() => {
		const win = getCurrentWindow();
		const unlisten = win.onCloseRequested(async (e) => {
			e.preventDefault();
			if (persistTimer) clearTimeout(persistTimer);
			try {
				await Promise.all([flushAll(), session?.persist()]);
			} catch (err) {
				console.error('flush on close failed', err);
			}
			await win.destroy();
		});
		const unlistenScan = listen<{ source_id: string; skipped: number }>('source-reconciled', (e) =>
			reportScanSkips(e.payload.skipped)
		);
		return () => {
			unlisten.then((f) => f());
			unlistenScan.then((f) => f());
		};
	});

	function onKeydown(e: KeyboardEvent) {
		if (!session || e.repeat || e.defaultPrevented || keyCapture.active) return;
		// Ahead of the lookup: this handler captures, so a chord it takes never reaches the
		// document, even one the reader has bound an app action to.
		if (inEditorContent(e) && isEditorReservedChord(specFromEvent(e))) return;
		const action = actionForKey(e, session.settings);
		if (!action) return;
		e.preventDefault();
		e.stopPropagation();
		void action.run(session);
	}

	const SCROLL_STEP = 48;
	// `.editor` is aragonite's own class, not a contract, but it earns its place: focus parks on
	// the editor root, which is neither a field nor contenteditable, and the scroll fallback would
	// page the document under a reader only moving the caret. `$lib/editor-chords` couples to it too.
	const EDITABLE =
		'input, textarea, select, [contenteditable=""], [contenteditable="true"], .editor';

	function inEditable(e: KeyboardEvent): boolean {
		const t = e.target as HTMLElement | null;
		const a = document.activeElement as HTMLElement | null;
		return !!(t?.closest(EDITABLE) || a?.closest(EDITABLE));
	}

	function activeScroller(): HTMLElement | null {
		const area = document.querySelector('.content-area');
		if (!area) return null;
		const r = area.getBoundingClientRect();
		let el = document.elementFromPoint(
			r.left + r.width / 2,
			r.top + r.height / 2
		) as HTMLElement | null;
		while (el && el !== document.body) {
			if (area.contains(el)) {
				const oy = getComputedStyle(el).overflowY;
				if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight > 1) return el;
			}
			el = el.parentElement;
		}
		return null;
	}

	function onArrowScroll(e: KeyboardEvent) {
		if (e.defaultPrevented || keyCapture.active) return;
		if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		if (inEditable(e)) return;
		if (document.querySelector('[role="menu"], [role="listbox"], [role="dialog"], .overlay'))
			return;
		const scroller = activeScroller();
		if (!scroller) return;
		e.preventDefault();
		scroller.scrollBy({ top: e.key === 'ArrowDown' ? SCROLL_STEP : -SCROLL_STEP });
	}

	// When nothing valid is focused (no tabs, or a stale focus), fall back to the library tab.
	$effect(() => {
		const ed = session?.editors[0];
		if (!ed) return;
		const f = ed.focused;
		const valid =
			f?.kind === 'search' ||
			f?.kind === 'settings' ||
			(f?.kind === 'tab' && ed.tabs.some((t) => t.id === f.id));
		if (!valid) ed.focusTab({ kind: 'search' });
	});
</script>

<svelte:window onkeydowncapture={onKeydown} onkeydown={onArrowScroll} />

{#if session}
	{@const editor = session.editors[0]}
	<div class="app-layout">
		<TopBar {editor} settings={session.settings}></TopBar>
		<main class="content-area">
			{#if tab}
				{#key tab.id}
					{#if tab.content.type === 'view'}
						<ViewPage view={tab.content.view} {tab} {editor} />
					{:else if tab.content.type === 'markdown'}
						<DocumentEditor {tab} {editor} />
					{:else if tab.content.type === 'new'}
						<NewTabPage {tab} {editor} />
					{:else if tab.content.type === 'licenses'}
						<LicensesPage {tab} />
					{/if}
				{/key}
			{:else if editor.focused?.kind === 'search'}
				<LibraryPage {editor} />
			{:else if editor.focused?.kind === 'settings'}
				<SettingsPage viewTab={session.getViewTab('settings')} {session} />
			{:else}
				<div class="panel-placeholder">No document selected</div>
			{/if}
		</main>
	</div>
	<ContextMenu />
{/if}

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: transparent;
	}

	.content-area {
		position: relative;
		flex: 1;
		margin: 0 12px 12px 12px;
		background: var(--color-surface);
		border-radius: 8px;
		overflow: hidden;
	}

	.panel-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-ui-muted);
		font-size: 14px;
		text-transform: capitalize;
	}
</style>
