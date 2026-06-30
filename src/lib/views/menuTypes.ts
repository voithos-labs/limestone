import type { Component } from 'svelte';

export interface MenuItem {
	value: string;
	label: string;
	icon?: Component;
	children?: MenuItem[];
	keepOpen?: boolean;
}

export interface MenuDivider {
	kind: 'divider';
	section?: string;
}

export type MenuEntry = MenuItem | MenuDivider;

export function isMenuItem(e: MenuEntry): e is MenuItem {
	return !('kind' in e);
}
