# Limestone Summary

## What this app is

Limestone is a **local-first desktop notes app** built with **Tauri 2 + SvelteKit + Vite + TypeScript**, with a **Rust backend**. The data model is centered around a file-system "vault" of Markdown notes plus a local SQLite cache/index for fast lookup.

## What is currently implemented

- **Vault management**
  - Create a vault directory
  - Persist known vaults in app data
  - Set and load the active vault
- **Local settings system**
  - Compiled default settings
  - Global settings in app data
  - Vault-level settings overrides
- **Index/cache layer**
  - SQLite schema for vaults, documents, groups, and document-group links
  - Background vault reconciliation on startup / vault switch
  - Markdown file scanning with frontmatter parsing
  - `.limestoneignore` support when creating a vault
- **Search**
  - Title search is implemented
  - Empty query returns recent documents
  - Short queries use prefix matching; longer queries use fuzzy matching with recency weighting

## Current state of the app

- **Backend is ahead of the frontend**.
- The Rust/Tauri side already has real commands and storage logic.
- The Svelte UI is still mostly the default starter page and does **not** yet expose most of the backend features.
- There are TS model files for documents, groups, views, and settings, but several are still placeholders/incomplete.

## Implementation direction

From `README.md` and `TODO.md`, the intended direction seems to be:

- Markdown-vault-based knowledge app
- Per-vault metadata/config structure
- Richer views/groups/journal concepts
- Quick action / quick search workflow
- Better desktop UI shell
- Future improvements like file watching and full-text search (Tantivy)

Note: the README sketches a richer vault layout than what is currently created by code today.

## Important files

- `src-tauri/src/lib.rs` - app setup, state, command registration, startup reconciliation
- `src-tauri/src/commands/` - Tauri commands for vaults and settings
- `src-tauri/src/services/vault.rs` - vault creation/opening/reconciliation
- `src-tauri/src/services/search.rs` - current search implementation
- `src-tauri/sql/schema.sql` - SQLite schema
- `src/routes/+page.svelte` - current frontend entry page

## Setup / startup

This repo uses **npm** (`package-lock.json` is present).

1. Install JS deps:
   - `npm install`
2. Ensure **Rust** and **Tauri v2 prerequisites** are installed for your OS.
3. Start the desktop app in dev mode:
   - `npm run tauri dev`

Useful extras:

- Frontend only: `npm run dev`
- Type check: `npm run check`
- Production desktop build: `npm run tauri build`

## Persistence locations

App data is stored locally via Tauri app data files such as:

- `user.json`
- `vaults.json`
- `settings.json`
- `limestone.db`

Vault content itself lives on disk in the user-selected vault folder.
