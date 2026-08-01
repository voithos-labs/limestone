/**
 * What the document editor claims off the keyboard, so the window-level shortcut handler can
 * stand down for it. That handler runs in the capture phase and stops what it takes, so without
 * this the app silently wins every collision — Mod+I opened settings instead of italicizing.
 *
 * Both halves are read out of aragonite, neither being derivable at runtime: the editor exposes
 * no chord list, and its focus boundary is keyed on an element the host cannot reach.
 */

// ── Chords the editor claims ─────────────────────────────────────────────────

/**
 * Read off aragonite 0.9.36 and the plugins limestone mounts: the block-kind and editor-global
 * keymaps, the search UI's reserved pair, the cell-arrow and staged select-all handlers that sit
 * outside the keymaps, the plugin chords, and this adapter's own chrome in `DocumentEditor.svelte`.
 * Re-check when the editor dependency moves.
 *
 * Modifier-carrying chords only: an app shortcut on a bare typing key is broken whatever this set
 * says. Over-reserving only costs an app shortcut inside a document, under-reserving loses an
 * editor feature — so err long.
 *
 * On macOS the editor folds Ctrl and Cmd into one modifier and `specFromEvent` does not; ledgered
 * with the reason it is not fixed here in `e2e/requirements/keybindings.md`.
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
 * Class names the editor mints, neither of them contract — the editor declines to key its own
 * copy on `.editor-header` precisely because a host could mint a node by that name. `.editor` is
 * load-bearing a second time, in the `EDITABLE` selector in `+page.svelte`.
 */
const EDITOR_ROOT = '.editor';
const HOST_CHROME = '.editor-header';

/**
 * Whether focus sits where the editor routes chords: inside its root but outside the header slot,
 * which is the editor's own boundary — so renaming a document in the title field keeps the app's
 * shortcuts. Narrower than `inEditable` on purpose: reserving chords in every text field would
 * take them from quick search, the settings pane and the view editors.
 */
export function inEditorContent(e: KeyboardEvent): boolean {
	const target = e.target instanceof Element ? e.target : null;
	const active = document.activeElement;
	return isEditorContent(target) || isEditorContent(active);
}

function isEditorContent(el: Element | null): boolean {
	return !!el?.closest(EDITOR_ROOT) && !el.closest(HOST_CHROME);
}
