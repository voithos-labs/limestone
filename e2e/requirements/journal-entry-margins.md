# Feature: clicking the blank space around a journal entry

Covers `journal-entry-margins.spec.ts`. A journal draws its entry inside the page, and the page
keeps a narrow blank strip either side of the text. A reader who aims a little wide of a line still
means that line, the same as in a document tab, and a click below the entry means its end.

## Happy paths

- Clicking the strip left of a line puts the caret at that line's start, so the next character
  typed lands there.
- Clicking the strip right of a line puts the caret at that line's end.
- Clicking below the entry puts the caret at the end of the document.

## Edge cases

- The document title and the entry's first line share a left edge. The strip is the document's own
  margin, so whichever element holds it must not shift one of the two.

## User interactions

- A selection running across several blocks is cleared by a click in the strip, and the caret lands
  in the line clicked beside. A click that left the highlight painted with the caret outside the
  entry would leave the reader unable to tell what the next keystroke replaces.

## Miss analysis

Nothing covered clicks that miss the text. `page-layout.spec.ts` measures where the text column
sits, and that stayed right the whole time: the strip beside it belonged to the page rather than to
the editor, and only a click could tell the two apart.
