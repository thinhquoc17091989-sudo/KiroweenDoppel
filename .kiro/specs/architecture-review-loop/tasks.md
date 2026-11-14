# Tasks (owner: K = Kiro, C = Claude Code, U = user)

## Week 1, Nov 10 to 16: foundation
- [x] 1. (U) Public GitHub repo created with an MIT license.
- [x] 2. (C) Scaffold: Vite + TypeScript + Vitest + fast-check, README stub, `samples/plant-watering/proposals.puml`
- [x] 3. (C) puml-subset parser and printer (R3.2)
  - [x] 3.1 Property-based round-trip test
- [x] 4. (K) Review and tighten requirements.md and design.md against the scaffold. Add `.kiro/steering/architecture.md` that always includes `architecture/*.puml`.

## Week 2, Nov 17 to 23: the loop
- [x] 5. (C) Review UI: SVG diagram, dashed vs solid, drag to position, `layout.json` sidecar (R1)
- [x] 6. (C) Accept, rename, reject (R2); approve writes `architecture/*.puml` via File System Access API (R3.1)
- [x] 7. (C) Trace module, `trace.json`, stale detection by element hash (R5)
- [x] 8a. (K, Sonnet) Generation mechanism verified manually on the plant-watering sample: a real approved architecture/plant-watering.puml, 5 real generated src/test files (type-checked, all pass), trace.json recorded via update-trace.mjs, drift clean. Proved the actual demo moment too: renaming an element's name in the architecture file made check-drift.mjs report it stale; restoring made it clean again.
- [ ] 8b. (U, to try interactively) The live PostFileSave hook itself -- Kiro editing architecture/*.puml inside a real IDE/CLI session, not this manual run -- is still unverified; see the hook JSON bug fixed in this same pass (task 8a's work also caught and fixed invalid JSON in on-architecture-change.json: `\.` is not a legal JSON escape, so the file would not have loaded at all before this fix)
- [ ] 9. (C) Trace table in UI (R5.1)

## Week 3, Nov 24 to 30: MCP, second sample, polish
- [x] 10a. (C) mcp/check-drift.mjs: plain Node script, no-code/stale/orphan report from architecture/*.puml + trace.json, fixes the drift-on-prompt hook (R6). Tested against real no-architecture, no-code, in-sync, stale and orphan states.
- [x] 10b. (C) Real MCP server: mcp/server.mjs exposes check_drift and list_trace over stdio (official @modelcontextprotocol/sdk), registered in .kiro/settings/mcp.json, verified by a real JSON-RPC handshake in test/mcp-server.test.ts (not just assumed)
- [ ] 11. (K) Second sample system `samples/library-lending` to show versatility
- [x] 11a. (C) Add `status: 'modified'` to the Status type (now shared via dsl.ts across every dialect) and wire it through review.ts, render.ts, main.ts, style.css
- [ ] 11b. (C) Multi-file architecture: a file picker inside Static, one element id resolvable across files, layout merge aware of which file an element came from
- [ ] 12. (C) UI polish, dark theme, GitHub Pages deploy
- [ ] 13. (K) README: Kiro usage write-up with one sentence per feature and what it changed

## Week 4, Dec 1 to 4: ship
- [ ] 14. (U) Credits deadline Dec 1 noon PT. Record 3-minute video: open diagram, accept and rename, approve, hook generates files, rename again, trace goes stale, drift tool reports, Kiro fixes.
- [ ] 15. (U, C drafts) Blog post and #KiroweenHackathon26 social post. Submit on Devpost by Dec 3 to keep a day of buffer.

## Dynamic dialects (added 2026-11-12, referencing a prior in-house editor's layout ideas)
- [x] 16. (C) Shared dsl.ts (envelope + id/req/status comment) and rank.ts (longest-path ranking), layout.ts's layers() refactored onto it
- [x] 17. (C) State machine dialect: src/core/state.ts, property-based round-trip test
- [x] 18. (C) Activity dialect: src/core/activity.ts, property-based round-trip test
- [x] 19. (C) Sequence dialect: src/core/sequence.ts, property-based round-trip test
- [x] 20. (K, Haiku 5.5) Draft the three R7 sample files (state/activity/sequence), verified by parsing them with the real parsers (test/samples.test.ts), not by trusting the model's own report
- [ ] 21. (C) Render each dynamic dialect in the review UI; extend the file-list sidebar to multi-dialect selection; persist layout per file
- [ ] 22. (C) reject() on a 'modified' element: store a pre-change snapshot so reject can revert instead of delete

## Shippable as a package (added 2026-11-13)
- [x] 23. (C) Stop hardcoding the plant-watering sample: main.ts fetches /api/state for the HOST project's proposals, falling back to the bundled sample only when no server is present (static hosting), and says which it is reading. Proposals are searched for at proposals.puml / doppel/proposals.puml / samples/... -- never architecture/proposals.puml, which would feed unapproved proposals to Kiro as approved truth
- [x] 24. (C) `doppel init` (bin/init.mjs): scaffolds a HOST project -- architecture/, a starter proposals.puml, always-on steering, both hooks, and .kiro/settings/mcp.json, every generated path resolved to wherever Doppel actually lives. Never overwrites. Verified in a clean project: paths resolve, the drift script runs, and the MCP server reports on THAT project's architecture
- [ ] 25. (K) AI-driven bootstrap: Kiro proposes an initial architecture from an existing codebase via propose-mcp (brownfield path)
- [ ] 29. (C) Configurable code directory: generated src/<id>.ts collides with Doppel's own src/ when Doppel's folder is reused as the project (scenario A). Functional but untidy.

## Compare and auto-detect (added 2026-11-13, product UI this time, not the dev console)
- [x] 25b. (C) "Compare with approved" toggle in the real review page: cached directory handle, loads and merges architecture/*.puml, renders beside the proposal using the same render.ts/layout.ts
- [ ] 26. (C) Auto-detect a finished Kiro run: poll the granted directory handle for proposals.puml's last-modified time, banner on change, pause while the tab is hidden

## Delivery shape (decided 2026-11-13)
- [x] 27. (C) `npx doppel` entry point (bin/doppel.mjs): Vite root = the Doppel package, data root = the host project (--root to override). Verified against a throwaway unrelated project (a payments architecture) that it serves THAT project's files and none of Doppel's own
- [ ] 28. (C, OPTIONAL — not required for compliance, see design.md correction) Static GitHub Pages build: sample data, read-only, lowers friction for a judge but the repo link is a valid "working app URL" on its own
