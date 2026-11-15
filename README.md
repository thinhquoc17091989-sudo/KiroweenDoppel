# Doppel

**You draw the architecture. Kiro writes the code and keeps it honest.**

Doppel is a Kiroween 2026 entry. It brings round-trip engineering back: an architecture
diagram that stays in sync with the code, because an AI agent does the syncing.

1. Kiro proposes an architecture as PlantUML. Proposed elements are drawn dashed.
2. You review it in the browser: inspect each element, describe it, drag it where it belongs.
3. Approving writes the diagram into `architecture/`, into the feature folder you choose.
4. A Kiro hook sees the change and generates one code file and one test file per element.
5. `trace.json` links every element to its requirement, code and test, so drift is visible.
6. A Kiro MCP tool checks for drift between architecture and code, so the agent can fix it.

## Install

Doppel runs against any project. It needs Node 22.6 or newer, because the CLI, the MCP
server and the review page all run locally.

```
npm install -g doppel-0.1.0.tgz
```

## Use it on your project

```
cd your-project
doppel init     # writes .kiro steering, hooks and the MCP server registration
doppel          # opens the review page for this project
```

`doppel init` never overwrites steering you have already written, and it merges its MCP
server into an existing `.kiro/settings/mcp.json` rather than replacing the file. If the
config cannot be parsed it leaves it alone and tells you what to add by hand.

Two things are worth knowing about where files land. Approved diagrams go into
`architecture/`, which Kiro steering feeds to the agent wholesale as the approved design.
Hand-placed positions go to `.doppel/layout/<diagram>.json` instead, committed with the
repo so your team opens a diagram arranged the way you left it, and deliberately kept out
of `architecture/` because pixel coordinates are not design.

## Check drift without opening the page

```
node mcp/check-drift.mjs --root path/to/your-project
```

The same answer is available to Kiro as the `check_drift` MCP tool, which is what the hook
calls after generating code.

## Developing Doppel itself

```
npm install
npm test        # the tool's own tests
npm run dev     # the review page against this repo
```

This repository is the tool only. The Node side (CLI, dev server, MCP server) imports a
compiled copy of the core from `dist-node/`, built by `npm run build:node` and rebuilt
automatically on install and before packing. That build exists because Node refuses to
strip TypeScript types for files under `node_modules`, so an installed package cannot load
raw `.ts`.

`samples/plant-watering/` holds the PlantUML fixtures the parser tests run against. It is
an invented plant-watering controller; no real system data is used anywhere.

## License

MIT
