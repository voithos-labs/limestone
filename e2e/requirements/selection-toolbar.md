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
- Every button is pinned. The four wrapping toggles each put their own markers around the selected
  word in the bytes the save writes, and Link reaches the editor's link card. The document is the
  proof, not the button's own state: a toggle that lights up and writes the wrong marker still
  looks like it worked.
- Collapsing the selection takes the bar away, so it is only ever up while there is something for
  it to act on.

## Edge cases

- Source and reading modes float no bar at all. Both already show the syntax or refuse the edit.
- A selection spanning table cells floats no bar. The commands would fire against the cells' own
  coordinates rather than the text the reader highlighted. Text selected inside one cell is prose
  to the commands, so it floats the bar like a paragraph, and Bold wraps that text in place.
- Pressing a button keeps the document's selection alive, so the wrap lands on what was selected
  rather than on nothing. The bar takes no focus on the way down.
- A selection running across two blocks keeps the bar, anchored to the first block's line. A format
  toggle there marks every block the range touches (pinned on the bytes: both paragraphs come back
  bold), while Link greys out, since a link card cannot span blocks. Greyed, not hidden: the reader
  sees the affordance exists and that this selection cannot take it.
- A selection already inside a bold run shows Bold pressed, and the press lifts the selected word out
  of the run. The pressed paint and the press read the same bytes, so the two cannot disagree.

## Accepted

- The bar re-anchors when the selection changes, not while the document scrolls. A selection
  scrolled off-screen carries its bar off with it rather than pinning to the edge; re-anchoring on
  scroll would cost a measurement per frame to fix a position the reader has already left.
- The intra-table exclusion asks the editor what kind of block the selection starts in. The flag on
  a selection endpoint cannot answer this on its own: an intra-table selection shares the table's
  path and carries cell-valued offsets on endpoints that are never flagged.
- Journal and flow entries do float the bar, unlike the insert menu, which cannot appear there
  because it is drawn inside a header row those surfaces never render. The gate here is the mode
  alone, and those entries are live and editable, so the formatting they offer is worth reaching.
