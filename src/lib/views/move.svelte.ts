import DocHandle from '#lib/models/DocHandle.js';
import Folder, { folderIdPath, folderIdSource } from '#lib/models/Folder.js';
import { mark, errorKind } from '#lib/overlays.svelte.js';
import { getSource, sourceName, type Source } from '#lib/models/Source.js';
import { flushAll } from '#lib/services/platform.js';

// Moving things between places by drag: a document or folder picked up in one list and dropped
// on a folder chip or a breadcrumb. Native drag and drop (the window's Tauri drag-drop is off
// so the DOM gets the events); the payload also sits here because `dataTransfer` is sealed
// until the drop, and targets want to judge it while hovering

export const MOVE_MIME = 'application/x-limestone-move';

export type MovePayload = { kind: 'doc' | 'folder'; id: string };

let current: MovePayload | null = null;

export function startMove(e: DragEvent, p: MovePayload) {
	if (!e.dataTransfer) return;
	e.dataTransfer.setData(MOVE_MIME, JSON.stringify(p));
	e.dataTransfer.effectAllowed = 'move';
	current = p;
}

export function endMove() {
	current = null;
}

export function movingNow(): MovePayload | null {
	return current;
}

export function isMove(e: DragEvent): boolean {
	return !!e.dataTransfer?.types.includes(MOVE_MIME);
}

export function readMove(e: DragEvent): MovePayload | null {
	const raw = e.dataTransfer?.getData(MOVE_MIME);
	if (raw) {
		try {
			return JSON.parse(raw) as MovePayload;
		} catch {
			/* fall through to the held copy */
		}
	}
	return current;
}

export function canMoveInto(targetId: string, p: MovePayload | null): boolean {
	if (p?.kind !== 'folder') return true;
	if (folderIdSource(p.id) !== folderIdSource(targetId)) return false;
	const from = folderIdPath(p.id);
	const to = folderIdPath(targetId);
	const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
	return to !== from && !to.startsWith(from + '/') && to !== parent;
}

export async function moveAllInto(targetId: string, items: MovePayload[]): Promise<boolean> {
	const batch = new MoveBatch(items.length);
	let moved = false;
	for (const p of items) {
		batch.remaining--;
		if (await moveInto(targetId, p, batch)) moved = true;
	}
	return moved;
}

export async function moveInto(
	targetId: string,
	p: MovePayload,
	batch = new MoveBatch()
): Promise<boolean> {
	const sourceId = folderIdSource(targetId);
	const targetPath = folderIdPath(targetId);
	let subject =
		p.kind === 'doc' ? 'This note' : mark('folder', folderIdPath(p.id).split('/').pop() ?? '');
	try {
		if (p.kind === 'doc') {
			const d = await DocHandle.fromID(p.id);
			subject = mark('note', d.title);
			const file = d.relPath.split('/').pop() ?? d.relPath;
			const newRel = targetPath ? `${targetPath}/${file}` : file;
			if (d.source.id === sourceId && newRel === d.relPath) return false;
			const target = d.source.id === sourceId ? d.source : await getSource(sourceId);
			return await moveNote(d, target, newRel, batch);
		}
		if (!canMoveInto(targetId, p)) return false;
		const fp = folderIdPath(p.id);
		const name = fp.split('/').pop() ?? fp;
		const dest = targetPath ? `${targetPath}/${name}` : name;
		return (await moveFolder(sourceId, fp, dest, batch)) !== null;
	} catch (e) {
		Folder.reportOpError(e, `${subject} couldn't be moved.`);
		return false;
	}
}

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
