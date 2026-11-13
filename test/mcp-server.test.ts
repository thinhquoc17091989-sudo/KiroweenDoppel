import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Integration test for the MCP server: config shape, then a real JSON-RPC handshake over
 * stdio. Worth the ~1s because the failure modes are silent — invalid JSON in a .kiro
 * config file already broke a hook here once without anything complaining, and a broken
 * import inside the server would make Kiro's connection die with no test noticing.
 */
const ROOT = process.cwd();
const CONFIG = join(ROOT, '.kiro', 'settings', 'mcp.json');

interface RpcMessage { id?: number; result?: { tools?: { name: string }[]; content?: { type: string; text: string }[]; serverInfo?: { name: string } } }

/** Minimal MCP client: initialize, then whatever calls the test asks for. */
async function withServer<T>(fn: (rpc: (method: string, params: unknown) => Promise<RpcMessage>) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, ['mcp/server.mjs'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, (m: RpcMessage) => void>();
  let buf = '';
  let nonProtocolStdout = '';

  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as RpcMessage;
        if (msg.id !== undefined) pending.get(msg.id)?.(msg);
      } catch {
        nonProtocolStdout += line + '\n'; // anything non-JSON on stdout corrupts MCP
      }
    }
  });

  let nextId = 1;
  const rpc = (method: string, params: unknown) =>
    new Promise<RpcMessage>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000);
    });

  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    const out = await fn(rpc);
    expect(nonProtocolStdout, 'server wrote non-protocol text to stdout, which corrupts MCP').toBe('');
    return out;
  } finally {
    child.kill();
  }
}

describe('.kiro/settings/mcp.json', () => {
  it('exists and is valid JSON', () => {
    expect(existsSync(CONFIG)).toBe(true);
    expect(() => JSON.parse(readFileSync(CONFIG, 'utf8'))).not.toThrow();
  });

  it('registers doppel-drift pointing at a server file that exists', () => {
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const entry = cfg.mcpServers?.['doppel-drift'];
    expect(entry).toBeDefined();
    expect(entry.command).toBe('node');
    expect(entry.disabled).toBe(false);
    const serverPath = join(ROOT, entry.args[0]);
    expect(existsSync(serverPath), `${entry.args[0]} does not exist`).toBe(true);
  });

  it('auto-approves only tools the server actually exposes', async () => {
    const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const approved: string[] = cfg.mcpServers['doppel-drift'].autoApprove ?? [];
    const names = await withServer(async (rpc) => {
      const res = await rpc('tools/list', {});
      return (res.result?.tools ?? []).map((t) => t.name);
    });
    for (const a of approved) expect(names, `autoApprove lists "${a}" but the server does not expose it`).toContain(a);
  });
});

describe('MCP server over stdio', () => {
  it('completes a handshake and exposes check_drift and list_trace', async () => {
    const names = await withServer(async (rpc) => {
      const res = await rpc('tools/list', {});
      return (res.result?.tools ?? []).map((t) => t.name);
    });
    expect(names).toContain('check_drift');
    expect(names).toContain('list_trace');
  });

  it('check_drift returns readable text about the real architecture', async () => {
    const out = await withServer(async (rpc) => {
      const res = await rpc('tools/call', { name: 'check_drift', arguments: {} });
      return res.result?.content?.[0]?.text ?? '';
    });
    // Either state is legitimate depending on the repo's current contents; what matters is
    // that it answered in prose about elements rather than erroring.
    expect(out).toMatch(/drift|element/i);
  });

  it('list_trace filters by requirement', async () => {
    const out = await withServer(async (rpc) => {
      const res = await rpc('tools/call', { name: 'list_trace', arguments: { requirement: 'R99' } });
      return res.result?.content?.[0]?.text ?? '';
    });
    expect(out).toContain('R99');
  });
});
