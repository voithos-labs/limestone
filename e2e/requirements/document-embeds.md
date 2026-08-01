# Feature: `![[…]]` embeds inside a real document

Covers `document-embeds.spec.ts` — the half of `wiki-image-embeds.md` that needs the app around
the editor: the host's image resolver, the clipboard, the save path, and the asset importer.

The asset URLs the app mints are answerable only by the Tauri webview, so the spec serves them
itself: a broken image has no height, and clicking one or reading its size needs one.

## Happy paths

- An embed renders as the editor's own image, at the URL the app resolves against the source's
  asset folder, and the `![[…]]` bytes are nowhere on screen.
- A `|300` modifier is the width it renders at; without one it renders at the image's own size.

## User interactions

- Arrowing onto an embed selects it whole; the next press deletes it, and the saved document
  loses exactly those bytes.
- Copying a selection that spans an embed puts the literal `![[…]]` bytes on the clipboard, so a
  paste into another note — or another app — carries the embed rather than an image widget.
- Editing elsewhere in the document leaves the embed's bytes untouched, and it still renders when
  the reader comes back to the tab.
- Pasting an image imports it into the source and inserts the embed the importer's path yields,
  rendered immediately. What reaches the importer is asserted, not just that it was called: the
  source, the extension, and the bytes' length.

## Editing an embed keeps it an embed

The built-in way back from an image node is GFM; the plugin's own rewrite is what keeps a note in
the syntax it was written in. `wiki-image-embeds.md` carries the reasoning.

- Resizing a selected embed writes the new width in the note's own syntax: `![[cat.png|300]]`
  becomes `![[cat.png|320]]`, not `![cat.png|320](cat.png)`. A note edited here still resolves in
  Obsidian.
- Retargeting an embed from the popover's URL row rewrites the target and nothing else: an embed
  that carried no width does not come back wearing one. Its alt is derived from the target rather
  than stored, so an alt still reading as the old target is stale, not authored, and re-derives.
- An alt an embed cannot carry is declined rather than escaped into GFM: typing one into the
  properties popover commits nothing, and the bytes stay as the author wrote them. The decline is
  asserted from what the editor reports, because bytes alone cannot tell a declined edit from one
  that was quietly ignored and dropped by the commit's equality guard.

## Accepted

- An embed whose image fails to load leaves a 0×0 gap where it sits. aragonite caches the failure
  at once, but the widget already in the DOM is never redecorated, so the "⚠ image failed to load"
  placeholder appears only when something re-renders that block (a mode round-trip does). It is a
  render behind rather than mode-gated: a reader opening a note with a missing image sees nothing.

## Deferred

- An embed whose target the app cannot resolve: the app mints an asset URL for any image
  extension, so "unresolvable" is a fetch that fails, not a different render. `boot.md` already
  pins what that costs — a console error the harness must not count as the app's.
