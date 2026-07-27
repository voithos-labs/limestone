/**
 * What the document editor claims off the keyboard, so the window-level shortcut handler can
 * stand down for it. The handler runs in the capture phase and stops what it takes, so without
 * this the app silently wins every collision — Mod+I opened settings instead of italicizing.
 *
 * Both halves are read from aragonite rather than guessed, and neither is derivable at runtime:
 * the editor exposes no chord list, and its focus boundary is keyed on an element the host
 * cannot reach. Re-check them when the editor dependency moves.
 */

// ── Chords the editor claims ─────────────────────────────────────────────────

/**
 * Verified against aragonite 0.9.35 and the plugins limestone mounts: the block-kind and
 * editor-global keymaps, the search UI's reserved pair, the table and block-selection handlers
 * that sit outside the keymaps, the admonition and mermaid plugin chords, and the adapter's
 * own chrome chords in `DocumentEditor.svelte`.
 *
 * Modifier-carrying chords only. The editor binds plain Enter/Tab/Backspace/Delete/Escape and
 * the bare arrows too, but an app shortcut on a bare typing key is broken whatever this set
 * says, and listing them is a drift surface for nothing.
 *
 * Membership costs nothing but an app shortcut inside a document: the guard's only move is to
 * return, so over-reserving can never reach native browser behaviour. Under-reserving is the
 * direction that loses an editor feature, so err long.
 *
 * On macOS the editor folds Ctrl and Cmd into one modifier and `specFromEvent` does not, so a
 * chord held with Ctrl reads as the editor's and not as this set's. Ledgered, with the reason
 * it is not fixed here, in `e2e/requirements/keybindings.md`.
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
	'mod+shift+a',
	'mod+c',
	'mod+x',
	'mod+shift+end',
	'mod+shift+home',
	// Block motion and hard line breaks
	'alt+arrowup',
	'alt+arrowdown',
	'shift+enter',
	'shift+tab',
	// Table rows, columns and cell motion
	'mod+enter',
	'mod+shift+enter',
	'mod+shift+backspace',
	'alt+arrowleft',
	'alt+arrowright',
	'alt+shift+arrowleft',
	'alt+shift+arrowright',
	'alt+shift+backspace',
	// Plugin chords: admonition kind, mermaid focus
	'mod+7',
	'mod+m',
	// The adapter's own chrome: reading toggle and zoom
	'mod+e',
	'mod+=',
	'mod+-'
]);

/** Takes what `specFromEvent` produces, null included, so a bare modifier press is not a chord. */
export function isEditorReservedChord(spec: string | null): boolean {
	return spec !== null && RESERVED.has(spec);
}

// ── Where the editor claims them ─────────────────────────────────────────────

/**
 * aragonite's root, and the slot within it that the host fills with its own chrome. Both are
 * class names the editor mints and neither is contract: the editor declines to key its own copy
 * on `.editor-header` precisely because a host could mint a node by that name. `.editor` is
 * load-bearing a second time, in the `EDITABLE` selector in `+page.svelte`.
 */
const EDITOR_ROOT = '.editor';
const HOST_CHROME = '.editor-header';

/**
 * Whether focus sits where the editor routes chords: inside its root but outside the header
 * slot. That is the editor's own boundary — it hands the whole keystroke back to the host when
 * focus is in the slot — so renaming a document in the title field keeps the app's shortcuts.
 *
 * Deliberately narrower than `inEditable`, which matches any text field on the page: reserving
 * chords there would take them from quick search, the settings pane and every view editor, none
 * of which the document editor can act in.
 */
export function inEditorContent(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	const active = document.activeElement;
	return isEditorContent(target) || isEditorContent(active);
}

function isEditorContent(el: Element | null): boolean {
	return !!el?.closest(EDITOR_ROOT) && !el.closest(HOST_CHROME);
}
