// Phase 3 rule cards: "This rule is about <group>", "When…", "Then…", plus free notes.
// Not scored in this mockup; every edit is reported as a diff.

import { h } from './dom';
import type { Group } from './notebook';

export interface RuleCard {
  id: string;
  about: string | null;
  when: string;
  then: string;
}

export type RuleDiff =
  | { op: 'create'; id: string }
  | { op: 'delete'; id: string; card: RuleCard }
  | { op: 'set_about'; id: string; from: string | null; to: string | null }
  | { op: 'set_when'; id: string; from: string; to: string }
  | { op: 'set_then'; id: string; from: string; to: string }
  | { op: 'notes'; from: string; to: string };

export class RulesPanel {
  readonly el = h('section', { class: 'panel rules' });
  cards: RuleCard[] = [];
  notes = '';
  private nextId = 1;

  constructor(
    private readonly groups: () => Group[],
    private readonly onDiff: (d: RuleDiff) => void,
  ) {
    this.render();
  }

  private emit(d: RuleDiff, rerender = false): void {
    this.onDiff(d);
    if (rerender) this.render();
  }

  render(): void {
    const cards = this.cards.map((c) => {
      const about = h('select', { 'aria-label': 'This rule is about' }, h('option', { value: '' }, '— choose a group —'));
      for (const g of this.groups()) about.append(h('option', { value: g.id }, g.name));
      about.value = c.about ?? '';
      about.addEventListener('change', () => {
        const from = c.about;
        c.about = about.value || null;
        this.emit({ op: 'set_about', id: c.id, from, to: c.about });
      });
      const field = (key: 'when' | 'then', label: string) => {
        const ta = h('textarea', { rows: 2, placeholder: label, 'aria-label': label });
        ta.value = c[key];
        ta.addEventListener('change', () => {
          const from = c[key];
          c[key] = ta.value;
          this.emit({ op: key === 'when' ? 'set_when' : 'set_then', id: c.id, from, to: ta.value });
        });
        return ta;
      };
      return h('div', { class: 'card', 'data-card': c.id },
        h('div', { class: 'row' }, h('label', {}, 'This rule is about'), about,
          h('button', {
            class: 'small danger',
            title: 'Delete rule',
            onclick: () => {
              this.cards = this.cards.filter((x) => x !== c);
              this.emit({ op: 'delete', id: c.id, card: { ...c } }, true);
            },
          }, '✕')),
        field('when', 'When…'),
        field('then', 'Then…'),
      );
    });

    const notes = h('textarea', { rows: 4, placeholder: 'Anything else you noticed…', id: 'rules-notes' });
    notes.value = this.notes;
    notes.addEventListener('change', () => {
      const from = this.notes;
      this.notes = notes.value;
      this.emit({ op: 'notes', from, to: notes.value });
    });

    this.el.replaceChildren(
      h('h3', {}, 'Rules'),
      h('p', { class: 'muted' }, 'Write rules about how things in this world behave.'),
      ...cards,
      h('button', {
        id: 'rules-add',
        onclick: () => {
          const id = `r${this.nextId++}`;
          this.cards.push({ id, about: null, when: '', then: '' });
          this.emit({ op: 'create', id }, true);
        },
      }, '+ Add rule'),
      h('h4', {}, 'Notes'),
      notes,
    );
  }
}
