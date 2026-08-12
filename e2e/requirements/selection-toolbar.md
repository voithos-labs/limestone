# Feature: the selection toolbar

Covers `selection-toolbar.spec.ts`. Selecting text in live mode floats a small bar above it — bold,
italic, strikethrough, code, link. It is a live-mode affordance for the same reason the insert menu
is: live paints no syntax, so there is nothing on screen to type the asterisks around, and clicking
is the only way to reach the formatting the other modes show you outright.

Every button asks the editor to run a command it already owns. Nothing here fakes a keystroke.

## Happy paths

- Selecting text in live mode floats the bar above the selection's first line. Pinned twice: that
  the bar is on screen, and that it sits near the top of the block that was selected — visibility
  alone would pass a bar anchored to the wrong corner of the window.
- Bold wraps the selection, and the `**`s land in the bytes the save writes. The document is the
  proof, not the button's own state.
- Collapsing the selection takes the bar away, so it is only ever up while there is something for
  it to act on.

## Edge cases

- Source and reading modes float no bar at all. Both already show the syntax or refuse the edit.
- An intra-table cell selection floats no bar. The commands would fire against a cell's own
  coordinates rather than the text the reader highlighted.
- Pressing a button keeps the document's selection alive, so the wrap lands on what was selected
  rather than on nothing. The bar takes no focus on the way down.
- A selection running across two blocks anchors the bar to the first block of the range, not to
  whichever end the reader happened to finish on. Both drag directions are covered, and the
  backward one is the test that can tell the difference: dragged upward, the end the reader
  finished on is the earlier one, so a bar that simply took the starting endpoint lands a block low.
  Crossing out of a paragraph takes two arrow presses, the first reaching only its own far edge.

## Accepted

- The bar re-anchors when the selection changes, not while the document scrolls. A selection
  scrolled off-screen carries its bar off with it rather than pinning to the edge; re-anchoring on
  scroll would cost a measurement per frame to fix a position the reader has already left.
- The intra-table exclusion reads whether the focused element sits inside a table. The flag on a
  selection endpoint cannot answer this on its own: an intra-table selection shares the table's
  path and carries cell-valued offsets on endpoints that are never flagged. This stands until the
  editor offers a way to ask what kind of block a path holds.
- Journal and flow entries do float the bar, unlike the insert menu, which cannot appear there
  because it is drawn inside a header row those surfaces never render. The gate here is the mode
  alone, and those entries are live and editable, so the formatting they offer is worth reaching.
