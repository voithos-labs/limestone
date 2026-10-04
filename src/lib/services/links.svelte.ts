import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { select } from '$lib/services/db';
import { flushAll } from '$lib/util/flush';
import { toastBulkFailures, type BulkResult } from '$lib/models/View.svelte';
import {
	pathRank,
	resolveAmong,
	stripExt,
	targetStem,
	normalizeTarget,
	type LinkCandidate
} from '$lib/wikilinks';

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
	toastBulkFailures([result]);
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
