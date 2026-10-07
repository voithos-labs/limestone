import Session from '#lib/models/Session.svelte.js';
import { palette } from '#lib/overlays.svelte.js';
import type { SettingsState } from '#lib/models/Settings.svelte.js';
import DocHandle from '#lib/models/DocHandle.js';
import type { EditorInstance } from '@voithos-labs/aragonite';

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
const isLinux = navigator.userAgent.includes('Linux');

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
		id: 'palette.open',
		title: 'Search',
		category: 'global',
		defaultKeys: isLinux ? ['mod+k', 'mod+p'] : ['ctrl+space', 'mod+k', 'mod+p'],
		run: () => palette.show()
	},
	{
		id: 'tab.new',
		title: 'New',
		category: 'tabs',
		defaultKeys: ['mod+t'],
		run: () => palette.show()
	},
	{
		id: 'tab.next',
		title: 'Next tab',
		category: 'tabs',
		defaultKeys: ['ctrl+tab', 'mod+]', 'mod+alt+arrowright'],
		run: (session) => session.active.focusAdjacentTab(1)
	},
	{
		id: 'tab.prev',
		title: 'Previous tab',
		category: 'tabs',
		// `mod+,` stays with settings, the way it reads on every other desktop app
		defaultKeys: ['ctrl+shift+tab', 'mod+[', 'mod+alt+arrowleft'],
		run: (session) => session.active.focusAdjacentTab(-1)
	},
	{
		id: 'tab.close',
		title: 'Close tab',
		category: 'tabs',
		defaultKeys: ['mod+w'],
		run: (session) => {
			const ed = session.active;
			const f = ed.focused;
			if (f?.kind === 'tab' && !ed.isPinned(f.id)) ed.closeTab(f.id);
		}
	},
	{
		id: 'tab.restore',
		title: 'Reopen closed tab',
		category: 'tabs',
		defaultKeys: ['mod+shift+t'],
		run: (session) => session.active.reopenClosedTab()
	},
	{
		id: 'tab.move_across',
		title: 'Move tab to other side',
		category: 'tabs',
		defaultKeys: ['mod+\\'],
		run: (session) => {
			const ed = session.active;
			const tab = ed.focusedTab;
			if (!tab || tab === ed.preview) return;
			if (session.editors.length > 1 || ed.tabs.length > 1)
				session.moveTab(tab, ed, session.beside(ed));
		}
	},
	{
		id: 'pane.focus_right',
		title: 'Focus right side',
		category: 'tabs',
		defaultKeys: ['mod+shift+}', 'mod+alt+shift+arrowright'],
		run: (session) => {
			if (session.editors[1]) session.activate(session.editors[1], true);
		}
	},
	{
		id: 'pane.focus_left',
		title: 'Focus left side',
		category: 'tabs',
		defaultKeys: ['mod+shift+{', 'mod+alt+shift+arrowleft'],
		run: (session) => session.activate(session.editors[0], true)
	},
	{
		id: 'doc.new',
		title: 'New document',
		category: 'documents',
		defaultKeys: ['mod+n'],
		run: async (session) => {
			const doc = await DocHandle.createDraft();
			if (doc) session.active.openDoc(doc);
		}
	},
	{
		id: 'nav.back',
		title: 'Back',
		category: 'navigation',
		defaultKeys: ['alt+arrowleft'],
		run: (session) => {
			const ed = session.active;
			const tab = ed.focusedTab;
			if (tab) ed.goBack(tab);
		}
	},
	{
		id: 'nav.forward',
		title: 'Forward',
		category: 'navigation',
		defaultKeys: ['alt+arrowright'],
		run: (session) => {
			const ed = session.active;
			const tab = ed.focusedTab;
			if (tab) ed.goForward(tab);
		}
	},
	{
		id: 'nav.home',
		title: 'Open home',
		category: 'navigation',
		defaultKeys: ['mod+l'],
		run: (session) => session.active.openHome()
	},
	{
		id: 'nav.settings',
		title: 'Open settings',
		category: 'navigation',
		// Not Mod+I: the editor uses it for italic, and a key the editor takes never reaches this
		// handler while a document has focus. Any replacement has to be one the editor leaves alone.
		defaultKeys: ['mod+,'],
		run: (session) => {
			session.activate(session.editors[0], true);
			session.editors[0].focusTab({ kind: 'settings' });
		}
	}
];

/**
 * Which keystrokes a focused document takes, so the app's window-level handler can leave them
 * alone. That handler captures and swallows what it takes, so without this the app quietly wins
 * every clash (Mod+I opened settings instead of italicizing).
 */

// ── The editors on screen ────────────────────────────────────────────────────

const mounted = new Set<EditorInstance>();

/** DocumentEditor registers its editor while it is on screen; the result unregisters it. */
export function registerDocumentEditor(instance: EditorInstance): () => void {
	mounted.add(instance);
	return () => {
		mounted.delete(instance);
	};
}

// ── Shortcuts the app adds inside a document ─────────────────────────────────

export type AppEditorShortcut = 'zoom-in' | 'zoom-out';

/**
 * Zoom, which DocumentEditor handles itself and runs from this same answer. The editor knows
 * nothing about it, so these are the only keys the app still spells out.
 */
export function appEditorShortcut(e: KeyboardEvent): AppEditorShortcut | null {
	if (!(e.ctrlKey || e.metaKey)) return null;
	if (e.key === '=' || e.key === '+') return 'zoom-in';
	if (e.key === '-') return 'zoom-out';
	return null;
}

// ── The answer ───────────────────────────────────────────────────────────────

/**
 * Whether a focused document takes this keystroke. The editor is asked about its own shortcuts
 * rather than the app keeping a copy of them, so the answer moves when the editor does.
 */
export function editorTakesKey(e: KeyboardEvent): boolean {
	if (!inEditorContent(e)) return false;
	if (appEditorShortcut(e)) return true;
	for (const instance of mounted) {
		if (instance.claimsChord(e)) return true;
	}
	return false;
}

// ── Where the editor takes them ──────────────────────────────────────────────

/**
 * Two of aragonite's own class names. Neither is promised API, but focus has to be tested against
 * something. `.editor` is depended on a second time, by the `EDITABLE` selector in `+page.svelte`.
 */
const EDITOR_ROOT = '.editor';
const EDITOR_HEADER = '.editor-header';

/**
 * Whether focus is somewhere the editor handles shortcuts: inside its root but outside the header
 * the app draws there, so renaming a document in the title field keeps the app's shortcuts.
 * Narrower than `inEditable` on purpose: standing down in every text field would take these keys
 * from quick search, the settings pane and the view editors.
 */
function inEditorContent(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	return isEditorContent(target) || isEditorContent(document.activeElement);
}

function isEditorContent(el: Element | null): boolean {
	return !!el?.closest(EDITOR_ROOT) && !el.closest(EDITOR_HEADER);
}
