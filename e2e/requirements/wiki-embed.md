# Feature: Obsidian-style `![[…]]` image embeds

Covers `wiki-embed.spec.ts`. Notes written by limestone's previous editor — and by
Obsidian — carry image embeds as `![[image.png]]`, optionally sized as
`![[image.png|300]]`. Those bytes are not GFM, so the embedded aragonite editor parses
them as ordinary text; `src/components/editor/wiki-embed-plugin.ts` is what makes them
render as images again after the editor swap.

The plugin renders them as a **replace decoration**: a view-only island layered over the
prose, never a node in the syntax tree. That is what keeps the bytes byte-identical on
disk, and it is also why the scenarios below split into a pure-scan half (the recognizer
in `wiki-embed-scan.ts`, exercised directly) and a rendered half (the decoration island
in a mounted editor).

Image targets resolve through a per-instance plugin option the host supplies — the same
resolver the editor's `resolveImageUrl` prop gets — so a target that resolves to nothing
must not be replaced.

## Happy paths

- `![[cat.png]]` in a paragraph renders as an image whose source is what the host's
  resolver returned for `cat.png`.
- `![[cat.png|300]]` renders that image at width 300.
- An embed inside a heading renders over its own bytes, which the `#` markers have
  already shifted — the offsets the plugin reports count from the block's source, not
  from its displayed content.
- Two embeds in one block each cover their own bytes.
- Surrounding text keeps its own formatting: `text **bold** ![[cat.png]] more` renders
  the embed without disturbing the emphasis beside it.

## Edge cases

- `![[notes.md]]` stays literal text: the target's extension is not an image one, which
  is the same gate the previous editor applied.
- `![[cat.png]]` inside a fenced code block stays literal text — code carries no inline
  content.
- An unterminated `![[cat.png` stays literal text, and an embed later in the same block
  still renders.
- `![[` and `]]` on different lines do not pair: an embed never spans a line ending.
- `![[]]` and `![[|300]]` stay literal text — an empty target resolves to nothing.
- `![[cat.png|abc]]` renders at the image's natural width; a non-numeric size modifier is
  ignored rather than treated as a target.
- A target the host's resolver declines (an image beside no source, an unknown scheme)
  stays literal text rather than rendering a broken image.
- A GFM image, `![alt](cat.png)`, keeps rendering through the editor's own image
  pipeline — the plugin claims neither its bytes nor its behavior.

## User interactions

- Typing elsewhere in a document that contains an embed: `getSource()` still holds the
  literal `![[cat.png]]` bytes, and the editor logs no complaint about the island — not
  that its span disagrees with the bytes it displaced, nor that it was skipped.
- Typing text immediately before an embed: the embed keeps rendering, over the bytes at
  their new offsets.
- Arrowing across an embed: the caret steps over it in one press, as it does over the
  editor's own image widgets.
- Selecting a range that spans an embed and copying it: the clipboard carries the literal
  `![[cat.png]]` bytes.
- Pasting an image into the editor inserts `![[…]]` (the import hook's format) and it
  renders immediately, with no reload.

## Verifiable now vs deferred

Task 3 owns the plugin; Task 4 is what first mounts an editor in the app. Everything
above is pinned by `wiki-embed.spec.ts` at Task 3 except where noted, but the spec drives
an editor it mounts itself in a bare page rather than the app's document view:

- **Pinned now, against the recognizer directly:** every Edge case that turns on whether
  bytes are claimed (extension gate, unterminated, line ending, empty target, non-numeric
  size), plus the offsets two embeds in one block occupy.
- **Pinned now, against a mounted editor:** rendering, width, heading offsets, resolver
  decline, the code fence, neighbouring inline constructs, GFM images, and both editing
  scenarios (before the embed and in another block).
- **Deferred to Task 6:** everything that needs the app around the editor — caret and
  copy behavior through the real document view, paste-image, and the interaction between
  an embed and the app's own save/restore. Task 6 re-homes these against the app rather
  than a bare mount.

One scenario is pinned but not enforced by this plugin: an embed inside a code fence
stays literal because the editor layers no islands over a code block at all, so the
plugin's own prose gate is belt-and-braces. The scenario stays — it is what a reader
of a note cares about — but a regression would come from the editor, not from here.

## Known deltas from the CodeMirror editor

Recorded here so Task 6 pins the behavior that shipped, not the behavior that was:

- Backspace or Delete beside an embed no longer selects it first. The old editor bound
  those chords specially; a decoration island is atomic, so a single press removes the
  whole embed. Aragonite's own image widgets select first — matching that needs the
  embed to be a real inline node, which is blocked upstream (see the plugin's header).
- The source is never revealed under the caret. The old editor swapped the image back to
  `![[…]]` text while the caret was inside it; aragonite renders its own images as
  widgets in every presentation mode, and the embed now follows that rule. Editing a
  target means deleting the embed and retyping it.

And one divergence from the editor rather than from the old one:

- Inside a table cell an embed still renders as an image, where a GFM image in that same
  cell renders as its alt text — the editor turns image widgets off for cells and the
  plugin does not follow it there. Keeping a note's tables looking the way they did won
  over matching the editor's own rule.
