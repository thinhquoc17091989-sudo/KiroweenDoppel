# Doppel: tech steering (assumptions, change if the stack changes)

- TypeScript, Node 20+, Vite for the browser UI, Vitest for tests.
- Property-based tests with fast-check for the PlantUML parse/print round trip.
- Architecture files use a restricted PlantUML subset: `component`, `interface`, `-->`, `..>` (proposal), `note`.
- No PlantUML server. The UI renders the subset itself so it works offline.
- `trace.json` is the only generated metadata file. Everything else is plain text.
