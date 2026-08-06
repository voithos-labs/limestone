# Feature: tab state the document can no longer honour

Covers `stale-tab-state.spec.ts`. A restored session hands the editor whatever the last one left
on the tab, and some of it no longer fits: keys the previous editor wrote, and this editor's own
state gone stale because the file changed while the app was closed. Each fails silently — the
document opens somewhere the reader did not leave it, or with no caret at all — so each is pinned.

What a tab does remember is `tab-state.md`'s.

## Error cases

- A tab carrying `cursorPos` opens without error: the number is a flat character offset, which
  means nothing against a tree of blocks. The document opens at the top, typable.
- A tab carrying `scrollTop` opens at the top too. That number measured a scroller the document
  header sat inside, while this editor counts scroll from where the blocks begin — so reading it
  as one of its own would drop the reader roughly the header's height below the line they left.
  Positions this editor writes carry a name of their own, which is what keeps the two apart.
- A remembered caret addressing a block the document no longer has leaves it typable all the
  same. That selection addresses blocks by path, so a file that shrank outside the app between
  sessions invalidates it. Placing it fails rather than throwing, and the restore falls through to
  the top of the document. A caret nowhere means the keyboard reaches nothing until a click.
