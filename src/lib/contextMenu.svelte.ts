import type { Component } from 'svelte';

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

	get items(): CtxEntry[] {
		return typeof this.source === 'function' ? this.source() : this.source;
	}

	show(x: number, y: number, items: CtxSource, opts: { minWidth?: number } = {}) {
		this.x = x;
		this.y = y;
		this.source = items;
		this.minWidth = opts.minWidth ?? 168;
		this.open = true;
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
