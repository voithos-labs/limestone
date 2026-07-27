# Feature: the editor's presentation modes

Covers `mode-toggle.spec.ts`. The mode is per tab; `data-presentation` on `.editor` reports the
effective one, and is absent in source mode.

## User interactions

- Mod+E enters reading mode, and pressing it again leaves. Reading mode is the only mode control a
  journal entry has, so a one-way trip would strand the reader there.
- Leaving reading mode returns the reader to the editing mode they were in, not to a fixed one — a
  reader who chose source mode gets source mode back.
- That return holds however reading mode was entered (the chord or the toggle button) and however
  long ago: leaving the document and coming back does not forget it.

## Edge cases

- The editor's own chords do not fire while a text field in the chrome has focus. Renaming a
  document is typing, and `Ctrl+E` in the title field belongs to the field, not to the editor.
