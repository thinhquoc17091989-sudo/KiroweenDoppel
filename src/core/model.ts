/** Doppel architecture model. One file = one diagram = one Model. */

export type ElementKind = 'component' | 'interface';
/** 'modified': an already-approved element whose block changed and awaits re-approval.
 *  It ships as current content (approvedOnly keeps it), and a link naming only modified
 *  and approved ends stays solid (refreshLinkStatus dashes a link only when one of its
 *  ends is 'proposed' — brand new, not yet in the architecture at all). The UI still
 *  shows it as a pending decision, distinct from 'approved', via its own color. */
export type Status = 'proposed' | 'approved' | 'modified';
export type NoteSide = 'right' | 'left' | 'top' | 'bottom';

export interface Element {
  /** Stable identity. Rename keeps it, so trace links survive. */
  id: string;
  kind: ElementKind;
  /** Display name, may contain spaces. */
  name: string;
  /** PlantUML alias used in link lines. Word characters only. */
  alias: string;
  /** Requirement ids this element satisfies, e.g. ["R1", "R2"]. */
  req: string[];
  status: Status;
}

export interface Link {
  /** Element ids, not aliases. */
  from: string;
  to: string;
  label: string;
  /** `..>` in PlantUML. `-->` when false. */
  proposed: boolean;
}

export interface Note {
  /** Element id the note is attached to. */
  target: string;
  side: NoteSide;
  lines: string[];
}

export interface Model {
  title: string;
  elements: Element[];
  links: Link[];
  notes: Note[];
}

export const emptyModel = (): Model => ({ title: '', elements: [], links: [], notes: [] });

export function findElement(m: Model, id: string): Element | undefined {
  return m.elements.find((e) => e.id === id);
}
