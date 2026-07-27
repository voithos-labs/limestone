# Feature: a document tab remembers where you left off

Covers `tab-state.spec.ts`. Leaving a document tab destroys its editor; coming back mounts a new
one. Everything a reader would expect to survive that — caret, scroll, zoom, the panels they
opened — lives on the tab in `state.json`, and the new editor is handed it on mount. What the tab
refuses to remember, because a previous editor wrote it, is `legacy-tab-state.md`'s.

## User interactions

- Placing the caret mid-document, switching to another tab and back: the caret is where it was, and
  typing carries on from there rather than from the top of the document.
- Scrolling down, switching away and back: the document is at the same place, within a couple of
  pixels of rounding.
- Zooming with Mod+= and switching away and back: the document keeps the size the reader set. Zoom
  is per tab, so the other document is unaffected by it.
- Opening the properties panel, switching away and back: it is still open. The panel's own state is
  the tab's, so the reader's choice outlives the editor that showed it.

## Edge cases

- **A header that finishes settling after the editor has painted.** A document whose properties
  panel is open has a header that grows once the panel's fields load — after the editor mounted and
  after the tab's scroll position was restored. The reader still lands exactly where they left, not
  the panel's height below it.

  Two writers correct the same scroll here: this restore, which sets an absolute position, and the
  editor's own compensation for a header that grows under a scrolled reader, which adds a relative
  delta. Persisting the position relative to where the blocks begin — rather than as a raw
  `scrollTop` — is what makes them agree. The scenario asserts the header genuinely settled late,
  by recording that no panel was inside the editor when it entered the DOM and that a material one
  is there afterwards; a fixture whose panel loaded first would otherwise pass while pinning
  nothing.
