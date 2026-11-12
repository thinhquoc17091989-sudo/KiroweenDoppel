import { describe, expect, it } from 'vitest';
import { rankByLongestPath } from '../src/core/rank';

describe('rankByLongestPath', () => {
  it('ranks a chain in order', () => {
    const r = rankByLongestPath(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
    expect(r.get('a')).toBe(0);
    expect(r.get('b')).toBe(1);
    expect(r.get('c')).toBe(2);
  });

  it('ranks a node at the depth of its DEEPEST incoming path, not the first one found', () => {
    // a->c (short path) and a->b->c (long path): c must rank 2, not 1.
    const r = rankByLongestPath(['a', 'b', 'c'], [
      { from: 'a', to: 'c' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
    ]);
    expect(r.get('c')).toBe(2);
  });

  it('gives an isolated id rank 0', () => {
    const r = rankByLongestPath(['solo'], []);
    expect(r.get('solo')).toBe(0);
  });

  it('does not infinite-loop on a cycle, and ignores a self-loop', () => {
    const r = rankByLongestPath(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'a' }]);
    expect(r.get('a')).toBeTypeOf('number');
    expect(r.get('b')).toBeTypeOf('number');
  });
});
