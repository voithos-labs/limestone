**Things to clean up for 1.0**

Legacy migrations (drop at 1.0):

- [ ] old-id system history migration code, see `LEGACY_PATH_KEY_NAMESPACE` in history_commands.rs
- [ ] `migrate_layout` in history_commands.rs: renames `.limestone/history` to `.limestone/docs` and folds `by-path/<uuid5>` dirs into `docs/<doc id>`; called from `sweep_orphans` on every sweep. Its test `legacy_history_folds_into_docs_and_by_path_joins_its_row` goes with it
- [ ] `sweep_orphans` in history_commands.rs backfills `meta.json` into doc dirs that predate it (the `!entry.path().join(META_FILE).exists()` branch)
- [ ] `ensure_writable` in history_commands.rs overwrites a `.limestone/.gitignore` that still says `history/` (any content other than `docs/` is rewritten)
- [ ] `LEGACY_THEME_KEYS` + the `activeTheme` read-and-delete in Session.svelte.ts `loadAppState` (old single theme key split into themeDark/themeLight, `default-dark`/`default-light` renamed to stone)
- [ ] `![[image.png]]` wiki image embeds in image-embeds.ts (+ wiki-image-embeds-scan.ts) are kept for older limestone notes; new images write `![]()`. Not strictly a migration, decide whether to keep for Obsidian imports

Reset-on-mismatch mechanisms (keep, but at 1.0 they stop being allowed to wipe):

- [ ] `SCHEMA_VERSION` in lib.rs: any `PRAGMA user_version` mismatch drops every table and rebuilds from schema.sql. Post 1.0 this needs real per-version migrations instead of a drop list
- [ ] `APP_STATE_VERSION` in Session.svelte.ts: mismatch clears state.json (editors, tabs, themes)
- [ ] `JOURNAL_VERSION` in bulk_ops.rs: mismatch discards the pending bulk-op journal
- [ ] `SOURCES_VERSION` (source.rs) and `USER_VERSION` (user.rs): version fields written to sources.json / user.json with a serde default, nothing reads them yet

Serde defaults covering fields added pre-1.0 (fold into the struct, drop the `default` attrs where the field is now required):

- [ ] `SourceConfig` in source.rs: `use_frontmatter`, `strong_meta`, `frontmatter_dirs`, `note_location`, `asset_location`, `ignore`
- [ ] `Sources` in source.rs: `default_source_id`, `sources`
- [ ] `Journal` / `BulkOp` in bulk_ops.rs (lines ~69, ~71, ~202, ~204)

Already removed: source-settings migration dropped in 0476c1b4 (pre-1.0, settings reset instead)
