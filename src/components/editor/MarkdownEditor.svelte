<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import {
		EditorView,
		keymap,
		placeholder as cmPlaceholder,
		ViewPlugin,
		Decoration,
		WidgetType,
		type DecorationSet,
		type ViewUpdate
	} from '@codemirror/view';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { importSourceAssetBytes } from '$lib/services/assets';
	import { EditorState, RangeSetBuilder } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { languages } from '@codemirror/language-data';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { syntaxHighlighting, HighlightStyle, syntaxTree } from '@codemirror/language';
	import { tags } from '@lezer/highlight';
	import type { TabState } from '$lib/models/EditorState.svelte.js';
	import type EditorStateModel from '$lib/models/EditorState.svelte.js';
	import { getSetting } from '$lib/models/Settings.svelte';
	import { registerFlush } from '$lib/util/flush';
	import DocumentHero from '../DocumentHero.svelte';
	import ScrollThumb from '../ScrollThumb.svelte';

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
		try {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			await handle.delete();
			editor?.closeTab(tab.id, false);
		} catch (e) {
			console.error('delete failed', e);
		}
	}

	let handle = $derived(tab.handle);

	// Persisted on the tab, so a doc reopens with its properties panel as you left it
	let propsOpen = $state(untrack(() => tab.state.props_open ?? false));
	$effect(() => {
		tab.state.props_open = propsOpen;
	});
	let zoom = $state(untrack(() => tab.state.zoom ?? 16));

	// The thumb track starts level with the document title (the hero's top padding)
	// rather than at the very top of the scroller.
	const THUMB_TOP_PX = 34;

	if (untrack(() => tab.state.zoom) === undefined) {
		getSetting<number>('appearance.editor_font_size').then((v) => {
			if (tab.state.zoom === undefined && typeof v === 'number') zoom = v;
		});
	}

	let container: HTMLDivElement;
	let scrollEl: HTMLDivElement | null = $state(null);
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

	const initFlow = untrack(() => flow);

	const theme = EditorView.theme({
		'&': {
			height: 'auto',
			fontSize: 'var(--editor-font-size, 16px)',
			backgroundColor: 'transparent'
		},
		'.cm-content': {
			fontFamily: 'var(--font-editor)',
			lineHeight: '1.6',
			padding: initFlow ? '4px 0 48px' : '20px 24px 48px',
			maxWidth: 'var(--page-max-width, 1200px)',
			margin: '0 auto',
			caretColor: 'var(--color-text-primary)'
		},
		'.cm-cursor': {
			borderLeftColor: 'var(--color-text-primary)'
		},
		'.cm-scroller': {
			overflow: 'visible',
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
			color: 'var(--color-text-primary)',
			// CM defaults to 6px here, which pushes the text off the header's left edge
			padding: '0 2px 0 0'
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

	const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
	const IMAGE_EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

	function resolveImageSrc(target: string): string | null {
		if (!handle) return null;
		if (/^(https?|data|asset):/i.test(target)) return target;
		const clean = target.replace(/\\/g, '/').replace(/^\.?\//, '');
		const ext = clean.split('.').pop()?.toLowerCase() ?? '';
		if (!IMAGE_EXTS.has(ext)) return null;
		const loc = handle.source.asset_location.replace(/^\/+|\/+$/g, '');
		const rel = clean.includes('/') || !loc ? clean : `${loc}/${clean}`;
		return convertFileSrc(`${handle.source.path}/${rel}`);
	}

	function embedTarget(m: RegExpExecArray): string {
		const target = m[1] ? m[1].split('|')[0] : m[3];
		return target.trim();
	}

	function embedRangeAt(
		v: EditorView,
		pos: number,
		side: 'start' | 'end'
	): { from: number; to: number } | null {
		const line = v.state.doc.lineAt(pos);
		IMAGE_EMBED_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = IMAGE_EMBED_RE.exec(line.text))) {
			const from = line.from + m.index;
			const to = from + m[0].length;
			if ((side === 'end' ? to : from) !== pos) continue;
			if (!resolveImageSrc(embedTarget(m))) continue;
			return { from, to };
		}
		return null;
	}

	class ImageWidget extends WidgetType {
		src: string;
		alt: string;
		width: number | null;
		focused: boolean;

		constructor(src: string, alt: string, width: number | null, focused: boolean) {
			super();
			this.src = src;
			this.alt = alt;
			this.width = width;
			this.focused = focused;
		}

		eq(other: ImageWidget) {
			return other.src === this.src && other.width === this.width && other.focused === this.focused;
		}

		toDOM() {
			const img = document.createElement('img');
			img.className = this.focused ? 'cm-embed-image focused' : 'cm-embed-image';
			img.src = this.src;
			img.alt = this.alt;
			if (this.width) img.width = this.width;
			return img;
		}

		ignoreEvent() {
			return false;
		}
	}

	const imageEmbedPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.build(update.view);
				}
			}

			build(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const sel = view.state.selection.main;
				for (const { from, to } of view.visibleRanges) {
					const text = view.state.doc.sliceString(from, to);
					IMAGE_EMBED_RE.lastIndex = 0;
					let m: RegExpExecArray | null;
					while ((m = IMAGE_EMBED_RE.exec(text))) {
						const start = from + m.index;
						const end = start + m[0].length;
						const focused = !sel.empty && sel.from === start && sel.to === end;
						const reveal = focused
							? false
							: sel.empty
								? sel.from > start && sel.from < end
								: sel.from < end && sel.to > start;
						if (reveal) continue;
						const target = embedTarget(m);
						const mod = m[1]?.split('|')[1];
						const width = mod && /^\d+$/.test(mod) ? Number(mod) : null;
						const src = resolveImageSrc(target);
						if (!src) continue;
						builder.add(
							start,
							end,
							Decoration.replace({ widget: new ImageWidget(src, m[2] || target, width, focused) })
						);
					}
				}
				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations
		}
	);

	const MIME_EXTS: Record<string, string> = {
		'image/png': 'png',
		'image/jpeg': 'jpg',
		'image/gif': 'gif',
		'image/webp': 'webp',
		'image/svg+xml': 'svg',
		'image/bmp': 'bmp',
		'image/avif': 'avif'
	};

	async function importPastedImage(file: File) {
		if (!handle) return;
		const relPath = await importSourceAssetBytes(
			handle.source.id,
			await file.arrayBuffer(),
			MIME_EXTS[file.type] ?? 'png'
		);
		const { from, to } = view.state.selection.main;
		const embed = `![[${relPath}]]`;
		view.dispatch({
			changes: { from, to, insert: embed },
			selection: { anchor: from + embed.length }
		});
		view.focus();
	}

	const imageEvents = EditorView.domEventHandlers({
		paste: (event) => {
			const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
				f.type.startsWith('image/')
			);
			if (!files.length || !handle) return false;
			event.preventDefault();
			for (const file of files) {
				importPastedImage(file).catch((e) => console.error('image paste failed', e));
			}
			return true;
		},
		mousedown: (event, v) => {
			const t = event.target;
			if (!(t instanceof HTMLImageElement) || !t.classList.contains('cm-embed-image')) {
				return false;
			}
			const r = embedRangeAt(v, v.posAtDOM(t), 'start');
			if (!r) return false;
			event.preventDefault();
			v.dispatch({ selection: { anchor: r.from, head: r.to } });
			v.focus();
			return true;
		}
	});

	function selectEmbed(v: EditorView, side: 'start' | 'end'): boolean {
		const sel = v.state.selection.main;
		if (!sel.empty) return false;
		const r = embedRangeAt(v, sel.from, side);
		if (!r) return false;
		v.dispatch({ selection: { anchor: r.from, head: r.to } });
		return true;
	}

	const embedKeymap = [
		{ key: 'Backspace', run: (v: EditorView) => selectEmbed(v, 'end') },
		{ key: 'Delete', run: (v: EditorView) => selectEmbed(v, 'start') }
	];

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

	onMount(() => {
		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				internalUpdate = true;
				content = update.state.doc.toString();
				onchange?.(content);
				internalUpdate = false;
				if (initApplied) scheduleSave();
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
					keymap.of([...zoomKeymap, ...embedKeymap, ...defaultKeymap, ...historyKeymap]),
					history(),
					markdown({ codeLanguages: languages }),
					syntaxHighlighting(microMonokai),
					taskDonePlugin,
					imageEmbedPlugin,
					imageEvents,
					theme,
					cmPlaceholder('Start writing...'),
					updateListener,
					EditorView.lineWrapping
				]
			}),
			parent: container
		});

		scrollEl?.addEventListener('scroll', handleScroll);
	});

	function handleScroll() {
		if (!initApplied || !scrollEl) return;
		tab.state.scrollTop = scrollEl.scrollTop;
	}

	function bgMouseDown(e: MouseEvent) {
		if (flow || !view) return;
		if (e.target !== scrollEl && e.target !== container) return;
		e.preventDefault();
		view.dispatch({ selection: { anchor: view.state.doc.length } });
		view.focus();
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
				if (initialScrollTop !== undefined && scrollEl) {
					scrollEl.scrollTop = initialScrollTop;
				}
				if (!flow && !handle?.isDraft) view.focus();
				initApplied = true;
			});
		}
	});

	onDestroy(() => {
		unregisterFlush();
		if (saveTimer) flushSave();
		scrollEl?.removeEventListener('scroll', handleScroll);
		view?.destroy();
	});
</script>

<div class="doc-view" class:flow>
	<div
		class="doc-scroll"
		class:flow
		bind:this={scrollEl}
		onmousedown={bgMouseDown}
		role="presentation"
	>
		{#if handle}
			<DocumentHero
				{handle}
				onDelete={deleteDoc}
				onDuplicated={(d) => editor?.openDoc(d)}
				compact={flow}
				bind:propsOpen
			/>
		{/if}
		<div
			class="cm-wrapper"
			class:flow
			bind:this={container}
			style="--editor-font-size: {zoom}px"
		></div>
	</div>
	{#if !flow}
		<ScrollThumb scroller={scrollEl} top={THUMB_TOP_PX} />
	{/if}
</div>

<style>
	/* Full width so the wheel works anywhere on the page and the thumb rides the
	   page's right edge; the hero and the editor content center themselves. */
	.doc-view {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
	}

	.doc-view.flow {
		height: auto;
	}

	.doc-scroll {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		scrollbar-width: none;
	}

	.doc-scroll::-webkit-scrollbar {
		display: none;
	}

	.doc-scroll.flow {
		flex: none;
		display: block;
		overflow: visible;
	}

	.cm-wrapper {
		position: relative;
		width: 100%;
		flex: 1 0 auto;
	}

	.cm-wrapper.flow {
		flex: none;
	}

	.doc-view:not(.flow) .doc-scroll {
		margin: 2px;
		border-radius: 6px;
	}

	.cm-wrapper :global(.cm-editor) {
		height: auto;
		outline: none;
	}

	.cm-wrapper :global(.cm-focused) {
		outline: none;
	}

	.cm-wrapper :global(.cm-embed-image) {
		display: inline-block;
		max-width: 100%;
		max-height: 480px;
		border-radius: 8px;
		vertical-align: text-bottom;
		cursor: default;
	}

	.cm-wrapper :global(.cm-embed-image.focused) {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}

	.cm-wrapper :global(.cm-embed-image::selection) {
		background: transparent;
	}
</style>
