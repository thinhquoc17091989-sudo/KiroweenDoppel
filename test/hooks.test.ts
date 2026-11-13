import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every .kiro/hooks/*.json file must be valid JSON and have the shape Kiro's v1 hook
 * format expects. This exists because a JSON file can look fine to a human and still fail
 * to parse — `"architecture/.*\.puml$"` reads as an escaped dot, but `\.` is not a legal
 * JSON escape (only \" \\ \/ \b \f \n \r \t \uXXXX are), so the whole file was invalid
 * JSON from the moment it was first written, silently, until this test caught it.
 */
const HOOKS_DIR = join(process.cwd(), '.kiro', 'hooks');
const files = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.json'));

describe('hook files', () => {
  it('found at least one hook file to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      const text = readFileSync(join(HOOKS_DIR, file), 'utf8');

      it('is valid JSON', () => {
        expect(() => JSON.parse(text)).not.toThrow();
      });

      it('has the v1 shape: version, and a non-empty hooks array', () => {
        const data = JSON.parse(text);
        expect(data.version).toBe('v1');
        expect(Array.isArray(data.hooks)).toBe(true);
        expect(data.hooks.length).toBeGreaterThan(0);
      });

      it('each hook has a name, a trigger, and an action with a type', () => {
        const data = JSON.parse(text);
        for (const h of data.hooks) {
          expect(typeof h.name).toBe('string');
          expect(typeof h.trigger).toBe('string');
          expect(['agent', 'command']).toContain(h.action?.type);
          if (h.action.type === 'agent') expect(typeof h.action.prompt).toBe('string');
          if (h.action.type === 'command') expect(typeof h.action.command).toBe('string');
        }
      });

      it('a file-trigger hook has a regex matcher that actually compiles', () => {
        const data = JSON.parse(text);
        for (const h of data.hooks) {
          if (h.trigger === 'PostFileSave' || h.trigger === 'PreFileSave') {
            expect(typeof h.matcher).toBe('string');
            expect(() => new RegExp(h.matcher)).not.toThrow();
          }
        }
      });
    });
  }
});
