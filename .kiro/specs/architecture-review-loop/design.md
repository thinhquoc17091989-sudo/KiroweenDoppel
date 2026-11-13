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
This mirrors a prior in-house PlantUML editor I had worked on, which keeps one project as several diagram files (e.g. a BDD per subsystem, an IBD per interface) picked from a list rather than one file — an idea only, per the origin rule in steering/product.md; no code is shared.
Consequence for the UI: the top-level choice is Static vs Dynamic (two categories), and *within* Static there is a file picker (a chip row), not a third tab. `architecture/*.puml` in the always-on steering glob already covers "however many static files exist," so nothing about steering or the hook changes. What does change, tracked as a new task: `architecture/` needs an index (or just a directory listing) so the review UI and `propose-mcp` know which static file an element belongs to, and multi-file layout merge (today's `mergeLayout` assumes one file's worth of elements).

## File list replaces tabs, with a status per file (2026-11-12)
Superseding the tab-plus-chip navigation above: the review UI shows one persistent file list (not tabs), covering every file under `architecture/`, Static and Dynamic grouped separately. Each file carries exactly one status:
- **approved** — the current baseline for that file, nothing pending.
- **editing** — open now, with proposed or modified elements pending a decision.
- **new** — a file Kiro drafted for this change that does not exist in `architecture/` yet; it is written only when the reviewer approves the change set.
This generalizes the earlier model/parser note (an element can span static files) up one level: a *project* can hold any number of static and dynamic files, and the reviewer needs to see all of them, not just the one or two touched by the current change, so they always know what exists before deciding what to approve. `propose-mcp` (planned) must therefore report, per proposal, which existing file it edits versus which new file it creates, so the UI can set each file's status correctly; this is new information beyond what today's single-file model carries.

## Dynamic dialects: Sequence, State Machine, Activity (2026-11-12)
Three new parser/printer modules, matching the static dialect's shape (own file per dialect,
`' id:` / `' req:` / `' status:` comment triplet, property-based round-trip test), layout
ideas borrowed from that prior in-house editor as ideas only per steering's origin rule, no code shared:

- Shared foundation: `src/core/dsl.ts` factors the envelope-stripping and meta-comment
  pattern all three (and, going forward, the static dialect too) rely on. `src/core/rank.ts`
  factors the longest-path DAG ranking that prior editor uses for both its block layout (left-to-right)
  and its activity/state layout (top-to-bottom), one algorithm, the caller picks the axis.
  `src/core/layout.ts`'s existing `layers()` now calls it too, a safe refactor since the
  existing property and unit tests covered the old inline version and still pass unchanged.
- State machine (`src/core/state.ts`, `*.state.puml`): one flat machine only, no composite
  states, no concurrency, no choice/fork/history pseudostates (the prior editor supports all of
  these; this slice deliberately does not, tracked as follow-up). The start/end pseudostate
  token is positional: valid only as a transition's from (meaning initial) or to (final),
  never the reverse, matching what real PlantUML state-machine text without reversed arrows
  can express. A transition directly from the initial token to the final one is genuinely
  ambiguous even in real PlantUML and is dropped on parse, the same choice that editor's own
  importer makes. Layout: rankByLongestPath over states and transitions, rank becomes a row
  top-to-bottom, reusing that editor's observation that a state machine reads downward.
- Activity (`src/core/activity.ts`, `*.activity.puml`): NOT real PlantUML activity syntax,
  which chains steps implicitly and has no natural place for a stable id. This dialect
  declares action/decision nodes with an alias and connects them with explicit edges
  instead, a named departure, not an oversight. The start/end tokens are reserved words
  here, not a positional pseudostate like state's; the printer treats both ends fully
  symmetrically (fixed mid-implementation: an edge using end as a source or start as a
  destination, odd but not a parse error, used to vanish silently on print because only one
  direction of each was handled). While/repeat loops, fork/join and partitions are out of
  this slice, no loops means the layout is always a plain DAG, so it reuses
  rankByLongestPath directly with no cycle-breaking pass.
- Sequence (`src/core/sequence.ts`, `*.seq.puml`): closest to real PlantUML of the three,
  since a message already is one addressable, ordered line. The message carries the
  id/req/status triplet here, not the participant, a message is what a change actually adds
  or edits; participants are structural, like a static diagram's declared names. No
  fragments and no activation bars in this slice. Layout needs no ranking algorithm at all:
  column is participant declaration order, row is message declaration order.
- Status, uniformly: every dialect's primary content unit (element / state / action /
  decision / message) carries the same tri-state proposed, approved or modified now used
  project-wide (model.ts's Status widened to match; a modified status now round-trips
  through the static dialect's own parser and printer too, which only handled the first two
  until this pass). Secondary things, static Links, state Transitions, activity Edges, stay
  a plain proposed boolean, same as before; only the primary unit gets its own id.
- review.ts, three real fixes: approvedOnly now ships modified elements, not only approved
  ones (it used to silently drop them). refreshLinkStatus already dashed a link only for a
  proposed end, which turned out to already match the mockup's intent (a modified element's
  existing links stay solid), so no change was needed there, just confirmation. reject on a
  modified element still deletes it outright; the arguably correct behavior, revert to the
  prior approved content, needs a stored pre-change snapshot that nothing here keeps yet,
  flagged in code as a known simplification, not fixed blind.
- Not done this pass, by design: wiring these three dialects into the review UI (a renderer
  per dialect, multi-dialect file-list integration, layout persistence per file). That is
  real, separate UI work, scoped as follow-up rather than rushed alongside the parser and
  model work above.

## Shippable as a drop-in package (2026-11-13)
The product requirement: another team copies Doppel into their own project and gets set up
with a script or an AI call, not a manual walkthrough. Two consequences for what is already built:

- `main.ts` currently hardcodes `import sampleText from '../samples/plant-watering/proposals.puml?raw'`
  and a matching `localStorage` key. That only works inside this repo. A drop-in package needs
  the UI to load whatever `architecture/` and `proposals.puml` actually exist in the host
  project, with the plant-watering sample demoted to this repo's own demo content, not
  something the shipped package depends on.
- `.kiro/steering/architecture.md` and both hook files are already project-agnostic — they
  reference `architecture/*.puml` generically, not plant-watering by name — so these three
  files are already copy-paste-able into another project as they stand.

Two setup paths, not mutually exclusive:
- **Script setup** (`scripts/setup.mjs` or similar, not yet written): creates `architecture/`
  if missing, copies the steering file and hooks into the host's `.kiro/`, registers
  `drift-mcp` in `.kiro/settings/mcp.json`. Deterministic, no credits.
  Fits the **greenfield** use case (empty `architecture/`, start from a proposal).
- **AI-driven setup**: the user asks Kiro to bootstrap Doppel in an existing codebase. Kiro
  reads the real source, proposes an initial architecture via `propose-mcp` the same way it
  proposes a change, and the reviewer approves it like any other change set. Fits the
  **brownfield** use case named early in this project (bringing an existing codebase under
  Doppel rather than only starting new ones).
Both need the portability fix above done first; neither is useful while the UI only knows
how to load one hardcoded sample.

## Trace and drift, built (2026-11-13)
`src/core/trace.ts` is the one place that knows how to tell in-sync apart from stale apart
from no-code. A row's hash is computed only from kind, name and req (sorted, so order
never matters) — never id or alias (a rename must not look like a content change, that is
the entire point of a stable id) and never status (proposed vs approved vs modified is a
review decision, not a change to what was built). `trace.json` lives at the repo root,
keyed by element id, keys sorted on write so it diffs cleanly in git.

`mcp/check-drift.mjs` is the first half of task 10: a plain Node script, not yet a real MCP
tool, that reads every `architecture/*.puml` (static dialect only; the dynamic dialects
are not written into `architecture/` by anything yet), loads `trace.json`, and reports
no-code / stale / orphan-row elements via `trace.ts`. It is what the `drift-on-prompt` hook
was already pointed at and previously could not find. Node 24 strips TypeScript types
natively, so the script imports `src/core/*.ts` directly — no build step, no second copy
of the parsing logic. Tested by hand against all five real states (no architecture at all,
elements with no trace, all in sync, one stale, one orphan row) before trusting it.

One real Node/Windows finding worth keeping: calling `process.exit()` right after this
loader's async hooks raises a libuv assertion (`UV_HANDLE_CLOSING`) and crashes the process
even though the printed output was already correct. The fix was to stop calling
`process.exit()` at all and let the script end by falling off the bottom once the event
loop drains — not a workaround, the simpler and more correct shape anyway, since every
branch already wanted the same exit code 0 (drift found is information, not a script
failure). Keep this in mind for any other `.mjs` script here that imports `.ts` directly.

Still task 10b, not yet built: wrapping this same logic as a real MCP tool
(`check_drift`, `list_trace`) registered in `.kiro/settings/mcp.json`, so Kiro can call it
directly instead of only reading it secondhand through the prompt-submit hook's stdout.

## Generation mechanism verified end to end (2026-11-13)
Before trusting the hook to work, ran its exact job by hand once: a real
`architecture/plant-watering.puml` written by the actual parser/printer (not hand-typed),
Kiro (claude-sonnet-5.5) generating `src/*.ts` and `test/*.test.ts` for all 5 elements —
4 components get a class and a vitest test, the one interface element gets a TypeScript
`interface` and no test, matching the convention. Type-checked clean, all generated tests
pass for real, not stubs. `mcp/update-trace.mjs` recorded all 5 rows (never hand-written —
see its own doc comment for why that matters). `mcp/check-drift.mjs` then reported
everything in sync. Renaming one element's name (not its id) in the architecture file made
the checker report it stale immediately, restoring the name made it clean again — the exact
"rename, watch it go stale, watch it get fixed" moment the demo is built around, proven to
work mechanically, not just described.

Caught in the same pass: `on-architecture-change.json`'s `matcher` field was invalid JSON
(`"architecture/.*\.puml$"` — `\.` is not a legal JSON escape, only `\\.` is), meaning the
hook file could never have loaded at all. Fixed, and `test/hooks.test.ts` now parses every
`.kiro/hooks/*.json` file and checks its shape, so this class of silent breakage cannot
recur unnoticed.

What this does NOT yet prove: that the real `PostFileSave` trigger fires this generation
automatically inside a live Kiro session when a person (or Kiro itself) edits an approved
architecture file. That mechanism is still task 8b, to try interactively — everything it
would call (generation, `update-trace.mjs`, `check-drift.mjs`) is now known to work; only
the trigger itself is unverified.

## Dev console (2026-11-13, tooling, not part of the Doppel product)
`dev/dev-server.mjs` + `dev/console.html`, launched by `dev-console.bat`: a small local
server (127.0.0.1 only) behind a one-page UI — type a task description, pick a model,
click Run, see the architecture files, the trace table and any orphan rows update. Built
because iterating entirely through the command line was slow for fast visual feedback
during development. The shipped review page (`index.html`) never calls this; it exists for
developing Doppel, not for using it, and should not be confused with the product's own UI
in the submission write-up.

`/api/run` spawns Kiro CLI the same way every manual call in this project has (fs_read and
fs_write trust only, no shell trust — a broader grant was denied by this environment's own
sandbox once already) and then has to work out which `src/<id>.ts` files the run actually
touched, since Kiro is not trusted to call `update-trace.mjs` itself here. The first version
of that check compared file mtimes against the run's start time and genuinely missed a real
edit during testing: Kiro wrote a line into `moisture-sensor.ts`, its own text response
claimed it had not, and the file's mtime did not read back later than the run start either
on this Windows/Node combination — two independent signals (the agent's self-report AND the
mtime check) agreed, and both were wrong, confirmed by `git diff` against the last commit.
Fixed by comparing file CONTENT before and after instead of a timestamp — no precision to
get wrong, a byte-identical file is provably untouched. Verified afterward on all three
paths: a real edit correctly appears in `synced`, a no-op task correctly reports nothing,
and drift stays accurate either way.

## First real feature proposed through the dev console: R8 (2026-11-13)
Asked through the console for "skip watering when rain is forecast" as a new requirement.
Kiro added R8 to requirements.md, added a proposed `RainForecast` component (id
`rain-forecast`, req R8) to `samples/plant-watering/proposals.puml` with a dashed link from
WateringController, and correctly generated no code for it — proposed, not approved, so
nothing to generate yet, exactly the rule. It also caught something this project had
genuinely gotten wrong: the three dynamic-dialect sample files already covering this same
rain scenario (`watering-controller.state.puml`, `skip-watering-decision.activity.puml`,
`skip-watering-on-rain.seq.puml`) were tagged R7, which requirements.md had since reassigned
to a different, unrelated requirement — "Dynamic dialects," the property-based test
requirement added when those parsers were built. Two different things both called R7.
Retagged all three sample files (and the two test/samples.test.ts assertions that checked
the old tag) to R8.

Running the test suite was not possible from inside that session — this console grants
Kiro fs_read/fs_write only, no shell trust (the same scoping used everywhere else in this
project, and the same one the sandbox denied broadening earlier), so npx vitest failed with
a permission error, which the session reported honestly rather than silently skipping.
Running it afterward by hand found one real, expected failure: `puml.test.ts` hardcoded the
exact original 5-element list from `proposals.puml`, which the new proposal legitimately
extended to 6 — fixed by updating the test to the file's new content, not by reverting the
file. That same check also caught a second-order detail worth keeping: `rain-forecast` has
no `' status:' comment in the file (same as every other element there), so it parses as
'approved' at the raw-text level — it only reads as 'proposed' once `main.ts`'s
`loadSample()` applies the whole-file override that `proposals.puml` represents nothing but
proposals in the first place. Kiro matched the file's own existing convention correctly; an
over-specific test assertion was the thing that needed fixing, not the content.

## Compare-with-approved, in the real product this time (2026-11-13)
The dev console's two-panel view (proposals + approved) was mine only. The actual review
page (`index.html`) needed its own version — a "Compare with approved" toggle in the
header, splitting the canvas into two stacked panes, both drawn by the exact same
`render.ts`/`layout.ts` the single-pane view already used. No second rendering path.

Along the way, `btnApprove`'s directory-picker call stopped being re-prompted on every
click: the handle is now cached in a module-level `projectDir` once granted, reused by
both Approve and Compare for the rest of the session. This was needed for Compare to work
at all (it has to read the same folder Approve writes to) and happens to make repeated
approvals smoother too.

Loading the approved side reads every `*.puml` directly under `architecture/` (not
recursively, and not the dynamic dialects, which nothing writes there yet) and merges them
into one `Model`, the same flattening the dev console's `mergeArchitecture` does — a real
multi-file merge (an element spanning files, a shared layout) is still task 11b, not this.
A missing `architecture/` folder reads as "nothing approved yet," not an error.

## Still open: the auto-pop-up half of the request (not built this pass)
The other half of what was asked for — the page noticing on its own that Kiro finished and
surfacing the new proposal without the reviewer refreshing anything — is not built. The
honest shape for a shipped static page: poll the already-granted directory handle every
few seconds for `proposals.puml`'s last-modified time, and show a banner the moment it
changes, rather than claim an OS-level pop-up a browser tab cannot produce. Needs: a
polling interval decision, pause-when-tab-hidden handling (`document.visibilityState`), and
a decision on what the banner does — redraw in place vs. require a click to adopt the new
proposal (the latter is safer if the reviewer was mid-edit of the current one). Tracked as
task 26.

## Doppel Workbench: proposed direction, mocked up not built (2026-11-13)
Three linked mockups — `mockups/overview-steering.html`, `overview-hooks.html`,
`overview-mcp.html`, sharing `workbench.css` — show one standalone tool from three angles.
They are a proposal for review, nothing here is implemented. What they change about the
product as it stands today:

- **Standalone tool, many architectures.** Today's review page knows one hardcoded sample.
  The Workbench opens a project folder and shows a tree: project → feature → the files for
  that feature, with past versions (baseline v1, R8 v2) kept so a reviewer can look back at
  an earlier architecture instead of only the current one.
- **Tabs.** Several files open at once — a static architecture beside its own low-level
  diagrams, or this feature's architecture beside the baseline's, which is the "check in
  parallel" ask generalized beyond the single compare toggle already built.
- **Low-level design is a first-class output.** The sequence, state and activity dialects
  stop being samples and become what Kiro generates per feature, beside the code, during
  implementation. This is what those three parsers were actually for.
- **Write and trigger.** One button writes the approved files and then triggers Kiro,
  rather than relying on a file-save hook that (per the Kiro docs) only fires for changes
  the agent itself made. The dev console already proves this shape works: a local process
  can spawn Kiro CLI and read back the result.

**Format decision, asked and answered: PlantUML stays the source of truth.** Not JSON, not
Markdown. It is readable, it diffs cleanly in review, a person can hand-edit it, and the
parser already handles it. JSON appears only as derived index data — `trace.json` (element
→ code → test) and a possible per-project `index.json` so the tree can list what exists
without parsing every file. Markdown is for steering and prose, never for the architecture
itself. Switching the architecture to JSON would cost the entire parser and printer layer
and buy nothing a reviewer can read in a pull request.

Still open: whether a feature's versions are real directories or git history read through
the tool.

## Decided: local server + browser UI, not a desktop app, not a pure browser page (2026-11-13)
The deciding capability is not file editing — a browser page edits files fine through the
File System Access API, which today's Approve button already does. It is **starting Kiro**.
Spawning a process is a hard browser security boundary with no workaround, and Doppel's
write-and-trigger step depends on it.

| Capability | Browser page | Desktop app | Local server + browser |
|---|---|---|---|
| Read/write project files | after folder picker | yes | yes, no picker |
| Folder hierarchy | yes | yes | yes |
| Detect that Kiro finished | polling only | file watcher | file watcher |
| Start Kiro CLI | **no** | yes | **yes** |
| Host the MCP server | no | yes | yes |
| Install cost | none | build + sign per platform | one command |
| Browser support | Chromium only | n/a | any |

**Local server wins, and it is already proven here**: the dev console (`dev/api-plugin.mjs`
plus `dev/console.ts`) is exactly this architecture — a Node process that reads and writes
files, spawns Kiro CLI and serves a page that draws the diagrams. Electron would add build
and code-signing work before Dec 4 and buy almost nothing over it. It is also the shape of
Vite, Storybook and Prisma Studio, and it satisfies the drop-in requirement directly:
`npx doppel` inside someone else's project, nothing installed.

### Correction (2026-11-13): a hosted URL is NOT required, checked against the winner
An earlier version of this section claimed the rules force a clickable app URL and that a
local tool therefore needs a GitHub Pages build to comply. That was overstated. Checked
against the Kiroween 2025 grand prize winner (Kiro InteractionKit): its own README states a
webcam is required and there is **no hosted web demo** — a judge clones it, runs
`./setup.sh` or `.\setup.bat`, then `python my_apps/Math-O-Lantern/main.py`. That won the
top prize, so "URL to your working app" is plainly satisfiable with the repo link when
nothing is hosted. The rules agree elsewhere: the repo must carry "instructions required
for the project to be functional", which only matters if judges are expected to run things.

What the winner actually did about friction is the part to copy: one setup script covering
both platforms, then a single command per demo app, with nothing for a judge to work out.
That is the real bar, and it is what `npx doppel` (task 27) should clear.

So the static Pages build (task 28) drops from "needed for compliance" to optional — worth
doing only if time is left over, because a judge who can click something forms an
impression faster. The local-server decision above costs the submission nothing.

## The MCP server, built (2026-11-13, task 10b)
`mcp/server.mjs` exposes two tools to Kiro over stdio, using the official
`@modelcontextprotocol/sdk`:
- **check_drift** — elements with no code, elements gone stale, orphaned trace rows, plus
  the instruction to fix them via `update-trace.mjs` rather than hand-writing a hash.
- **list_trace** — requirement to element to code to test, optionally filtered by a
  requirement id, so Kiro can answer "what implements R8" by lookup instead of guessing.

It imports `src/core/trace.ts` and `src/core/puml.ts` directly, exactly as
`mcp/check-drift.mjs` does, so the CLI and the MCP tool are one implementation with two
front doors, never two copies that can disagree.

Two things that matter and are easy to get wrong:
- **stdout belongs to the protocol.** A single stray `console.log` corrupts the JSON-RPC
  stream and the connection dies silently. Diagnostics go to stderr, and
  `test/mcp-server.test.ts` asserts that nothing non-JSON ever reaches stdout.
- **Verified by speaking the protocol, not by assuming the SDK works.** The test spawns the
  server, performs a real `initialize` handshake, lists tools, and calls both — and
  separately, by hand, the drift path was forced into its stale and no-code states to
  confirm the tool reports them rather than only ever saying "no drift".

The `on-architecture-change` hook now tells the agent to call `check_drift` directly,
falling back to the CLI script if the tool is unavailable.

## Drop-in, working for real (2026-11-13, tasks 23 and 27)
`npx doppel` (or `node bin/doppel.mjs`) in any project folder serves the review page against
THAT project. The distinction that makes it work: Vite's root is the Doppel package (where
index.html and src/ live) while the API plugin's root is the host project (wherever the
command ran). Conflating them is the obvious bug — Vite would hunt for index.html in the
user's repo, or the API would serve Doppel's own sample instead of their architecture.

The review page now gets its data two ways and must work both:
- **served by the tool** — `/api/state` returns the host project's proposals file;
- **static hosting** — that fetch returns index.html with a 200 (an SPA fallback, NOT a 404),
  so the content type is what distinguishes the two, not the status code. Then the bundled
  plant-watering sample is used so a public demo link still works.
The header always names the file it read. Silently showing a sample while a reviewer
believes they are looking at their own project would be the worst failure available here.

**Two real bugs found by running it against a throwaway unrelated project** (a payments
architecture), not by reasoning about it:
1. The proposals path was still hardcoded to `samples/plant-watering/proposals.puml` — just
   moved from main.ts into the plugin. A real project had to mimic Doppel's demo folder
   layout before anything appeared. Now searched for at `proposals.puml`,
   `doppel/proposals.puml`, then the samples path last (so this repo still demoes itself).
2. Putting proposals at `architecture/proposals.puml` — the apparently natural spot, and the
   first fix attempted — **broke the core invariant**: `architecture/` means approved, and
   `.kiro/steering/architecture.md` feeds `architecture/*.puml` to Kiro wholesale as settled
   design. A proposals file there was read as approved AND double-counted every element
   shared with the real architecture (`checkout-api` appeared twice). Fixed by excluding it
   everywhere via one shared predicate, `isApprovedArchitectureFile` in `src/core/trace.ts`,
   because five separate readers glob that folder (dev API, MCP server, both mcp/ scripts,
   the review page) and they must agree exactly. Covered by tests.
