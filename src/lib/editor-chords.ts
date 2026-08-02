/**
 * Which keystrokes a focused document takes, so the app's window-level handler can leave them
 * alone. That handler captures and swallows what it takes, so without this the app quietly wins
 * every clash (Mod+I opened settings instead of italicizing).
 */

import type { EditorInstance } from 'aragonite';

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

export type AppEditorShortcut = 'zoom-in' | 'zoom-out' | 'cycle-mode';

/**
 * Zoom and the mode toggle, which DocumentEditor handles itself and runs from this same answer.
 * The editor knows nothing about them, so they are the only keys the app still spells out.
 */
export function appEditorShortcut(e: KeyboardEvent): AppEditorShortcut | null {
	if (!(e.ctrlKey || e.metaKey)) return null;
	if (e.key === '=' || e.key === '+') return 'zoom-in';
	if (e.key === '-') return 'zoom-out';
	if (e.key.toLowerCase() === 'e' && !e.shiftKey && !e.altKey) return 'cycle-mode';
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
