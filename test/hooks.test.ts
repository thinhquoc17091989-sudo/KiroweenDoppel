import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const ideHooks = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.kiro.hook'));

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

/**
 * Kiro has TWO hook schemas for two surfaces, and they are not interchangeable:
 *   - the IDE reads `*.kiro.hook`  -> { when: {type,patterns}, then: {type,prompt} }
 *   - the CLI reads `*.json`       -> { version:"v1", hooks:[{trigger,matcher,action}] }
 * This project needs both. It learned that the hard way: the .kiro.hook file was deleted
 * and "corrected" to the CLI schema from the docs, after which the IDE silently stopped
 * firing the hook at all — the rename landed, no code regenerated, and nothing complained.
 */
describe('IDE hook files (*.kiro.hook)', () => {
  it('at least one exists, so the IDE has a hook to fire', () => {
    expect(ideHooks.length, 'no *.kiro.hook file: the Kiro IDE will not fire anything').toBeGreaterThan(0);
  });

  for (const file of ideHooks) {
    describe(file, () => {
      const hook = JSON.parse(readFileSync(join(HOOKS_DIR, file), 'utf8'));

      it('uses the IDE when/then schema, not the CLI one', () => {
        expect(hook.when, 'missing "when": this looks like the CLI schema in an IDE file').toBeDefined();
        expect(hook.then, 'missing "then"').toBeDefined();
        expect(hook.hooks, 'has a "hooks" array: that is the CLI schema, wrong file type').toBeUndefined();
      });

      it('is enabled and watches architecture files with a glob (not a regex)', () => {
        expect(hook.enabled).toBe(true);
        expect(hook.when.type).toBe('fileEdited');
        expect(Array.isArray(hook.when.patterns)).toBe(true);
        // IDE patterns are globs; a regex like "architecture/.*\.puml$" silently matches nothing.
        for (const p of hook.when.patterns) expect(p).not.toContain('.*');
      });

      it('reaches diagrams inside feature folders, not just the top level', () => {
        // Only applies to a hook watching architecture/, which is a hierarchy with a folder
        // per feature. A lone "architecture/*.puml" does not cross a slash, so approving
        // into a feature folder would write the file and then silently generate nothing —
        // the core loop broken exactly where it is least visible. Hooks watching the
        // proposals file have no such hierarchy and are left alone.
        const patterns: string[] = hook.when.patterns;
        if (!patterns.some((p) => p.startsWith('architecture/'))) return;
        expect(patterns.some((p) => p.includes('**')), `no recursive pattern in ${JSON.stringify(patterns)}`).toBe(true);
      });

      it('either asks the agent or runs a command, with the matching field filled in', () => {
        expect(['askAgent', 'runCommand']).toContain(hook.then.type);
        if (hook.then.type === 'askAgent') {
          expect(typeof hook.then.prompt).toBe('string');
          // A one-liner prompt usually means the instruction got truncated during editing.
          expect(hook.then.prompt.length).toBeGreaterThan(40);
        } else {
          expect(typeof hook.then.command).toBe('string');
          expect(hook.then.command.length).toBeGreaterThan(0);
        }
      });

      it('if it runs a command, that command points at a script that exists', () => {
        if (hook.then.type !== 'runCommand') return;
        // "node bin/open-review.mjs" -> bin/open-review.mjs must actually be there, or the
        // hook fires into nothing and fails silently, which is the whole failure mode here.
        const scriptArg = hook.then.command.split(/\s+/).find((p: string) => p.endsWith('.mjs') || p.endsWith('.js'));
        expect(scriptArg, `no script found in command: ${hook.then.command}`).toBeDefined();
        expect(existsSync(join(process.cwd(), scriptArg!)), `${scriptArg} does not exist`).toBe(true);
      });
    });
  }
});
