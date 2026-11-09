**Things to clean up for 1.0**

Legacy migrations (drop at 1.0):

- [ ] old-id system history migration code, see `LEGACY_PATH_KEY_NAMESPACE` in history_commands.rs
- [ ] `migrate_layout` in history_commands.rs: renames `.limestone/history` to `.limestone/docs` etc.
- [ ] `sweep_orphans` in history_commands.rs backfills `meta.json` into doc dirs that predate it (the
  `!entry.path().join(META_FILE).exists()` branch)
- [ ] `ensure_writable` in history_commands.rs overwrites a `.limestone/.gitignore` that still says `history/` (any
  content other than `docs/` is rewritten)
- [ ] `LEGACY_THEME_KEYS` + the `activeTheme` read-and-delete in Session.svelte.ts `loadAppState`
- [ ] `![[image.png]]` wiki image embeds in image-embeds.ts (+ wiki-image-embeds-scan.ts) are kept for older limestone
  notes, new images write `![]()`

Serde defaults covering fields added pre-1.0

- [ ] `SourceConfig` in source.rs: `use_frontmatter`, `strong_meta`, `frontmatter_dirs`, `note_location`,
  `asset_location`, `ignore`
- [ ] `Sources` in source.rs: `default_source_id`, `sources`
- [ ] `Journal` / `BulkOp` in bulk_ops.rs

