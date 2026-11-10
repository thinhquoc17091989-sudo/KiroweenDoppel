# Doppel

**You draw the architecture. Kiro writes the code and keeps it honest.**

Doppel is a Kiroween 2026 entry. It brings round-trip engineering back: an architecture
diagram that stays in sync with the code, because an AI agent does the syncing.

1. Kiro proposes an architecture as PlantUML. Proposed elements are drawn dashed.
2. You review it in the browser: accept, rename or reject each element, drag it where it belongs.
3. Approving writes `architecture/*.puml` into your repo. The layout lives beside it in `layout.json`.
4. A Kiro hook sees the change and generates one code file and one test file per element.
5. `trace.json` links every element to its requirement, code and test. The table shows what is stale.
6. A Kiro MCP tool checks for drift between architecture and code, so the agent can fix it.

## Status

Early. The parser and printer for the PlantUML subset are done and property-tested.
See `.kiro/specs/architecture-review-loop/tasks.md` for the plan.

## Run

```
npm install
npm test
npm run dev
```

## Sample

`samples/plant-watering/` is an invented plant-watering controller. No real system data is used anywhere.

## License

MIT
