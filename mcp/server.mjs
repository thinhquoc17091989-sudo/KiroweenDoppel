#!/usr/bin/env node
/**
 * Doppel's own MCP server: lets Kiro ask, mid-conversation, whether the code still matches
 * the architecture — instead of a human running a script afterwards and pasting the result
 * in. Task 10b; mcp/check-drift.mjs (task 10a) remains the CLI form of the same logic, and
 * both import src/core/trace.ts, so there is one implementation, not two.
 *
 * Tools:
 *   check_drift  — elements with no code, elements gone stale, orphaned trace rows
 *   list_trace   — requirement → element → code → test, so Kiro can answer "what
 *                  implements R8" by looking it up rather than guessing
 *
 * Transport is stdio: Kiro spawns this process and speaks JSON-RPC over stdin/stdout.
 * Nothing may ever be written to stdout except protocol messages — a stray console.log
 * corrupts the stream and the connection dies. Diagnostics go to stderr.
 *
 * Register in .kiro/settings/mcp.json; see that file for the exact block.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parse as parsePuml } from '../src/core/puml.ts';
import { computeStatus, emptyTrace, isApprovedArchitectureFile, orphanRows, parseTrace } from '../src/core/trace.ts';

// The project root. Kiro launches the server with cwd set to the workspace; DOPPEL_ROOT
// overrides that for anyone running it from somewhere else.
const ROOT = process.env.DOPPEL_ROOT || process.cwd();

/**
 * How the agent should invoke update-trace.mjs from the project it is working in. Doppel
 * often does not live inside that project (installed as a dependency, or run from a clone
 * elsewhere), so a bare "mcp/update-trace.mjs" is only right inside Doppel's own repo —
 * telling an agent to run a path that does not resolve is worse than saying nothing.
 */
const UPDATE_TRACE_CMD = (() => {
  const abs = join(dirname(fileURLToPath(import.meta.url)), 'update-trace.mjs');
  const rel = relative(ROOT, abs).split('\\').join('/');
  return `node ${rel.startsWith('..') ? abs.split('\\').join('/') : rel}`;
})();

function loadArchitecture() {
  const dir = join(ROOT, 'architecture');
  if (!existsSync(dir)) return [];
  const elements = [];
  for (const name of readdirSync(dir).filter(isApprovedArchitectureFile)) {
    elements.push(...parsePuml(readFileSync(join(dir, name), 'utf8')).elements);
  }
  return elements;
}

function loadTrace() {
  const p = join(ROOT, 'trace.json');
  if (!existsSync(p)) return emptyTrace();
  try { return parseTrace(readFileSync(p, 'utf8')); } catch { return emptyTrace(); }
}

/** One text block back to the agent. MCP content is a list; a single text entry is enough
 *  here, and plain prose reads better in Kiro's context than JSON it has to re-parse. */
const text = (s) => ({ content: [{ type: 'text', text: s }] });

const server = new McpServer({ name: 'doppel-drift', version: '0.1.0' });

server.registerTool(
  'check_drift',
  {
    title: 'Check architecture drift',
    description:
      'Compare the approved architecture (architecture/*.puml) against trace.json and report ' +
      'elements with no generated code, elements whose code is stale because the element changed ' +
      'after generation, and orphaned trace rows whose element no longer exists. Call this before ' +
      'claiming the code matches the design, and after generating or changing any element.',
    inputSchema: {},
  },
  async () => {
    const elements = loadArchitecture();
    if (!elements.length) return text('No architecture/*.puml files found — nothing to check yet.');

    const trace = loadTrace();
    const entries = computeStatus(elements, trace);
    const noCode = entries.filter((e) => e.state === 'no-code');
    const stale = entries.filter((e) => e.state === 'stale');
    const orphans = orphanRows(elements, trace);

    if (!noCode.length && !stale.length && !orphans.length) {
      return text(`No drift. All ${entries.length} element(s) are in sync with their generated code.`);
    }

    const lines = [`Drift found across ${entries.length} element(s):`];
    if (noCode.length) {
      lines.push('', `${noCode.length} with no generated code:`);
      for (const e of noCode) lines.push(`  - ${e.id} (${e.name}) — expected src/${e.id}.ts`);
    }
    if (stale.length) {
      lines.push('', `${stale.length} stale (element changed after its code was generated):`);
      for (const e of stale) lines.push(`  - ${e.id} (${e.name}) — ${e.codePath}`);
    }
    if (orphans.length) {
      lines.push('', `${orphans.length} orphaned trace row(s) (element no longer in the architecture):`);
      for (const r of orphans) lines.push(`  - ${r.id} — ${r.codePath}`);
    }
    lines.push('', `To fix: regenerate or update the named files, then run \`${UPDATE_TRACE_CMD} <element-id>\` for each. Never hand-write a trace.json hash.`);
    return text(lines.join('\n'));
  },
);

server.registerTool(
  'list_trace',
  {
    title: 'List architecture trace',
    description:
      'List every architecture element with the requirements it satisfies, its generated code and ' +
      'test file, and whether it is in sync. Use this to answer questions like "what implements R8" ' +
      'or "which file covers this element" without searching the repository.',
    inputSchema: {
      requirement: z
        .string()
        .optional()
        .describe('Optional requirement id (for example "R8") to list only elements satisfying it.'),
    },
  },
  async ({ requirement }) => {
    const elements = loadArchitecture();
    if (!elements.length) return text('No architecture/*.puml files found — nothing to list yet.');

    const trace = loadTrace();
    let entries = computeStatus(elements, trace);
    if (requirement) {
      const want = requirement.trim().toUpperCase();
      entries = entries.filter((e) => e.req.some((r) => r.toUpperCase() === want));
      if (!entries.length) return text(`No element satisfies ${requirement}.`);
    }

    const lines = [requirement ? `Elements satisfying ${requirement}:` : 'Architecture trace:'];
    for (const e of entries) {
      const req = e.req.length ? e.req.join(' ') : 'no requirement tagged';
      lines.push(`  - ${e.id} (${e.name}) [${req}] — ${e.state}; code ${e.codePath ?? 'none'}, test ${e.testPath ?? 'none'}`);
    }
    return text(lines.join('\n'));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`doppel-drift MCP server ready (root: ${ROOT})`); // stderr: safe, stdout is the protocol
