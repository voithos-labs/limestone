import type Session from '$lib/models/Session';
import type { SettingsState } from '$lib/models/Settings.svelte';
import DocHandle from '$lib/models/DocHandle';

export interface Action {
	id: string;
	title: string;
	defaultKeys?: string[];
	run(session: Session): void | Promise<void>;
}

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

const MAC_SYMBOLS: Record<string, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' };
const PC_LABELS: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

export function formatKey(spec: string): string {
	const parts = spec.split('+');
	const key = parts.pop()!;
	const keyLabel = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
	return isMac
		? parts.map((m) => MAC_SYMBOLS[m] ?? m).join('') + keyLabel
		: [...parts.map((m) => PC_LABELS[m] ?? m), keyLabel].join('+');
}

export const actions: Action[] = [
	{
		id: 'tab.new',
		title: 'New tab',
		defaultKeys: ['ctrl+space', 'mod+t'],
		run: (session) => session.editors[0].openNewTab()
	},
	{
		id: 'doc.new',
		title: 'New document',
		defaultKeys: ['mod+n'],
		run: async (session) => {
			const doc = await DocHandle.createDraft();
			if (doc) session.editors[0].openDoc(doc);
		}
	}
];
