import type { ViewFace } from '$lib/models/View.svelte';

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
	todo: 'Todo',
	docs: 'Documents'
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
