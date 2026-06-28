import type { Component } from 'svelte';

/**
 * App-wide custom context menu (right click menu)
 */

export interface CtxItem {
	label: string;
	icon?: Component;
	action: () => void;
	danger?: boolean;
	disabled?: boolean;
}

export interface CtxDivider {
	divider: true;
}

export type CtxEntry = CtxItem | CtxDivider;

export function isCtxItem(e: CtxEntry): e is CtxItem {
	return !('divider' in e);
}

class ContextMenuController {
	open = $state(false);
	x = $state(0);
	y = $state(0);
	items = $state<CtxEntry[]>([]);

	show(x: number, y: number, items: CtxEntry[]) {
		this.x = x;
		this.y = y;
		this.items = items;
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
		contextMenu.show(e.clientX, e.clientY, items);
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
