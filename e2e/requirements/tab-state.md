# Feature: a document tab remembers where you left off

Covers `tab-state.spec.ts`. Leaving a document tab destroys its editor; coming back mounts a new
one. Everything a reader would expect to survive that — caret, scroll, zoom — lives on the tab in
`state.json`, and the new editor is handed it on mount.

## User interactions

- Placing the caret mid-document, switching to another tab and back: the caret is where it was, and
  typing carries on from there rather than from the top of the document.
- Scrolling down, switching away and back: the document is at the same place, within a couple of
  pixels of rounding.
- Zooming with Mod+= and switching away and back: the document keeps the size the reader set. Zoom
  is per tab, so the other document is unaffected by it.

## Edge cases

- **A header that finishes settling after the editor has painted.** A document whose properties
  panel is open has a header that grows once the panel's fields load — after the editor mounted and
  after the tab's scroll position was restored. The reader still lands exactly where they left, not
  the panel's height below it.

  Two writers correct the same scroll here: this restore, which sets an absolute position, and the
  editor's own compensation for a header that grows under a scrolled reader, which adds a relative
  delta. Persisting the position relative to where the blocks begin — rather than as a raw
  `scrollTop` — is what makes them agree. The scenario asserts the header genuinely settled late,
  because a fixture whose panel happened to load first would pass while pinning nothing.

## Error cases

- A tab carrying `cursorPos` from the previous editor restores without error: that number
  addresses a flat character offset, which means nothing against a tree of blocks, so it is
  ignored and the document opens at the top, typable.
