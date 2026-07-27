# Feature: `![[…]]` embeds inside a real document

Covers `document-embeds.spec.ts` — the half of `wiki-embed.md` that needs the app around the
editor: the host's own image resolver, the clipboard, the save path, and the asset importer.
`wiki-embed.spec.ts` owns the recognizer and the parse, which need no app.

The asset URLs the app mints are answerable only by the Tauri webview, so the spec serves them
itself. A broken image has no height, and half of what a reader does with an embed — click it,
see its size — is unobservable without one.

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

## Known deltas from the CodeMirror editor

Recorded rather than desired; the fixes are upstream in the editor. `wiki-embed.md` carries the
reasoning, this file the scenario that pins today's behavior.

- **Editing a selected embed rewrites it as GFM.** `![[cat.png|300]]` becomes
  `![cat.png|320](cat.png)`, and the Obsidian syntax is gone from the note. Pinned so the day it
  changes upstream is a red test rather than a surprise.

## Deferred

- An embed whose target the app cannot resolve: the app mints an asset URL for any image
  extension, so "unresolvable" is a fetch that fails, not a different render. `boot.md` already
  pins what that costs — a console error the harness must not count as the app's.
