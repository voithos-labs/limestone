import type EditorState from '$lib/models/EditorState.svelte.js';
import { TabState } from '$lib/models/EditorState.svelte.js';

export type SetupUnit = { id: string; name: string };

// The preamble is a tab: "new project" opens a fresh one, "turn into project" navigates the
// unit's own tab there, so setting a place up happens where that place was and cancelling
// is a step back
export function openProjectSetup(editor: EditorState, unit?: SetupUnit, inTab?: TabState) {
	const state = unit ? { unit: unit.id, unit_name: unit.name } : {};
	if (inTab) {
		editor.showSetupInTab(inTab, state);
		return;
	}
	const tab = TabState.forNew();
	tab.state = state;
	editor.openTab(tab);
	editor.focusTab({ kind: 'tab', id: tab.id });
}
