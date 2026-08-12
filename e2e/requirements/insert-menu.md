# Feature: the insert menu

Covers `insert-menu.spec.ts`. A `+` beside the mode toggle drops a structure at the caret — table,
code block, callout, details, math block, diagram, divider. It is a live-mode affordance: source
mode shows the syntax to copy from, reading mode takes no edits, and only in live is a table
something the reader has no way to see the shape of before typing it.

## Happy paths

- The `+` sits beside the mode toggle whenever the document is in live mode.
- Clicking it opens the app's menu, listing one entry per structure.
- Choosing Table drops a canonical table at the caret and it renders as a table, not as the
  pipes and dashes it is written with.
- Choosing Details drops the HTML disclosure the editor actually parses, so the reader gets a
  real details block rather than a lookalike box.
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

- Flow and journal surfaces render no chrome row, so they carry no insert menu. Their entries are
  short by design and the mode control they do have is reading, not live.
- The shared menu closes before it runs the chosen action, so a declined insert cannot leave the
  menu hanging open. The reader sees the menu dismiss either way and reads the document, not the
  menu, to know whether anything landed.
