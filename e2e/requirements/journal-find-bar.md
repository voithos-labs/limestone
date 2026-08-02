# Feature: where the find bar sits on a page that scrolls the document

Covers `journal-find-bar.spec.ts`. A journal draws its entry inside the page's own scroller, so
the editor's find bar would otherwise sit halfway down the page and scroll away with the entry.
The page hands the editor a box in its top right instead, and the editor draws the same bar there:
same chord, same buttons, same Escape, only somewhere the reader can still see it.

## Happy paths

- Mod+F with the caret in the entry opens the find bar in the page's top right, and nowhere inside
  the entry.
- Typing a word into the bar highlights it in the entry, so the bar the page holds is the one
  searching the document.

## Edge cases

- Scrolling the entry leaves the bar where it is. This is the whole point of moving it: a bar
  drawn with the entry slides off the top of the page as soon as the reader scrolls.
- A theme change repaints the bar. It sits outside the editor now, so it only stays in step
  because the editor carries its colours with it.

## User interactions

- Escape closes the bar and puts the caret back where the search started, so the next character
  typed lands in the entry rather than nowhere.
