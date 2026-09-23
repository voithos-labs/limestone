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
