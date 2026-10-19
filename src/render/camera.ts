// Pan/zoom camera. (x, y) is the world point shown at the centre of the viewport.

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 1;
  viewH = 1;
  static readonly MIN_ZOOM = 0.15;
  static readonly MAX_ZOOM = 8;

  setView(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  fit(worldW: number, worldH: number): void {
    this.x = worldW / 2;
    this.y = worldH / 2;
    this.zoom = Math.min(this.viewW / worldW, this.viewH / worldH) * 0.95;
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.viewW / 2) / this.zoom + this.x, (sy - this.viewH / 2) / this.zoom + this.y];
  }

  panByScreen(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.min(Camera.MAX_ZOOM, Math.max(Camera.MIN_ZOOM, this.zoom * factor));
    const [wx2, wy2] = this.screenToWorld(sx, sy);
    this.x += wx - wx2;
    this.y += wy - wy2;
  }

  state(): { x: number; y: number; zoom: number } {
    const r = (v: number) => Math.round(v * 100) / 100;
    return { x: r(this.x), y: r(this.y), zoom: Math.round(this.zoom * 1e4) / 1e4 };
  }
}
