# Feature: editing a document and writing it back

Covers `editor-save.spec.ts`. The app runs against the fake backend in
`e2e/support/tauri-mocks.ts`, so `getMockState(page).writes` is the record of what reached the
document-write command.

## Happy paths

- Opening a document places a caret: typing with no click at all reaches the document, and the
  edit is written back. The editor is usable the moment a note opens, the way a text field is.
- A document whose metadata lives in YAML frontmatter round-trips it: the editor edits the body
  alone, and the saved file still carries the frontmatter block and its custom keys.

## Edge cases

- An empty document is typable on open too — there is no first block to click.
- A fast burst of keystrokes settles on a write carrying all of them. It may take more than one
  write to get there: the editor commits the first character on its own and the rest on a debounce
  of its own, longer than this adapter's, so a burst crosses two save windows. Each write is a
  truthful snapshot of the document at that moment, so what a scenario pins is the settled content,
  never the number of writes.

## Known deltas from the CodeMirror editor

Neither is enforced by a scenario above; both are recorded so a reader does not mistake them
for regressions.

- **No placeholder.** The old editor showed `Start writing...` in an empty document. aragonite
  exposes no placeholder prop, so an empty note renders one empty paragraph and nothing else.
  Closing it means an affordance in the editor rather than a port.
- **Clicking the empty space below the last block places no caret.** The old editor put the caret
  at the end of the document; aragonite's padding click focuses its root instead, which — as with
  a freshly opened document — establishes no caret. Restoring it is a host-side `setSelection` to
  the last block's end.
