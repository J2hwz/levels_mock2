// Report phase (after Explore): three steps in a fixed order, no going back, so earlier answers are not primed by
// later ones.
//   1. an open description of the world (nothing structured shown yet)
//   2. fill-in-the-blank rules: picture tokens of every element (no level names) dragged into sentence blanks,
//      outcomes in free text, after one worked example taken from the real composition
//   3. an open question on how they would organise the world
// Every edit is reported through onEvent (logged as `report` events).

import { h } from './dom';

// =====================================================================================================
// TUNE: everything participants read in the report. Avoid naming levels (cell / organism / herd / level):
// the word used for them is "scale", and elements are shown as pictures only.
// =====================================================================================================
export const REPORT = {
  bannerText: 'Tell us what you found out about this world.',
  steps: [
    {
      title: 'Describe the world',
      question: 'Suppose you are describing this world to another player who has never seen it. What would you tell them?',
    },
    {
      title: 'Rules',
      intro:
        'Now write down rules of this world, as you would explain them to another player. Fill in the blanks by ' +
        'dragging the pictures into them (or click a picture, then a blank). Click a filled blank to empty it. ' +
        'Add as many rules as you like.',
    },
    {
      title: 'Organising the world',
      question: 'If you had to sort everything in this world into groups, how would you do it? Explain your groups.',
    },
  ],
  palette: 'Things in this world, at each scale',
  example: 'For example:',
  interaction: { label: '+ “When … is near …” rule', when: 'When', near: 'is near', placeholder: 'what happens?' },
  makeup: { label: '+ “… make up …” rule', makeUp: 'make up' },
  other: { label: '+ Other rule', placeholder: 'Any other rule, in your own words' },
  sizeWords: ['small', 'medium', 'large'],
  colourWords: ['light blue', 'purple', 'red', 'green'],
};

/** An element, as the analysis sees it: level (tier) and colour (type). */
export interface Token {
  tier: number;
  type: number;
}

export type ReportRule =
  | { id: string; kind: 'interaction'; a: Token | null; b: Token | null; outcome: string }
  | { id: string; kind: 'makeup'; n: number | null; member: Token | null; whole: Token | null }
  | { id: string; kind: 'other'; text: string };

export interface ReportAnswers {
  describe: string;
  rules: ReportRule[];
  organise: string;
}

export type ReportEvent =
  | { op: 'step'; step: number }
  | { op: 'answer'; q: 'describe' | 'organise'; from: string; to: string }
  | { op: 'rule_add'; id: string; kind: ReportRule['kind'] }
  | { op: 'rule_set'; id: string; field: string; from: unknown; to: unknown }
  | { op: 'rule_delete'; id: string; rule: ReportRule };

export interface TokenLook {
  /** css colours per tier [cells, organisms, herds], indexed by type */
  colours: string[][];
  /** shape drawn inside each cell type */
  shapes: string[];
}

const SIZE_PX = [20, 28, 38];

/** Small inline SVG of an element: a cell with its shape, a plain blob, or a pale disc. */
function tokenSvg(t: Token, look: TokenLook): string {
  const c = look.colours[t.tier][t.type];
  const px = SIZE_PX[t.tier];
  let body: string;
  if (t.tier === 0) {
    const shape = look.shapes[t.type];
    const inner =
      shape === 'triangle'
        ? `<polygon points="10,4.5 15,13.5 5,13.5" fill="${c}"/>`
        : shape === 'square'
          ? `<rect x="6" y="6" width="8" height="8" fill="${c}"/>`
          : shape === 'star'
            ? `<polygon points="10,3.8 11.6,8.3 16.3,8.3 12.5,11.2 13.9,15.8 10,13 6.1,15.8 7.5,11.2 3.7,8.3 8.4,8.3" fill="${c}"/>`
            : `<circle cx="10" cy="10" r="3.6" fill="${c}"/>`;
    body = `<circle cx="10" cy="10" r="8.3" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="1.6"/>${inner}`;
  } else if (t.tier === 1) {
    body = `<path d="M10 1.8 C14.8 1.6 18.4 5 18.1 10.2 C17.8 15.2 14.4 18.3 9.6 18.2 C4.9 18 1.7 14.6 1.9 9.8 C2.1 5 5.4 2 10 1.8 Z" fill="${c}" stroke="${c}" stroke-width="1"/>`;
  } else {
    body = `<circle cx="10" cy="10" r="9" fill="${c}" fill-opacity="0.55" stroke="${c}" stroke-width="0.8"/>`;
  }
  return `<svg width="${px}" height="${px}" viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`;
}

const tokenKey = (t: Token) => `${t.tier}:${t.type}`;
const parseKey = (k: string): Token | null => {
  const m = /^(\d):(\d)$/.exec(k);
  return m ? { tier: Number(m[1]), type: Number(m[2]) } : null;
};

export class ReportPanel {
  readonly el = h('section', { class: 'panel report' });
  step = 0;
  private describe = '';
  private organise = '';
  private rules: ReportRule[] = [];
  private nextId = 1;
  /** token picked by click, waiting for a blank */
  private picked: Token | null = null;
  private readonly stepEls: HTMLElement[];
  private readonly ruleList = h('div', { class: 'report-rules' });
  private readonly palette = h('div', { class: 'palette' });

  constructor(
    private readonly look: TokenLook,
    private readonly example: { n: number; member: Token; whole: Token },
    private readonly onEvent: (e: ReportEvent) => void,
  ) {
    this.stepEls = [this.openStep(0, 'describe'), this.rulesStep(), this.openStep(2, 'organise')];
    this.el.append(...this.stepEls);
    this.show();
  }

  /** Move on to the next step; the current one is hidden for good. Returns false if already on the last step. */
  next(): boolean {
    if (this.step >= this.stepEls.length - 1) return false;
    this.step++;
    this.onEvent({ op: 'step', step: this.step });
    this.show();
    return true;
  }

  answers(): ReportAnswers {
    return { describe: this.describe, rules: JSON.parse(JSON.stringify(this.rules)), organise: this.organise };
  }

  private show(): void {
    this.stepEls.forEach((el, i) => (el.style.display = i === this.step ? '' : 'none'));
  }

  // ---------------------------------------------------------------- steps

  private openStep(i: 0 | 2, q: 'describe' | 'organise'): HTMLElement {
    const s = REPORT.steps[i] as { title: string; question: string };
    const ta = h('textarea', { rows: 10, id: `report-${q}`, 'aria-label': s.question });
    ta.addEventListener('change', () => {
      const from = this[q];
      this[q] = ta.value;
      this.onEvent({ op: 'answer', q, from, to: ta.value });
    });
    return h('div', { class: 'report-step', 'data-step': String(i) }, h('h3', {}, s.title), h('p', {}, s.question), ta);
  }

  private rulesStep(): HTMLElement {
    const s = REPORT.steps[1] as { title: string; intro: string };
    // palette: one row per scale, small to large, no labels
    for (let tier = 0; tier < 3; tier++) {
      const row = h('div', { class: 'palette-row' });
      for (let type = 0; type < REPORT.colourWords.length; type++) row.append(this.paletteToken({ tier, type }));
      this.palette.append(row);
    }
    const ex = this.example;
    const exampleLine = h('div', { class: 'rule-line example' },
      h('span', { class: 'n' }, String(ex.n)), '×', this.staticToken(ex.member), REPORT.makeup.makeUp, this.staticToken(ex.whole));
    const add = (kind: ReportRule['kind'], label: string) =>
      h('button', { class: 'small', id: `report-add-${kind}`, onclick: () => this.addRule(kind) }, label);
    return h('div', { class: 'report-step', 'data-step': '1' },
      h('h3', {}, s.title),
      h('p', {}, s.intro),
      h('div', { class: 'muted' }, REPORT.palette),
      this.palette,
      h('div', { class: 'muted' }, REPORT.example),
      exampleLine,
      this.ruleList,
      h('div', { class: 'row wrap' }, add('interaction', REPORT.interaction.label), add('makeup', REPORT.makeup.label), add('other', REPORT.other.label)),
    );
  }

  // ---------------------------------------------------------------- tokens and blanks

  private describeToken(t: Token): string {
    return `${REPORT.sizeWords[t.tier]} ${REPORT.colourWords[t.type]}`;
  }

  private staticToken(t: Token): HTMLElement {
    const el = h('span', { class: 'token', title: this.describeToken(t) });
    el.innerHTML = tokenSvg(t, this.look);
    return el;
  }

  private paletteToken(t: Token): HTMLElement {
    const el = this.staticToken(t);
    el.classList.add('pick');
    el.setAttribute('draggable', 'true');
    el.dataset.token = tokenKey(t);
    el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', tokenKey(t)));
    el.addEventListener('click', () => this.pick(this.picked && tokenKey(this.picked) === tokenKey(t) ? null : t));
    return el;
  }

  /** click-to-place: remember (and highlight) a palette token until it is placed in a blank */
  private pick(t: Token | null): void {
    this.picked = t;
    for (const p of this.palette.querySelectorAll<HTMLElement>('.pick')) p.classList.toggle('picked', t !== null && p.dataset.token === tokenKey(t));
  }

  /** A blank in a rule sentence: drop (or click-place) a token into it; click a filled one to empty it. */
  private blank(get: () => Token | null, set: (t: Token | null) => void, label: string): HTMLElement {
    const el = h('span', { class: 'blank', 'data-blank': label, title: 'drop a picture here' });
    const paint = () => {
      const t = get();
      el.classList.toggle('filled', t !== null);
      el.innerHTML = t ? tokenSvg(t, this.look) : '';
      el.title = t ? this.describeToken(t) : 'drop a picture here';
    };
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const t = parseKey(e.dataTransfer?.getData('text/plain') ?? '');
      if (t) {
        set(t);
        paint();
      }
    });
    el.addEventListener('click', () => {
      if (get()) set(null);
      else if (this.picked) {
        set(this.picked);
        this.pick(null);
      }
      paint();
    });
    paint();
    return el;
  }

  // ---------------------------------------------------------------- rules

  private addRule(kind: ReportRule['kind']): void {
    const id = `q${this.nextId++}`;
    const rule: ReportRule =
      kind === 'interaction'
        ? { id, kind, a: null, b: null, outcome: '' }
        : kind === 'makeup'
          ? { id, kind, n: null, member: null, whole: null }
          : { id, kind, text: '' };
    this.rules.push(rule);
    this.onEvent({ op: 'rule_add', id, kind });
    this.ruleList.append(this.ruleEl(rule));
  }

  private setField(rule: ReportRule, field: string, to: unknown): void {
    const r = rule as unknown as Record<string, unknown>;
    const from = r[field];
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    r[field] = to;
    this.onEvent({ op: 'rule_set', id: rule.id, field, from, to });
  }

  private ruleEl(rule: ReportRule): HTMLElement {
    const r = rule as unknown as Record<string, unknown>;
    const tokenBlank = (field: string) =>
      this.blank(() => (r[field] as Token | null) ?? null, (t) => this.setField(rule, field, t), field);
    let line: HTMLElement;
    if (rule.kind === 'interaction') {
      const outcome = h('input', { type: 'text', class: 'grow', placeholder: REPORT.interaction.placeholder, 'data-field': 'outcome' });
      outcome.addEventListener('change', () => this.setField(rule, 'outcome', outcome.value));
      line = h('div', { class: 'rule-line' }, REPORT.interaction.when, tokenBlank('a'), REPORT.interaction.near, tokenBlank('b'), ',', outcome);
    } else if (rule.kind === 'makeup') {
      const n = h('input', { type: 'number', min: 1, max: 20, class: 'n-input', 'data-field': 'n', 'aria-label': 'how many' });
      n.addEventListener('change', () => this.setField(rule, 'n', n.value === '' ? null : Math.max(1, Math.min(20, Math.round(Number(n.value))))));
      line = h('div', { class: 'rule-line' }, n, '×', tokenBlank('member'), REPORT.makeup.makeUp, tokenBlank('whole'));
    } else {
      const text = h('textarea', { rows: 2, placeholder: REPORT.other.placeholder, 'data-field': 'text' });
      text.addEventListener('change', () => this.setField(rule, 'text', text.value));
      line = h('div', { class: 'rule-line' }, text);
    }
    const card = h('div', { class: 'card', 'data-rule': rule.id }, line);
    card.append(h('button', {
      class: 'small danger rule-delete',
      title: 'Delete rule',
      onclick: () => {
        this.rules = this.rules.filter((x) => x !== rule);
        this.onEvent({ op: 'rule_delete', id: rule.id, rule: JSON.parse(JSON.stringify(rule)) });
        card.remove();
      },
    }, '✕'));
    return card;
  }
}
