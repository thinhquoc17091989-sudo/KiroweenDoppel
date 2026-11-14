/**
 * `doppel init` — scaffolds a HOST project so Kiro actually knows about Doppel there.
 *
 * Serving the review page is the easy half; without this, a project gets the UI and no Kiro
 * integration at all: no steering telling Kiro what the approved architecture is, no hook
 * regenerating code when it changes, no MCP server to check drift. This writes those.
 *
 * Every generated path points at wherever Doppel actually lives relative to the host
 * project, because `node mcp/server.mjs` is only correct inside Doppel's own repo — in a
 * project that installed it, the scripts sit under node_modules.
 *
 * Never overwrites. Existing files are reported and left alone, so re-running is safe and a
 * project that has customised its steering does not silently lose it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Doppel's own demo content, by exact path. Only ever removed by an explicit `--clean`,
 * and only these paths — never a glob, never a directory sweep, because this deletes files
 * in someone's project. Everything here is demo material shipped with Doppel; none of it is
 * Doppel's implementation (src/core, src/ui, src/main.ts, mcp/, dev/, bin/ all stay).
 *
 * This matters for the "rename Doppel's folder and build in it" route: without clearing
 * these, plant-watering becomes YOUR approved architecture, trace.json claims five elements
 * you never wrote, and the drift checker cheerfully reports no drift about all of it.
 */
const DEMO_CONTENT = [
  'architecture/plant-watering.puml',
  'architecture/layout.json',
  'trace.json',
  'src/moisture-sensor.ts',
  'src/moisture-reading.ts',
  'src/pump-driver.ts',
  'src/scheduler.ts',
  'src/watering-controller.ts',
  'test/moisture-sensor.test.ts',
  'test/pump-driver.test.ts',
  'test/scheduler.test.ts',
  'test/watering-controller.test.ts',
  'test/samples.test.ts',
  'samples/plant-watering/proposals.puml',
  'samples/plant-watering/watering-controller.state.puml',
  'samples/plant-watering/skip-watering-decision.activity.puml',
  'samples/plant-watering/skip-watering-on-rain.seq.puml',
];

export function cleanDemoContent(projectRoot) {
  const removed = [];
  for (const rel of DEMO_CONTENT) {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) continue;
    rmSync(abs, { force: true });
    removed.push(rel);
  }
  return removed;
}

/** Path to a Doppel script as the HOST project should refer to it. */
function scriptPath(projectRoot, packageDir, rel) {
  const abs = join(packageDir, rel);
  const relPath = relative(projectRoot, abs).split('\\').join('/');
  // If Doppel sits outside the project entirely (running from a clone elsewhere), a
  // relative path would escape upward and break once anything moves; use absolute.
  return relPath.startsWith('..') ? abs.split('\\').join('/') : relPath;
}

const STEERING = `---
inclusion: always
---
# Approved architecture

The approved architecture for this project is in \`architecture/*.puml\`. Read it before you
write or change any code.

#[[file:architecture/*.puml]]

## Rules

- Element ids are the stable identity. Each element carries an \`' id:\` comment.
  Refer to an element by its id in code, tests, comments and trace.json — never by its
  display name or alias, because a reviewer may rename those and the id will not change.
- Code for an element goes in \`src/<element-id>.ts\`; its test in \`test/<element-id>.test.ts\`.
- After writing or changing an element's files, record it by running the update-trace script
  (see .kiro/hooks/on-architecture-change.json for the exact command). Never hand-write a
  hash into trace.json — it must come from the script, or drift reporting becomes wrong.
- Do not write code for anything that is not in \`architecture/*.puml\`. A proposals file is
  not approved and is not part of this architecture until a reviewer approves it.
`;

const PROPOSALS_STARTER = `@startuml proposal
' Proposals awaiting review. Dashed links (..>) are proposed.
' Each element carries a stable id; renaming the display name never changes it.
' Approve these in Doppel and they become architecture/*.puml.

' id: example-service
' req: R1
component "ExampleService" as ExampleService

' id: example-store
' req: R1
component "ExampleStore" as ExampleStore

ExampleService ..> ExampleStore : reads and writes
@enduml
`;

export function runInit(projectRoot, packageDir, { clean = false } = {}) {
  const created = [];
  const skipped = [];
  const merged = [];
  const failed = [];
  // Clear first, so the starter proposals.puml and architecture/ below are written into a
  // project with no leftover demo content rather than alongside it.
  const removed = clean ? cleanDemoContent(projectRoot) : [];

  const write = (relPath, contents) => {
    const abs = join(projectRoot, relPath);
    if (existsSync(abs)) { skipped.push(relPath); return; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
    created.push(relPath);
  };

  const serverJs = scriptPath(projectRoot, packageDir, 'mcp/server.mjs');
  const updateJs = scriptPath(projectRoot, packageDir, 'mcp/update-trace.mjs');
  const driftJs = scriptPath(projectRoot, packageDir, 'mcp/check-drift.mjs');

  // architecture/ must exist, or there is nowhere for an approval to land.
  const archDir = join(projectRoot, 'architecture');
  if (!existsSync(archDir)) { mkdirSync(archDir, { recursive: true }); created.push('architecture/'); }
  else skipped.push('architecture/');

  write('proposals.puml', PROPOSALS_STARTER);
  write('.kiro/steering/architecture.md', STEERING);

  write('.kiro/hooks/on-architecture-change.json', JSON.stringify({
    version: 'v1',
    hooks: [{
      name: 'On architecture change',
      description: 'When an approved architecture file is saved, generate or update code and tests for the changed elements, then record and check them.',
      enabled: true,
      trigger: 'PostFileSave',
      matcher: 'architecture/.*\\.puml$',
      action: {
        type: 'agent',
        prompt:
          'An approved architecture file under architecture/ changed. Read .kiro/steering/architecture.md and the changed file. ' +
          'For each approved element that is new or whose block changed, generate or update src/<element-id>.ts and ' +
          'test/<element-id>.test.ts. Do not touch unchanged elements. After writing each element\'s files, run ' +
          `\`node ${updateJs} <element-id>\` to record it — never hand-write a trace.json row, its hash must come from that script. ` +
          'Then call the check_drift MCP tool and fix anything it reports.',
      },
    }],
  }, null, 2) + '\n');

  write('.kiro/hooks/drift-on-prompt.json', JSON.stringify({
    version: 'v1',
    hooks: [{
      name: 'Drift check on every prompt',
      description: 'File hooks only see agent-made saves, so approvals made in the Doppel UI are picked up here instead: report drift before each prompt.',
      enabled: true,
      trigger: 'PromptSubmit',
      action: { type: 'command', command: `node ${driftJs} --brief`, timeout: 20 },
    }],
  }, null, 2) + '\n');

  // mcp.json is MERGED, not skipped. A project already using Kiro almost certainly has
  // other servers registered here; skipping it (as every other file here is skipped) would
  // silently leave doppel-drift unregistered, and the user would get no MCP tool with
  // nothing but a "left untouched" line to explain why. Merging touches only our own key.
  const mcpRel = '.kiro/settings/mcp.json';
  const mcpAbs = join(projectRoot, mcpRel);
  const ourServer = {
    command: 'node',
    args: [serverJs],
    disabled: false,
    autoApprove: ['check_drift', 'list_trace'],
  };

  if (!existsSync(mcpAbs)) {
    mkdirSync(dirname(mcpAbs), { recursive: true });
    writeFileSync(mcpAbs, JSON.stringify({ mcpServers: { 'doppel-drift': ourServer } }, null, 2) + '\n');
    created.push(mcpRel);
  } else {
    let existing;
    try {
      existing = JSON.parse(readFileSync(mcpAbs, 'utf8'));
    } catch {
      // Malformed JSON: leave it completely alone. Overwriting someone's whole MCP config
      // because it had a trailing comma would be far worse than not registering ourselves.
      failed.push(`${mcpRel} — could not be parsed as JSON, so it was left untouched. Add this to "mcpServers" by hand:\n      "doppel-drift": ${JSON.stringify(ourServer)}`);
      return { created, skipped, removed, merged, failed, projectRoot };
    }
    const servers = existing.mcpServers ?? (existing.mcpServers = {});
    const had = Object.prototype.hasOwnProperty.call(servers, 'doppel-drift');
    const unchanged = had && JSON.stringify(servers['doppel-drift']) === JSON.stringify(ourServer);
    if (unchanged) {
      skipped.push(`${mcpRel} (doppel-drift already registered)`);
    } else {
      servers['doppel-drift'] = ourServer;
      writeFileSync(mcpAbs, JSON.stringify(existing, null, 2) + '\n');
      const others = Object.keys(servers).filter((k) => k !== 'doppel-drift');
      merged.push(
        `${mcpRel} — ${had ? 'updated' : 'added'} "doppel-drift"` +
        (others.length ? `, left ${others.length} other server(s) untouched: ${others.join(', ')}` : ''),
      );
    }
  }

  return { created, skipped, removed, merged, failed, projectRoot };
}

export function reportInit({ created, skipped, removed = [], merged = [], failed = [], projectRoot }) {
  console.log(`Doppel init — ${projectRoot}\n`);
  // Deletions are reported first and in full: a command that removes files from someone's
  // project must never be quiet about which ones.
  if (removed.length) {
    console.log("  removed Doppel's demo content:");
    for (const f of removed) console.log(`    - ${f}`);
    console.log('');
  }
  if (created.length) {
    console.log('  created:');
    for (const f of created) console.log(`    + ${f}`);
  }
  if (merged.length) {
    console.log('  merged into existing config:');
    for (const f of merged) console.log(`    ~ ${f}`);
  }
  if (skipped.length) {
    console.log('  already there, left untouched:');
    for (const f of skipped) console.log(`    · ${f}`);
  }
  if (failed.length) {
    console.log('\n  NEEDS YOUR ATTENTION:');
    for (const f of failed) console.log(`    ! ${f}`);
  }
  console.log('\n  Next:');
  console.log('    1. Edit proposals.puml, or ask Kiro to propose an architecture for this project.');
  console.log('    2. Run the tool and approve what you want: elements become architecture/*.puml.');
  console.log('    3. Kiro then has steering, a hook, and the check_drift MCP tool for this project.\n');
}

export { scriptPath as _scriptPath };
