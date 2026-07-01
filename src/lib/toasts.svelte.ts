export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	action?: ToastAction;
}

class ToastController {
	items = $state<Toast[]>([]);
	private seq = 0;

	push(message: string, opts: { action?: ToastAction; timeout?: number } = {}): number {
		const id = ++this.seq;
		this.items = [...this.items, { id, message, action: opts.action }];
		const timeout = opts.timeout ?? (opts.action ? 0 : 5000);
		if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastController();
