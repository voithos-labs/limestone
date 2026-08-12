# Feature: the editor's presentation modes

Covers `mode-toggle.spec.ts`. The mode is per tab; `data-presentation` on `.editor` reports the
effective one, and is absent in source mode.

What each mode does with a document's markers is asserted against rendered text, not the DOM's:
a collapsed marker stays in `textContent`, so only `innerText` says what the reader sees.

## Happy paths

- A document opens in live: the markers the file is written with never show, not even in the block
  the caret is sitting in. The document reads as a document and still takes typing.
- Source mode shows every marker the file is written with.
- Reading mode shows none of them and takes no typing — it is the one mode where the document is
  inert.

## Modes a document opens in

- A fresh document opens in the mode the reader chose as their default.
- A tab that already remembers a mode keeps it: the setting seeds a document that has no memory,
  it does not overrule one that does.
- A tab that remembers `preview-inline`, the name the middle mode went by before, opens in live.
  The name changed; the reader's choice did not, and nobody's tab falls back to a default.
- A default-mode setting of `preview-inline` reads as live, and the stored value is rewritten to
  `live` as the app loads. Settings shows a name it no longer offers as the bare string, so a
  remap the editor keeps to itself would leave the reader looking at `preview-inline`.

## User interactions

- Mod+E steps one mode along, in the order the toggle offers them — source, live, reading — and
  wraps, so three presses land back where they started. Reading mode is the only mode control a
  journal entry has, so a step that could not come back round would strand the reader there.
- The step follows the mode the reader is in, not the one they came from: reading mode entered by
  clicking the toggle steps on to source, exactly as it does when the chord put them there. The
  cycle keeps no memory, which is what lets the chord and the buttons be used interchangeably.
- A tab keeps its mode however long ago it was set — leaving the document and coming back does not
  forget it — and the next Mod+E goes on from there.
- Changing the mode changes only the mode. A reader deep in a long entry stays exactly where they
  were reading, both ways through the trip — a mode toggle that lost their place would be worse
  than no toggle on an entry long enough to need one. Pinned but skipped for now: stepping out of
  reading scrolls the reader back to the caret (aragonite #155).

## Edge cases

- The editor's own chords do not fire while a text field in the chrome has focus. Renaming a
  document is typing, and `Ctrl+E` in the title field belongs to the field, not to the editor.

## Miss analysis

The stays-where-they-were scenario is driven by the chord, not by clicking the toggle. The toggle
rides in the header, off-screen on a scrolled document, so `locator.click()` scrolls it into view
first and the reading lands at the top whatever the app does — reporting a scroll reset that
nothing in either codebase performs.

## Accepted

- A task item keeps its literal `[ ]` / `[x]` glyphs in every mode rather than swapping them for a
  checkbox control. Not inert text — aragonite wraps them in a `role="checkbox"` span with
  `aria-checked`, and clicking one in live toggles it — but a reader expecting a real box will not
  find one.
