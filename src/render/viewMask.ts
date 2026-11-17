// The blurred surround of the viewing window: four panels (top, bottom, left, right) over the world canvas, plus an
// outline around the window. They blur and dim what is behind them (VIEW.peek) and take the pointer, so nothing
// outside the window can be hovered, clicked or dropped on.

import { h } from '../ui/dom';
import type { Camera } from './camera';
import { VIEW } from './view';

export class ViewMask {
  readonly el = h('div', { class: 'view-mask' });
  private readonly sides = [0, 1, 2, 3].map(() => h('div', { class: 'view-side' }));
  private readonly frame = h('div', { class: 'view-frame' });
  private last = '';

  constructor(bg: string) {
    const peek = Math.min(1, Math.max(0, VIEW.peek));
    const blur = VIEW.blurPx * (1 - peek);
    for (const s of this.sides) {
      s.style.setProperty('backdrop-filter', `blur(${blur}px)`);
      s.style.setProperty('-webkit-backdrop-filter', `blur(${blur}px)`);
      s.style.background = `color-mix(in srgb, ${bg} ${Math.round((1 - peek) * 100)}%, transparent)`;
      // drops on the surround are swallowed here, so nothing is added outside the window
      s.addEventListener('dragover', (e) => e.preventDefault());
      s.addEventListener('drop', (e) => e.preventDefault());
    }
    this.el.append(...this.sides, this.frame);
  }

  /** Place the panels around the window as the camera currently shows it (screen px within the stage). */
  update(cam: Camera): void {
    const w = VIEW.w * cam.zoom;
    const hgt = VIEW.h * cam.zoom;
    const l = (cam.viewW - w) / 2;
    const t = (cam.viewH - hgt) / 2;
    const key = `${cam.viewW}|${cam.viewH}|${w}|${hgt}`;
    if (key === this.last) return; // the window stays centred: only a resize moves it
    this.last = key;
    const px = (v: number) => `${Math.round(v)}px`;
    const place = (el: HTMLElement, left: number, top: number, width: number, height: number) =>
      Object.assign(el.style, { left: px(left), top: px(top), width: px(Math.max(0, width)), height: px(Math.max(0, height)) });
    const [top, bottom, left, right] = this.sides;
    place(top, 0, 0, cam.viewW, t);
    place(bottom, 0, t + hgt, cam.viewW, cam.viewH - t - hgt);
    place(left, 0, t, l, hgt);
    place(right, l + w, t, cam.viewW - l - w, hgt);
    place(this.frame, l, t, w, hgt);
  }
}
