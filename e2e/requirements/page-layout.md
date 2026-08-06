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
- The chord needs no click to wake it: a document that has just opened already holds the caret, and
  zooming works straight away. The chord is handled on the wrapper around the editor, so this is
  the one thing that decides whether a reader who has not touched the document can zoom it.

## Accepted

- Zoom belongs to the document editor alone: on the library page, in a view tab, or in a journal
  entry nobody has clicked into yet (flow mode deliberately places no caret), Mod+= does nothing.
  The app's own scale is a setting, `appearance.ui_scale_percent`, with no chord.
- In the packaged Windows app the browser claims Mod+= and Mod+- before the page does: WebView2
  handles them as browser accelerators ahead of the web content, and Tauri leaves that on while
  turning WebView2's own zoom off. Playwright dispatches straight into the page, so the zoom
  scenarios above pin the app's half only. Same mechanism as `keybindings.md` § Accepted.
- With the document at the top, the open find bar covers the hero's metadata row: aragonite sticks
  its search anchor to the top of the scrollport and the app renders the hero into that same
  scrollport. Transient, and the alternative is worse — offsetting the anchor by the header's
  height unsticks it, which is what makes it findable mid-document.
