# LIMESTONE (V4 (fml))
<img width="1348" height="944" alt="image" src="https://github.com/user-attachments/assets/3f753258-6adc-4b32-a2ac-27cb6bb4d09c" />

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
