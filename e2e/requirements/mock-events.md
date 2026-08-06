# Feature: the mock backend's event channel

Covers `mock-events.spec.ts`. This is a harness self-test: it pins the contract
`@tauri-apps/api/event` relies on, because a break there is invisible to every
app-facing spec — nothing on the boot path emits.

## Happy paths

- A listener registered through the IPC channel receives the payload of a matching emit.

## Edge cases

- The id `listen` resolves to is the id `unlisten` accepts back, whatever that id is. The real
  backend mints its own counter while the mock echoes the handler, so what the app depends on is
  the round trip; pinning the value would pin the mock's convenience and block making it faithful.
- After unlisten, a further emit for the same event name is not delivered.

## Covered elsewhere

- Driving the app through an emitted `tauri://close-requested`: `editor-save.md`, where the
  close matters — an edit still inside the save debounce has to reach the file.
