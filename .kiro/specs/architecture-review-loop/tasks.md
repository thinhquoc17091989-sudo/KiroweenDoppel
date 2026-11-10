# Tasks (owner: K = Kiro, C = Claude Code, U = user)

## Week 1, Nov 10 to 16: foundation
- [ ] 1. (U) Employer OK for public repo. Resubmit Kiro credit request. Create empty public GitHub repo `doppel` with MIT license.
- [x] 2. (C) Scaffold: Vite + TypeScript + Vitest + fast-check, README stub, `samples/plant-watering/proposals.puml`
- [x] 3. (C) puml-subset parser and printer (R3.2)
  - [x] 3.1 Property-based round-trip test
- [x] 4. (K) Review and tighten requirements.md and design.md against the scaffold. Add `.kiro/steering/architecture.md` that always includes `architecture/*.puml`.

## Week 2, Nov 17 to 23: the loop
- [x] 5. (C) Review UI: SVG diagram, dashed vs solid, drag to position, `layout.json` sidecar (R1)
- [x] 6. (C) Accept, rename, reject (R2); approve writes `architecture/*.puml` via File System Access API (R3.1)
- [ ] 7. (C) Trace module, `trace.json`, stale detection by element hash (R5)
- [ ] 8. (K) Hook: on architecture change, generate one code file and one test file per changed element and update trace rows (R4). Run on the plant-watering sample.
- [ ] 9. (C) Trace table in UI (R5.1)

## Week 3, Nov 24 to 30: MCP, second sample, polish
- [ ] 10. (K, C reviews) drift-mcp server with `check_drift` and `list_trace`; register in `.kiro/settings/mcp.json`; hook calls it (R6)
- [ ] 11. (K) Second sample system `samples/library-lending` to show versatility
- [ ] 12. (C) UI polish, dark theme, GitHub Pages deploy
- [ ] 13. (K) README: Kiro usage write-up with one sentence per feature and what it changed

## Week 4, Dec 1 to 4: ship
- [ ] 14. (U) Credits deadline Dec 1 noon PT. Record 3-minute video: open diagram, accept and rename, approve, hook generates files, rename again, trace goes stale, drift tool reports, Kiro fixes.
- [ ] 15. (U, C drafts) Blog post and #KiroweenHackathon26 social post. Submit on Devpost by Dec 3 to keep a day of buffer.
