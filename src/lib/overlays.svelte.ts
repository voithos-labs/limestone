import type { Component } from 'svelte';

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

export function errorKind(e: unknown): string {
	const kind = (e as { kind?: unknown } | null)?.kind;
	return typeof kind === 'string' ? kind : 'other';
}

export function describeError(e: unknown, fallback: string): string {
	const name = (e as { name?: unknown } | null)?.name;
	const named = typeof name === 'string' && !(e instanceof Error) ? name : null;
	switch (errorKind(e)) {
		case 'source_missing':
			return 'The source folder is unavailable. Check that the drive or folder is connected.';
		case 'not_found':
			return "The file couldn't be found. It may have been moved or deleted outside Limestone.";
		case 'permission':
			return "The file is read-only or you don't have permission to change it.";
		case 'locked':
			return 'The file is open in another app. Close it there and try again.';
		case 'no_space':
			return 'Your disk is out of space.';
		case 'already_exists':
			return named ? `Something named "${named}" is already there.` : 'The name is already taken.';
		case 'invalid_name':
			return named ? `"${named}" can't be used as a name.` : "The name can't be used.";
		case 'no_metadata':
			return "This folder keeps metadata out of its files, so that can't be saved here.";
		case 'invalid_data':
			return "The file isn't readable as text.";
		default:
			return fallback;
	}
}

const RETRYABLE = new Set(['source_missing', 'locked', 'no_space', 'other']);

export function isRetryable(e: unknown): boolean {
	return RETRYABLE.has(errorKind(e));
}

export function splitMessage(message: string): [string, string | null] {
	const m = /^((?:"[^"]*"|<[^<>]*>|[^"<])+?)(?:: |\. )(.+)$/s.exec(message);
	if (!m) return [message, null];
	return [m[1], m[2][0].toUpperCase() + m[2].slice(1)];
}

export type ReportError = (e: unknown, fallback: string, retry?: () => unknown) => void;

export function reportError(
	e: unknown,
	fallback: string,
	retry?: () => unknown,
	describe = describeError
): void {
	console.error(fallback, e);
	const action = retry && isRetryable(e) ? { label: 'Retry', run: () => void retry() } : undefined;
	const reason = describe(e, '');
	toasts.push(reason ? `${fallback.replace(/\.$/, '')}: ${reason}` : fallback, { action });
}

/**
 * App-wide custom context menu (right click menu)
 */

export interface CtxItem {
	label: string;
	icon?: Component;
	emoji?: string; // drawn in the icon's place when set
	action?: () => void;
	danger?: boolean;
	disabled?: boolean;
	checked?: boolean; // drawn with a check, for a choice among several
	keepOpen?: boolean; // the menu stays up after this action (toggles, choices)
	children?: CtxEntry[]; // a flyout instead of an action
	aux?: { icon: Component; label: string; action: () => void }; // a second way, on the row's right
}

export interface CtxDivider {
	divider: true;
	label?: string; // a titled rule, heading the group under it
}

export type CtxEntry = CtxItem | CtxDivider;

export function isCtxItem(e: CtxEntry): e is CtxItem {
	return !('divider' in e);
}

type CtxSource = CtxEntry[] | (() => CtxEntry[]);

class ContextMenuController {
	open = $state(false);
	x = $state(0);
	y = $state(0);
	// a function source is re-read while the menu is up, so checks and toggles stay current
	private source = $state<CtxSource>([]);
	minWidth = $state(168);
	anchor: HTMLElement | null = $state(null);

	get items(): CtxEntry[] {
		return typeof this.source === 'function' ? this.source() : this.source;
	}

	show(
		x: number,
		y: number,
		items: CtxSource,
		opts: { minWidth?: number; anchor?: HTMLElement } = {}
	) {
		this.x = x;
		this.y = y;
		this.source = items;
		this.minWidth = opts.minWidth ?? 168;
		this.anchor = opts.anchor ?? null;
		this.open = true;
	}

	showAt(anchor: HTMLElement, items: CtxSource, opts: { minWidth?: number } = {}) {
		const r = anchor.getBoundingClientRect();
		this.show(r.left, r.bottom + 4, items, { ...opts, anchor });
	}

	close() {
		this.open = false;
	}
}

export const contextMenu = new ContextMenuController();

/**
 * Svelte action: `use:ctxMenu={() => entries}`
 */
export function ctxMenu(node: HTMLElement, getItems: () => CtxEntry[] | null | undefined) {
	let provide = getItems;
	function handle(e: MouseEvent) {
		const items = provide();
		if (!items || items.length === 0) return;
		e.preventDefault();
		e.stopPropagation();
		contextMenu.show(e.clientX, e.clientY, () => provide() ?? []);
	}
	node.addEventListener('contextmenu', handle);
	return {
		update(next: () => CtxEntry[] | null | undefined) {
			provide = next;
		},
		destroy() {
			node.removeEventListener('contextmenu', handle);
		}
	};
}

// The command palette: one popup for finding things and for doing things. Anything can raise
// it, optionally with a starting query
class PaletteController {
	open = $state(false);
	initial = $state('');

	show(initial = '') {
		this.initial = initial;
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const palette = new PaletteController();

// The folder metadata dialog, one for the app: any menu or notice can raise it for a folder
class MetaDialogController {
	open = $state(false);
	folderId = $state('');

	show(folderId: string) {
		this.folderId = folderId;
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const metaDialog = new MetaDialogController();

class AddSourceRequest {
	signal = $state(0);

	open(): void {
		this.signal++;
	}
}

export const addSourceRequest = new AddSourceRequest();

export interface MenuItem {
	value: string;
	label: string;
	icon?: Component;
	children?: MenuItem[];
	keepOpen?: boolean;
	danger?: boolean;
	hint?: string; // its current state, trailing in muted text
}

export interface MenuDivider {
	kind: 'divider';
	section?: string;
}

export type MenuEntry = MenuItem | MenuDivider;

export function isMenuItem(e: MenuEntry): e is MenuItem {
	return !('kind' in e);
}
