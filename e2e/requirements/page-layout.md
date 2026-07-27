# Feature: how large the document renders

Covers `page-layout.spec.ts`. Two app-owned measurements reach the embedded editor through
`src/components/editor/editor-tokens.css`: the width of the page column every limestone surface
shares, and the reader's own zoom. Colour is the other half of that bridge and lives in
`theming.md`.

## Happy paths

- The block column is centered in the editor and no wider than the app's page width, so a document
  lines up with the library and view pages beside it.
- The mode toggle takes that same column: its last button ends on the document's right edge, and
  follows it when the reader changes the page width. It is chrome the app renders into the editor's
  header slot, so nothing else would hold it to the column the hero and the text share.

## User interactions

- Changing the page width in settings and returning to the document: the column takes the new
  width. The editor has no page-width notion of its own — the number the reader sets is the one
  the document is laid out to.
- Zooming with Mod+= / Mod+-: the editor's font-size token follows, and the document's text is
  rendered at it. Zoom is per tab rather than a setting, so it is the tab's to remember.
