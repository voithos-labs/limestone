# Feature: a document tab remembers where you left off

Covers `tab-state.spec.ts`. Leaving a document tab destroys its editor; coming back mounts a new
one. Everything a reader expects to survive that — caret, scroll, zoom, the panels they opened —
lives on the tab in `state.json` and is handed to the new editor on mount. What the tab refuses
to remember is `stale-tab-state.md`'s.

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

  Two writers correct the same scroll: this restore sets an absolute position, and the editor's
  own compensation for a growing header adds a relative delta. Persisting relative to where the
  blocks begin is what makes them agree. The scenario asserts the header genuinely settled late —
  no panel inside the editor when it entered the DOM, a material one afterwards — because a
  fixture whose panel loaded first would pass while pinning nothing.

- **A block whose own height settles after the editor has painted.** A diagram renders after mount,
  and so do display math and an image that resolves. The measure pass that follows must leave the
  restore alone: a document with a remembered position keeps it, and one with none opens showing
  its own title rather than scrolled past it to the block the caret was placed in.

  Where the diagram sits decides what each scenario can assert. Below the reader, their position
  is untouched to the pixel. Above them, the editor deliberately moves `scrollTop` to hold the
  block under their eyes still — right, but not a number a scenario can pin — so the
  remembered-position case puts the diagram at the end and the opens-at-the-top case puts it first.

  This rests on aragonite's contract: `setSelection`'s reveal owns the viewport while it runs and
  hands it back when it resolves. A reveal whose pin outlived the call would let the diagram's
  measure pass re-assert the caret's block over the scroll this restore had just written.
