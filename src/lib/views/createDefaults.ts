import type View from '$lib/models/View.svelte';
import type { FilterNode, FilterLeaf, ViewFace, ViewField } from '$lib/models/View.svelte';
import type Group from '$lib/models/Group';

export interface CreateContext {
	folderGroupId: string | null;
	ambiguous: boolean;
	fieldValues: Record<string, unknown>;
	tagGroupIds: string[];
	sourceId: string | null;
}

function conjunctiveLeaves(node: FilterNode, out: FilterLeaf[]): void {
	if ('children' in node) {
		if (node.op !== 'and') return;
		for (const c of node.children) conjunctiveLeaves(c, out);
	} else {
		out.push(node);
	}
}

function ancestorChain(id: string, byId: Map<string, Group>): string[] {
	const chain: string[] = [];
	let g = byId.get(id);
	let guard = 0;
	while (g?.parentGroupId && guard++ < 64) {
		chain.push(g.parentGroupId);
		g = byId.get(g.parentGroupId);
	}
	return chain;
}

function resolveFolder(
	folderIds: string[],
	byId: Map<string, Group>
): { id: string | null; ambiguous: boolean } {
	const ids = [...new Set(folderIds)];
	if (ids.length === 0) return { id: null, ambiguous: false };
	if (ids.length === 1) return { id: ids[0], ambiguous: false };

	const deepest = ids.filter((c) => {
		const ancestors = new Set(ancestorChain(c, byId));
		return ids.every((o) => o === c || ancestors.has(o));
	});
	if (deepest.length === 1) return { id: deepest[0], ambiguous: false };
	return { id: null, ambiguous: true };
}

export function deriveCreateContext(view: View, face: ViewFace, folders: Group[]): CreateContext {
	const leaves: FilterLeaf[] = [];
	conjunctiveLeaves(view.filter, leaves);
	conjunctiveLeaves(face.additive_filter, leaves);

	const fieldsById = new Map(view.fields.map((f) => [f.id, f]));
	const byId = new Map(folders.map((g) => [g.id, g]));

	const folderIds: string[] = [];
	const tagGroupIds: string[] = [];
	const fieldValues: Record<string, unknown> = {};
	let sourceId: string | null = null;

	for (const field of view.fields) {
		const def = field.config?.default;
		if (def === undefined || def === null || def === '') continue;
		if (field.type === 'select' || field.type === 'multiselect') {
			fieldValues[field.name] = field.type === 'multiselect' && !Array.isArray(def) ? [def] : def;
		}
	}

	for (const leaf of leaves) {
		const field = fieldsById.get(leaf.field_id);
		if (!field) continue;

		if (field.type === 'folder') {
			if (leaf.op === 'in' && typeof leaf.value === 'string') folderIds.push(leaf.value);
		} else if (field.type === 'source') {
			if (leaf.op === 'eq' && typeof leaf.value === 'string') sourceId = leaf.value;
		} else if (field.type === 'tags') {
			if ((leaf.op === 'has_any' || leaf.op === 'has_all') && Array.isArray(leaf.value)) {
				for (const v of leaf.value) if (typeof v === 'string') tagGroupIds.push(v);
			}
		} else {
			collectFieldDefault(field, leaf, fieldValues);
		}
	}

	const folder = resolveFolder(folderIds, byId);
	if (!sourceId && folder.id) sourceId = byId.get(folder.id)?.sourceId ?? null;

	return {
		folderGroupId: folder.id,
		ambiguous: folder.ambiguous,
		fieldValues,
		tagGroupIds: [...new Set(tagGroupIds)],
		sourceId
	};
}

function collectFieldDefault(
	field: ViewField,
	leaf: FilterLeaf,
	out: Record<string, unknown>
): void {
	if (leaf.value === null || leaf.value === undefined || leaf.value === '') return;
	if (field.type === 'multiselect') {
		if (leaf.op === 'contains') out[field.name] = [leaf.value];
		return;
	}
	// boolean filters use eq with a real true/false ;;;; both are valid defaults
	if (field.type === 'boolean') {
		if (leaf.op === 'eq') out[field.name] = leaf.value === true || leaf.value === 'true';
		return;
	}
	if (leaf.op === 'eq') out[field.name] = leaf.value;
}

export function folderLinkChain(groupId: string, folders: Group[]): string[] {
	const byId = new Map(folders.map((g) => [g.id, g]));
	return [groupId, ...ancestorChain(groupId, byId)];
}

export function folderPath(
	groupId: string,
	folders: Pick<Group, 'id' | 'slug' | 'parentGroupId'>[]
): string {
	const byId = new Map(folders.map((g) => [g.id, g]));
	const parts: string[] = [];
	let g = byId.get(groupId);
	let guard = 0;
	while (g && guard++ < 64) {
		parts.unshift(g.slug);
		g = g.parentGroupId ? byId.get(g.parentGroupId) : undefined;
	}
	return parts.join('/');
}
