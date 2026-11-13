import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Element } from '../src/core/model';
import {
  computeStatus, emptyTrace, hashElement, orphanRows, parseTrace, pathsFor,
  isApprovedArchitectureFile, printTrace, removeRow, upsertRow, type TraceFile, type TraceRow,
} from '../src/core/trace';

const el = (over: Partial<Element> = {}): Element => ({
  id: 'pump-driver', kind: 'component', name: 'PumpDriver', alias: 'PumpDriver', req: ['R2'], status: 'approved', ...over,
});

describe('hashElement', () => {
  it('is the same for the same element every time', () => {
    const e = el();
    expect(hashElement(e)).toBe(hashElement(el()));
  });

  it('changes when the name changes', () => {
    expect(hashElement(el({ name: 'PumpActuator' }))).not.toBe(hashElement(el()));
  });

  it('changes when req changes', () => {
    expect(hashElement(el({ req: ['R2', 'R7'] }))).not.toBe(hashElement(el()));
  });

  it('does not change when only id or alias changes (rename keeps the hash meaning stable to content)', () => {
    expect(hashElement(el({ id: 'pump-actuator', alias: 'Pump2' }))).toBe(hashElement(el()));
  });

  it('is insensitive to req order', () => {
    expect(hashElement(el({ req: ['R1', 'R2'] }))).toBe(hashElement(el({ req: ['R2', 'R1'] })));
  });

  it('does not change with status (proposed vs approved vs modified is not content)', () => {
    expect(hashElement(el({ status: 'proposed' }))).toBe(hashElement(el({ status: 'modified' })));
  });
});

describe('pathsFor', () => {
  it('follows the src/<id>.ts, test/<id>.test.ts convention', () => {
    expect(pathsFor('pump-driver')).toEqual({ codePath: 'src/pump-driver.ts', testPath: 'test/pump-driver.test.ts' });
  });
});

describe('computeStatus', () => {
  it('reports no-code for an element with no trace row', () => {
    const [entry] = computeStatus([el()], emptyTrace());
    expect(entry).toMatchObject({ id: 'pump-driver', state: 'no-code' });
  });

  it('reports in-sync when the stored hash matches', () => {
    const e = el();
    const trace = upsertRow(emptyTrace(), { id: e.id, req: e.req, ...pathsFor(e.id), hash: hashElement(e) });
    const entry = computeStatus([e], trace)[0]!;
    expect(entry.state).toBe('in-sync');
  });

  it('reports stale when the element changed after code was generated', () => {
    const original = el();
    const trace = upsertRow(emptyTrace(), { id: original.id, req: original.req, ...pathsFor(original.id), hash: hashElement(original) });
    const renamed = el({ name: 'PumpActuator' }); // same id, different content
    const entry = computeStatus([renamed], trace)[0]!;
    expect(entry.state).toBe('stale');
  });

  it('a rename alone (id stable) keeps the row addressable by id even though content changed', () => {
    const original = el();
    const trace = upsertRow(emptyTrace(), { id: original.id, req: original.req, ...pathsFor(original.id), hash: hashElement(original) });
    const renamed = el({ name: 'PumpActuator' });
    const entry = computeStatus([renamed], trace)[0]!;
    expect(entry.codePath).toBe('src/pump-driver.ts'); // still found, not treated as a different element
  });
});

describe('orphanRows', () => {
  it('finds a trace row whose element no longer exists', () => {
    const trace = upsertRow(emptyTrace(), { id: 'gone', req: [], ...pathsFor('gone'), hash: 'deadbeef' });
    expect(orphanRows([el()], trace).map((r) => r.id)).toEqual(['gone']);
  });

  it('finds nothing when every row still has a live element', () => {
    const e = el();
    const trace = upsertRow(emptyTrace(), { id: e.id, req: e.req, ...pathsFor(e.id), hash: hashElement(e) });
    expect(orphanRows([e], trace)).toHaveLength(0);
  });
});

describe('upsertRow / removeRow', () => {
  it('upsert replaces a row with the same id rather than duplicating it', () => {
    let trace = upsertRow(emptyTrace(), { id: 'a', req: [], codePath: 'src/a.ts', testPath: 'test/a.test.ts', hash: '1' });
    trace = upsertRow(trace, { id: 'a', req: [], codePath: 'src/a.ts', testPath: 'test/a.test.ts', hash: '2' });
    expect(Object.keys(trace)).toEqual(['a']);
    expect(trace['a']!.hash).toBe('2');
  });

  it('remove drops only the named row', () => {
    let trace = upsertRow(emptyTrace(), { id: 'a', req: [], codePath: 'src/a.ts', testPath: 'test/a.test.ts', hash: '1' });
    trace = upsertRow(trace, { id: 'b', req: [], codePath: 'src/b.ts', testPath: 'test/b.test.ts', hash: '1' });
    trace = removeRow(trace, 'a');
    expect(Object.keys(trace)).toEqual(['b']);
  });
});

describe('printTrace / parseTrace', () => {
  it('round-trips and sorts keys for a clean diff', () => {
    let trace = upsertRow(emptyTrace(), { id: 'z', req: ['R1'], codePath: 'src/z.ts', testPath: 'test/z.test.ts', hash: '1' });
    trace = upsertRow(trace, { id: 'a', req: [], codePath: 'src/a.ts', testPath: 'test/a.test.ts', hash: '2' });
    const text = printTrace(trace);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"z"'));
    expect(parseTrace(text)).toEqual(trace);
  });

  it('parseTrace on garbage input returns an empty trace rather than throwing', () => {
    expect(parseTrace('null')).toEqual({});
  });
});

// ---------- property-based: hashElement depends only on kind/name/req, not id/alias/status ----------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/);
const req = fc.array(fc.stringMatching(/^R[1-9][0-9]?$/), { maxLength: 4 });
const arbElement: fc.Arbitrary<Element> = fc.record({
  id: word, kind: fc.constantFrom('component', 'interface'), name: word, alias: word, req,
  status: fc.constantFrom('proposed', 'approved', 'modified'),
});

describe('round trip (property, trace)', () => {
  it('hashElement is unaffected by id, alias or status alone', () => {
    fc.assert(fc.property(arbElement, word, word, fc.constantFrom('proposed', 'approved', 'modified'), (e, id2, alias2, status2) => {
      expect(hashElement({ ...e, id: id2, alias: alias2, status: status2 })).toBe(hashElement(e));
    }), { numRuns: 200 });
  });

  it('printTrace(parseTrace(printTrace(t))) is stable for any trace built from upsertRow', () => {
    const arbRow: fc.Arbitrary<TraceRow> = fc.record({ id: word, req, codePath: word, testPath: word, hash: word });
    const arbTrace: fc.Arbitrary<TraceFile> = fc.array(arbRow, { maxLength: 8 }).map((rows) =>
      rows.reduce((t, r) => upsertRow(t, r), emptyTrace()),
    );
    fc.assert(fc.property(arbTrace, (t) => {
      const once = printTrace(t);
      expect(printTrace(parseTrace(once))).toBe(once);
    }), { numRuns: 100 });
  });
});

describe('isApprovedArchitectureFile', () => {
  it('accepts ordinary architecture files', () => {
    expect(isApprovedArchitectureFile('plant-watering.puml')).toBe(true);
    expect(isApprovedArchitectureFile('topology.puml')).toBe(true);
  });

  it('rejects a proposals file, whatever the casing', () => {
    // architecture/ is fed to Kiro as approved truth via steering; a proposals file in
    // there would be read as settled design and double-count shared elements.
    expect(isApprovedArchitectureFile('proposals.puml')).toBe(false);
    expect(isApprovedArchitectureFile('Proposals.puml')).toBe(false);
    expect(isApprovedArchitectureFile('PROPOSALS.PUML')).toBe(false);
  });

  it('rejects non-puml files', () => {
    expect(isApprovedArchitectureFile('layout.json')).toBe(false);
    expect(isApprovedArchitectureFile('README.md')).toBe(false);
  });
});
