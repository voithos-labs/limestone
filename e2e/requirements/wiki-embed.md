# Feature: Obsidian-style `![[…]]` image embeds

Covers `wiki-embed.spec.ts`. Notes written by limestone's previous editor — and by
Obsidian — carry image embeds as `![[image.png]]`, optionally sized as
`![[image.png|300]]`. Those bytes are not GFM, so the embedded aragonite editor parses
them as ordinary text; `src/components/editor/wiki-embed-plugin.ts` is what makes them
render as images again after the editor swap.

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
- A target that resolves to nothing renders as the editor's broken-image treatment, the
  same as a GFM image pointing at a missing file. The plugin has no resolver of its own to
  decline with, so nothing falls back to literal text.

## User interactions

- Typing elsewhere in a document that contains an embed: `getSource()` still holds the
  literal `![[cat.png]]` bytes.
- An embed inside a table cell keeps its bytes exactly, through a mount and a read back.
- Arrowing onto an embed selects it whole, and a further press deletes it — the editor's
  image behavior, which the previous editor emulated with its own key handlers.
- Resizing a selected embed rewrites its `|width` modifier, a capability the previous
  editor did not have.
- Selecting a range that spans an embed and copying it: the clipboard carries the literal
  `![[cat.png]]` bytes.
- Pasting an image into the editor inserts `![[…]]` (the import hook's format) and it
  renders immediately, with no reload.

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
- **Deferred to Task 6:** everything that needs the app around the editor — caret,
  select-then-delete, resize, and copy through the real document view; paste-image; and an
  embed's interaction with the app's own save/restore.

One scenario is pinned but not enforced by this plugin: an embed inside a code fence stays
literal because a code block has no inline content for the scanner to run over. The
scenario stays — it is what a reader of a note cares about — but a regression would come
from the editor, not from here.

## Known deltas from the CodeMirror editor

- The source is never revealed under the caret. The old editor swapped the image back to
  `![[…]]` text while the caret was inside it; aragonite renders its own images as widgets
  in every presentation mode, and the embed now follows that rule. Editing a target means
  selecting the embed and retyping it.
- Inside a table cell an embed does not render as an image, and its source displays
  garbled — `![[cat.png]]` shows as `![cat.pngg]]`. A cell is the one place the editor
  renders images as alt text rather than widgets, and that fallback rebuilds the displayed
  source assuming the alt begins two characters into the node, as a GFM image's does. The
  character count still matches the source exactly, so offsets and bytes are unaffected;
  only the glyphs are wrong. Rendering an embed's own source verbatim there is an upstream
  fix, not a limestone one.
