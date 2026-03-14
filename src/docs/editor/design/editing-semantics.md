# Editing Semantics

This document defines concrete editing behavior for v1 commands.

Each entry specifies context, behavior, source effect, selection result, and blast radius. This is the operational contract that bridges the structural design docs and actual implementation.

## Guiding rules

- every command must produce a valid transaction with a defined blast radius
- outside the blast radius, source must remain byte-identical
- if a command cannot guarantee safe local behavior, it must widen the blast radius or fall back to a broader operation
- selection after a command must land at a valid logical position
- undo must reverse the command cleanly (see `undo-redo.md`)

---

## Text insertion

### Insert text in paragraph

- **Context**: cursor inside paragraph text
- **Behavior**: insert character(s) at cursor offset
- **Source effect**: splice text into paragraph's source range
- **Selection**: cursor advances past inserted text
- **Blast radius**: the owning paragraph

### Insert text in heading

- **Context**: cursor inside ATX heading text (after `# ` markers)
- **Behavior**: insert character(s) at cursor offset within heading content
- **Source effect**: splice text into heading's content range, preserving `#` prefix tokens
- **Selection**: cursor advances past inserted text
- **Blast radius**: the owning heading

### Insert text in list item

- **Context**: cursor inside list item text
- **Behavior**: insert character(s) at cursor offset
- **Source effect**: splice text into list item's content range, preserving marker tokens
- **Selection**: cursor advances past inserted text
- **Blast radius**: the owning list item; may widen to the full list if looseness/tightness could change

### Insert text in blockquote

- **Context**: cursor inside blockquote paragraph text
- **Behavior**: insert character(s) at cursor offset within the blockquote's child content
- **Source effect**: splice text into the child block's content range; blockquote `>` markers are not affected
- **Selection**: cursor advances past inserted text
- **Blast radius**: the owning blockquote child block

### Insert text in fenced code block

- **Context**: cursor inside code fence body
- **Behavior**: insert character(s) as plain text; no inline markdown parsing
- **Source effect**: splice text into code body range
- **Selection**: cursor advances past inserted text
- **Blast radius**: the code fence block

---

## Enter (insertParagraph)

### Enter in paragraph

- **Context**: cursor at some offset within paragraph text
- **Behavior**: split paragraph into two paragraphs at cursor
- **Source effect**: insert blank line separator at split point; first paragraph gets text before cursor, second gets text after
- **Selection**: cursor at start of new second paragraph
- **Blast radius**: both paragraphs

### Enter at end of paragraph

- **Context**: cursor at the end of paragraph text
- **Behavior**: create new empty paragraph after current
- **Source effect**: insert a blank separator line and create a session-only empty paragraph placeholder anchored after the current paragraph (see `cst.md`)
- **Selection**: cursor at the start position of the session-only placeholder
- **Blast radius**: the original paragraph and the anchored insertion gap

### Enter in ATX heading

- **Context**: cursor at some offset within heading text
- **Behavior**: split into heading (text before cursor) + new paragraph (text after cursor)
- **Source effect**: heading retains its prefix and text before cursor; a new paragraph is created after the heading with text after cursor
- **Selection**: cursor at start of new paragraph
- **Blast radius**: the heading and new paragraph
- **Note**: Enter does not create a second heading; it exits heading context

### Enter at end of ATX heading

- **Context**: cursor at end of heading text
- **Behavior**: create new empty paragraph after heading
- **Source effect**: insert a blank separator line and create a session-only empty paragraph placeholder anchored after the heading
- **Selection**: cursor at the start position of the session-only placeholder
- **Blast radius**: the heading and the anchored insertion gap

### Enter in list item

- **Context**: cursor at some offset within list item text
- **Behavior**: split list item at cursor; create new list item with same marker style
- **Source effect**: current item gets text before cursor; new item gets text after cursor with appropriate marker
- **Selection**: cursor at start of new list item's text
- **Blast radius**: the owning list (looseness/tightness may change)

### Enter in empty list item

- **Context**: cursor in a list item with no text content
- **Behavior**: exit the list; replace the empty item with an empty paragraph after the list
- **Source effect**: remove the empty list item; insert a blank separator line after the list and create a session-only empty paragraph placeholder anchored there
- **Selection**: cursor at the start position of the session-only placeholder
- **Blast radius**: the owning list and the anchored insertion gap
- **Note**: this is how users escape from lists, matching standard editor behavior

### Enter in fenced code block

- **Context**: cursor inside code body
- **Behavior**: insert a literal newline within the code body
- **Source effect**: splice newline into code body range
- **Selection**: cursor at start of new line within code body
- **Blast radius**: the code fence block

### Enter in blockquote

- **Context**: cursor in blockquote child paragraph
- **Behavior**: split the child paragraph; new paragraph remains inside the blockquote
- **Source effect**: split the child block; new line gets a `>` continuation marker matching the blockquote style
- **Selection**: cursor at start of new blockquote child paragraph
- **Blast radius**: the owning blockquote

### Enter in empty blockquote paragraph

- **Context**: cursor in an empty paragraph inside a blockquote (user pressed Enter on empty line)
- **Behavior**: exit the blockquote; create new empty paragraph after the blockquote
- **Source effect**: remove the empty blockquote line; insert a blank separator line after the blockquote and create a session-only empty paragraph placeholder anchored there
- **Selection**: cursor at the start position of the session-only placeholder outside the blockquote
- **Blast radius**: the blockquote and the anchored insertion gap

---

## Backspace (deleteContentBackward)

### Backspace within text

- **Context**: cursor inside text of any text-bearing block, not at the start
- **Behavior**: delete one character (or grapheme cluster) before cursor
- **Source effect**: remove the character from the source range
- **Selection**: cursor moves back by one position
- **Blast radius**: the owning block

### Backspace at start of paragraph (after another paragraph)

- **Context**: cursor at start of a paragraph, previous sibling is a paragraph
- **Behavior**: merge current paragraph into previous paragraph
- **Source effect**: remove separator blank line(s); join text of both paragraphs
- **Selection**: cursor at the join point (end of previous paragraph's original text)
- **Blast radius**: both paragraphs

### Backspace at start of paragraph (after heading)

- **Context**: cursor at start of a paragraph, previous sibling is an ATX heading
- **Behavior**: merge paragraph text into end of heading
- **Source effect**: remove separator; append paragraph text to heading content
- **Selection**: cursor at the join point within the heading
- **Blast radius**: the heading and the former paragraph

### Backspace at start of ATX heading

- **Context**: cursor at start of heading text (after `# ` markers)
- **Behavior**: unwrap heading to paragraph; remove `#` prefix
- **Source effect**: replace heading markers with nothing; content becomes a plain paragraph
- **Selection**: cursor at start of the resulting paragraph
- **Blast radius**: the former heading

### Backspace at start of list item (first item)

- **Context**: cursor at start of text in the first list item
- **Behavior**: unwrap to paragraph; remove list marker
- **Source effect**: replace list item marker with nothing; content becomes a plain paragraph before the remaining list (if any)
- **Selection**: cursor at start of the resulting paragraph
- **Blast radius**: the owning list and the new paragraph

### Backspace at start of list item (non-first item)

- **Context**: cursor at start of text in a list item that is not the first
- **Behavior**: merge with previous list item
- **Source effect**: remove item marker and separator; join text with previous item's text
- **Selection**: cursor at the join point
- **Blast radius**: the owning list

### Backspace at start of blockquote child

- **Context**: cursor at start of the first child block inside a blockquote
- **Behavior**: unwrap from blockquote; content becomes a paragraph before the remaining blockquote content (if any)
- **Source effect**: remove `>` markers for the affected lines
- **Selection**: cursor at start of the unwrapped paragraph
- **Blast radius**: the owning blockquote and the new paragraph

### Backspace at image boundary

- **Context**: cursor immediately after an inline image atom
- **Behavior**: select the image (do not delete immediately)
- **Source effect**: none yet; the image becomes selected
- **Selection**: node selection on the image
- **Blast radius**: none
- **Note**: a second Backspace with the image selected deletes it

### Backspace at start of fenced code block body

- **Context**: cursor at the very start of code body text (line after opening fence)
- **Behavior**: if at the absolute start of the code body, select the code fence block rather than deleting structural fence syntax
- **Source effect**: none
- **Selection**: block selection on the code fence
- **Note**: the code fence opening delimiter is structural; Backspace should not accidentally destroy the fence

---

## Delete (deleteContentForward)

### Delete within text

- **Context**: cursor inside text, not at the end
- **Behavior**: delete one character (or grapheme cluster) after cursor
- **Source effect**: remove the character from the source range
- **Selection**: cursor stays at current position
- **Blast radius**: the owning block

### Delete at end of paragraph (before another paragraph)

- **Context**: cursor at end of paragraph, next sibling is a paragraph
- **Behavior**: merge next paragraph into current
- **Source effect**: remove separator; join text
- **Selection**: cursor stays at original position (the join point)
- **Blast radius**: both paragraphs

### Delete at end of paragraph (before heading)

- **Context**: cursor at end of paragraph, next sibling is an ATX heading
- **Behavior**: merge heading text into paragraph; heading loses its markers
- **Source effect**: remove separator and heading markers; append heading text to paragraph
- **Selection**: cursor stays at original position
- **Blast radius**: the paragraph and the former heading

### Delete at image boundary

- **Context**: cursor immediately before an inline image atom
- **Behavior**: select the image
- **Source effect**: none yet
- **Selection**: node selection on the image
- **Note**: a second Delete with the image selected removes it

---

## Inline formatting commands

### Toggle emphasis (bold, italic, strikethrough)

- **Context**: text selection within a single text-bearing block
- **Behavior**: wrap selection with delimiter markers, or remove them if already present
- **Source effect**: insert/remove delimiter characters around the selected range
- **Selection**: selection expands to cover the same text content (excluding delimiters)
- **Blast radius**: the owning block

### Toggle emphasis with no selection (collapsed cursor)

- **Context**: cursor at a position within text, no selection
- **Behavior**: if inside an emphasis run, remove the emphasis from the current word or run; otherwise, insert empty delimiters and place cursor between them (typing will be formatted)
- **Source effect**: insert/remove delimiter characters
- **Selection**: cursor between delimiters (for new emphasis) or at adjusted position
- **Blast radius**: the owning block
- **Note**: the exact "expand to word" heuristic should match user expectations from Obsidian/VS Code

### Toggle emphasis across partially malformed delimiters

- **Context**: selection spans a region with existing but unbalanced delimiter characters
- **Behavior**: prefer wrapping the whole selection cleanly rather than trying to repair inner delimiters
- **Source effect**: add new outer delimiters; existing inner delimiters become literal text if they don't resolve
- **Selection**: selection covers the same text
- **Blast radius**: the owning block
- **Fallback**: if the resulting source would be ambiguous or the reparse produces unexpected structure, widen blast radius to the full block and accept the reparse result

### Toggle inline code

- **Context**: text selection within a single text-bearing block
- **Behavior**: wrap selection with backtick(s), or remove them if already inside inline code
- **Source effect**: insert/remove backtick delimiters
- **Selection**: adjusted to cover the same content
- **Blast radius**: the owning block
- **Note**: if the selection contains backticks, use double-backtick delimiters with spacing per CommonMark rules

---

## Link and image commands

### Insert link

- **Context**: text selection or collapsed cursor in a text-bearing block
- **Behavior**: wrap selection as link text, prompt for URL; if collapsed cursor, insert `[text](url)` placeholder
- **Source effect**: insert link markdown syntax
- **Selection**: cursor inside the URL portion (for immediate editing) or at end of link
- **Blast radius**: the owning block

### Edit link destination

- **Context**: cursor inside or selection on an existing link
- **Behavior**: open editing affordance (popover, inline edit) for the URL
- **Source effect**: replace the destination portion of the link syntax
- **Selection**: cursor returns to link text after editing
- **Blast radius**: the owning block

### Delete selected image

- **Context**: node selection on an image atom
- **Behavior**: remove the entire image syntax
- **Source effect**: delete the `![alt](src)` text from source
- **Selection**: cursor at the position where the image was
- **Blast radius**: the owning block

---

## Structural commands

### Toggle heading

- **Context**: cursor in a paragraph or heading
- **Behavior**: if paragraph, convert to heading at specified level; if heading, toggle between levels or back to paragraph
- **Source effect**: add, change, or remove `#` prefix markers
- **Selection**: cursor at equivalent offset within the content text
- **Blast radius**: the target block

### Toggle blockquote

- **Context**: cursor in a paragraph or blockquote
- **Behavior**: if paragraph, wrap in blockquote; if already in blockquote, unwrap
- **Source effect**: add or remove `> ` prefix markers on all affected lines
- **Selection**: cursor at equivalent content offset
- **Blast radius**: the blockquote region

### Toggle unordered list

- **Context**: cursor in a paragraph or list item
- **Behavior**: if paragraph, convert to unordered list item; if already unordered list item, unwrap to paragraph; if ordered list item, convert marker to unordered
- **Source effect**: add, change, or remove list marker prefix
- **Selection**: cursor at equivalent content offset
- **Blast radius**: the owning list (looseness/tightness, marker style)

### Toggle ordered list

- **Context**: cursor in a paragraph or list item
- **Behavior**: if paragraph, convert to ordered list item; if already ordered list item, unwrap to paragraph; if unordered list item, convert marker to ordered
- **Source effect**: add, change, or remove list marker prefix
- **Selection**: cursor at equivalent content offset
- **Blast radius**: the owning list

### Toggle task list checkbox

- **Context**: cursor in a list item
- **Behavior**: toggle `[ ]` / `[x]` checkbox marker; add checkbox if list item doesn't have one
- **Source effect**: insert, toggle, or remove checkbox syntax after list marker
- **Selection**: cursor stays at equivalent content offset
- **Blast radius**: the owning list item

### Indent list item

- **Context**: cursor in a list item that is not the first item in its list
- **Behavior**: nest the item under the previous sibling item
- **Source effect**: increase indentation of all item lines
- **Selection**: cursor at equivalent content offset
- **Blast radius**: the owning list
- **Precondition**: item must have a preceding sibling to nest under

### Dedent list item

- **Context**: cursor in a nested list item
- **Behavior**: move the item up one nesting level
- **Source effect**: decrease indentation of all item lines
- **Selection**: cursor at equivalent content offset
- **Blast radius**: the owning list

### Insert thematic break

- **Context**: cursor in a paragraph
- **Behavior**: split paragraph at cursor; insert thematic break between the two halves
- **Source effect**: insert `---` (or configured variant) with surrounding blank lines
- **Selection**: cursor at start of the paragraph after the break
- **Blast radius**: the original paragraph and surrounding blocks

### Insert fenced code block

- **Context**: cursor in a paragraph or empty position
- **Behavior**: insert a new empty fenced code block
- **Source effect**: insert opening and closing fence lines with blank body
- **Selection**: cursor inside the code body
- **Blast radius**: the surrounding blocks

---

## Clipboard operations

### Copy text selection

- **Context**: text selection within a single block
- **Behavior**: serialize selected text as markdown fragment to clipboard
- **Source effect**: none
- **Note**: plain text clipboard should contain the markdown source; HTML clipboard may contain rendered form

### Copy across blocks

- **Context**: selection spanning multiple blocks
- **Behavior**: serialize all fully and partially selected blocks as a markdown fragment
- **Source effect**: none
- **Note**: partial block selections include only the selected text portion; structural markers are included as needed to preserve meaning

### Paste plain text into paragraph

- **Context**: cursor in a paragraph, clipboard contains plain text
- **Behavior**: insert text at cursor; if text contains line breaks, split into multiple paragraphs
- **Source effect**: splice text into paragraph source, potentially creating new blocks
- **Selection**: cursor at end of pasted content
- **Blast radius**: the owning paragraph and any new blocks created
- **Note**: line endings are normalized to the document's newline style

### Paste multiline text into blockquote

- **Context**: cursor inside a blockquote child, clipboard contains multiline text
- **Behavior**: insert text; new lines remain inside the blockquote with appropriate `>` continuation markers
- **Source effect**: splice text and add `>` markers for new lines
- **Selection**: cursor at end of pasted content
- **Blast radius**: the owning blockquote

### Paste into fenced code block

- **Context**: cursor inside code body, clipboard contains any text
- **Behavior**: insert as plain text; no markdown parsing of pasted content
- **Source effect**: splice text into code body
- **Selection**: cursor at end of pasted content
- **Blast radius**: the code fence block

### Paste HTML

- **Context**: cursor in any editable region, clipboard contains HTML
- **Behavior**: convert HTML to markdown through a constrained import path, then insert as if pasting markdown text
- **Source effect**: same as pasting the equivalent markdown
- **Selection**: cursor at end of pasted content
- **Blast radius**: depends on the resulting markdown structure
- **Note**: HTML-to-markdown conversion should be conservative; unsupported HTML should be inserted as raw HTML blocks rather than silently dropped

### Paste image/file

- **Context**: cursor in any editable region, clipboard contains file data
- **Behavior**: route through asset import adapter (see asset paste/drop flow in `api.md`)
- **Source effect**: insert image markdown syntax after host processes the asset
- **Selection**: cursor after the inserted image
- **Blast radius**: the owning block

---

## Multi-block selection operations

### Delete with multi-block selection

- **Context**: selection spans parts of multiple blocks
- **Behavior**: delete selected content; merge the leading partial block with the trailing partial block
- **Source effect**: remove all fully selected blocks and the selected portions of partial blocks; join the remaining head and tail
- **Selection**: cursor at the join point
- **Blast radius**: all affected blocks

### Replace with multi-block selection

- **Context**: selection spans multiple blocks, user types or pastes
- **Behavior**: delete selection first (as above), then insert at the resulting cursor position
- **Source effect**: combined delete + insert
- **Selection**: cursor after inserted content
- **Blast radius**: all affected blocks

---

## Fallback rules

### Command in opaque/recovery region

- **Context**: cursor inside an opaque or recovery node (unsupported syntax)
- **Behavior**: all editing operates as raw text; no rich structural commands apply
- **Source effect**: direct text splice into the raw source slice
- **Selection**: adjusted by splice offset
- **Blast radius**: the opaque region; may widen if the edit causes the region to reparse into different structure

### Command that would corrupt source

- **Context**: any command where the resulting source cannot be safely serialized locally
- **Behavior**: widen blast radius; if still unsafe, fall back to full-document serialize and patch
- **Source effect**: broader region is reserialized
- **Selection**: best-effort preservation at equivalent content offset
- **Note**: this should be rare in practice but must be handled explicitly

### Command at preserve-only syntax boundary

- **Context**: cursor at or near preserve-only syntax (tables, setext headings, reference definitions, raw HTML, etc.)
- **Behavior**: the preserve-only block is treated as an atomic unit for structural commands; text editing within it falls back to raw-edit mode
- **Source effect**: raw text splice within the block, or structural operations that treat the block as indivisible
- **Selection**: adjusted by splice offset
- **Note**: rich editing of preserve-only syntax is explicitly out of scope for v1

---

## Relationship to other design docs

- `architecture.md` defines the data flow walkthrough that these commands follow
- `cst.md` defines the source ownership rules that commands must respect
- `undo-redo.md` defines how command transactions are grouped and reversed
- `input-selection.md` defines the selection model that commands read and produce
- `view-projection.md` defines how command results are rendered
- `compatibility-matrix.md` defines which syntax is rich-editable vs preserve-only
