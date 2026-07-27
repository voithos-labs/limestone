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

- Mod+E steps one mode along, in the order the toggle offers them — source, live preview, reading —
  and wraps, so three presses land back where they started. Reading mode is the only mode control a
  journal entry has, so a step that could not come back round would strand the reader there.
- The step follows the mode the reader is in, not the one they came from: reading mode entered by
  clicking the toggle steps on to source, exactly as it does when the chord put them there. The
  cycle keeps no memory, which is what lets the chord and the buttons be used interchangeably.
- A tab keeps its mode however long ago it was set — leaving the document and coming back does not
  forget it — and the next Mod+E goes on from there.
- Changing the mode changes only the mode. A reader deep in a long entry stays exactly where they
  were reading, both ways through the trip — a mode toggle that lost their place would be worse
  than no toggle on an entry long enough to need one.

## Edge cases

- The editor's own chords do not fire while a text field in the chrome has focus. Renaming a
  document is typing, and `Ctrl+E` in the title field belongs to the field, not to the editor.

## Miss analysis

The stays-where-they-were scenario is driven by the chord, not by clicking the toggle, and the
distinction is the whole scenario. The toggle rides in the header, which on a scrolled document is
off-screen; a `locator.click()` on it scrolls it into view before clicking, so the reading lands at
the top of the document whatever the app does. A version of this scenario written that way reports a
scroll reset that nothing in either codebase performs.

## Accepted

- A task item keeps its literal `[ ]` / `[x]` glyphs — in live preview and in reading alike —
  rather than swapping them for a checkbox control. They are not inert text: aragonite wraps the
  glyphs in a `role="checkbox"` span carrying `aria-checked`, and clicking one in live preview
  toggles it. But a reader expecting a real box will not find one.
