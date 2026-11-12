# Design: architecture review loop

## Data flow
`proposals.puml` -> review UI -> `architecture/*.puml` (approved) -> hook -> `src/<element>.ts` + `test/<element>.test.ts` -> `trace.json` -> trace table + drift MCP.

## Components
- **puml-subset**: parser and printer for the restricted subset in `src/core/puml.ts`, with the element types in `src/core/model.ts`. Pure functions, property-tested for round trip in `test/puml.test.ts`.
- **review-ui**: Vite page. Left: diagram. Right: proposal list with accept, rename, reject. Bottom: trace table.
- **trace**: reads and writes `trace.json`; computes in sync or stale by comparing the element hash stored at generation time.
- **drift-mcp**: small MCP server exposing `check_drift` and `list_trace`.
- **hook** (`.kiro/hooks/on-architecture-change.json`, trigger `PostFileSave`, regex matcher on `architecture/*.puml`): on save of `architecture/*.puml`, asks the agent to generate or update code, tests and trace for changed elements only.

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

## Hook constraint (from the Kiro docs, 2026-11-10)
File Create, File Save and File Delete hooks fire only on changes made by the agent. A file the Doppel UI writes through the File System Access API does not fire them. Therefore two hooks:
- `on-architecture-change.json`, `PostFileSave` on `architecture/.*\.puml$`: fires when Kiro itself edits the architecture, for example when the reviewer asks Kiro to split or rename an element in chat.
- `drift-on-prompt.json`, `PromptSubmit` command hook: runs the drift checker before every prompt, so an approval made in the UI is seen by the agent on the next message without the reviewer having to describe it. To verify in task 8: that a command hook's stdout is injected into the agent context on this Kiro version.
Both hooks exist in `.kiro/hooks/` as JSON with `version: "v1"`, a `hooks` array, PascalCase `trigger`, regex `matcher`, and an `action` of type `agent` or `command`.

## Entry point is Kiro chat, not a Doppel screen (2026-11-12)
There is no Doppel "ask Kiro" page. The reviewer talks to Kiro directly, in the IDE, CLI or Web, the way they would for any other request. Two things make that sufficient:
- **New vs continuing is free.** `.kiro/steering/architecture.md` is always-included and references `architecture/*.puml`. An empty glob means no approved architecture exists yet, so Kiro is starting fresh; a non-empty one means it is proposing a change against what is there. Kiro infers this from context already loaded on every request. Nothing in Doppel needs to detect or tell it which case it is.
- **`propose-mcp`** (new component, see below): a small MCP tool Kiro calls on its own after a chat request, never a UI the reviewer opens. It writes the actual `proposals.puml` delta in the exact dialect `src/core/puml.ts` parses: stable kebab-case ids, `' req:` lines, `' status: proposed` on new or changed elements, `' status: modified` on an existing approved element whose block changed (see Status below). This exists because free-form generation drifts on exact syntax over many turns; a tool call does not.
- Doppel's own UI starts at review: the diagram with proposed and modified elements, the change list, accept/rename/reject, approve. Trace and drift come after approval. These are the two mockup pages kept as plain HTML (see Mockups below).

## Status gains `modified` (change needed in src/core/model.ts)
The model's `Status` is `'proposed' | 'approved'` today. The mockup needs a third state: an **approved** element whose block changed since last approval, drawn amber, listed with a diff-style note, and counted as stale in the trace table even before the reviewer re-approves it. Add `'modified'` to `Status`; `approvedOnly()` treats `modified` as still-approved content (it ships) but `refreshLinkStatus` and the UI continue to show it as a pending decision. Not yet implemented; tracked as a task.

## Mockups
Static, non-interactive HTML files under `mockups/`, viewed directly in a browser, no publishing step and no dependency on any hosted service:
- `mockups/review.html`: the diagram with existing (solid green), modified (amber) and proposed (dashed purple) elements, switchable by tabs for Topology / Static / Dynamic (dynamic is a sequence-diagram sketch, out of scope for the coded parser in this slice), the change list with accept/rename/reject and reasons, and the live PlantUML diff.
- `mockups/trace.html`: the requirement-to-test table including missing and orphan rows, and the drift report with what Kiro will do about each item.
These superseded an earlier version of the same two screens plus a since-dropped "ask Kiro" screen, built as a hosted design-canvas artifact for a first look; that artifact still exists privately but is not part of the repo or the submission.

## Architecture is a folder of files, not three categories (2026-11-12, corrects the mockup above)
Topology is not a sibling of Static. It is a static diagram like any other, just at system/deployment scope instead of component scope. The real distinction is only:
- **Static** (one dialect, `src/core/puml.ts`): any number of `.puml` files under `architecture/`, each one view at some scope — a topology/deployment view, a block/component view, a refined view of one block. An element id can appear in more than one static file (e.g. a block shown in the topology view and detailed in a component view); `trace.json` rows key by element id, not by file, so this is not a new concept for trace, only for the file layer above it.
- **Dynamic** (a separate dialect, not yet in the parser): sequence/behavior files, referencing static element ids but describing scenarios, not structure.
This mirrors RIAPS's SysArch, which keeps one project as several diagram files (e.g. a BDD per subsystem, an IBD per interface) picked from a list rather than one file — an idea only, per the origin rule in steering/product.md; no code is shared.
Consequence for the UI: the top-level choice is Static vs Dynamic (two categories), and *within* Static there is a file picker (a chip row), not a third tab. `architecture/*.puml` in the always-on steering glob already covers "however many static files exist," so nothing about steering or the hook changes. What does change, tracked as a new task: `architecture/` needs an index (or just a directory listing) so the review UI and `propose-mcp` know which static file an element belongs to, and multi-file layout merge (today's `mergeLayout` assumes one file's worth of elements).

## File list replaces tabs, with a status per file (2026-11-12)
Superseding the tab-plus-chip navigation above: the review UI shows one persistent file list (not tabs), covering every file under `architecture/`, Static and Dynamic grouped separately. Each file carries exactly one status:
- **approved** — the current baseline for that file, nothing pending.
- **editing** — open now, with proposed or modified elements pending a decision.
- **new** — a file Kiro drafted for this change that does not exist in `architecture/` yet; it is written only when the reviewer approves the change set.
This generalizes the earlier model/parser note (an element can span static files) up one level: a *project* can hold any number of static and dynamic files, and the reviewer needs to see all of them, not just the one or two touched by the current change, so they always know what exists before deciding what to approve. `propose-mcp` (planned) must therefore report, per proposal, which existing file it edits versus which new file it creates, so the UI can set each file's status correctly; this is new information beyond what today's single-file model carries.
