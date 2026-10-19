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
