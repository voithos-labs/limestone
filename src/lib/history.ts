// Undo for view actions: one stack, owned by whichever view last pushed, cleared when its face
// changes. Entries put the file back (or forward again); the screen follows the file
export type Entry = { back: () => Promise<void>; forward: () => Promise<void> };

const MAX = 50;

class History {
	private owner: string | null = null;
	private undos: Entry[] = [];
	private redos: Entry[] = [];
	private batch: Entry[] | null = null;

	push(owner: string, entry: Entry): void {
		if (owner !== this.owner) {
			this.owner = owner;
			this.undos = [];
			this.redos = [];
		}
		if (this.batch) {
			this.batch.push(entry);
			return;
		}
		this.redos = [];
		this.undos.push(entry);
		if (this.undos.length > MAX) this.undos.shift();
	}

	// everything pushed inside runs as one step, undone in reverse
	group(owner: string, fn: () => void): void {
		if (this.batch) {
			fn();
			return;
		}
		const list: Entry[] = (this.batch = []);
		try {
			fn();
		} finally {
			this.batch = null;
		}
		if (list.length === 0) return;
		this.push(owner, {
			back: async () => {
				for (const e of [...list].reverse()) await e.back();
			},
			forward: async () => {
				for (const e of list) await e.forward();
			}
		});
	}

	clear(): void {
		this.owner = null;
		this.undos = [];
		this.redos = [];
	}

	async undo(owner: string): Promise<boolean> {
		if (owner !== this.owner) return false;
		const e = this.undos.pop();
		if (!e) return false;
		await e.back();
		this.redos.push(e);
		return true;
	}

	async redo(owner: string): Promise<boolean> {
		if (owner !== this.owner) return false;
		const e = this.redos.pop();
		if (!e) return false;
		await e.forward();
		this.undos.push(e);
		return true;
	}
}

export const history = new History();

// a page's Ctrl/Cmd+Z and Shift+Z / Y, when the page is the active pane and nothing with its
// own undo (a field, the editor, a menu) has the keyboard
export function undoKey(e: KeyboardEvent, owner: string, root: HTMLElement | null): void {
	if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
	const k = e.key.toLowerCase();
	if (k !== 'z' && k !== 'y') return;
	if (!root?.closest('.content-area.active')) return;
	const a = document.activeElement as HTMLElement | null;
	if (a && (a.matches('input, textarea, select') || a.isContentEditable || a.closest('.editor')))
		return;
	if (document.querySelector('.menu, .pop, .overlay, .ctx-menu, [role="dialog"]')) return;
	e.preventDefault();
	const redo = k === 'y' || e.shiftKey;
	void (redo ? history.redo(owner) : history.undo(owner));
}
