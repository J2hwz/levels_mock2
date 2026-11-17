// Inspect panel, controls legend and phase banner.

import { h } from './dom';

export interface InspectInfo {
  colour: string;
  colourName: string;
  size: number;
  speed: number;
  parts: number;
  debug?: string;
}

export class InspectPanel {
  readonly el = h('div', { class: 'inspect' });
  private last = '<init>';

  update(info: InspectInfo | null): void {
    const key = info ? JSON.stringify(info) : '';
    if (key === this.last) return;
    this.last = key;
    if (!info) {
      this.el.replaceChildren(h('span', { class: 'muted' }, 'Click something to inspect it.'));
      return;
    }
    this.el.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'swatch big', style: `background:${info.colour}` }), h('b', {}, info.colourName)),
      h('div', {}, `size: ${info.size.toFixed(0)}`),
      h('div', {}, `speed: ${info.speed.toFixed(0)}`),
      h('div', {}, `visible parts: ${info.parts}`),
      ...(info.debug ? [h('div', { class: 'debug' }, info.debug)] : []),
    );
  }
}

/** Always-visible key/mouse legend so participants don't have to remember the controls. */
export class ControlsLegend {
  readonly el = h('div', { class: 'legend', id: 'controls-legend' });
  private open = true;

  constructor(
    private readonly debug: boolean,
    private readonly reveal: boolean,
    /** lock & key is on somewhere: some loose pairs stick together instead of combining */
    private readonly sticks: boolean,
    /** composition=no: parts can't be seen, selected, pulled out or combined, so those rows are left out */
    private readonly compose: boolean,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.render();
  }

  private render(): void {
    const toggle = h('button', {
      class: 'link legend-toggle',
      onclick: () => {
        this.open = !this.open;
        this.onToggle(this.open);
        this.render();
      },
    }, this.open ? 'hide' : 'show controls');
    if (!this.open) {
      this.el.replaceChildren(toggle);
      return;
    }
    const row = (keys: string[], what: string) =>
      h('tr', {},
        h('td', {}, ...keys.flatMap((k, i) => [i ? ' + ' : '', h('kbd', {}, k)])),
        h('td', {}, what));
    this.el.replaceChildren(
      h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Controls'), toggle),
      h('table', {},
        row(['Hover'], this.reveal && this.compose ? 'highlight and look inside' : 'highlight'),
        row(['Click'], 'select'),
        ...(this.compose ? [row(['Click again'], 'select what it is part of')] : []),
        row(['Esc'], 'clear selection'),
        row(['Drag'], 'move the selected thing'),
        ...(!this.compose
          ? this.sticks ? [row(['Shift', 'Drag'], 'pull it off what it is stuck to')] : []
          : [row(['Shift', 'Drag'], this.sticks ? 'pull it out of what it is in (what is stuck to it comes too), or off what it is stuck to' : 'pull it out of what it is in')]),
        ...(this.compose ? [row(['Drag', 'C'], 'combine it with whatever it is touching')] : []),
        row(['Drag a picture'], 'add it to the world'),
        row(['Delete'], 'remove the selected thing'),
        row(['← ↑ → ↓'], 'move around (arrow keys)'),
        ...(this.debug ? [row(['S'], 'swap realisation (debug)')] : []),
      ),
    );
  }
}

export class PhaseBanner {
  readonly el = h('div', { class: 'banner' });
  private readonly title = h('b', { class: 'phase-title' });
  private readonly text = h('span', { class: 'phase-text' });
  private readonly timer = h('span', { class: 'timer' });
  readonly button = h('button', { class: 'continue', id: 'phase-continue' }, 'Continue');
  readonly skip = h('button', { class: 'small debug-skip', id: 'phase-skip', title: 'debug: skip phase' }, 'skip ▸');

  constructor(debug: boolean) {
    this.el.append(this.title, this.text, h('span', { class: 'spacer' }), this.timer, this.button);
    if (debug) this.el.append(this.skip);
  }

  set(title: string, text: string, showButton: boolean, buttonLabel = 'Continue'): void {
    this.title.textContent = title;
    this.text.textContent = text;
    this.button.style.display = showButton ? '' : 'none';
    this.button.textContent = buttonLabel;
  }

  setTimer(msLeft: number | null): void {
    if (msLeft === null) {
      this.timer.textContent = '';
      return;
    }
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
