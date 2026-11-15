/**
 * How an architecture file is classified from its path alone.
 *
 * The folder under `architecture/` is the feature, and a suffix before `.puml` names the
 * dialect: `watering-cycle.seq.puml` is the sequence view of the irrigation feature. That
 * convention is the whole classifier — no file needs to be opened and parsed to decide
 * where it belongs in the tree, which is what keeps a large project's tree cheap to draw.
 */

export type Dialect = 'static' | 'seq' | 'state' | 'activity';

const DIALECT_SUFFIX = /^(.*)\.(seq|state|activity)$/i;

/** Never a diagram to approve into, wherever someone puts it. */
const PROPOSALS_BASENAME = 'proposals.puml';

export interface ArchPath {
  /** Path relative to `architecture/`, e.g. "irrigation/watering-cycle.seq.puml". */
  rel: string;
  /** First folder under `architecture/`; empty for a file sitting directly in it. */
  feature: string;
  dialect: Dialect;
  /** What the tree shows: no folder, no `.puml`, no dialect suffix. */
  label: string;
}

/** Accepts a path with or without the leading `architecture/`. */
export function archPath(name: string): ArchPath {
  const rel = name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^architecture\//i, '');
  const segments = rel.split('/').filter(Boolean);
  const base = segments[segments.length - 1] ?? '';
  const feature = segments.length > 1 ? segments[0]! : '';

  const noExt = base.replace(/\.puml$/i, '');
  const m = DIALECT_SUFFIX.exec(noExt);
  return {
    rel,
    feature,
    dialect: m ? (m[2]!.toLowerCase() as Dialect) : 'static',
    label: m ? m[1]! : noExt,
  };
}

/**
 * Cleans a path typed by a reviewer into one that is safe to write under `architecture/`,
 * or null when it is not usable at all. Rejecting `..` matters: the write runs against a
 * directory handle the reviewer granted for the project, so a path that climbs out of
 * `architecture/` would land somewhere they never agreed to.
 */
export function normaliseTarget(input: string): string | null {
  const cleaned = input.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/^architecture\//i, '');
  const segments = cleaned.split('/').filter((s) => s.length && s !== '.');
  if (!segments.length) return null;
  if (segments.some((s) => s === '..')) return null;

  const base = segments[segments.length - 1]!;
  if (!/\.puml$/i.test(base)) return null;
  if (base.toLowerCase() === PROPOSALS_BASENAME) return null;
  return segments.join('/');
}

/** A diagram title turned into a filename-safe stem. */
export function slug(title: string): string {
  const s = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'architecture';
}

/** Where approving a proposals file writes by default: flat, beside the other diagrams.
 *  A folder is only ever created because a reviewer asked for one by editing the path. */
export const defaultTarget = (title: string): string => `${slug(title)}.puml`;

/**
 * Where a diagram's hand-placed positions live, as a path under `.doppel/layout/`.
 *
 * Deliberately NOT inside `architecture/`: steering feeds that whole folder to Kiro as
 * approved design, and a blob of pixel coordinates is not design. `.doppel/` is committed
 * with the repo instead, so a teammate who pulls the project opens every diagram arranged
 * the way it was left rather than re-arranged from scratch in their own browser.
 */
export function layoutPathFor(diagramPath: string): string | null {
  const cleaned = diagramPath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
  const segments = cleaned.split('/').filter((s) => s.length && s !== '.');
  if (!segments.length || segments.some((s) => s === '..')) return null;

  const base = segments[segments.length - 1]!;
  if (!/\.puml$/i.test(base)) return null;
  segments[segments.length - 1] = base.replace(/\.puml$/i, '.json');
  return segments.join('/');
}
