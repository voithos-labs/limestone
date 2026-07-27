import type Session from '$lib/models/Session.svelte.js';
import type { SettingsState } from '$lib/models/Settings.svelte';
import DocHandle from '$lib/models/DocHandle';

export interface Action {
	id: string;
	title: string;
	category: string;
	defaultKeys?: string[];
	run(session: Session): void | Promise<void>;
}

export interface ShortcutCategory {
	id: string;
	label: string;
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
	{ id: 'global', label: 'Global' },
	{ id: 'tabs', label: 'Tabs' },
	{ id: 'documents', label: 'Documents' },
	{ id: 'navigation', label: 'Navigation' },
	{ id: 'views', label: 'Views' }
];

const isMac = navigator.userAgent.includes('Mac');

function matches(e: KeyboardEvent, spec: string): boolean {
	const parts = spec.split('+');
	const key = parts.pop()!;
	const mods = new Set(parts.map((m) => (m === 'mod' ? (isMac ? 'meta' : 'ctrl') : m)));
	return (
		e.ctrlKey === mods.has('ctrl') &&
		e.metaKey === mods.has('meta') &&
		e.altKey === mods.has('alt') &&
		e.shiftKey === mods.has('shift') &&
		e.key.toLowerCase() === (key === 'space' ? ' ' : key)
	);
}

export const keyCapture = { active: false };

export function keysFor(action: Action, settings: SettingsState): string[] {
	const overrides = settings.get<Record<string, string[]>>('shortcuts');
	return overrides?.[action.id] ?? action.defaultKeys ?? [];
}

export function actionForKey(e: KeyboardEvent, settings: SettingsState): Action | undefined {
	return actions.find((a) => keysFor(a, settings).some((k) => matches(e, k)));
}

export function specFromEvent(e: KeyboardEvent): string | null {
	if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
	const parts: string[] = [];
	if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod');
	if (isMac && e.ctrlKey) parts.push('ctrl');
	if (e.altKey) parts.push('alt');
	if (e.shiftKey) parts.push('shift');
	if (!isMac && e.metaKey) parts.push('meta');
	parts.push(e.key === ' ' ? 'space' : e.key.toLowerCase());
	return parts.join('+');
}

const MAC_SYMBOLS: Record<string, string> = {
	mod: '⌘',
	ctrl: '⌃',
	alt: '⌥',
	shift: '⇧',
	meta: '⌘'
};
const PC_LABELS: Record<string, string> = {
	mod: 'Ctrl',
	ctrl: 'Ctrl',
	alt: 'Alt',
	shift: 'Shift',
	meta: 'Win'
};

const KEY_SYMBOLS: Record<string, string> = {
	arrowup: '↑',
	arrowdown: '↓',
	arrowleft: '←',
	arrowright: '→',
	enter: '↵',
	space: 'Space',
	escape: 'Esc',
	backspace: '⌫',
	delete: 'Del'
};

export function keyTokens(spec: string): string[] {
	const parts = spec.split('+');
	const key = parts.pop()!;
	const mods = parts.map((m) => (isMac ? (MAC_SYMBOLS[m] ?? m) : (PC_LABELS[m] ?? m)));
	const keyLabel =
		KEY_SYMBOLS[key] ??
		(key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
	return [...mods, keyLabel];
}

export const actions: Action[] = [
	{
		id: 'tab.new',
		title: 'New tab',
		category: 'tabs',
		defaultKeys: ['ctrl+space', 'mod+t'],
		run: (session) => session.editors[0].openNewTab()
	},
	{
		id: 'tab.next',
		title: 'Next tab',
		category: 'tabs',
		defaultKeys: ['ctrl+tab', 'mod+alt+arrowright', 'ctrl+.'],
		run: (session) => session.editors[0].focusAdjacentTab(1)
	},
	{
		id: 'tab.prev',
		title: 'Previous tab',
		category: 'tabs',
		defaultKeys: ['ctrl+shift+tab', 'mod+alt+arrowleft', 'ctrl+,'],
		run: (session) => session.editors[0].focusAdjacentTab(-1)
	},
	{
		id: 'tab.close',
		title: 'Close tab',
		category: 'tabs',
		defaultKeys: ['mod+w'],
		run: (session) => {
			const ed = session.editors[0];
			const f = ed.focused;
			if (f?.kind === 'tab' && !ed.isPinned(f.id)) ed.closeTab(f.id);
		}
	},
	{
		id: 'tab.restore',
		title: 'Reopen closed tab',
		category: 'tabs',
		defaultKeys: ['mod+shift+t'],
		run: (session) => session.editors[0].reopenClosedTab()
	},
	{
		id: 'doc.new',
		title: 'New document',
		category: 'documents',
		defaultKeys: ['mod+n'],
		run: async (session) => {
			const doc = await DocHandle.createDraft();
			if (doc) session.editors[0].openDoc(doc);
		}
	},
	{
		id: 'nav.library',
		title: 'Open library',
		category: 'navigation',
		defaultKeys: ['mod+l'],
		run: (session) => session.editors[0].focusTab({ kind: 'search' })
	},
	{
		id: 'nav.settings',
		title: 'Open settings',
		category: 'navigation',
		// Not Mod+I: the editor binds it to italic, and a chord the editor claims never reaches
		// this handler while a document has focus. Mod+, is taken by tab.prev off Windows' Ctrl.
		defaultKeys: ['mod+shift+i'],
		run: (session) => session.editors[0].focusTab({ kind: 'settings' })
	}
];
