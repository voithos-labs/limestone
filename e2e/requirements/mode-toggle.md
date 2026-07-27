# Feature: the editor's presentation modes

Covers `mode-toggle.spec.ts`. The mode is per tab; `data-presentation` on `.editor` reports the
effective one, and is absent in source mode.

## User interactions

- Mod+E round-trips: it enters reading mode, and pressing it again returns to the mode the reader
  was in. Reading mode is the only mode control a journal entry has, so a one-way trip would strand
  the reader there.
