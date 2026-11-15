/**
 * The renderer reuses DOM nodes between calls instead of rebuilding the SVG, which is what
 * keeps a file switch and a drag frame cheap. That reuse is easy to get subtly wrong — the
 * first version of it re-appended link paths without their labels, leaving every label
 * stranded in front of the lines — and none of it is covered by the pure-model tests.
 *
 * So these tests pin one invariant: a reused tree must always converge on exactly what a
 * freshly rendered tree looks like. There is no browser here, only the handful of DOM calls
 * render.ts actually makes, which is enough to compare structure, attributes and order.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/core/puml';
import { arrangeAll } from '../src/core/layout';
import { render, type RenderHandlers } from '../src/ui/render';
import type { Model } from '../src/core/model';

class El {
  attrs = new Map<string, string>();
  children: El[] = [];
  parent: El | null = null;
  listeners: [string, unknown][] = [];
  private text: string | null = null;
  readonly classList = {
    toggle: (name: string, on?: boolean) => {
      const set = new Set((this.attrs.get('class') ?? '').split(/\s+/).filter(Boolean));
      if (on) set.add(name); else set.delete(name);
      this.attrs.set('class', [...set].join(' '));
    },
  };
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  addEventListener(type: string, fn: unknown) { this.listeners.push([type, fn]); }
  append(...kids: El[]) {
    for (const k of kids) {
      if (k.parent) k.parent.children = k.parent.children.filter((c) => c !== k);
      k.parent = this;
      this.children.push(k);
    }
  }
  replaceChildren(...kids: El[]) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.append(...kids);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  set textContent(v: string | null) { this.text = v === null ? null : String(v); this.children = []; }
  get textContent(): string {
    return this.text !== null ? this.text : this.children.map((c) => c.textContent).join('');
  }
}

/** Structure, attributes and order, as one comparable string. */
function serialize(node: El, depth = 0): string {
  const pad = '  '.repeat(depth);
  const attrs = [...node.attrs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${v}"`).join(' ');
  const head = `${pad}<${node.tagName}${attrs ? ' ' + attrs : ''}>`;
  if (!node.children.length) return node.textContent ? `${head}${node.textContent}` : head;
  return [head, ...node.children.map((c) => serialize(c, depth + 1))].join('\n');
}

const countListeners = (n: El): number => n.listeners.length + n.children.reduce((s, c) => s + countListeners(c), 0);

const svg = () => new El('svg') as unknown as SVGSVGElement;
const ser = (s: SVGSVGElement) => serialize(s as unknown as El);
const handlers: RenderHandlers = { onSelect() {}, onRename() {}, onDragStart() {}, onNoteDragStart() {} };

/** What a brand-new canvas showing this model looks like. */
function fresh(m: Model, selected: string | null = null, style: 'free' | 'elbow' = 'free'): string {
  const s = svg();
  render(s, m, arrangeAll(m), selected, handlers, style);
  return ser(s);
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = { createElementNS: (_ns: string, tag: string) => new El(tag) };
});

describe('render reuses nodes without drifting from a fresh render', () => {
  let base: Model;
  beforeAll(() => { base = parse(readFileSync('samples/plant-watering/proposals.puml', 'utf8')); });

  it('is idempotent: rendering the same model twice changes nothing', () => {
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    const once = ser(s);
    render(s, base, arrangeAll(base), null, handlers);
    expect(ser(s)).toBe(once);
  });

  it('keeps each link label with its own path, not stranded in front of them', () => {
    // The exact bug the reuse pass introduced: paths were re-appended in model order while
    // their labels stayed where they were, so every label jumped ahead of every line.
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    const links = (s as unknown as El).children[1]!; // defs, links, notes, nodes
    const tags = links.children.map((c) => c.tagName);
    const firstText = tags.indexOf('text');
    if (firstText !== -1) {
      expect(tags.slice(0, firstText).every((t) => t === 'path'), `link group order: ${tags.join(',')}`).toBe(true);
    }
    expect(ser(s)).toBe(fresh(base));
  });

  it('matches a fresh render after the status of every element changes', () => {
    // Opening the approved copy of the proposal being reviewed: same ids, different status.
    const approved: Model = {
      ...base,
      elements: base.elements.map((e) => ({ ...e, status: 'approved' as const })),
      links: base.links.map((l) => ({ ...l, proposed: false })),
    };
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    render(s, approved, arrangeAll(approved), null, handlers);
    expect(ser(s)).toBe(fresh(approved));
  });

  it('matches a fresh render after switching to an unrelated diagram and back', () => {
    const other = parse('@startuml other\n\' id: solo\ncomponent "Solo" as Solo\n@enduml');
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    render(s, other, arrangeAll(other), null, handlers);
    expect(ser(s), 'stale nodes from the previous diagram were left behind').toBe(fresh(other));
    render(s, base, arrangeAll(base), null, handlers);
    expect(ser(s)).toBe(fresh(base));
  });

  it('matches a fresh render when a selection, a route style or a description changes', () => {
    const id = base.elements[1]!.id;
    const described: Model = { ...base, elements: base.elements.map((e) => (e.id === id ? { ...e, desc: 'why it exists' } : e)) };
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    render(s, base, arrangeAll(base), id, handlers);
    expect(ser(s), 'selection').toBe(fresh(base, id));
    render(s, base, arrangeAll(base), id, handlers, 'elbow');
    expect(ser(s), 'route style').toBe(fresh(base, id, 'elbow'));
    render(s, described, arrangeAll(described), id, handlers, 'elbow');
    expect(ser(s), 'description added').toBe(fresh(described, id, 'elbow'));
    render(s, base, arrangeAll(base), id, handlers, 'elbow');
    expect(ser(s), 'description removed again').toBe(fresh(base, id, 'elbow'));
  });

  it('never accumulates listeners, however many times it redraws', () => {
    // Listeners are attached once at creation and read the current handlers indirectly.
    // Re-attaching them per render would quietly multiply every click.
    const s = svg();
    render(s, base, arrangeAll(base), null, handlers);
    const after1 = countListeners(s as unknown as El);
    for (let i = 0; i < 25; i++) render(s, base, arrangeAll(base), null, handlers);
    expect(countListeners(s as unknown as El)).toBe(after1);
  });
});
