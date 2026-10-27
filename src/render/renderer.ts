// Pixi drawing. Reads the world + display layout; never mutates the world.

import { Application, Container, Graphics, Text } from 'pixi.js';
import type { SizeMode } from '../config';
import { type Entity, P, type WorldState, catalysisOn, descendants } from '../sim/world';
import { Camera } from './camera';
import { type Layout, openRoots } from './layout';
import { type Glyph, type SkinDef, lerpColor } from './skins';

export interface ViewState {
  selected: number;
  hovered: number;
  debug: boolean;
  size: SizeMode;
  /** composites closed (solid colour) unless hovered / selected / isolated */
  reveal: boolean;
  skin: SkinDef;
  /** render-only clock in seconds, for cosmetic wobble */
  time: number;
  /** entity to ring in red (C found nothing to combine with), or -1 */
  flash: number;
}

export class Renderer {
  readonly camera = new Camera();
  private readonly world = new Container();
  private readonly gRegion = new Graphics();
  private readonly gHerd = new Graphics();
  private readonly gOrg = new Graphics();
  private readonly gCell = new Graphics();
  private readonly gOver = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool = new Map<number, Text>();
  private hidden: (e: Entity) => boolean = () => false;

  private constructor(readonly app: Application) {
    this.world.addChild(this.gRegion, this.gHerd, this.gOrg, this.gCell, this.gOver, this.labels);
    app.stage.addChild(this.world);
  }

  static async create(parent: HTMLElement, skin: SkinDef): Promise<Renderer> {
    const app = new Application();
    await app.init({ resizeTo: parent, background: skin.bg, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
    parent.appendChild(app.canvas);
    const r = new Renderer(app);
    r.camera.setView(app.screen.width, app.screen.height);
    r.camera.fit(P.worldW, P.worldH);
    return r;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  draw(s: WorldState, layout: Layout, v: ViewState): void {
    const cam = this.camera;
    cam.setView(this.app.screen.width, this.app.screen.height);
    this.world.scale.set(cam.zoom);
    this.world.position.set(cam.viewW / 2 - cam.x * cam.zoom, cam.viewH / 2 - cam.y * cam.zoom);
    const px = 1 / cam.zoom; // one screen pixel in world units
    const sk = v.skin;

    let activeSet: Uint8Array | null = null;
    if (s.isolated >= 0) {
      activeSet = new Uint8Array(s.entities.length);
      activeSet[s.isolated] = 1;
      for (const d of descendants(s, s.isolated)) activeSet[d] = 1;
    }
    const dim = (e: Entity) => (activeSet && !activeSet[e.id] ? 0.22 : 1);

    // reveal: a top-level composite is closed (drawn as its colour only) unless something in it is
    // hovered, selected or isolated; everything inside a closed one is hidden
    const open = v.reveal ? openRoots(s, [v.hovered, v.selected, s.isolated]) : null;
    const rootOf = (e: Entity) => {
      let r = e;
      while (r.parent >= 0) r = s.entities[r.parent];
      return r;
    };
    const closed = (e: Entity) => open !== null && e.parent < 0 && e.tier > 0 && !open.has(e.id);
    const hidden = (e: Entity) => open !== null && e.parent >= 0 && !open.has(rootOf(e).id);
    this.hidden = hidden;

    for (const g of [this.gRegion, this.gHerd, this.gOrg, this.gCell, this.gOver]) g.clear();

    // world bounds
    this.gRegion.rect(0, 0, P.worldW, P.worldH).stroke({ width: 2 * px, color: sk.ui, alpha: 0.12 });

    // flat condition: health regions
    for (const r of s.regions) {
      this.gRegion.circle(r.x, r.y, r.r).stroke({ width: 1.5 * px, color: sk.ui, alpha: 0.15 });
      this.healthBar(this.gRegion, r.x, r.y - r.r - 10 * px, 60 * px, r.health, sk);
    }

    // lock & key bonds: a short link between bound partners, under everything else
    for (const e of s.entities) {
      if (!e.alive || e.bond < e.id || hidden(e)) continue;
      const a = layout[e.id];
      const b = layout[e.bond];
      if (!a || !b) continue;
      this.gRegion.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2 * px, color: sk.ui, alpha: 0.5 * dim(e) });
    }
    // catalysis turns organisms: show their orientation when it is on
    const spinMark = (t: number) => catalysisOn(s.config, t);

    for (const e of s.entities) {
      if (!e.alive) continue;
      const n = layout[e.id];
      if (!n || hidden(e)) continue;
      const a = dim(e);
      const shut = closed(e);
      if (e.tier === 2) {
        const col = sk.herd[e.type];
        this.gHerd.circle(n.x, n.y, n.r).fill({ color: col, alpha: (shut ? CLOSED_ALPHA : sk.herdFill) * a });
        if (v.size === 'irrelevant') {
          dashedCircle(this.gHerd, n.x, n.y, n.r, Math.max(10, Math.round(n.r / (6 * px))));
          this.gHerd.stroke({ width: 1.5 * px, color: col, alpha: Math.min(1, sk.herdStroke * 2) * a });
        } else {
          this.gHerd.circle(n.x, n.y, n.r).stroke({ width: 1.5 * px, color: col, alpha: sk.herdStroke * a });
        }
        if (e.health < 1) this.healthBar(this.gHerd, n.x, n.y - n.r - 6 * px, Math.max(n.r * 0.6, 20 * px), e.health, sk, a);
      } else if (e.tier === 1) {
        const col = sk.species[e.type];
        blob(this.gOrg, n.x, n.y, n.r, sk.wobble, v.time * 1.3 + e.id, e.angle);
        this.gOrg.fill({ color: col, alpha: (shut ? CLOSED_ALPHA : sk.membraneFill) * a });
        blob(this.gOrg, n.x, n.y, n.r, sk.wobble, v.time * 1.3 + e.id, e.angle);
        this.gOrg.stroke({ width: Math.max(1.5 * px, n.r * 0.08), color: col, alpha: sk.membraneStroke * a });
        if (spinMark(1)) rimMark(this.gOrg, n.x, n.y, n.r, e.angle, Math.max(n.r * 0.12, 1.5 * px), col, a);
        const w = Math.max(n.r * 1.3, 14 * px);
        this.healthBar(this.gOrg, n.x, n.y - n.r - w * 0.15 - 2 * px, w, e.health, sk, a);
      } else {
        const stressT = Math.min(1, e.signal / 0.6) * 0.65;
        const col = lerpColor(sk.cell[e.type], sk.stress, stressT);
        const r = Math.max(n.r, 0.6 * px);
        if (sk.wobble > 0) {
          this.gCell.circle(n.x, n.y, r).fill({ color: col, alpha: 0.3 * a });
          this.gCell.circle(n.x, n.y, r).stroke({ width: r * 0.22, color: col, alpha: sk.cellAlpha * a });
          glyph(this.gCell, sk.nucleus[e.type], n.x, n.y, r * 0.48, e.angle);
          this.gCell.fill({ color: col, alpha: a });
        } else {
          glyph(this.gCell, sk.glyph[e.type], n.x, n.y, r, e.angle);
          this.gCell.fill({ color: col, alpha: a });
        }
      }
    }

    // hover + selection
    const ring = (id: number, alpha: number, width: number) => {
      const n = id >= 0 ? layout[id] : undefined;
      if (!n || !s.entities[id].alive || this.hidden(s.entities[id])) return;
      this.gOver.circle(n.x, n.y, n.r + 3 * px).stroke({ width: width * px, color: sk.ui, alpha });
    };
    if (v.hovered !== v.selected) ring(v.hovered, 0.45, 1.5);
    ring(v.selected, 0.95, 2.5);
    if (s.isolated >= 0) ring(s.isolated, 0.5, 6);
    if (v.flash >= 0 && s.entities[v.flash]?.alive) {
      const n = layout[v.flash];
      if (n) this.gOver.circle(n.x, n.y, n.r + 5 * px).stroke({ width: 3 * px, color: sk.stress, alpha: 0.9 });
    }

    this.drawLabels(s, layout, v, px);
  }

  private healthBar(g: Graphics, cx: number, y: number, w: number, health: number, sk: SkinDef, a = 1): void {
    const h = Math.max(w * 0.12, 2 / this.camera.zoom);
    g.rect(cx - w / 2, y - h, w, h).fill({ color: sk.healthBg, alpha: 0.8 * a });
    const col = lerpColor(sk.stress, sk.health, health);
    g.rect(cx - w / 2, y - h, w * Math.max(0, health), h).fill({ color: col, alpha: a });
  }

  private drawLabels(s: WorldState, layout: Layout, v: ViewState, px: number): void {
    const seen = new Set<number>();
    if (v.debug) {
      for (const e of s.entities) {
        if (!e.alive || this.hidden(e)) continue;
        if (e.tier === 0 && this.camera.zoom < 2.5) continue;
        const n = layout[e.id];
        if (!n) continue;
        seen.add(e.id);
        let t = this.labelPool.get(e.id);
        if (!t) {
          t = new Text({ text: '', style: { fontSize: 11, fill: v.skin.text, fontFamily: 'monospace' } });
          this.labelPool.set(e.id, t);
          this.labels.addChild(t);
        }
        t.text =
          e.tier === 2
            ? `HERD#${e.id} k${e.type} r${e.realisation} ρ=${e.density.toFixed(2)}`
            : e.tier === 1
              ? `ORG#${e.id} sp${e.type} r${e.realisation} h=${e.hormone.toFixed(2)}`
              : `cell#${e.id} t${e.type}`;
        t.scale.set(px);
        t.position.set(n.x - t.width / 2, e.tier === 1 ? n.y + n.r + 2 * px : n.y - n.r - 14 * px);
      }
    }
    for (const [id, t] of this.labelPool) {
      if (!seen.has(id)) {
        t.destroy();
        this.labelPool.delete(id);
      }
    }
  }
}

/** fill alpha of a closed composite: it shows as its colour, hiding its parts */
const CLOSED_ALPHA = 0.85;

/** small dot on the rim at the entity's orientation */
function rimMark(g: Graphics, x: number, y: number, r: number, angle: number, size: number, color: number, alpha: number): void {
  g.circle(x + r * Math.cos(angle), y + r * Math.sin(angle), size).fill({ color, alpha });
}

function blob(g: Graphics, x: number, y: number, r: number, wob: number, phase: number, angle = 0): void {
  if (wob <= 0) {
    g.circle(x, y, r);
    return;
  }
  const pts: number[] = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    // the wobble pattern turns with the organism, so rotation is visible
    const rel = th - angle;
    const rr = r * (1 + wob * Math.sin(3 * rel + phase) + wob * 0.5 * Math.sin(5 * rel - phase * 1.3));
    pts.push(x + rr * Math.cos(th), y + rr * Math.sin(th));
  }
  g.poly(pts, true);
}

function glyph(g: Graphics, kind: Glyph, x: number, y: number, r: number, angle = 0): void {
  if (kind === 'circle') {
    g.circle(x, y, r);
    return;
  }
  const k = kind === 'triangle' ? 3 : 6;
  const rr = kind === 'triangle' ? r * 1.25 : r * 1.05;
  const pts: number[] = [];
  for (let i = 0; i < k; i++) {
    const th = -Math.PI / 2 + angle + (2 * Math.PI * i) / k;
    pts.push(x + rr * Math.cos(th), y + rr * Math.sin(th));
  }
  g.poly(pts, true);
}

function dashedCircle(g: Graphics, x: number, y: number, r: number, segments: number): void {
  const n = segments * 2;
  for (let i = 0; i < n; i += 2) {
    const a0 = (2 * Math.PI * i) / n;
    const a1 = (2 * Math.PI * (i + 1)) / n;
    g.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
    g.arc(x, y, r, a0, a1);
  }
}
