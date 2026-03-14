# Testing Strategy

This document defines the testing strategy for the editor module.

The editor needs unusually strong correctness testing because its main promise is source preservation under rich editing.

## Core testing goals

Every test strategy should help prove one or more of these invariants:

- parse -> serialize without edits preserves exact source
- edits preserve untouched regions outside the command blast radius
- malformed and partially complete markdown remains preserved and editable
- logical selection and DOM behavior remain stable in supported contexts
- performance remains acceptable for note-sized documents

## Test layers

### 1. Golden round-trip tests

For each supported or preserved syntax fixture:

- parse source
- build CST
- serialize without edits
- assert exact equality with original source text and file metadata expectations

These fixtures should cover:

- paragraphs and headings
- emphasis / strong / strikethrough
- lists and task lists
- blockquotes
- fenced code blocks
- links and images
- reference links / definitions
- tables
- raw HTML
- malformed / incomplete constructs

### 2. Localized patch tests

For each editing command:

- apply a transaction
- compute the command blast radius
- serialize and splice the updated region
- assert untouched regions remain byte-identical
- assert resulting markdown matches expectation

Representative cases:

- typing within a paragraph
- splitting and merging blocks
- toggling inline formatting
- toggling task list state
- wrapping and unwrapping blockquotes
- editing link and image destinations
- edits near setext heading ambiguity
- edits near list looseness/tightness boundaries

### 3. CST invariant tests

After each parsed or edited fixture, assert:

- every source byte is owned exactly once
- parent/child ranges remain nested and non-overlapping
- token ownership obeys the CST contract
- recovery and opaque regions preserve exact source slices
- ID reuse rules behave as expected across reparses

### 4. Input and interaction tests

These should focus on the v1 supported surface.

Required coverage:

- caret movement across block boundaries
- selection across nested structures
- image atom selection behavior
- code fence editing behavior
- IME composition inside supported editable islands
- clipboard copy/paste behavior
- raw-edit fallback for opaque regions
- invalid DOM selection repair

### 5. Fuzz and corpus tests

Use a corpus of real-world and synthetic markdown documents.

Test against:

- CommonMark fixtures
- GFM fixtures
- GitHub-style documents with tasks, tables, details, and mixed formatting
- malformed documents
- randomized edit sequences over representative note-sized files

The goal is not only parser correctness, but discovering unexpected source-preservation failures.

## Fixture policy

Keep explicit fixtures for:

- note-sized documents with mixed syntax
- nested containers
- ambiguous delimiter runs
- newline and final-newline variants
- `LF` and `CRLF` inputs
- files with and without BOM
- unicode edge cases

## Performance test policy

Measure at least:

- full reparse cost
- projection rebuild cost
- keystroke-to-transaction time
- transaction-to-render time

Track median and p95 on representative fixtures.

## Minimum gating rule

A new syntax feature should not be considered implemented until it has:

- round-trip fixtures
- localized edit fixtures if rich-editable
- malformed/recovery fixtures if applicable
- interaction fixtures when the feature affects selection or input behavior
