/** Review actions on a Model. Pure: each returns a new Model. */
import type { Model } from './model';
import { aliasOf } from './puml';

/** A link is a proposal while either end is still proposed. */
export function refreshLinkStatus(m: Model): Model {
  const proposed = new Set(m.elements.filter((e) => e.status === 'proposed').map((e) => e.id));
  return { ...m, links: m.links.map((l) => ({ ...l, proposed: proposed.has(l.from) || proposed.has(l.to) })) };
}

export function accept(m: Model, id: string): Model {
  return refreshLinkStatus({
    ...m,
    elements: m.elements.map((e) => (e.id === id ? { ...e, status: 'approved' } : e)),
  });
}

export function reject(m: Model, id: string): Model {
  return {
    ...m,
    elements: m.elements.filter((e) => e.id !== id),
    links: m.links.filter((l) => l.from !== id && l.to !== id),
    notes: m.notes.filter((n) => n.target !== id),
  };
}

/** Rename keeps the id, so trace links survive. The alias follows the name. */
export function rename(m: Model, id: string, name: string): Model {
  const clean = name.trim();
  if (!clean) return m;
  let alias = aliasOf(clean);
  const taken = new Set(m.elements.filter((e) => e.id !== id).map((e) => e.alias));
  let n = 2;
  while (taken.has(alias)) alias = aliasOf(clean) + n++;
  return { ...m, elements: m.elements.map((e) => (e.id === id ? { ...e, name: clean, alias } : e)) };
}

/** Only approved elements and the links and notes between them. */
export function approvedOnly(m: Model): Model {
  const keep = new Set(m.elements.filter((e) => e.status === 'approved').map((e) => e.id));
  return {
    title: m.title,
    elements: m.elements.filter((e) => keep.has(e.id)),
    links: m.links.filter((l) => keep.has(l.from) && keep.has(l.to)).map((l) => ({ ...l, proposed: false })),
    notes: m.notes.filter((n) => keep.has(n.target)),
  };
}
