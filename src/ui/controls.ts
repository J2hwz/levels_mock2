// Time controls, inspect panel and phase banner.

import { h } from './dom';

export const SPEEDS = [0, 0.5, 1, 2] as const;

export class TimeControls {
  readonly el = h('div', { class: 'time-controls' });
  private speed = 1;

  constructor(private readonly onSpeed: (s: number) => void) {
    this.render();
  }

  set(s: number): void {
    this.speed = s;
    this.render();
  }

  private render(): void {
    this.el.replaceChildren(
      ...SPEEDS.map((s) =>
        h('button', {
          class: 'small' + (s === this.speed ? ' active' : ''),
          'data-speed': s,
          onclick: () => {
            if (s === this.speed) return;
            this.set(s);
            this.onSpeed(s);
          },
        }, s === 0 ? '❚❚ pause' : `${s}×`),
      ),
    );
  }
}

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
  private isolated = false;

  constructor(
    private readonly debug: boolean,
    private readonly reveal: boolean,
    /** lock & key is on somewhere: some loose pairs stick together instead of combining */
    private readonly sticks: boolean,
    private readonly onToggle: (open: boolean) => void,
  ) {
    this.render();
  }

  /** highlight the I row while isolation is on */
  setIsolated(on: boolean): void {
    if (on === this.isolated) return;
    this.isolated = on;
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
    const row = (keys: string[], what: string, active = false) =>
      h('tr', active ? { class: 'active' } : {},
        h('td', {}, ...keys.flatMap((k, i) => [i ? ' + ' : '', h('kbd', {}, k)])),
        h('td', {}, what));
    this.el.replaceChildren(
      h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Controls'), toggle),
      h('table', {},
        row(['Hover'], this.reveal ? 'highlight and look inside' : 'highlight'),
        row(['Click'], 'select'),
        row(['Click again'], 'select what it is part of'),
        row(['Esc'], 'clear selection'),
        row(['Drag'], 'move the selected thing'),
        row(['Shift', 'Drag'], 'pull it out of what it is in, or off what it is stuck to'),
        row(['Drop'], 'loose thing joins what it lands on'),
        row(['Drop on a loose one'], this.sticks ? 'the two combine into something new, or stick together' : 'the two combine into something new'),
        row(['I'], this.isolated ? 'unfreeze everything (frozen now)' : 'freeze everything except selection', this.isolated),
        row(['Scroll'], 'zoom'),
        row(['Drag background'], 'move around'),
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

  constructor(timeControls: HTMLElement, debug: boolean) {
    this.el.append(this.title, this.text, h('span', { class: 'spacer' }), this.timer, timeControls, this.button);
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
