# Feature: the insert menu

Covers `insert-menu.spec.ts`. A `+` beside the mode toggle drops a structure at the caret — table,
code block, callout, details, math block, diagram, divider. It is a live-mode affordance: source
mode shows the syntax to copy from, reading mode takes no edits, and only in live is a table
something the reader has no way to see the shape of before typing it.

## Happy paths

- The `+` sits beside the mode toggle whenever the document is in live mode.
- Clicking it opens the app's menu, listing one entry per structure.
- Every entry drops its structure at the caret and it renders as that structure, not as the
  characters it is written with. Each is pinned twice: by the class its block renders under, so a
  snippet parsing into a lookalike box is caught, and by the bytes the save writes.
- An insert is one undo step: once it has been saved, a single `Ctrl+Z` puts the file back to the
  byte it started at. Undone inside the save window it writes nothing at all, which is the same
  outcome by a shorter road.

## Edge cases

- Source and reading modes carry no `+` at all — not a disabled one, since neither mode has an
  insert to offer.
- Clicking a menu entry inserts at the caret the document had before the menu opened. Opening the
  menu takes focus off the document, so the caret is snapshotted on the way in and put back before
  the insert runs; without it the editor declines an insert with no caret to insert at.

## Accepted

- Flow and journal surfaces render no chrome row, so they carry no insert menu. Their documents
  still run live and stay editable; the missing menu is the missing row, not a mode.
- The shared menu closes before it runs the chosen action, so a declined insert cannot leave the
  menu hanging open. The reader sees the menu dismiss either way and reads the document, not the
  menu, to know whether anything landed.
