# Undo and Redo

This document defines the undo/redo design for the editor.

## Core model

The editor uses a linear transaction history with redo branch pruning.

### History stack

- an undo stack of entries, each containing a reversible transaction or transaction group
- a redo stack that is cleared whenever a new transaction is committed

### Transaction as the unit of history

Every committed transaction produces a history entry. The entry must contain enough information to reverse the transaction:

- the inverse source buffer splice (the original text and the range it occupied)
- the selection state before the transaction

The editor does not store CST snapshots in history. Undo replays the inverse splice, then triggers a full reparse, just like a forward edit. This keeps history entries small and avoids coupling history to CST structure.

## Undo grouping

Not every keystroke should be a separate undo step.

### Typing runs

Consecutive `insertText` transactions are coalesced into a single undo group when:

- they target adjacent offsets (continuous typing, not jumping around)
- they occur within a short time window (e.g., 500ms between keystrokes)
- they remain within the same block

A group boundary is created when:

- the user pauses typing beyond the time threshold
- the cursor moves to a non-adjacent position
- a structural command is dispatched
- a deletion is interleaved with insertion

### Structural commands

Each structural command (toggle heading, wrap blockquote, toggle list, etc.) is always a single undo group, never coalesced with adjacent typing.

### Deletion

Consecutive backward or forward deletions are coalesced similarly to typing runs. A group boundary is created when deletion direction changes, the cursor jumps, or a non-deletion command intervenes.

### Paste

A paste operation is always a single undo group regardless of size.

## Selection restoration

On undo:

- restore the selection state captured at the start of the undo group
- map the restored selection through the reparsed CST to verify it lands at a valid logical position
- if the restored position is no longer valid (e.g., the block structure changed in a way that invalidates it), snap to the nearest valid position

On redo:

- restore the selection state captured at the end of the redo group
- apply the same validity check

## Interaction with full reparse

Because undo replays an inverse splice and triggers reparse:

- the resulting CST may differ structurally from the original CST at that point in history (e.g., if the parser produces different recovery nodes for an intermediate malformed state)
- this is acceptable; the source text will be byte-identical to what it was before the undone transaction, and the CST is derived from source, not canonical
- selection restoration uses source offsets, which remain valid regardless of CST structure

## Interaction with the projection

The projection is not involved in undo/redo. After undo replays the inverse splice and reparse completes, the projection is rebuilt from the new CST exactly as it would be for any other state change.

## Compound transactions

Some user-visible actions produce multiple source splices (e.g., wrapping a selection in a link inserts both `[` and `](url)` at different offsets). These must be committed as a single compound transaction with a single undo group.

The history entry for a compound transaction stores the inverse of all splices in reverse order, so undo replays them in the correct sequence.

## Memory management

- history entries store only source buffer diffs (old text, range, new text length), not full document snapshots
- for note-sized documents, the undo stack can be effectively unbounded in v1
- if future profiling shows memory pressure, the bottom of the undo stack can be truncated

## Non-goals for v1

- collaborative undo (operation transformation / CRDT undo)
- branching undo history (undo trees)
- per-block undo isolation
- undo across document switches (each document session has its own history)
- persistent undo (history is lost when the document is closed)

## Relationship to other design docs

- `architecture.md` references history in the data flow walkthrough
- `api.md` lists undo/redo as editor-controlled state; the host does not manage history
- `input-selection.md` defines selection semantics that undo must restore
- `plan.md` includes history-ready transaction primitives in Phase 1 and undo/redo grouping in Phase 3
