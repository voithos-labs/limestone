# Feature: moving a block within a document

Covers `block-reorder.spec.ts`. The editor offers a hover grip and Alt+↑ / Alt+↓; limestone takes
the keyboard one only, because a grip beside every paragraph the pointer passes is chrome a
document should not wear.

## Happy paths

- Alt+↑ moves the block holding the caret above its neighbour, and the move reaches the file.
  Turning the grips off must not cost the reorder itself — the chord is the only route left.

## Edge cases

- Hovering a block reveals no grip. Asserted by counting the handles, not by looking at one: the
  editor renders them transparent until hovered, so a visibility assertion passes either way.
