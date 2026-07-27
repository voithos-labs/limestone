# Feature: moving a block within a document

Covers `block-reorder.spec.ts`. The editor offers two ways to reorder a block — a grip that
appears in the left gutter on hover, and Alt+↑ / Alt+↓ with the caret in the block. limestone
takes the keyboard one only: a grip that materialises beside every paragraph the pointer passes
is chrome a document should not wear.

## Happy paths

- Alt+↑ moves the block holding the caret above its neighbour, and the move reaches the file.
  Turning the grips off must not cost the reorder itself — the chord is the only route left.

## Edge cases

- Hovering a block reveals no grip. Asserted by counting the handles rather than by looking at
  one: the editor renders them transparent until their block is hovered, so an assertion on
  visibility passes just as well with the handles switched on.
