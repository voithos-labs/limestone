<script lang="ts">
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import TopBar from '../components/nav/TopBar.svelte';
	import { flushAll } from '$lib/util/flush';
	import Session from '$lib/models/Session.svelte.js';
	import Pane from '../components/Pane.svelte';
	import Palette from '../components/Palette.svelte';
	import MetadataDialog from '../components/MetadataDialog.svelte';
	import ContextMenu from '../components/ContextMenu.svelte';
	import { actionForKey, keyCapture } from '$lib/actions';
	import { editorTakesKey } from '$lib/editor-chords';
	import { runStartupUpdateCheck, notePostUpdate } from '$lib/services/updater.svelte';
	import { toasts } from '$lib/toasts.svelte';
	import { startWatching } from '$lib/models/Source';

	let session = $state<Session>();
	let addSourceSignal = $state(0);

	Session.init().then((s) => (session = s));

	function addSource() {
		addSourceSignal++;
		session?.editors[0].focusTab({ kind: 'settings' });
	}

	// watching for external changes
	let unlistenWatch: Promise<UnlistenFn> | undefined;
	$effect(() => {
		if (!session || unlistenWatch) return;
		unlistenWatch = startWatching(session.missingSources).catch((err) => {
			console.error('file watching failed to start', err);
			return () => {};
		});
	});

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
		const percent = session?.settings.get<number>('appearance.ui_scale_percent');
		if (percent && percent > 0) getCurrentWebview().setZoom(percent / 100);
	});

	$effect(() => {
		const maxWidth = session?.settings.get<number>('appearance.max_page_width');
		if (maxWidth && maxWidth > 0) {
			document.documentElement.style.setProperty('--page-max-width', maxWidth + 'px');
		}
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
		// startup scan
		const unlistenScan = listen<{ source_id: string; skipped: number }>('source-reconciled', (e) =>
			reportScanSkips(e.payload.skipped)
		);
		return () => {
			unlisten.then((f) => f());
			unlistenScan.then((f) => f());
			unlistenWatch?.then((f) => f());
		};
	});

	function onKeydown(e: KeyboardEvent) {
		if (!session || e.repeat || e.defaultPrevented || keyCapture.active) return;
		// Before the lookup: this handler captures, so anything it takes never reaches the
		// document, even a shortcut the reader has bound to an app action.
		if (editorTakesKey(e)) return;
		const action = actionForKey(e, session.settings);
		if (!action) return;
		e.preventDefault();
		e.stopPropagation();
		void action.run(session);
	}

	const SCROLL_STEP = 48;
	// `.editor` is aragonite's own class, not a promised API, but it earns its place: focus can
	// rest on the editor root, which is neither a form field nor contenteditable, and without it
	// arrow keys would scroll the page while the reader is only moving the caret. `$lib/editor-chords`
	// depends on it too.
	const EDITABLE =
		'input, textarea, select, [contenteditable=""], [contenteditable="true"], .editor';

	function inEditable(e: KeyboardEvent): boolean {
		const t = e.target as HTMLElement | null;
		const a = document.activeElement as HTMLElement | null;
		return !!(t?.closest(EDITABLE) || a?.closest(EDITABLE));
	}

	function activeScroller(): HTMLElement | null {
		const area = document.querySelector('.content-area.active');
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

	// An empty strip is never a blank window: Home takes the place, on first launch and when
	// the last tab closes.
	$effect(() => {
		if (!session) return;
		for (const ed of session.editors) {
			if (ed.tabs.length === 0) {
				if (session.editors.length > 1) session.closeEditor(ed);
				else ed.openHome();
				return;
			}
			const f = ed.focused;
			const valid =
				f?.kind === 'settings' ||
				(f?.kind === 'preview' && !!ed.preview) ||
				(f?.kind === 'tab' && ed.tabs.some((t) => t.id === f.id));
			if (!valid) ed.openHome();
		}
	});

	function onSeamMove(e: PointerEvent) {
		const seam = e.currentTarget as HTMLElement;
		if (!session || !seam.hasPointerCapture(e.pointerId)) return;
		const r = seam.parentElement!.getBoundingClientRect();
		const ratio = Math.min(0.75, Math.max(0.25, (e.clientX - r.left) / r.width));
		session.editors[0].flex = ratio;
		session.editors[1].flex = 1 - ratio;
	}

	function resetSeam() {
		for (const ed of session?.editors ?? []) ed.flex = 1;
	}
</script>

<svelte:window onkeydowncapture={onKeydown} onkeydown={onArrowScroll} />

{#if session}
	{@const [first, second] = session.editors}
	<div
		class="app-layout"
		style:--pane-cols={second
			? session.editors.map((e) => `minmax(0, ${e.flex}fr)`).join(' ')
			: '1fr'}
	>
		<TopBar {session} onAddSource={addSource}></TopBar>
		<div class="panes">
			{#each session.editors as editor (editor)}
				<Pane {editor} {session} {addSourceSignal} onAddSource={addSource} />
			{/each}
			{#if second}
				<div
					class="seam"
					style:left="{(first.flex / (first.flex + second.flex)) * 100}%"
					onpointerdown={(e) => {
						e.preventDefault();
						e.currentTarget.setPointerCapture(e.pointerId);
					}}
					onpointermove={onSeamMove}
					ondblclick={resetSeam}
					role="separator"
					aria-orientation="vertical"
				></div>
			{/if}
		</div>
	</div>
	<ContextMenu />
	<Palette {session} onAddSource={addSource} />
	<MetadataDialog />
{/if}

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: transparent;
	}

	.panes {
		position: relative;
		display: grid;
		grid-template-columns: var(--pane-cols);
		grid-template-rows: minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}

	.seam {
		position: absolute;
		top: 0;
		bottom: 12px;
		width: 8px;
		transform: translateX(-50%);
		cursor: col-resize;
	}
</style>
