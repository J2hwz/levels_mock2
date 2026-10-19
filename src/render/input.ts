// Pointer / keyboard -> Action translation.
//   hover: highlight; click: select deepest; click again on the same spot: select parent
//   drag selected (or a part of it): move it with all its parts; Shift-drag: detach first
//   drop a free entity near a compatible parent: join; drag background: pan; wheel: zoom
//   Esc: clear selection; I: isolate toggle; S (debug only): swap realisation

import type { Action, WorldState } from '../sim/world';
import { findJoinTarget } from '../sim/world';
import type { Camera } from './camera';
import { type Layout, displayToSim, hitChain } from './layout';

export interface InputHost {
  readonly state: WorldState;
  readonly camera: Camera;
  readonly debug: boolean;
  layout(): Layout;
  selected(): number;
  act(a: Action): void;
  select(id: number | null): void;
  setHover(id: number): void;
}

const CLICK_SLOP_PX = 4;
const HIT_MIN_PX = 5;

export class InputController {
  private down: {
    sx: number;
    sy: number;
    chain: number[];
    shift: boolean;
    mode: 'none' | 'drag' | 'pan';
    dragId: number;
    offX: number;
    offY: number;
  } | null = null;
  private pendingMove: Action | null = null;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: InputHost,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, k: K, f: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(k, f as EventListener, opts);
      this.off.push(() => el.removeEventListener(k, f as EventListener));
    };
    on(canvas, 'pointerdown', (e) => this.onDown(e));
    on(canvas, 'pointermove', (e) => this.onMove(e));
    on(canvas, 'pointerup', (e) => this.onUp(e));
    on(canvas, 'pointercancel', (e) => this.onUp(e));
    on(canvas, 'pointerleave', () => !this.down && this.host.setHover(-1));
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKey(e));
  }

  dispose(): void {
    for (const f of this.off) f();
  }

  /** Called once per frame before sim ticks: at most one dragMove action per frame. */
  flush(): void {
    if (this.pendingMove) {
      this.host.act(this.pendingMove);
      this.pendingMove = null;
    }
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private chainAt(sx: number, sy: number): number[] {
    const [wx, wy] = this.host.camera.screenToWorld(sx, sy);
    return hitChain(this.host.state, this.host.layout(), wx, wy, HIT_MIN_PX / this.host.camera.zoom);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.local(e);
    this.down = { sx, sy, chain: this.chainAt(sx, sy), shift: e.shiftKey, mode: 'none', dragId: -1, offX: 0, offY: 0 };
  }

  private onMove(e: PointerEvent): void {
    const [sx, sy] = this.local(e);
    const d = this.down;
    if (!d) {
      const chain = this.chainAt(sx, sy);
      this.host.setHover(chain.length ? chain[0] : -1);
      return;
    }
    if (d.mode === 'none') {
      if (Math.hypot(sx - d.sx, sy - d.sy) < CLICK_SLOP_PX) return;
      const sel = this.host.selected();
      if (sel >= 0 && d.chain.includes(sel)) {
        d.mode = 'drag';
        d.dragId = sel;
        const s = this.host.state;
        if (d.shift && s.entities[sel].parent >= 0) this.host.act({ kind: 'detach', id: sel });
        const n = this.host.layout()[sel];
        const [wx, wy] = this.host.camera.screenToWorld(d.sx, d.sy);
        d.offX = n ? n.x - wx : 0;
        d.offY = n ? n.y - wy : 0;
        const [tx, ty] = this.dragTarget(sx, sy);
        this.host.act({ kind: 'dragStart', id: sel, x: tx, y: ty });
      } else {
        d.mode = 'pan';
      }
    }
    if (d.mode === 'drag') {
      const [tx, ty] = this.dragTarget(sx, sy);
      this.pendingMove = { kind: 'dragMove', id: d.dragId, x: tx, y: ty };
    } else if (d.mode === 'pan') {
      this.host.camera.panByScreen(sx - d.sx, sy - d.sy);
      d.sx = sx;
      d.sy = sy;
    }
  }

  private dragTarget(sx: number, sy: number): [number, number] {
    const d = this.down!;
    const [wx, wy] = this.host.camera.screenToWorld(sx, sy);
    return displayToSim(this.host.state, this.host.layout(), d.dragId, wx + d.offX, wy + d.offY);
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.mode === 'none') {
      this.click(d.chain);
    } else if (d.mode === 'drag') {
      this.flush();
      this.host.act({ kind: 'dragEnd', id: d.dragId });
      const target = findJoinTarget(this.host.state, d.dragId);
      if (target >= 0) this.host.act({ kind: 'join', id: d.dragId, parent: target });
    }
  }

  private click(chain: number[]): void {
    if (chain.length === 0) {
      this.host.select(null);
      return;
    }
    const sel = this.host.selected();
    const i = chain.indexOf(sel);
    // same spot again: climb to the parent; past the top, wrap back to the deepest
    this.host.select(i >= 0 ? (chain[i + 1] ?? chain[0]) : chain[0]);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const [sx, sy] = this.local(e);
    this.host.camera.zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const sel = this.host.selected();
    if (e.key === 'Escape') {
      this.host.select(null);
    } else if (e.key === 'i' || e.key === 'I') {
      const iso = this.host.state.isolated;
      this.host.act({ kind: 'isolate', id: iso >= 0 ? null : sel >= 0 ? sel : null });
    } else if ((e.key === 's' || e.key === 'S') && this.host.debug && sel >= 0) {
      this.host.act({ kind: 'swap', id: sel });
    }
  }
}
