// Moving things between places by drag: a document or folder picked up in one list and dropped
// on a folder chip or a breadcrumb. Native drag and drop (the window's Tauri drag-drop is off
// so the DOM gets the events); the payload also sits here because `dataTransfer` is sealed
// until the drop, and targets want to judge it while hovering
import DocHandle from '$lib/models/DocHandle';
import Folder, { folderIdPath, folderIdSource } from '$lib/models/Folder';
import { toasts, mark } from '$lib/toasts.svelte';

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

export async function moveInto(targetId: string, p: MovePayload): Promise<boolean> {
	const sourceId = folderIdSource(targetId);
	const targetPath = folderIdPath(targetId);
	let subject =
		p.kind === 'doc' ? 'This note' : mark('folder', folderIdPath(p.id).split('/').pop() ?? '');
	try {
		if (p.kind === 'doc') {
			const d = await DocHandle.fromID(p.id);
			subject = mark('note', d.title);
			if (d.source.id !== sourceId) {
				toasts.push('Drag between sources is not supported yet. Use Move from the document.');
				return false;
			}
			const file = d.relPath.split('/').pop() ?? d.relPath;
			const newRel = targetPath ? `${targetPath}/${file}` : file;
			if (newRel === d.relPath) return false;
			await d.moveToPath(newRel);
			return true;
		}
		if (!canMoveInto(targetId, p)) return false;
		const fp = folderIdPath(p.id);
		const name = fp.split('/').pop() ?? fp;
		await Folder.move(sourceId, fp, targetPath ? `${targetPath}/${name}` : name);
		return true;
	} catch (e) {
		Folder.reportOpError(e, `${subject} couldn't be moved.`);
		return false;
	}
}
