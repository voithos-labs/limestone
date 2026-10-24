import type { Component } from 'svelte';
import { LayoutList, TextAlignStart } from '@lucide/svelte';
import View from '#lib/models/View.svelte.js';
import { TabState, type TabContent } from '#lib/models/EditorState.svelte.js';
import type EditorState from '#lib/models/EditorState.svelte.js';
import { getViewIcon } from '#lib/views/filterDisplay.js';
import { metaDialog } from '#lib/overlays.svelte.js';
import PdfIcon from '../ui/PdfIcon.svelte';

export type Place = { label: string; icon: Component; emoji?: string; go: () => void };

function describe(content: TabContent) {
	const view = content.type === 'view' ? content.view : undefined;
	return {
		label: TabState.titleOf(content),
		icon: view ? getViewIcon(view) : content.type === 'pdf' ? PdfIcon : TextAlignStart,
		emoji: view?.emoji
	};
}

export function backPlace(editor: EditorState | undefined, tab: TabState): Place | undefined {
	if (!editor) return undefined;
	const prev = tab.back?.content;
	if (prev) return { ...describe(prev), go: () => editor.goBack(tab) };
	if (tab.detail) {
		return { label: tab.detail, icon: LayoutList, go: () => editor.closeTab(tab.id, false) };
	}
	return undefined;
}

export function forwardPlace(editor: EditorState | undefined, tab: TabState): Place | undefined {
	const next = tab.next?.content;
	if (!next || !editor) return undefined;
	return { ...describe(next), go: () => editor.goForward(tab) };
}

// the folder the document sits in, opened in this tab so Back comes straight here
export function openFolder(
	editor: EditorState | undefined,
	tab: TabState,
	unitId: string,
	name: string,
	newTab = false
) {
	if (!editor) return;
	View.forUnit(unitId, name)
		.then((v) => (newTab ? editor.openView(v) : editor.showViewInTab(tab, v)))
		.catch((e) => console.error('open folder failed', e));
}

// the folder in a tab of its own, the document staying where it is, with its setting open
export function openFolderMeta(editor: EditorState | undefined, unitId: string, name: string) {
	if (!editor) return;
	View.forUnit(unitId, name)
		.then((v) => {
			editor.openView(v);
			metaDialog.show(unitId);
		})
		.catch((e) => console.error('open folder failed', e));
}
