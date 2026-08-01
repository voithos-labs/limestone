/**
 * Keyboard shortcuts the document editor uses, so the app's window-level handler can leave them
 * alone. That handler captures and swallows what it takes, so without this list the app quietly
 * wins every clash (Mod+I opened settings instead of italicizing).
 *
 * Both halves are copied from aragonite by hand: it publishes no shortcut list, and its idea of
 * "focus is in the editor" is not something the app can ask it at runtime.
 */

// ── Chords the editor claims ─────────────────────────────────────────────────

/**
 * Copied by hand from aragonite 0.9.36, the plugins limestone mounts, and this file's companion
 * shortcuts in `DocumentEditor.svelte`. Re-check it when the aragonite dependency moves.
 *
 * Chords with a modifier only: an app shortcut on a bare typing key is lost inside a document
 * whatever this list says. Listing too many only costs an app shortcut while a document has
 * focus, listing too few loses an editor feature, so err long.
 *
 * On macOS aragonite treats Ctrl and Cmd as one modifier and `specFromEvent` does not. Why that
 * is not fixed here is recorded in `e2e/requirements/keybindings.md`.
 */
const RESERVED = new Set([
	// Inline formatting and heading level
	'mod+b',
	'mod+i',
	'mod+0',
	'mod+1',
	'mod+2',
	'mod+3',
	'mod+4',
	'mod+5',
	'mod+6',
	// Undo and redo
	'mod+z',
	'mod+y',
	'mod+shift+z',
	// Find and replace
	'mod+f',
	'mod+h',
	// Block selection and its clipboard
	'mod+a',
	'mod+c',
	'mod+x',
	'mod+shift+end',
	'mod+shift+home',
	// Block motion and hard line breaks
	'alt+arrowup',
	'alt+arrowdown',
	'shift+enter',
	'shift+tab',
	// Table rows, columns, alignment, and moving the table itself
	'mod+enter',
	'mod+shift+enter',
	'mod+shift+backspace',
	'mod+shift+a',
	'alt+arrowleft',
	'alt+arrowright',
	'alt+shift+arrowleft',
	'alt+shift+arrowright',
	'alt+shift+backspace',
	'mod+alt+arrowup',
	'mod+alt+arrowdown',
	// Plugin shortcuts: admonition kind, mermaid focus
	'mod+7',
	'mod+m',
	// Added by DocumentEditor: mode toggle and zoom
	'mod+e',
	'mod+=',
	'mod+-'
]);

/** Takes whatever `specFromEvent` returns, null included, so a lone modifier is not a chord. */
export function isEditorReservedChord(spec: string | null): boolean {
	return spec !== null && RESERVED.has(spec);
}

// ── Where the editor claims them ─────────────────────────────────────────────

/**
 * aragonite's own class names, neither of them a promised API (aragonite avoids relying on
 * `.editor-header` itself, since a host app could add an element by that name). `.editor` is
 * depended on a second time, by the `EDITABLE` selector in `+page.svelte`.
 */
const EDITOR_ROOT = '.editor';
const HOST_CHROME = '.editor-header';

/**
 * Whether focus is somewhere the editor handles shortcuts: inside its root but outside the header
 * slot, which is where aragonite draws the line too, so renaming a document in the title field
 * keeps the app's shortcuts. Narrower than `inEditable` on purpose: reserving these in every text
 * field would take them from quick search, the settings pane and the view editors.
 */
export function inEditorContent(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	const active = document.activeElement;
	return isEditorContent(target) || isEditorContent(active);
}

function isEditorContent(el: Element | null): boolean {
	return !!el?.closest(EDITOR_ROOT) && !el.closest(HOST_CHROME);
}
