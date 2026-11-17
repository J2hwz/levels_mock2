// Pointer / keyboard -> Action translation.
//   hover: highlight; click: select deepest; click again on the same spot: select parent
//   drag selected (or a part of it): move it with all its parts (and its bond partner);
//   Shift-drag: detach first (a member leaves its parent with its partner; a free one leaves its partner)
//   dropping never builds anything: things just meet (so lock & key / catalysis can be seen).
//   C while dragging: join the compatible parent it touches, else combine it with every loose same-level
//   thing touching it into a new parent; then keep dragging that whole.
//   arrow keys: scroll the world under the viewing window. No zoom, no drag-to-pan.
//   look only outside the window: nothing there can be hovered or picked, and a dragged thing can't leave it
//   Esc: clear selection; S (debug only): swap realisation; C: see above
//   composition=no: only whole things can be hovered, selected or dragged, and C does nothing

import type { Action, WorldState } from '../sim/world';
import { canCombine, findCombineGroup, findJoinTarget } from '../sim/world';
import type { Camera } from './camera';
import { type Layout, actionableChain, displayToSim, hitChain } from './layout';
import { VIEW, clampToView, inRect } from './view';

export interface InputHost {
  readonly state: WorldState;
  readonly camera: Camera;
  readonly debug: boolean;
  layout(): Layout;
  selected(): number;
  act(a: Action): void;
  select(id: number | null): void;
  setHover(id: number): void;
  /** C found nothing to join or combine with */
  refused(id: number): void;
  /** an arrow key went down or up (for the log) */
  viewKey(key: string, down: boolean): void;
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const CLICK_SLOP_PX = 4;
const HIT_MIN_PX = 5;

export class InputController {
  private down: {
    sx: number;
    sy: number;
    /** latest pointer position (screen) */
    lx: number;
    ly: number;
    chain: number[];
    shift: boolean;
    /** ignore: moved off the selection, which does nothing (there is no drag-to-pan) */
    mode: 'none' | 'drag' | 'ignore';
    dragId: number;
    offX: number;
    offY: number;
  } | null = null;
  private pendingMove: Action | null = null;
  /** arrow keys held down */
  private readonly held = new Set<string>();
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
    on(canvas, 'wheel', (e) => e.preventDefault(), { passive: false }); // no zoom; don't scroll the page either
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'keyup', (e) => this.release(e.key));
    on(window, 'blur', () => [...this.held].forEach((k) => this.release(k)));
  }

  /** Remove every listener (safe to call more than once). */
  dispose(): void {
    for (const f of this.off.splice(0)) f();
    this.held.clear();
  }

  /**
   * Called once per frame before sim ticks: scroll for the arrow keys held (dtMs since the last frame), then send
   * at most one dragMove action. A held drag follows the scroll, so the thing stays under the pointer.
   */
  flush(dtMs = 0): void {
    if (this.held.size && dtMs > 0) {
      let dx = 0;
      let dy = 0;
      for (const k of this.held) {
        dx += ARROWS[k][0];
        dy += ARROWS[k][1];
      }
      const step = (VIEW.speed * dtMs) / 1000;
      this.host.camera.moveBy(dx * step, dy * step);
      const d = this.down;
      if (d?.mode === 'drag') {
        const [tx, ty] = this.dragTarget(d.lx, d.ly);
        this.pendingMove = { kind: 'dragMove', id: d.dragId, x: tx, y: ty };
      }
    }
    this.flushMove();
  }

  private flushMove(): void {
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
    if (!inRect(this.host.camera.rect(), wx, wy)) return []; // look only outside the window
    return actionableChain(this.host.state, hitChain(this.host.state, this.host.layout(), wx, wy, HIT_MIN_PX / this.host.camera.zoom));
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this.local(e);
    this.down = { sx, sy, lx: sx, ly: sy, chain: this.chainAt(sx, sy), shift: e.shiftKey, mode: 'none', dragId: -1, offX: 0, offY: 0 };
  }

  private onMove(e: PointerEvent): void {
    const [sx, sy] = this.local(e);
    const d = this.down;
    if (d) {
      d.lx = sx;
      d.ly = sy;
    }
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
        if (d.shift && (s.entities[sel].parent >= 0 || s.entities[sel].bond >= 0)) this.host.act({ kind: 'detach', id: sel });
        const n = this.host.layout()[sel];
        const [wx, wy] = this.host.camera.screenToWorld(d.sx, d.sy);
        d.offX = n ? n.x - wx : 0;
        d.offY = n ? n.y - wy : 0;
        const [tx, ty] = this.dragTarget(sx, sy);
        this.host.act({ kind: 'dragStart', id: sel, x: tx, y: ty });
      } else {
        d.mode = 'ignore';
      }
    }
    if (d.mode === 'drag') {
      const [tx, ty] = this.dragTarget(sx, sy);
      this.pendingMove = { kind: 'dragMove', id: d.dragId, x: tx, y: ty };
    }
  }

  private dragTarget(sx: number, sy: number): [number, number] {
    const d = this.down!;
    const [wx, wy] = this.host.camera.screenToWorld(sx, sy);
    // the dragged thing's centre stays inside the window
    const [cx, cy] = clampToView(this.host.camera.rect(), wx + d.offX, wy + d.offY);
    return displayToSim(this.host.state, this.host.layout(), d.dragId, cx, cy);
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.mode === 'none') {
      this.click(d.chain);
    } else if (d.mode === 'drag') {
      this.flushMove();
      this.host.act({ kind: 'dragEnd', id: d.dragId });
    }
  }

  /** C while dragging: build, then keep dragging the whole the dragged thing is now part of. */
  private combineNow(): void {
    const d = this.down!;
    const s = this.host.state;
    const id = d.dragId;
    if (s.config.compose === false) return; // nothing can be combined in composition=no
    this.flushMove();
    const target = findJoinTarget(s, id);
    if (target >= 0) {
      this.host.act({ kind: 'join', id, parent: target });
    } else {
      const group = findCombineGroup(s, id);
      if (canCombine(s, group)) this.host.act({ kind: 'combine', ids: group });
    }
    const p = s.entities[id].parent;
    if (p < 0) {
      this.host.refused(id);
      return;
    }
    this.host.act({ kind: 'dragEnd', id });
    this.host.select(p);
    const [wx, wy] = this.host.camera.screenToWorld(d.lx, d.ly);
    // a whole that was just founded is not laid out yet; free-standing things are drawn at their sim position
    const n = this.host.layout()[p];
    d.dragId = p;
    d.offX = (n && s.entities[p].parent >= 0 ? n.x : s.entities[p].x) - wx;
    d.offY = (n && s.entities[p].parent >= 0 ? n.y : s.entities[p].y) - wy;
    const [tx, ty] = this.dragTarget(d.lx, d.ly);
    this.host.act({ kind: 'dragStart', id: p, x: tx, y: ty });
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

  private release(key: string): void {
    if (!this.held.delete(key)) return;
    this.host.viewKey(key, false);
  }

  private onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key in ARROWS) {
      e.preventDefault(); // don't scroll the page
      if (!this.held.has(e.key)) {
        this.held.add(e.key);
        this.host.viewKey(e.key, true);
      }
      return;
    }
    if ((e.key === 'c' || e.key === 'C') && !e.repeat && this.down?.mode === 'drag') {
      this.combineNow();
      return;
    }
    const sel = this.host.selected();
    if (e.key === 'Escape') {
      this.host.select(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.repeat && sel >= 0) {
      // delete the selected thing (and everything inside it)
      e.preventDefault();
      this.host.act({ kind: 'remove', id: sel });
      this.host.select(null);
    } else if ((e.key === 's' || e.key === 'S') && this.host.debug && sel >= 0) {
      this.host.act({ kind: 'swap', id: sel });
    }
  }
}
