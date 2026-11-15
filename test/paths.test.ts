import { describe, expect, it } from 'vitest';
import { archPath, defaultTarget, layoutPathFor, normaliseTarget, slug } from '../src/core/paths';

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

describe('layoutPathFor', () => {
  it('mirrors the diagram path under .doppel/layout, as json', () => {
    expect(layoutPathFor('architecture/plant-watering.puml')).toBe('architecture/plant-watering.json');
    expect(layoutPathFor('architecture/irrigation/watering-cycle.seq.puml')).toBe('architecture/irrigation/watering-cycle.seq.json');
    expect(layoutPathFor('proposals.puml')).toBe('proposals.json');
  });

  it('gives a proposal and the file it is approved into DIFFERENT keys', () => {
    // The bug this exists to prevent is the opposite one: they must not collide, but the
    // approve step has to copy one to the other deliberately, not rely on a shared key.
    expect(layoutPathFor('proposals.puml')).not.toBe(layoutPathFor('architecture/plant-watering.puml'));
  });

  it('refuses anything that is not a diagram, or that climbs out', () => {
    expect(layoutPathFor('../escape.puml')).toBeNull();
    expect(layoutPathFor('architecture/../../escape.puml')).toBeNull();
    expect(layoutPathFor('notes.md')).toBeNull();
    expect(layoutPathFor('')).toBeNull();
  });
});
