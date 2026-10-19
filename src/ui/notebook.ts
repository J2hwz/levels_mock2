// Phase 2 notebook: named groups, examples (entities), and nesting via a parent dropdown.
// Every edit is reported as a diff.

import { h } from './dom';

export interface Group {
  id: string;
  name: string;
  parent: string | null;
  examples: number[];
}

export type NotebookDiff =
  | { op: 'create'; id: string; name: string; parent: string | null }
  | { op: 'rename'; id: string; from: string; to: string }
  | { op: 'delete'; id: string; name: string; reparented: string[] }
  | { op: 'add_example'; id: string; entity: number }
  | { op: 'remove_example'; id: string; entity: number }
  | { op: 'set_parent'; id: string; from: string | null; to: string | null };

export interface NotebookOpts {
  getSelected: () => number;
  /** CSS colour of an entity, or null if it no longer exists */
  swatch: (entity: number) => string | null;
  onDiff: (d: NotebookDiff) => void;
  onFocusEntity: (entity: number) => void;
}

export class NotebookPanel {
  readonly el = h('section', { class: 'panel notebook' });
  groups: Group[] = [];
  private nextId = 1;
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly opts: NotebookOpts) {
    this.render();
  }

  onChange(f: () => void): void {
    this.listeners.push(f);
  }

  private emit(d: NotebookDiff): void {
    this.opts.onDiff(d);
    this.render();
    for (const f of this.listeners) f();
  }

  private get(id: string): Group {
    return this.groups.find((g) => g.id === id)!;
  }

  private isDescendant(id: string, ofId: string): boolean {
    let p = this.get(id).parent;
    while (p) {
      if (p === ofId) return true;
      p = this.get(p).parent;
    }
    return false;
  }

  create(name: string): void {
    const id = `g${this.nextId++}`;
    const nm = name.trim() || `Group ${this.nextId - 1}`;
    this.groups.push({ id, name: nm, parent: null, examples: [] });
    this.emit({ op: 'create', id, name: nm, parent: null });
  }

  /** depth-first order so children appear under their parents */
  private ordered(): { g: Group; depth: number }[] {
    const out: { g: Group; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const g of this.groups) {
        if (g.parent !== parent) continue;
        out.push({ g, depth });
        walk(g.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  render(): void {
    const nameInput = h('input', { type: 'text', placeholder: 'New group name…', class: 'grow' });
    const add = () => {
      this.create(nameInput.value);
    };
    nameInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') add();
    });

    const rows = this.ordered().map(({ g, depth }) => {
      const rename = h('input', { type: 'text', value: g.name, class: 'grow', 'aria-label': 'Group name' });
      rename.addEventListener('change', () => {
        const to = rename.value.trim();
        if (!to || to === g.name) {
          rename.value = g.name;
          return;
        }
        const from = g.name;
        g.name = to;
        this.emit({ op: 'rename', id: g.id, from, to });
      });

      const parentSel = h('select', { 'aria-label': 'Part of' }, h('option', { value: '' }, '— top level —'));
      for (const o of this.groups) {
        if (o.id === g.id || this.isDescendant(o.id, g.id)) continue;
        parentSel.append(h('option', { value: o.id }, o.name));
      }
      parentSel.value = g.parent ?? '';
      parentSel.addEventListener('change', () => {
        const from = g.parent;
        g.parent = parentSel.value || null;
        this.emit({ op: 'set_parent', id: g.id, from, to: g.parent });
      });

      const addEx = h('button', {
        class: 'small',
        title: 'Add the currently selected thing as an example',
        onclick: () => {
          const sel = this.opts.getSelected();
          if (sel < 0 || g.examples.includes(sel)) return;
          g.examples.push(sel);
          this.emit({ op: 'add_example', id: g.id, entity: sel });
        },
      }, '+ selected');

      const del = h('button', {
        class: 'small danger',
        title: 'Delete group',
        onclick: () => {
          const reparented = this.groups.filter((o) => o.parent === g.id).map((o) => o.id);
          for (const o of this.groups) if (o.parent === g.id) o.parent = g.parent;
          this.groups = this.groups.filter((o) => o.id !== g.id);
          this.emit({ op: 'delete', id: g.id, name: g.name, reparented });
        },
      }, '✕');

      const chips = g.examples.map((ent) => {
        const col = this.opts.swatch(ent);
        return h('span', { class: 'chip' + (col ? '' : ' gone') },
          h('span', { class: 'swatch', style: `background:${col ?? 'transparent'}` }),
          h('button', { class: 'link', title: 'Show it', onclick: () => this.opts.onFocusEntity(ent) }, `#${ent}`),
          h('button', {
            class: 'link',
            title: 'Remove example',
            onclick: () => {
              g.examples = g.examples.filter((x) => x !== ent);
              this.emit({ op: 'remove_example', id: g.id, entity: ent });
            },
          }, '×'),
        );
      });

      return h('div', { class: 'group', style: `margin-left:${depth * 16}px`, 'data-group': g.id },
        h('div', { class: 'row' }, rename, del),
        h('div', { class: 'row' }, h('label', {}, 'part of '), parentSel, addEx),
        h('div', { class: 'chips' }, ...(chips.length ? chips : [h('span', { class: 'muted' }, 'no examples yet')])),
      );
    });

    this.el.replaceChildren(
      h('h3', {}, 'Notebook'),
      h('p', { class: 'muted' }, 'Make groups. Select something in the world and press “+ selected” to add it as an example. Use “part of” to put a group inside another group.'),
      h('div', { class: 'row' }, nameInput, h('button', { onclick: add, id: 'nb-create' }, 'Create group')),
      ...rows,
    );
  }
}
