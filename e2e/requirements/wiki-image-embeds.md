# Feature: Obsidian-style `![[…]]` image embeds

Covers `wiki-image-embeds.spec.ts`. Notes written by limestone's previous editor — and by
Obsidian — carry image embeds as `![[image.png]]`, optionally sized as `![[image.png|300]]`.
Those bytes are not GFM, so `src/components/editor/wiki-image-embeds-plugin.ts` is what makes
them render as images again. `![[note.md]]`, Obsidian's note transclusion, is deliberately
unclaimed — hence the narrow name.

The plugin mints a **built-in `image` inline node**, so an embed is an image to the whole editor:
`resolveImageUrl` resolves it, the image widget renders it, and selecting, resizing and deleting
behave as they do for `![alt](url)`.

Its rung is consulted **before** the built-in bracket scanner, and the grammars overlap —
`![[a]](u)` is a legal GFM image with alt `[a]`. Declining the overlap is the recognizer's job,
and getting it wrong is silent: the bytes still serialize, they just stop being the construct the
author wrote. Hence the two decline gates below are pinned as hard as the happy paths.

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
- A target that resolves to nothing is still an image node, not literal text: the plugin has no
  resolver of its own to decline with, so the gate is the extension alone. What a reader is shown
  for one is measured in `document-embeds.md` § Accepted.

## User interactions

- Typing elsewhere in a document that contains an embed: `getSource()` still holds the
  literal `![[cat.png]]` bytes.
- An embed inside a table cell keeps its bytes exactly, through a mount and a read back.

Selecting, deleting, copying and pasting an embed are the app's to answer, not the
plugin's; they are `document-embeds.md`'s.

## Which layer pins what

The spec mounts its own editor in a bare page and prefers the parse layer wherever a scenario is
decidable there:

- **The recognizer directly:** every case that turns on whether bytes are claimed — extension
  gate, the `(` gate, unterminated, line ending, empty target, non-numeric size, nested opener,
  scan window.
- **A parse with the plugins installed:** node shape and offsets, width, heading offsets, two
  embeds in one block, neighbouring constructs, and both overlap fixtures as built-in images.
- **A mounted editor:** the image widget and its resolved URL, the code fence, a table cell's
  bytes, and round-trip after an edit elsewhere.
- **The running app, in `document-embeds.md`:** caret, select-then-delete and copy through the
  real document view; paste-image; the host's resolved URL; survival of a save and reopen.

The code-fence scenario is pinned here but enforced by the editor, not this plugin: a code block
has no inline content for the scanner to run over. It stays because it is what a reader cares
about, but a regression would come from upstream.

## Why the plugin owns the way back

An `image` node records nothing of the syntax it was parsed from, so every read path can treat an
embed as an image but no write path can: the built-in inverse emits GFM, and re-serializing an
edited embed would bring it back as `![cat.png|320](cat.png)`.

That is the rewrite hook's job, and why it declines as readily as it writes: an embed holds a
target and an optional width, so an edit needing anywhere else to live has no form here. Both
halves are pinned in `document-embeds.md` — a resize commits `![[cat.png|320]]`, an alt edit
commits nothing.

## Known deltas from the CodeMirror editor

- The source is never revealed under the caret. The old editor swapped the image back to
  `![[…]]` text while the caret was inside it; aragonite renders its own images as widgets
  in every presentation mode, and the embed now follows that rule. Editing a target means
  selecting the embed and retyping it.
