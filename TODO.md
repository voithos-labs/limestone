# TODO n shit

## Features

- [x] Title search
- [ ] FTS (via tantivy)
- [ ] File watcher
- [ ] Executable code blocks (with env config)

## UI Components

- [ ] Topbar UI (see: https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design)
- [ ] Quick action / quick search

### Markdown document editor

*Blocks*

- [ ] Markdown Block

### Groups

- [ ] Quick open group as a view

### Views

- [ ] Pinned views somewhere
- [ ] Default / base table-like view, with filters etc.
- [ ] Journal / Daily log

Thinking for the quick action menu, maybe have it like a tab in the sense it keeps it state between
uses. E.g., if you're browsing a group / view, and you open quick nav again you see the same thing,
with super quick keyboard actions

Maybe:

`CTRL` + `Space` => open straight to new search, type `/` for command -- shows last search / state before you type
`CTRL` + `Shift` + `Space` => use last filters / state
`CTRL` + `P` => command, basically just the search but with `/` already entered

Searches should be able to be opened as a tab in one click