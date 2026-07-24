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

class ToastController {
	items = $state<Toast[]>([]);
	private seq = 0;

	push(
		message: string,
		opts: { action?: ToastAction; timeout?: number; variant?: ToastVariant } = {}
	): number {
		const id = ++this.seq;
		this.items = [
			...this.items,
			{ id, message, action: opts.action, variant: opts.variant ?? 'error' }
		];
		const timeout = opts.timeout ?? (opts.action ? 0 : 5000);
		if (timeout > 0) setTimeout(() => this.dismiss(id), timeout);
		return id;
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastController();
