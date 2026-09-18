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

async function rewrite(sourceId: string, replacements: [string, string][]): Promise<void> {
	const live = replacements.filter(([a, b]) => normalizeTarget(a) !== normalizeTarget(b));
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
