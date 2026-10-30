import View, { ViewFace, type ViewFieldType } from '#lib/models/View.svelte.js';
import EditorState, { TabState } from '#lib/models/EditorState.svelte.js';
import { exists } from '@tauri-apps/plugin-fs';
import { listSources, sourceName } from '#lib/models/Source.js';
import { folderIdPath, folderIdSource } from '#lib/models/Folder.js';
import type { SearchResult } from '#lib/services/search.js';

// The project face's sections: which are shown, in what order, folded or not. Kept on the
// face so a project remembers how it was left
export type DashSectionId = 'folders' | 'todo' | 'docs';
export interface DashSection {
	id: DashSectionId;
	hidden?: boolean;
	collapsed?: boolean;
}

export const DASH_SECTION_LABEL: Record<DashSectionId, string> = {
	folders: 'Folders',
	todo: 'Upcoming',
	docs: 'Recent'
};

const DEFAULT: DashSection[] = [{ id: 'folders' }, { id: 'todo' }, { id: 'docs' }];

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

const TODO = 'tag:todo';

export function applyProjectTemplate(view: View, id: string) {
	const of = (t: ViewFieldType) => view.fields.find((f) => f.type === t)?.id ?? '';
	const title = of('title');
	const tags = of('tags');
	const updated = of('updated_at');
	const keep = (ids: string[]) => ids.filter(Boolean);
	const onlyTodo = {
		op: 'and' as const,
		children: [{ field_id: tags, op: 'has_any', value: [TODO] }]
	};
	const todoList = () =>
		ViewFace.create(
			'list',
			keep([`${TODO}/done`, title, tags, `${TODO}/due`]),
			onlyTodo,
			[{ field_id: `${TODO}/due`, direction: 'asc', nulls: 'last' }],
			{ right: [`${TODO}/due`], hide_tag: TODO, group_by: `${TODO}/done` }
		);
	switch (id) {
		case 'project': {
			const dash = ViewFace.create('dashboard');
			const tasks = todoList();
			tasks.name = 'Todo List';
			const board = ViewFace.create(
				'kanban',
				keep([title, tags, `${TODO}/due`, updated]),
				onlyTodo,
				[],
				{ group_by: `${TODO}/status`, right: [`${TODO}/due`, updated], hide_tag: TODO }
			);
			board.name = 'Todo Board';
			const docs = ViewFace.create(
				'list',
				keep([title, tags, updated]),
				{ op: 'and', children: [{ field_id: tags, op: 'has_none', value: [TODO] }] },
				[],
				{ layout: 'grid' }
			);
			docs.name = 'Documents';
			view.faces = [dash, tasks, board, docs];
			break;
		}
		case 'todo':
			view.faces = [todoList()];
			break;
		case 'journal':
			view.faces = [ViewFace.create('journal', keep([title, tags, updated]))];
			break;
		case 'grid':
			view.faces = [
				ViewFace.create('list', keep([title, tags, updated]), undefined, [], { layout: 'grid' })
			];
			break;
		default:
			view.faces = [ViewFace.create('list', keep([title, tags, updated]))];
	}
	view.state.active_face_id = view.faces[0].id;
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
