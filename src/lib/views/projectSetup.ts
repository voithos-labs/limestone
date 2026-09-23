import type EditorState from '$lib/models/EditorState.svelte.js';
import { TabState } from '$lib/models/EditorState.svelte.js';

export type SetupUnit = { id: string; name: string };

// The preamble is a tab: "new project" opens a fresh one, "turn into project" replaces the
// unit's own tab, so setting a place up happens where that place already was
export function openProjectSetup(editor: EditorState, unit?: SetupUnit, replaceTabId?: string) {
	const tab = TabState.forNew();
	if (unit) tab.state = { unit: unit.id, unit_name: unit.name };
	if (replaceTabId) editor.replaceTab(replaceTabId, tab);
	else {
		editor.openTab(tab);
		editor.focusTab({ kind: 'tab', id: tab.id });
	}
}
