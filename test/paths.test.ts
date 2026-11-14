import { describe, expect, it } from 'vitest';
import { archPath, defaultTarget, normaliseTarget, slug } from '../src/core/paths';

describe('archPath', () => {
  it('reads the feature from the folder and the dialect from the suffix', () => {
    expect(archPath('architecture/irrigation/watering-cycle.seq.puml')).toEqual({
      rel: 'irrigation/watering-cycle.seq.puml',
      feature: 'irrigation',
      dialect: 'seq',
      label: 'watering-cycle',
    });
  });

  it('treats a file sitting directly in architecture/ as having no feature', () => {
    expect(archPath('architecture/plant-watering.puml')).toMatchObject({ feature: '', dialect: 'static', label: 'plant-watering' });
  });

  it('works with or without the leading architecture/, and with backslashes', () => {
    expect(archPath('irrigation/pump-driver.state.puml').feature).toBe('irrigation');
    expect(archPath('architecture\\irrigation\\pump-driver.state.puml')).toMatchObject({ feature: 'irrigation', dialect: 'state', label: 'pump-driver' });
  });

  it('only takes the FIRST folder as the feature, however deep the file sits', () => {
    expect(archPath('architecture/irrigation/zone-a/valve.activity.puml')).toMatchObject({
      feature: 'irrigation',
      dialect: 'activity',
      label: 'valve',
    });
  });

  it('leaves a name alone when the suffix is not a dialect', () => {
    // "plant.watering.puml" is one name with a dot in it, not an unknown dialect.
    expect(archPath('architecture/plant.watering.puml')).toMatchObject({ dialect: 'static', label: 'plant.watering' });
  });
});

describe('normaliseTarget', () => {
  it('accepts a plain name and a nested one, with or without the architecture/ prefix', () => {
    expect(normaliseTarget('irrigation.puml')).toBe('irrigation.puml');
    expect(normaliseTarget('irrigation/irrigation.puml')).toBe('irrigation/irrigation.puml');
    expect(normaliseTarget('architecture/irrigation/irrigation.puml')).toBe('irrigation/irrigation.puml');
  });

  it('tidies separators, leading slashes and empty segments', () => {
    expect(normaliseTarget('  /irrigation//irrigation.puml  ')).toBe('irrigation/irrigation.puml');
    expect(normaliseTarget('./irrigation\\irrigation.puml')).toBe('irrigation/irrigation.puml');
  });

  it('refuses to climb out of architecture/', () => {
    // The write runs against a directory handle granted for the project, so a path that
    // escapes architecture/ would write somewhere the reviewer never agreed to.
    expect(normaliseTarget('../secrets.puml')).toBeNull();
    expect(normaliseTarget('irrigation/../../escape.puml')).toBeNull();
  });

  it('refuses anything that is not a .puml, and refuses to overwrite a proposals file', () => {
    expect(normaliseTarget('irrigation')).toBeNull();
    expect(normaliseTarget('notes.md')).toBeNull();
    expect(normaliseTarget('')).toBeNull();
    expect(normaliseTarget('proposals.puml')).toBeNull();
    expect(normaliseTarget('irrigation/PROPOSALS.PUML')).toBeNull();
  });
});

describe('slug and defaultTarget', () => {
  it('makes a filename-safe stem out of a title', () => {
    expect(slug('Plant Watering')).toBe('plant-watering');
    expect(slug('  Irrigation / Zone A  ')).toBe('irrigation-zone-a');
  });

  it('never produces an empty name', () => {
    expect(slug('   ')).toBe('architecture');
    expect(slug('!!!')).toBe('architecture');
  });

  it('defaults to a flat file, so approving never invents a folder on its own', () => {
    expect(defaultTarget('Irrigation')).toBe('irrigation.puml');
    expect(normaliseTarget(defaultTarget('Irrigation'))).toBe('irrigation.puml');
  });
});
