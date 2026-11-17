// Camera. (x, y) is the world point at the centre of the stage, which is also the centre of the viewing window.
// The zoom is fixed (see VIEW in view.ts); participants move with the arrow keys, kept inside the world.

import { P } from '../sim/world';
import { type ViewRect, clampCentre, viewRect, viewZoom } from './view';

export class Camera {
  x = P.worldW / 2;
  y = P.worldH / 2;
  zoom = 1;
  viewW = 1;
  viewH = 1;

  /** Stage size changed (or every frame): re-derive the fixed zoom and keep the window inside the world. */
  setView(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.zoom = viewZoom(w, h);
    [this.x, this.y] = clampCentre(this.x, this.y);
  }

  /** Scroll by (dx, dy) world units, staying inside the world. */
  moveBy(dx: number, dy: number): void {
    [this.x, this.y] = clampCentre(this.x + dx, this.y + dy);
  }

  /** The viewing window, world units. */
  rect(): ViewRect {
    return viewRect(this.x, this.y);
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.viewW / 2) / this.zoom + this.x, (sy - this.viewH / 2) / this.zoom + this.y];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.viewW / 2, (wy - this.y) * this.zoom + this.viewH / 2];
  }

  state(): ViewRect {
    const r = (v: number) => Math.round(v * 100) / 100;
    const v = this.rect();
    return { x: r(v.x), y: r(v.y), w: v.w, h: v.h };
  }
}
