---
id: da597ec2-6c45-45b2-99b2-428acf1a2f1e
tags: []
created_at: 2026-04-10T20:16:06.000Z
updated_at: 2026-04-10T20:16:06.000Z
---

# TODO n shit

## Features

- [ ] Document history
- [ ] File watcher
- [ ] Executable code blocks (with env config)
- [ ] Asset handling (e.g. when you paste an image in a doc)

### Search

- [x] Title search
- [ ] FTS (via tantivy)
- [ ] Group filtering in search

### General UI

- [x] Topbar UI
- [ ] Upgrade topbar (& related settings) for macOS and linux
- [ ] Quick action / quick search

Thinking for the quick action menu, maybe have it like a tab in the sense it keeps it state between
uses. E.g., if you're browsing a group / view, and you open quick nav again you see the same thing,
with super quick keyboard actions

Maybe:

`CTRL` + `Space` => open straight to new search, type `/` for command -- shows last search / state before you type
`CTRL` + `Shift` + `Space` => use last filters / state
`CTRL` + `P` => command, basically just the search but with `/` already entered

Searches should be able to be opened as a tab in one click

### Groups

- [ ] Quick open group as a view

### Views

- [ ] Pinned views somewhere
- [ ] Default / base table-like view, with filters etc.
- [ ] Journal / Daily log
- [ ] Yoo maybe like uh view-property editing in the documents yo?

Think about:

- Maybe use H1 header as title optionally? Including in search
