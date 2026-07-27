# Feature: Obsidian-style `![[…]]` image embeds

Covers `wiki-image-embeds.spec.ts`. Notes written by limestone's previous editor — and by
Obsidian — carry image embeds as `![[image.png]]`, optionally sized as
`![[image.png|300]]`. Those bytes are not GFM, so the embedded aragonite editor parses
them as ordinary text; `src/components/editor/wiki-image-embeds-plugin.ts` is what makes them
render as images again after the editor swap.

Named for what it handles and nothing more: `![[…]]` wrapping an image is the whole of it, and
`![[note.md]]` — Obsidian's transclusion of another note — is a separate feature this deliberately
leaves unclaimed. A plugin called `wiki-embed` would have read as owning both.

The plugin registers `![[` as inline syntax and mints a **built-in `image` inline node**.
An embed is therefore an image to the whole editor, not just to the eye: the editor's own
`resolveImageUrl` resolves it, its image widget renders it, and selecting, resizing and
deleting behave as they do for `![alt](url)`. The plugin resolves no URLs itself.

That rung is consulted **before** the built-in bracket scanner, and the two grammars
overlap — `![[a]](u)` is a legal GFM image whose alt text is `[a]`. Declining the overlap
is the recognizer's job, and getting it wrong is silent: the bytes still serialize, they
just stop being the construct the author wrote. Hence the two decline gates below, and
hence they are pinned as hard as the happy paths.

## Happy paths

- `![[cat.png]]` parses as an image node covering exactly those bytes, with the target as
  both its URL and its alt text.
- `![[cat.png|300]]` carries width 300 on the node.
- An embed inside a heading reports offsets counted from the block's source, markers
  included — not from its displayed content.
- Two embeds in one block each cover their own bytes.
- Surrounding text keeps its own formatting: `text **bold** ![[cat.png]] more` parses as
  text, strong, text, image, text.
- A rendered embed reaches the DOM through the editor's own image widget, carrying the
  URL the host's `resolveImageUrl` returned.

## Edge cases

- `![[notes.md]]` stays literal text: the target's extension is not an image one, which
  is the same gate the previous editor applied.
- `![[a]](u)` stays a built-in image with alt `[a]` — the recognizer declines because the
  target has no image extension.
- `![[a.png]](u)` stays a built-in image with alt `[a.png]` — the extension gate would let
  this one through, so the recognizer also declines when a `(` follows the `]]`, which is
  exactly when the built-in scanner has an inline image to parse.
- `![alt](cat.png)` parses exactly as it did before the plugin existed.
- `![[cat.png]]` inside a fenced code block stays literal text — code carries no inline
  content.
- An unterminated `![[cat.png` stays literal text, and an embed later in the same block
  still renders.
- `![[` and `]]` on different lines do not pair: an embed never spans a line ending.
- `![[]]` and `![[|300]]` stay literal text — an empty target is not an image path.
- `![[cat.png|abc]]` renders at the image's natural width; a non-numeric size modifier is
  ignored rather than treated as a target.
- An embed whose closing `]]` lies outside the scanner's window is declined rather than
  claimed past it.
- A target that resolves to nothing is still an image node, not literal text: the plugin has
  no resolver of its own to decline with, so the gate is the extension alone. What the reader
  is shown for one is measured behavior rather than this file's to state — see
  `document-embeds.md` § Accepted, which records a 0×0 gap rather than the broken-image
  placeholder this bullet claimed before it was measured.

## User interactions

- Typing elsewhere in a document that contains an embed: `getSource()` still holds the
  literal `![[cat.png]]` bytes.
- An embed inside a table cell keeps its bytes exactly, through a mount and a read back.

Selecting, deleting, copying and pasting an embed are the app's to answer, not the
plugin's; they are `document-embeds.md`'s.

## Verifiable now vs deferred

Task 3 owns the plugin; Task 4 is what first mounts an editor in the app. The spec drives
an editor it mounts itself in a bare page rather than the app's document view, and it
prefers the parse layer wherever a scenario is decidable there:

- **Pinned now, against the recognizer directly:** every case that turns on whether bytes
  are claimed — extension gate, the `(` gate, unterminated, line ending, empty target,
  non-numeric size, nested opener, scan window.
- **Pinned now, against a parse with the plugins installed:** node shape and offsets,
  width, heading offsets, two embeds in one block, neighbouring constructs, and both
  overlap fixtures resolving to built-in images.
- **Pinned now, against a mounted editor:** the image widget and its resolved URL, the
  code fence, a table cell's bytes, and round-trip after an edit elsewhere.
- **Pinned against the running app, in `document-embeds.md`:** everything that needs the
  app around the editor — caret, select-then-delete, and copy through the real document
  view; paste-image; the host's resolved URL; and an embed's survival of the app's own
  save and reopen. The editing delta below is pinned there too: the deltas are what that
  spec records, not the parity they replaced.

One scenario is pinned but not enforced by this plugin: an embed inside a code fence stays
literal because a code block has no inline content for the scanner to run over. The
scenario stays — it is what a reader of a note cares about — but a regression would come
from the editor, not from here.

## Why the plugin owns the way back

An `image` node carries no record of the syntax it was parsed from. Every read path can
therefore treat an embed as an image — which is the point — but no write path can: the
editor's inverse for a built-in kind emits that kind's built-in grammar, so re-serializing
an edited embed would bring it back as `![cat.png|320](cat.png)` and the syntax the note
was written in would be gone.

That is what the rung's rewrite hook is for, and it is why the hook must decline as
readily as it writes: an embed holds a target and an optional width, so an edit that needs
anywhere else to live has no form here, and the editor suppresses it rather than writing
bytes this plugin did not author. Both halves are pinned against a real document in
`document-embeds.md` — a resize commits `![[cat.png|320]]`, an alt edit commits nothing.

## Known deltas from the CodeMirror editor

- The source is never revealed under the caret. The old editor swapped the image back to
  `![[…]]` text while the caret was inside it; aragonite renders its own images as widgets
  in every presentation mode, and the embed now follows that rule. Editing a target means
  selecting the embed and retyping it.
