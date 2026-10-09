import type { ViewFace } from '#lib/models/View.svelte.js';
import EditorState, { TabState } from '#lib/models/EditorState.svelte.js';
import { exists } from '@tauri-apps/plugin-fs';
import { listSources, sourceName } from '#lib/models/Source.js';
import { folderIdPath, folderIdSource } from '#lib/models/Folder.js';
import type { SearchResult } from '#lib/services/search.js';

// The project face's sections: which are shown, in what order, folded or not. Kept on the
// face so a project remembers how it was left
export type DashSectionId = 'folders' | 'todo' | 'done' | 'docs';
export interface DashSection {
	id: DashSectionId;
	hidden?: boolean;
	collapsed?: boolean;
}

export const DASH_SECTION_LABEL: Record<DashSectionId, string> = {
	folders: 'Folders',
	todo: 'Todo',
	done: 'Done',
	docs: 'Documents'
};

const DEFAULT: DashSection[] = [
	{ id: 'folders' },
	{ id: 'todo' },
	{ id: 'done', collapsed: true },
	{ id: 'docs' }
];

export function dashboardSections(face: ViewFace): DashSection[] {
	const saved = face.config.sections as DashSection[] | undefined;
	if (!Array.isArray(saved)) return DEFAULT;
	// every known section exactly once, unknown ids dropped, new ones appended
	const seen = new Set<string>();
	const out: DashSection[] = [];
	for (const s of saved) {
		if (!DEFAULT.some((d) => d.id === s.id) || seen.has(s.id)) continue;
		seen.add(s.id);
		out.push(s);
	}
	// a section added since the face was saved slots in at its default position
	DEFAULT.forEach((d, i) => {
		if (!seen.has(d.id)) out.splice(Math.min(i, out.length), 0, d);
	});
	return out;
}

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

export type FolderPresence =
	| { state: 'ok' }
	| { state: 'removed' }
	| { state: 'source_missing'; source: string }
	| { state: 'gone'; source: string; path: string };

export async function folderPresence(unitId: string): Promise<FolderPresence> {
	const source = (await listSources()).find((s) => s.id === folderIdSource(unitId));
	if (!source) return { state: 'removed' };
	const name = sourceName(source);
	if (!(await exists(source.path).catch(() => false)))
		return { state: 'source_missing', source: name };
	const path = folderIdPath(unitId);
	if (!path || (await exists(`${source.path}/${path}`).catch(() => true))) return { state: 'ok' };
	return { state: 'gone', source: name, path };
}

// The doc face draws one document, but the control that chooses it lives in the view
export class DocPicker {
	open = $state(false);
	anchor: HTMLElement | null = $state(null);
	results: SearchResult[] = $state([]);
	activeId: string | null = $state(null);
	create: ((title?: string) => void) | null = $state(null);
	onPick: ((id: string) => void) | null = $state(null);

	pick(id: string): void {
		this.activeId = id;
		this.open = false;
		this.onPick?.(id);
	}
}
