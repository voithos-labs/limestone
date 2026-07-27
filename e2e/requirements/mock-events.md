# Feature: the mock backend's event channel

Covers `mock-events.spec.ts`. This is a harness self-test: it pins the contract
`@tauri-apps/api/event` relies on, because a break there is invisible to every
app-facing spec — nothing on the boot path emits.

## Happy paths

- A listener registered through the IPC channel receives the payload of a matching emit.

## Edge cases

- The id `listen` resolves to is the callback id it was handed, so the app can unlisten
  with it and an emit can find the handler.
- After unlisten, a further emit for the same event name is not delivered.

## Covered elsewhere

- Driving the app through an emitted `tauri://close-requested`: `editor-save.md`, where the
  close matters — an edit still inside the save debounce has to reach the file.
