# TODO n shit

--- for lunch ---

**Plumbing**

- [ ] body indexing (in-body tags, wikilinks)
- [ ] filesystem watcher (see figjam plan)
- [ ] wire histroy into Daniel's document system + UI

> Then add soft delete (trash) for docs!

**UI/UX**

- [ ] First lauch / no sources preamble ("Hey buddy, want to do something?")
- [ ] view creation preamble (select folder, default type, eventually templates, etc.)
- [ ] Kanban view face
- [ ] Override all default shortcuts (e.g. CTRL + F)
- [ ] Populate global context menus

**Chores**

- [ ] Finish limestone.app launch site

**Review**

- [ ] All aragonite fundemental components, full visual/UX pass
- [ ] Webview shell checklist, per platform in the BUILT app (aragonite consumer-guide § Embedding in a webview shell; Windows keyboard findings already in e2e/requirements/keybindings.md):
  - [ ] every chord the editor + app rely on (zoom, devtools, reload are the usual shell claims)
  - [x] select-all across an image / thematic break, copy, paste into an external app
  - [x] the two async-clipboard routes: whole-block Mod+C/X on a rule or diagram, table menu Paste (unproven on wry)
  - [ ] multi-line text copied from a native app, pasted into a block
  - [ ] image paste from the system clipboard (onPasteImage)
  - [ ] a local-file image on each platform (asset protocol differs on Windows vs mac/linux)

--- for dinner ---

**UI/UX**

- [ ] In-line commands in the editor
- [ ] File explorer view face? (default for sources / folders opened as a view)

**Features**

- [ ] Embed view-faces in notes wikilink style!
- [ ] PDF + EPUB viewing and annotation (see google doc notes)
- [ ] Audio file first-party document support
- [ ] TTS, STT

**Icky (Yucky)**

- [ ] MCP server
- [ ] Local LLM integration for organization / migrations (e.g. my synced log entries have fucked up on-disk created_at dates, mostly the same day, would be nice to have the 500+ entries migrated with minimal effort, like me typing this sentence. We invented AI so I don't have to peel grapes or write a script to organize my files.)
