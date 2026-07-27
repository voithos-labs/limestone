# Feature: the editor's presentation modes

Covers `mode-toggle.spec.ts`. The mode is per tab; `data-presentation` on `.editor` reports the
effective one, and is absent in source mode.

What each mode does with a document's markers is asserted against rendered text, not the DOM's:
a collapsed marker stays in `textContent`, so only `innerText` says what the reader sees.

## Happy paths

- A document opens in live preview: markers are out of the way except in the block holding the
  caret, which shows its own so the reader can edit them.
- Source mode shows every marker the file is written with.
- Reading mode shows none of them and takes no typing — it is the one mode where the document is
  inert.

## Modes a document opens in

- A fresh document opens in the mode the reader chose as their default.
- A tab that already remembers a mode keeps it: the setting seeds a document that has no memory,
  it does not overrule one that does.

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
