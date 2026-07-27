# Feature: tab state the previous editor left behind

Covers `legacy-tab-state.spec.ts`. An install that ran the CodeMirror editor has tabs in
`state.json` carrying that editor's own position keys. Both address a space this editor does not
have, so both are ignored rather than translated — and each is pinned as ignored, because
misreading one is silent: the document simply opens somewhere the reader did not leave it.

What a tab does remember is `tab-state.md`'s.

## Error cases

- A tab carrying `cursorPos` opens without error: the number is a flat character offset, which
  means nothing against a tree of blocks. The document opens at the top, typable.
- A tab carrying `scrollTop` opens at the top too. That number measured a scroller the document
  header sat inside, while this editor counts scroll from where the blocks begin — so reading it
  as one of its own would drop the reader roughly the header's height below the line they left.
  Positions this editor writes carry a name of their own, which is what keeps the two apart.
