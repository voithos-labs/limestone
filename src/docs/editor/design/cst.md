# Lossless CST Contract

This document defines the lossless concrete syntax tree contract.

The CST is the highest-risk internal abstraction in the editor. It is the structure that makes source preservation auditable.

## Purpose

The CST must support all of the following at once:

- exact round-trip serialization without edits
- localized editing without whole-document normalization
- preservation of malformed or unsupported regions
- stable enough identity for decorations, history, and UI mapping
- explicit ownership of every source byte

## Core invariant

Every byte of the loaded markdown source must be owned by exactly one of the following:

- document prefix or suffix trivia
- a node's leading trivia
- a syntax token owned by a node
- a raw text span owned by a text-like node
- a recovery / opaque span for malformed or unsupported content

There must be no unowned bytes and no overlapping ownership.

## Node model

A conceptual node shape:

```ts
interface CstNode {
  id: string;
  kind: string;
  range: SourceRange;
  leadingTrivia: TriviaSlice[];
  tokens: SyntaxToken[];
  children: CstNode[];
  metadata: SourceShapeMetadata;
  flags?: {
    incomplete?: boolean;
    opaque?: boolean;
    recovery?: boolean;
  };
}
```

This is not a final API. It is a contract sketch.

## Ownership rules

### Document ownership

`Document` owns:

- any source prefix before the first child
- any source suffix after the last child

### Sibling ownership

Within a container:

- each node owns its own leading trivia
- separator bytes between siblings belong to the following sibling, not the preceding sibling

This means blank lines between two paragraph nodes are owned by the second paragraph's leading trivia.

### Token ownership

Bytes that are semantically part of a node belong to syntax tokens, not trivia.

Examples:

- heading markers like `#`
- list markers like `-`, `*`, `1.`
- task checkbox markers like `[ ]` and `[x]`
- blockquote continuation markers like `>` on each physical line they prefix
- code fence delimiters and info strings
- table pipe and delimiter row syntax when parsed as table structure
- setext underline markers when parsed as headings

### Text ownership

Text-like node content owns its literal body bytes.

Examples:

- paragraph text
- code fence body text
- inline code content
- raw HTML preserved as opaque source

## Trivia ownership examples

### Example 1

```markdown
Paragraph one.

Paragraph two.
```

Ownership:

- `Paragraph("Paragraph one.")` owns its text and line ending
- the blank separator line belongs to the leading trivia of `Paragraph("Paragraph two.")`

### Example 2

```markdown
> Quote line 1
> Quote line 2
```

Ownership:

- each `>` marker belongs to blockquote syntax tokens
- the quoted text belongs to child paragraph text nodes
- there is no free-floating trivia containing the `>` markers

### Example 3

```markdown
- item one
  
- item two
```

Ownership:

- the second list item's leading trivia owns the blank separator line inside the list container
- the list markers belong to `ListItem` tokens

## Delimiter accounting

Markdown inline parsing is not purely lexical. The CST must preserve both resolved structure and raw delimiter reality.

For delimiter-run constructs such as emphasis/strong:

- store the raw delimiter spans exactly as they appeared
- record which delimiter bytes were consumed as opener and closer
- record which delimiter bytes remained literal text
- preserve unresolved or malformed runs in recovery form instead of rewriting them

This is necessary for subtle cases where parse resolution is context-dependent.

## Malformed and incomplete constructs

The CST must represent incomplete or malformed states without forcing normalization.

### Required behavior

- half-typed constructs remain editable
- the source slice must be preserved exactly
- the node may be marked `incomplete` or `recovery`
- serialization must emit the exact preserved slice unless an explicit edit changes it

### Recovery node guidance

Use recovery or opaque nodes when:

- the parser cannot confidently map a region into richer node kinds
- a GitHub-specific construct is preserved but not richly editable
- a malformed inline structure would otherwise lose delimiter bytes

Opaque nodes are not errors. They are an explicit safety valve.

## Empty paragraph placeholder contract

Markdown source does not have a stable canonical representation for a standalone empty paragraph block. A blank line is separator trivia, not paragraph content.

To support normal editor behavior such as pressing `Enter` at the end of a paragraph and landing on a visually empty next line, the design uses a **session-only empty paragraph placeholder**.

Rules:

- the placeholder is not a canonical source node and owns no source bytes of its own
- it is anchored to a valid insertion position between blocks or in document suffix trivia
- its visual emptiness is derived from the insertion gap, not from synthetic paragraph bytes serialized into source
- typing into the placeholder converts the anchored gap into a real paragraph by inserting text at the anchor offset
- deleting out of the placeholder removes only the session placeholder state unless surrounding source bytes are explicitly affected

This keeps the CST lossless and source-canonical while still allowing the UI and command layer to expose expected paragraph-entry behavior.

## ID stability contract

Node IDs are stable only within a limited contract.

### Guaranteed

- nodes outside the reparsed region keep their IDs

### Best-effort

- nodes inside the reparsed region may reuse IDs if they can be matched by kind, local structure, and stable source anchors

### Not guaranteed

- materially rewritten nodes
- nodes in recovery regions that reparse into different structure
- nodes in ambiguously remapped regions after structural edits

Consumers that need stronger anchoring should use:

- source range anchors
- semantic fingerprints
- or both

They should not rely on node IDs alone.

## ID reuse rules

A reparsed node may reuse an old ID only if:

- the enclosing serialization region is the same logical container
- the node kind matches
- a conservative anchor matches, such as start token shape plus relative order plus compatible semantic metadata

A node must receive a new ID if:

- its kind changes
- its owned token shape changes in a way that breaks confidence
- sibling reordering makes the match ambiguous
- the region transitioned through recovery in a way that destroys stable correspondence

## Source-shape metadata

Each node should carry the minimum metadata needed to preserve author style choices.

Examples:

- list bullet character
- ordered list delimiter and start number
- ATX vs Setext heading form
- code fence character and length
- exact info string
- reference definition label spelling
- link title quoting form if preserved distinctly
- table delimiter row formatting

## Edit-time invariants

After any transaction:

- the CST must still satisfy the single-owner byte rule
- parent/child ranges must remain nested and non-overlapping
- tokens must remain inside their node range
- leading trivia may move only according to the ownership rules
- serialization of untouched regions must remain byte-identical

## Required examples before broad implementation

Before the editor expands beyond the initial proof of concept, the CST spec should be exercised against explicit examples covering:

- nested lists and blockquotes
- emphasis delimiter ambiguity
- setext heading vs paragraph underline ambiguity
- fence opening and closing edits
- reference definition preservation
- malformed partial links and code fences
- raw HTML preserved as opaque regions

## Non-goal

The CST is not intended to be a friendly public API. It is an internal contract optimized for correctness and source preservation.
