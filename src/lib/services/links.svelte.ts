import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { select } from '#lib/services/db.js';
import { flushAll } from '#lib/services/platform.js';
import { describeBulkFailure, type BulkResult } from '#lib/models/View.svelte.js';
import { splitMessage } from '#lib/overlays.svelte.js';

export const linkIndex = $state({ version: 0 });

let watching = false;

function watchIndex(): void {
	if (watching) return;
	watching = true;
	void listen('source-indexed', () => {
		linkIndex.version++;
	});
}

export function touchLinkIndex(): void {
	linkIndex.version++;
}

async function candidatesFor(sourceId: string, stem: string): Promise<LinkCandidate[]> {
	return select<LinkCandidate>(
		`SELECT id, rel_path FROM documents
		 WHERE source_id = ?1 AND deleted_at IS NULL AND lower(title) = lower(?2)`,
		[sourceId, stem]
	);
}

export async function resolveWikiLink(
	sourceId: string,
	target: string
): Promise<LinkCandidate | null> {
	watchIndex();
	const stem = targetStem(target);
	if (!stem) return null;
	return resolveAmong(target, await candidatesFor(sourceId, stem));
}

/**
 * The shortest link text that resolves back to each document: the bare name, or the path
 * when another note with the same name would win it. Keyed by document id.
 */
export async function linkTargets(
	sourceId: string,
	docs: LinkCandidate[]
): Promise<Map<string, string>> {
	const stems = [...new Set(docs.map((d) => targetStem(d.rel_path)))];
	if (stems.length === 0) return new Map();
	// candidatesFor's own match, one query for every name at once
	const wanted = stems.map((_, i) => `(?${i + 2})`).join(', ');
	const namesakes = await select<LinkCandidate & { wanted: string }>(
		`WITH wanted(stem) AS (VALUES ${wanted})
		 SELECT w.stem AS wanted, d.id, d.rel_path FROM wanted w
		 JOIN documents d ON lower(d.title) = lower(w.stem)
		 WHERE d.source_id = ?1 AND d.deleted_at IS NULL`,
		[sourceId, ...stems]
	);
	const targets = new Map<string, string>();
	for (const doc of docs) {
		const stem = targetStem(doc.rel_path);
		const same = namesakes.filter((n) => n.wanted === stem);
		targets.set(doc.id, resolveAmong(stem, same)?.id === doc.id ? stem : stripExt(doc.rel_path));
	}
	return targets;
}

const UNLINKABLE = /[[\]|#^]|\p{Cc}/u;

export class LinkRewriteFailure extends Error {
	kind: string;
	failed: number;
	reason: string | null;

	constructor(result: BulkResult) {
		super('link rewrite failed');
		this.kind = result.source_unreachable
			? 'source_missing'
			: (result.failures[0]?.kind ?? 'other');
		this.failed = result.failed;
		this.reason = splitMessage(describeBulkFailure(result))[1];
	}
}

async function rewrite(sourceId: string, replacements: [string, string][]): Promise<void> {
	const live = replacements.filter(
		([a, b]) =>
			!UNLINKABLE.test(a) && !UNLINKABLE.test(b) && normalizeTarget(a) !== normalizeTarget(b)
	);
	if (live.length === 0) return;
	const result = await invoke<BulkResult>('bulk_rewrite_links', {
		sourceId,
		replacements: live
	});
	if (result.failed > 0 || result.source_unreachable) throw new LinkRewriteFailure(result);
}

export async function rewriteLinksForMove(
	sourceId: string,
	docId: string,
	oldRel: string,
	newRel: string
): Promise<void> {
	const oldStem = targetStem(oldRel);
	const newStem = targetStem(newRel);
	const [oldSiblings, newSiblings] = await Promise.all([
		candidatesFor(sourceId, oldStem).then((cs) => cs.filter((c) => c.id !== docId)),
		candidatesFor(sourceId, newStem).then((cs) => cs.filter((c) => c.id !== docId))
	]);

	const wasBare = oldSiblings.every((s) => pathRank(oldRel, s.rel_path) < 0);
	const isBare = newSiblings.every((s) => pathRank(newRel, s.rel_path) < 0);
	const newForm = isBare ? newStem : stripExt(newRel);

	await flushAll();

	if (isBare && newSiblings.length > 0) {
		const previousOwner = newSiblings.reduce((best, c) =>
			pathRank(c.rel_path, best.rel_path) < 0 ? c : best
		);
		const sameStem = oldStem.toLowerCase() === newStem.toLowerCase();
		const ownedBefore = !sameStem || pathRank(previousOwner.rel_path, oldRel) < 0;
		if (ownedBefore) await rewrite(sourceId, [[newStem, stripExt(previousOwner.rel_path)]]);
	}

	const oldForms = [stripExt(oldRel), ...(wasBare ? [oldStem] : [])];
	await rewrite(
		sourceId,
		oldForms.map((f): [string, string] => [f, newForm])
	);
	touchLinkIndex();
}

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

// A heading's text as a link fragment: [ ] and | would end or split the link, so they become spaces
export function headingFragment(text: string): string {
	return text
		.replace(/[[\]|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
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
