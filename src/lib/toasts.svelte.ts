export interface ToastAction {
	label: string;
	run: () => void;
}

export type ToastVariant = 'error' | 'update' | 'info';

export interface Toast {
	id: number;
	message: string;
	action?: ToastAction;
	variant: ToastVariant;
}

export type MarkKind = 'source' | 'project' | 'folder' | 'tag' | 'note';

const MARK = /<(source|project|folder|tag|note):([^<>]+)>/;

export function mark(kind: MarkKind, name: string): string {
	const clean = name.replace(/[<>]/g, '');
	return clean ? `<${kind}:${clean}>` : `this ${kind}`;
}

export function toastParts(text: string): { text: string; kind: MarkKind | null }[] {
	const pieces = text.split(MARK);
	const out: { text: string; kind: MarkKind | null }[] = [];
	for (let i = 0; i < pieces.length; i += 3) {
		if (pieces[i]) out.push({ text: pieces[i], kind: null });
		if (i + 2 < pieces.length) out.push({ text: pieces[i + 2], kind: pieces[i + 1] as MarkKind });
	}
	return out;
}

class ToastController {
	items = $state<Toast[]>([]);
	private seq = 0;

	push(
		message: string,
		opts: { action?: ToastAction; timeout?: number; variant?: ToastVariant; sticky?: boolean } = {}
	): number {
		const shown = this.items.find((t) => t.message === message);
		if (shown) return shown.id;
		const id = ++this.seq;
		this.items = [
			...this.items,
			{ id, message, action: opts.action, variant: opts.variant ?? 'error' }
		];
		const timeout = opts.sticky ? 0 : (opts.timeout ?? (opts.action ? 0 : 5000));
		if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastController();
