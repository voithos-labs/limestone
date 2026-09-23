export interface WikiTarget {
	target: string;
	fragment?: string;
	alias?: string;
}

export interface LinkCandidate {
	id: string;
	rel_path: string;
}

export function parseWikiTarget(inner: string): WikiTarget {
	const bar = inner.indexOf('|');
	const head = bar < 0 ? inner : inner.slice(0, bar);
	const alias = bar < 0 ? undefined : inner.slice(bar + 1).trim();
	const hash = head.indexOf('#');
	const target = (hash < 0 ? head : head.slice(0, hash)).trim();
	const fragment = hash < 0 ? undefined : head.slice(hash + 1).trim();
	return {
		target,
		...(fragment ? { fragment } : {}),
		...(alias ? { alias } : {})
	};
}

export function stripExt(path: string): string {
	return path.replace(/\.md$/i, '');
}

export function normalizeTarget(target: string): string {
	return stripExt(target.trim().replace(/\\/g, '/').replace(/^\.\//, '')).toLowerCase();
}

export function targetStem(target: string): string {
	const clean = stripExt(target.trim().replace(/\\/g, '/'));
	return clean.slice(clean.lastIndexOf('/') + 1);
}

export function pathRank(a: string, b: string): number {
	const da = a.split('/').length;
	const db = b.split('/').length;
	if (da !== db) return da - db;
	if (a.length !== b.length) return a.length - b.length;
	return a.localeCompare(b);
}

export function resolveAmong(target: string, candidates: LinkCandidate[]): LinkCandidate | null {
	const wanted = normalizeTarget(target);
	const exact = candidates.find((c) => normalizeTarget(c.rel_path) === wanted);
	if (exact) return exact;
	const stem = targetStem(target).toLowerCase();
	const byStem = candidates.filter((c) => targetStem(c.rel_path).toLowerCase() === stem);
	if (byStem.length === 0) return null;
	return byStem.reduce((best, c) => (pathRank(c.rel_path, best.rel_path) < 0 ? c : best));
}

export function joinRel(dir: string, target: string): string {
	const parts = dir ? dir.split('/') : [];
	for (const seg of target.replace(/\\/g, '/').split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '.' && seg !== '') parts.push(seg);
	}
	return parts.join('/');
}
