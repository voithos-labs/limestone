<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		EditorView,
		keymap,
		placeholder as cmPlaceholder,
		ViewPlugin,
		Decoration,
		type DecorationSet,
		type ViewUpdate
	} from '@codemirror/view';
	import { EditorState, RangeSetBuilder } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
	import { tags } from '@lezer/highlight';
	import type { TabState } from '$lib/state/EditorState.svelte';
	import type EditorStateModel from '$lib/state/EditorState.svelte';
	import { getSetting } from '$lib/models/Settings';
	import { registerFlush } from '$lib/flush';
	import { confirm } from '@tauri-apps/plugin-dialog';
	import DocumentHero from '../DocumentHero.svelte';

	let {
		tab,
		editor,
		onchange,
		flow = false
	}: {
		tab: TabState;
		editor?: EditorStateModel;
		onchange?: (value: string) => void;
		flow?: boolean;
	} = $props();

	async function deleteDoc() {
		if (!handle) return;
		const ok = await confirm(`Delete "${handle.title}"? This removes the file from disk.`, {
			title: 'Delete document',
			kind: 'warning'
		});
		if (!ok) return;
		try {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			await handle.delete();
			editor?.closeTab(tab.id);
		} catch (e) {
			console.error('delete failed', e);
		}
	}

	let handle = $derived(tab.handle);
	let zoom = $state(tab.state.zoom ?? 16);
	let scrolling = $state(false);
	let scrollHideTimer: ReturnType<typeof setTimeout> | null = null;

	// Custom scrollbar thumb metrics
	let thumbTop = $state(0);
	let thumbHeight = $state(0);
	let showThumb = $state(false);
	const THUMB_MAX_FRACTION = 1 / 5;
	const THUMB_MIN_PX = 24;
	const THUMB_INSET_PX = 8;

	function startThumbDrag(e: PointerEvent) {
		if (!view) return;
		e.preventDefault();
		const startY = e.clientY;
		const startScroll = view.scrollDOM.scrollTop;
		const viewH = view.scrollDOM.clientHeight;
		const maxScroll = view.scrollDOM.scrollHeight - viewH;
		const trackRange = viewH - 2 * THUMB_INSET_PX - thumbHeight;
		if (trackRange <= 0 || maxScroll <= 0) return;
		const ratio = maxScroll / trackRange;

		function onMove(ev: PointerEvent) {
			view.scrollDOM.scrollTop = startScroll + (ev.clientY - startY) * ratio;
		}
		function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		}
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	function updateThumb() {
		if (!view) return;
		const scroll = view.scrollDOM;
		const viewH = scroll.clientHeight;
		const contentH = scroll.scrollHeight;
		const maxScroll = contentH - viewH;
		const trackH = viewH - 2 * THUMB_INSET_PX;
		if (maxScroll <= 0 || trackH <= 0) {
			showThumb = false;
			return;
		}
		const natural = (viewH / contentH) * trackH;
		const capped = Math.min(natural, trackH * THUMB_MAX_FRACTION);
		thumbHeight = Math.max(capped, THUMB_MIN_PX);
		thumbTop = THUMB_INSET_PX + (scroll.scrollTop / maxScroll) * (trackH - thumbHeight);
		showThumb = true;
	}
	if (tab.state.zoom === undefined) {
		getSetting<number>('appearance.editor_font_size').then((v) => {
			if (tab.state.zoom === undefined && typeof v === 'number') zoom = v;
		});
	}

	let container: HTMLDivElement;
	let view: EditorView;
	let internalUpdate = false;
	let initApplied = false;

	let content: string = $state('');
	let loaded = $state(false);

	$effect(() => {
		loaded = false;
		handle?.loadContent().then((c) => {
			content = c;
			loaded = true;
		});
	});

	const theme = EditorView.theme({
		'&': {
			height: flow ? 'auto' : '100%',
			fontSize: 'var(--editor-font-size, 16px)',
			backgroundColor: 'transparent'
		},
		'.cm-content': {
			fontFamily: 'var(--font-editor)',
			lineHeight: '1.6',
			padding: flow ? '16px 0 48px' : '48px 24px',
			maxWidth: 'var(--page-max-width, 1200px)',
			margin: '0 auto',
			caretColor: 'var(--color-text-primary)'
		},
		'.cm-cursor': {
			borderLeftColor: 'var(--color-text-primary)'
		},
		'.cm-scroller': {
			overflow: flow ? 'visible' : 'auto',
			scrollbarWidth: 'none'
		},
		'.cm-scroller::-webkit-scrollbar': {
			display: 'none'
		},
		'.cm-gutters': {
			display: 'none'
		},
		'.cm-activeLine': {
			backgroundColor: 'transparent'
		},
		'.cm-selectionBackground': {
			backgroundColor: 'rgba(255, 255, 255, 0.1) !important'
		},
		'.cm-focused .cm-selectionBackground': {
			backgroundColor: 'rgba(255, 255, 255, 0.15) !important'
		},
		'.cm-line': {
			color: 'var(--color-text-primary)'
		},
		'.cm-task-marker': {
			color: 'var(--syntax-task) !important'
		},
		'.cm-task-done': {
			color: 'var(--syntax-task-done) !important'
		}
	});

	const microMonokai = HighlightStyle.define([
		{ tag: tags.heading1, color: 'var(--syntax-heading)', fontWeight: '700', fontSize: '1.6em' },
		{ tag: tags.heading2, color: 'var(--syntax-heading)', fontWeight: '600', fontSize: '1.4em' },
		{ tag: tags.heading3, color: 'var(--syntax-heading)', fontWeight: '600', fontSize: '1.2em' },
		{
			tag: [tags.heading4, tags.heading5, tags.heading6],
			color: 'var(--syntax-heading)',
			fontWeight: '600'
		},
		{ tag: tags.emphasis, color: 'var(--syntax-emphasis)', fontStyle: 'italic' },
		{ tag: tags.strong, color: 'var(--syntax-emphasis)', fontWeight: '700' },
		{ tag: tags.strikethrough, color: 'var(--syntax-emphasis)', textDecoration: 'line-through' },
		{ tag: tags.link, color: 'var(--syntax-link)' },
		{ tag: tags.url, color: 'var(--syntax-url)' },
		{ tag: tags.quote, color: 'var(--syntax-quote)' },
		{ tag: tags.monospace, color: 'var(--syntax-code)' },
		{ tag: tags.comment, color: 'var(--syntax-comment)' },
		{ tag: tags.contentSeparator, color: 'var(--syntax-separator)' }
	]);

	// Mark checked task markers (`- [x]`) with a dimmer class so completed
	// tasks render in a muted shade vs. the brighter `- [ ]` markers.
	const taskDonePlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.build(update.view);
				}
			}

			build(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const openMark = Decoration.mark({ class: 'cm-task-marker' });
				const doneMark = Decoration.mark({ class: 'cm-task-done' });
				for (const { from, to } of view.visibleRanges) {
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node) => {
							if (node.name !== 'TaskMarker') return;
							const text = view.state.doc.sliceString(node.from, node.to);
							const checked = text === '[x]' || text === '[X]';
							builder.add(node.from, node.to, checked ? doneMark : openMark);
						}
					});
				}
				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations
		}
	);

	function setZoom(next: number) {
		zoom = Math.max(10, Math.min(40, next));
		tab.state.zoom = zoom;
	}

	// Saving
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const SAVE_DEBOUNCE_MS = 250;

	function flushSave() {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		return handle?.saveContent(content).catch((e) => console.error('saveContent failed', e));
	}

	const unregisterFlush = registerFlush(() => {
		if (saveTimer) return flushSave();
	});

	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
	}

	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				internalUpdate = true;
				content = update.state.doc.toString();
				onchange?.(content);
				internalUpdate = false;
				if (initApplied) scheduleSave();
				updateThumb();
			}
			if (update.selectionSet && initApplied) {
				tab.state.cursorPos = update.state.selection.main.head;
			}
		});

		const zoomKeymap = [
			{
				key: 'Mod-=',
				run: () => {
					setZoom(zoom + 1);
					return true;
				}
			},
			{
				key: 'Mod-Shift-=',
				run: () => {
					setZoom(zoom + 1);
					return true;
				}
			},
			{
				key: 'Mod--',
				run: () => {
					setZoom(zoom - 1);
					return true;
				}
			}
		];

		view = new EditorView({
			state: EditorState.create({
				doc: content,
				extensions: [
					keymap.of([...zoomKeymap, ...defaultKeymap, ...historyKeymap]),
					history(),
					markdown({ codeLanguages: languages }),
					syntaxHighlighting(microMonokai),
					taskDonePlugin,
					theme,
					cmPlaceholder('Start writing...'),
					updateListener,
					EditorView.lineWrapping
				]
			}),
			parent: container
		});

		view.scrollDOM.addEventListener('scroll', handleScroll);

		resizeObserver = new ResizeObserver(() => updateThumb());
		resizeObserver.observe(view.scrollDOM);
		updateThumb();
	});

	function handleScroll() {
		scrolling = true;
		if (scrollHideTimer) clearTimeout(scrollHideTimer);
		scrollHideTimer = setTimeout(() => {
			scrolling = false;
		}, 500);
		updateThumb();

		if (!initApplied) return;
		tab.state.scrollTop = view.scrollDOM.scrollTop;
	}

	$effect(() => {
		if (!view || internalUpdate) return;
		const current = view.state.doc.toString();
		if (content !== current) {
			view.dispatch({
				changes: { from: 0, to: current.length, insert: content }
			});
		}
		if (loaded && !initApplied) {
			requestAnimationFrame(() => {
				if (!view) return;
				const initialCursorPos = tab.state.cursorPos;
				const initialScrollTop = tab.state.scrollTop;
				if (initialCursorPos !== undefined) {
					const pos = Math.min(initialCursorPos, view.state.doc.length);
					view.dispatch({ selection: { anchor: pos } });
				}
				if (initialScrollTop !== undefined) {
					view.scrollDOM.scrollTop = initialScrollTop;
				}
				if (!flow) view.focus();
				initApplied = true;
			});
		}
	});

	onDestroy(() => {
		unregisterFlush();
		if (saveTimer) flushSave();
		if (scrollHideTimer) clearTimeout(scrollHideTimer);
		resizeObserver?.disconnect();
		view?.scrollDOM.removeEventListener('scroll', handleScroll);
		view?.destroy();
	});
</script>

<div class="doc-view" class:flow>
	{#if handle}
		<DocumentHero {handle} onDelete={deleteDoc} compact={flow} />
	{/if}
	<div
		class="cm-wrapper"
		class:scrolling
		class:flow
		bind:this={container}
		style="--editor-font-size: {zoom}px"
	>
		{#if showThumb}
			<div
				class="scroll-thumb"
				style="height: {thumbHeight}px; transform: translateY({thumbTop}px);"
				onpointerdown={startThumbDrag}
			></div>
		{/if}
	</div>
</div>

<style>
	.doc-view {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		max-width: var(--page-max-width, none);
		margin-left: auto;
		margin-right: auto;
	}

	.cm-wrapper {
		position: relative;
		width: 100%;
		flex: 1;
		min-height: 0;
	}

	.doc-view.flow {
		height: auto;
	}

	.cm-wrapper.flow {
		flex: none;
		min-height: 0;
	}

	.cm-wrapper.flow :global(.cm-editor) {
		height: auto;
	}

	.cm-wrapper.flow::before,
	.cm-wrapper.flow::after {
		display: none;
	}

	.cm-wrapper::before,
	.cm-wrapper::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 24px;
		pointer-events: none;
		z-index: 1;
	}

	.cm-wrapper::before {
		top: 0;
		background: linear-gradient(to bottom, var(--color-surface), transparent);
		border-radius: 8px 8px 0 0;
	}

	.cm-wrapper::after {
		bottom: 0;
		background: linear-gradient(to top, var(--color-surface), transparent);
		border-radius: 0 0 8px 8px;
	}

	.cm-wrapper :global(.cm-editor) {
		height: 100%;
		outline: none;
	}

	.cm-wrapper :global(.cm-focused) {
		outline: none;
	}

	.scroll-thumb {
		position: absolute;
		right: 0;
		top: 0;
		width: 14px;
		background: transparent;
		cursor: pointer;
		z-index: 2;
	}

	.scroll-thumb::before {
		content: '';
		position: absolute;
		right: 4px;
		top: 0;
		bottom: 0;
		width: 1px;
		border-radius: 4px;
		background: var(--color-border);
		transition:
			background-color 350ms ease,
			width 350ms ease;
	}

	.cm-wrapper.scrolling .scroll-thumb::before,
	.scroll-thumb:hover::before {
		width: 4px;
		background: var(--color-ui-muted);
	}
</style>
