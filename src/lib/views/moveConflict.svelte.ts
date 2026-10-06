import DocHandle from '$lib/models/DocHandle';
import Folder from '$lib/models/Folder';
import { getSource, sourceName, type Source } from '$lib/models/Source';
import { errorKind } from '$lib/errors';
import { flushAll } from '$lib/util/flush';
import { mark } from '$lib/toasts.svelte';

export type ConflictChoice = 'keep' | 'replace' | 'cancel';
export type ConflictKind = 'note' | 'folder';

type Conflict = { kind: ConflictKind; name: string; into: string; remaining: number };
type Answer = { choice: ConflictChoice; all: boolean };

export class MoveBatch {
	remaining: number;
	decided: Partial<Record<ConflictKind, ConflictChoice>> = {};

	constructor(remaining = 0) {
		this.remaining = remaining;
	}
}

class MoveConflictController {
	current = $state<Conflict | null>(null);
	onReplaced: ((docId: string) => void) | null = null;
	private settle: ((a: Answer) => void) | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	ask(conflict: Conflict): Promise<Answer> {
		const next = this.queue.then(
			() =>
				new Promise<Answer>((resolve) => {
					this.current = conflict;
					this.settle = resolve;
				})
		);
		this.queue = next;
		return next;
	}

	answer(choice: ConflictChoice, all = false): void {
		const settle = this.settle;
		this.current = null;
		this.settle = null;
		settle?.({ choice, all });
	}
}

export const moveConflict = new MoveConflictController();

async function decide(batch: MoveBatch, conflict: Omit<Conflict, 'remaining'>) {
	const known = batch.decided[conflict.kind];
	if (known) return known;
	const { choice, all } = await moveConflict.ask({ ...conflict, remaining: batch.remaining });
	if (all) batch.decided[conflict.kind] = choice;
	return choice;
}

function numbered(rel: string, n: number, file: boolean): string {
	const cut = rel.lastIndexOf('/') + 1;
	const leaf = rel.slice(cut);
	const dot = file ? leaf.lastIndexOf('.') : -1;
	const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
	return `${rel.slice(0, cut)}${stem} ${n}${leaf.slice(stem.length)}`;
}

async function keepBoth<T>(
	rel: string,
	file: boolean,
	go: (rel: string) => Promise<T>
): Promise<T> {
	for (let n = 2; ; n++) {
		try {
			return await go(numbered(rel, n, file));
		} catch (e) {
			if (errorKind(e) !== 'already_exists' || n >= 99) throw e;
		}
	}
}

function placeMark(source: Source, rel: string): string {
	const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
	return dir ? mark('folder', dir.split('/').pop()!) : mark('source', sourceName(source));
}

export async function moveNote(
	doc: DocHandle,
	target: Source,
	newRel: string,
	batch = new MoveBatch()
): Promise<boolean> {
	const go = (rel: string) =>
		target.id === doc.source.id ? doc.moveToPath(rel) : doc.moveToSource(target, rel);
	try {
		await go(newRel);
		return true;
	} catch (e) {
		if (errorKind(e) !== 'already_exists') throw e;
	}
	const choice = await decide(batch, {
		kind: 'note',
		name: doc.title,
		into: placeMark(target, newRel)
	});
	if (choice === 'cancel') return false;
	if (choice === 'replace') {
		await flushAll();
		const replaced = await DocHandle.trashAt(target, newRel);
		if (replaced) moveConflict.onReplaced?.(replaced);
		await go(newRel);
	} else {
		await keepBoth(newRel, true, go);
	}
	return true;
}

export async function moveFolder(
	sourceId: string,
	fromPath: string,
	toPath: string,
	batch = new MoveBatch()
): Promise<string | null> {
	const go = (rel: string) => Folder.move(sourceId, fromPath, rel);
	try {
		return await go(toPath);
	} catch (e) {
		if (errorKind(e) !== 'already_exists') throw e;
	}
	const choice = await decide(batch, {
		kind: 'folder',
		name: fromPath.split('/').pop()!,
		into: placeMark(await getSource(sourceId), toPath)
	});
	return choice === 'cancel' ? null : keepBoth(toPath, false, go);
}
