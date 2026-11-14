import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error - plain .mjs module, no types, deliberately kept dependency-free
import { runInit, cleanDemoContent } from '../bin/init.mjs';

/**
 * `doppel init` writes into somebody else's project. These tests exist because the ways it
 * can go wrong are all silent and all destructive: clobbering an existing .kiro setup,
 * dropping other MCP servers while registering ours, or wiping a config it could not parse.
 */
const PACKAGE_DIR = process.cwd();
let project: string;

beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'doppel-init-')); });
afterEach(() => { rmSync(project, { recursive: true, force: true }); });

const readJson = (rel: string) => JSON.parse(readFileSync(join(project, rel), 'utf8'));
const MCP = '.kiro/settings/mcp.json';

describe('doppel init, fresh project', () => {
  it('creates the files Kiro needs and a place for approvals to land', () => {
    runInit(project, PACKAGE_DIR);
    for (const f of ['architecture', 'proposals.puml', '.kiro/steering/architecture.md',
      '.kiro/hooks/on-architecture-change.json', '.kiro/hooks/drift-on-prompt.json', MCP]) {
      expect(existsSync(join(project, f)), `${f} should exist`).toBe(true);
    }
  });

  it('points generated config at paths that actually exist', () => {
    runInit(project, PACKAGE_DIR);
    const serverPath = readJson(MCP).mcpServers['doppel-drift'].args[0];
    expect(existsSync(serverPath), `mcp.json points at ${serverPath}, which does not exist`).toBe(true);
  });
});

describe('doppel init, project that already uses Kiro', () => {
  beforeEach(() => {
    mkdirSync(join(project, '.kiro/settings'), { recursive: true });
    mkdirSync(join(project, '.kiro/steering'), { recursive: true });
    writeFileSync(join(project, MCP), JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        postgres: { command: 'node', args: ['tools/pg.mjs'], autoApprove: ['query'] },
      },
    }, null, 2));
    writeFileSync(join(project, '.kiro/steering/architecture.md'), 'MY OWN STEERING');
  });

  it('merges into mcp.json instead of replacing it, keeping every other server', () => {
    runInit(project, PACKAGE_DIR);
    const servers = readJson(MCP).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['context7', 'doppel-drift', 'postgres']);
    expect(servers.context7.args).toEqual(['-y', '@upstash/context7-mcp']);
    expect(servers.postgres.autoApprove).toEqual(['query']);
  });

  it('never overwrites existing steering', () => {
    runInit(project, PACKAGE_DIR);
    expect(readFileSync(join(project, '.kiro/steering/architecture.md'), 'utf8')).toBe('MY OWN STEERING');
  });

  it('is idempotent: a second run changes nothing', () => {
    runInit(project, PACKAGE_DIR);
    const after1 = readFileSync(join(project, MCP), 'utf8');
    const res = runInit(project, PACKAGE_DIR);
    expect(readFileSync(join(project, MCP), 'utf8')).toBe(after1);
    expect(res.merged).toEqual([]); // nothing re-merged the second time
  });
});

describe('doppel init, unparseable mcp.json', () => {
  it('leaves the file byte-for-byte alone and reports what to add by hand', () => {
    mkdirSync(join(project, '.kiro/settings'), { recursive: true });
    const broken = '{\n  "mcpServers": {\n    "context7": { "command": "npx" },\n  }\n}\n'; // trailing comma
    writeFileSync(join(project, MCP), broken);

    const res = runInit(project, PACKAGE_DIR);

    expect(readFileSync(join(project, MCP), 'utf8')).toBe(broken);
    expect(res.failed.length).toBe(1);
    expect(res.failed[0]).toContain('doppel-drift');
  });
});

describe('cleanDemoContent', () => {
  it('removes only listed demo files and leaves everything else', () => {
    mkdirSync(join(project, 'src'), { recursive: true });
    mkdirSync(join(project, 'architecture'), { recursive: true });
    writeFileSync(join(project, 'src/moisture-sensor.ts'), 'demo');
    writeFileSync(join(project, 'src/my-own-code.ts'), 'mine');
    writeFileSync(join(project, 'architecture/plant-watering.puml'), 'demo');
    writeFileSync(join(project, 'architecture/my-system.puml'), 'mine');

    const removed = cleanDemoContent(project);

    expect(existsSync(join(project, 'src/moisture-sensor.ts'))).toBe(false);
    expect(existsSync(join(project, 'architecture/plant-watering.puml'))).toBe(false);
    expect(existsSync(join(project, 'src/my-own-code.ts')), 'must not touch the user\'s own code').toBe(true);
    expect(existsSync(join(project, 'architecture/my-system.puml')), 'must not touch their architecture').toBe(true);
    expect(removed).toContain('src/moisture-sensor.ts');
  });
});
