# Design: architecture review loop

## Data flow
`proposals.puml` -> review UI -> `architecture/*.puml` (approved) -> hook -> `src/<element>.ts` + `test/<element>.test.ts` -> `trace.json` -> trace table + drift MCP.

## Components
- **puml-subset**: parser and printer for the restricted subset in `src/core/puml.ts`, with the element types in `src/core/model.ts`. Pure functions, property-tested for round trip in `test/puml.test.ts`.
- **review-ui**: Vite page. Left: diagram. Right: proposal list with accept, rename, reject. Bottom: trace table.
- **trace**: reads and writes `trace.json`; computes in sync or stale by comparing the element hash stored at generation time.
- **drift-mcp**: small MCP server exposing `check_drift` and `list_trace`.
- **hook** (`.kiro/hooks/on-architecture-change`): on save of `architecture/*.puml`, asks the agent to generate or update code, tests and trace for changed elements only.

## Key decisions
- Element identity is a stable id in a `' id:` comment, so rename keeps links (R2.2).
- Stale detection uses a hash of the element block, not file mtime.
- Generation is agent work. The app never calls a model, so the demo needs no credits.

## Sample project
Plant-watering controller: `MoistureSensor`, `WateringController`, `PumpDriver`, `Scheduler`. Invented, generic.



## Context chain
Each requirement can be followed to its tests through one chain:

`requirement id (R1 to R6)` -> `spec task` (tasks.md cites the id, e.g. task 6 cites R5) -> `architecture element` (stable `' id:` in `architecture/*.puml`) -> `code file` (`src/<element>.ts`) -> `test file` (`test/<element>.test.ts`).

`trace.json` stores the element-to-code-to-test part of the chain. Each row holds the element id, code path, test path, the requirement ids and task number it satisfies, and the element hash at generation time. The hook writes the row when it generates files. The trace module compares the stored hash with the current element hash to mark a row in sync or stale. The drift checker reads the same rows, so a missing element, code file or test file shows up as drift.

Architecture as steering context: the approved `architecture/*.puml` files are given to the agent as steering. A steering file in `.kiro/steering/` is set to always-included and references the architecture files, so every request sees the current approved elements without the user pasting them. The hook prompt and the `check_drift` result then refer to elements by id. Proposals in `proposals.puml` are not part of this context until approved.

## Layout and merge (lessons borrowed from a prior PlantUML editor, as ideas only)
- PlantUML carries no coordinates. Positions live in a sidecar `architecture/layout.json`, keyed by element id, never in the `.puml`. The `.puml` stays a clean architecture file that diffs well in git.
- Parsing strips `@startuml`/`@enduml`, `skinparam`, `hide`, `scale`, `!` directives and direction hints, and keeps comment lines, because `' id:` comments carry element identity.
- When the `.puml` changes after a layout was saved: elements whose id still exists keep their position; new elements are placed beside their nearest linked element or at the bottom; removed elements are drawn as ghosts until the reviewer accepts the change. No auto-arrange is ever forced on a reviewed layout.
- Only the block dialect is supported: `component`, `interface`, `note`, `-->`, `..>` (proposal), and `' id:` / `' req:` comments. No sequence, state or activity diagrams in this slice.

## Hosting the demo
The UI is a static page on GitHub Pages. It opens the repository folder through the browser's File System Access API, so approving writes `architecture/*.puml` straight into the working copy and the Kiro hook fires. Chromium browsers only, which is stated on the page. No server, no credits, works offline.
