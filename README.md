# LIMESTONE (V4)

## Dev Commands

Run dev app

```bash
npm run tauri dev
```

Format

```bash
npm run format
```

## Structure

### Files

So here's what I'm thinking:

```
app_data_dir/                    # stateful app data
├── sources.json
├── groups.json
├── views.json
├── settings.json
├── workspace.json
└── history/
    └── {uuid}.automerge

app_cache_dir/                   # cache
├── index.db
└── tantivy/

SOURCE/                          # any mounted folder
├── .limestone.json              # source policy, ignore, etc.
└── ...files
```

(nice: https://tree.nathanfriend.com)

## Tools

I use https://plugins.jetbrains.com/plugin/24705-code-divider for sections
