// Mounts the sandbox (Pixi stage + HTML panels), runs the fixed-tick loop and the phases, and resolves when the
// participant finishes. Two modes:
//   main:  Explore (timed) -> Report (3 steps)
//   task:  one generalisation task in an empty world: drop things in from a palette, 1 minute (see generalisation.ts)

import type { Config } from '../config';
import type { Session } from '../log/session';
import { InputController } from '../render/input';
import { type Layout, computeLayout } from '../render/layout';
import { Renderer } from '../render/renderer';
import { SKINS, hex } from '../render/skins';
import { hashWorld } from '../sim/hash';
import { type Action, P, type Tier, chanceOf } from '../sim/world';
import { ControlsLegend, InspectPanel, type InspectInfo, PhaseBanner } from '../ui/controls';
import { h } from '../ui/dom';
import { Notepad } from '../ui/notepad';
import { REPORT, ReportPanel } from '../ui/report';
import { PALETTE_SALT, parseKey, shuffledTokens, tokenKey, tokenName, tokenSvg } from '../ui/tokens';
import { GEN, type TaskKey, isTaskSuccess } from './generalisation';
import { saveBackup as saveMainBackup } from './storage';

const TICK_MS = 1000 / P.ticksPerSecond;

const MAX_TICKS_PER_FRAME = 8;
const CAMERA_SAMPLE_MS = 250;
const BACKUP_MS = 10_000;

export const PHASES = [
  {
    key: 'explore',
    title: 'Explore',
    text: 'Look around and try things out. Click, drag, zoom. Find out how this world works.',
  },
  {
    key: 'report',
    title: 'Report',
    text: REPORT.bannerText,
  },
] as const;

export interface SandboxResult {
  final_hash: string;
  final_tick: number;
  n_events: number;
  backup_saved: boolean;
}

export async function runSandbox(root: HTMLElement, session: Session, cfg: Config, task?: TaskKey): Promise<SandboxResult> {
  const skin = SKINS[cfg.skin];
  const state = session.state;
  // task sessions are backed up together with the main one by the timeline, not on their own
  const saveBackup = (s: Session) => (task ? false : saveMainBackup(s));

  // ---- DOM skeleton
  const stage = h('div', { class: 'stage' });
  const side = h('aside', { class: 'side', style: 'display:none' });
  const hud = h('pre', { class: 'hud' });
  const inspect = new InspectPanel();
  const banner = new PhaseBanner(cfg.debug);
  const main = h('div', { class: 'main' }, stage, side);
  const shell = h('div', { class: `sandbox skin-${cfg.skin}` }, banner.el, main);
  const legend = new ControlsLegend(cfg.debug, cfg.reveal, cfg.lock, cfg.composition, (open) => session.log('legend', { open }));
  // participant notes, available in every phase of the main sandbox (starts closed; bottom right of the world)
  const notepad = new Notepad(
    (open) => session.log('notepad_toggle', { open }),
    (text, reason) => session.log('notepad', { text, reason }),
  );
  stage.append(inspect.el, legend.el, ...(task ? [] : [notepad.el]));
  if (cfg.debug) stage.append(hud);
  root.append(shell);

  const renderer = await Renderer.create(stage, skin);
  renderer.canvas.classList.add('world-canvas');
  if (task) {
    // the task world starts empty: look closely at its centre, so dropped cells are easy to see
    renderer.camera.x = P.worldW / 2;
    renderer.camera.y = P.worldH / 2;
    renderer.camera.zoom = 2;
  }

  // ---- interaction state
  let selected = -1;
  let hovered = -1;
  let layout: Layout = computeLayout(state);

  const act = (a: Action) => {
    session.act(a);
  };
  const select = (id: number | null) => {
    selected = id ?? -1;
    act({ kind: 'select', id });
  };

  // a brief red ring when C finds nothing it can combine
  let flash = { id: -1, until: 0 };
  const input = new InputController(renderer.canvas, {
    state,
    camera: renderer.camera,
    debug: cfg.debug,
    layout: () => layout,
    selected: () => selected,
    act,
    select,
    refused: (id) => {
      session.log('combine_refused', { id });
      flash = { id, until: performance.now() + 600 };
    },
    setHover: (id) => {
      if (id === hovered) return;
      hovered = id;
      session.log('hover', { id: id >= 0 ? id : null });
    },
  });

  const colourOf = (id: number): { css: string; name: string } | null => {
    const e = state.entities[id];
    if (!e || !e.alive) return null;
    if (e.tier === 0) return { css: hex(skin.cell[e.type]), name: skin.cellNames[e.type] };
    if (e.tier === 1) return { css: hex(skin.species[e.type]), name: skin.speciesNames[e.type] };
    return { css: hex(skin.herd[e.type]), name: skin.herdNames[e.type] };
  };

  // ---- report (phase 2): its worked example is a format-only placeholder, the same in every condition
  // each palette shows the elements in its own random order, drawn from the seed and logged
  const reportOrder = shuffledTokens(cfg.seed, PALETTE_SALT.report, 3);
  if (!task) session.log('palette_order', { where: 'report', order: reportOrder.map(tokenKey) });
  const report = new ReportPanel(
    {
      colours: [skin.cell.map(hex), skin.species.map(hex), skin.herd.map(hex)],
      shapes: skin.wobble > 0 ? skin.nucleus : skin.glyph,
    },
    reportOrder,
    (e) => {
      session.log('report', e);
      if (e.op === 'step') showReportStep();
    },
  );

  // ---- generalisation task: palette of all elements (only cells in the flat condition), dropped onto the world
  const look = { colours: [skin.cell.map(hex), skin.species.map(hex), skin.herd.map(hex)], shapes: skin.wobble > 0 ? skin.nucleus : skin.glyph };
  let spawns = 0;
  let success: { tick: number; tiers: [number, number] } | null = null;
  const taskStatus = h('p', { class: 'task-status', id: 'task-status' });
  const taskPalette = h('div', { class: 'palette grid' });
  if (task) {
    const order = shuffledTokens(cfg.seed, PALETTE_SALT[task], cfg.hier ? 3 : 1);
    session.log('palette_order', { where: task, order: order.map(tokenKey) });
    for (const t of order) {
      const el = h('span', { class: 'token pick', draggable: 'true', title: tokenName(t), 'data-token': tokenKey(t) });
      el.innerHTML = tokenSvg(t, look);
      el.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', tokenKey(t)));
      taskPalette.append(el);
    }
  }
  const taskPanel = h('section', { class: 'panel report task' }, h('h3', {}, GEN.palette), taskPalette, taskStatus);
  if (task) {
    const canvas = renderer.canvas;
    canvas.addEventListener('dragover', (e) => e.preventDefault());
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = parseKey(e.dataTransfer?.getData('text/plain') ?? '');
      if (!t || spawns >= GEN.maxSpawns) return;
      const r = canvas.getBoundingClientRect();
      const [x, y] = renderer.camera.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      act({ kind: 'spawn', tier: t.tier as Tier, type: t.type, x, y });
      spawns++;
      if (spawns >= GEN.maxSpawns) {
        taskPalette.classList.add('spent');
        if (!success) taskStatus.textContent = GEN.outOfSpawns;
      }
    });
  }

  // ---- phases
  let phase = -1;
  let phaseStart = performance.now();
  let finish: (r: SandboxResult) => void = () => {};
  const done = new Promise<SandboxResult>((res) => (finish = res));

  const startTask = () => {
    if (!task) return;
    phase = 0;
    phaseStart = performance.now();
    session.log('phase', { from: null, to: `task_${task}`, index: 0 });
    side.style.display = '';
    side.replaceChildren(taskPanel);
    banner.set(`Task ${GEN.order.indexOf(task) + 1} of ${GEN.order.length}`, GEN.tasks[task].prompt, false, 'Continue');
    saveBackup(session);
  };
  const enterPhase = (i: number) => {
    const from = phase >= 0 ? PHASES[phase].key : null;
    phase = i;
    phaseStart = performance.now();
    const p = PHASES[i];
    session.log('phase', { from, to: p.key, index: i });
    side.style.display = i > 0 ? '' : 'none';
    side.replaceChildren(...(i === 1 ? [report.el] : []));
    if (i === 1) {
      enterReportMode();
      session.log('report', { op: 'step', step: report.step });
      showReportStep();
    } else {
      banner.set(`1/2 · ${p.title}`, p.text, false); // Explore ends on its timer
    }
    saveBackup(session);
  };
  /**
   * Report: the world is hidden and stops (no ticks, no camera samples, no input); only the notes stay, shown open
   * where the world was. Participants were told in the instructions that this would happen.
   */
  function enterReportMode(): void {
    input.dispose();
    window.clearInterval(camTimer);
    selected = -1;
    hovered = -1;
    stage.classList.add('report-mode');
    main.classList.add('report-layout'); // questions fill most of the screen; the notes are a column on the right
    notepad.show();
  }
  /** banner for the current report step: Next until the last step, then Finish */
  function showReportStep(): void {
    const last = report.step === REPORT.steps.length - 1;
    banner.set(`2/2 · ${PHASES[1].title} · step ${report.step + 1} of ${REPORT.steps.length}`, PHASES[1].text, true, last ? 'Finish' : 'Next');
    saveBackup(session);
  }
  const nextPhase = () => {
    if (task) end('continue');
    else if (phase === 0) enterPhase(1);
    else if (!report.next()) end();
  };
  banner.button.addEventListener('click', nextPhase);
  banner.skip.addEventListener('click', nextPhase);

  // ---- loop
  let acc = 0;
  let fps = 60;
  const t0 = performance.now();
  const frame = () => {
    const dt = Math.min(renderer.app.ticker.deltaMS, 100);
    fps = fps * 0.95 + (1000 / Math.max(1, renderer.app.ticker.deltaMS)) * 0.05;
    if (!task && phase === 1) return; // report: the world is hidden and stopped
    input.flush();
    acc += dt;
    let n = 0;
    while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
      const evs = session.tick();
      const hit = task && !success ? evs.find((e) => isTaskSuccess(task, e)) : undefined;
      if (task && hit && hit.kind === 'encounter') {
        // the target mechanism happened (any sizes): say so, and let them move on
        success = { tick: state.tick, tiers: [hit.tier, hit.tierB] };
        session.log('task_success', { task, tick: state.tick, tiers: success.tiers });
        taskStatus.textContent = GEN.success;
        taskStatus.classList.add('done');
        banner.set(`Task ${GEN.order.indexOf(task) + 1} of ${GEN.order.length}`, GEN.tasks[task].prompt, true, 'Continue');
      }
      acc -= TICK_MS;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) acc = 0; // fell behind: drop time rather than spiral
    if (selected >= 0 && !state.entities[selected]?.alive) selected = -1;
    if (hovered >= 0 && !state.entities[hovered]?.alive) hovered = -1;

    layout = computeLayout(state);
    renderer.draw(state, layout, { selected, hovered, debug: cfg.debug, contents: !cfg.composition ? 'never' : cfg.reveal ? 'hover' : 'always', skin, time: (performance.now() - t0) / 1000, flash: performance.now() < flash.until ? flash.id : -1 });
    inspect.update(inspectInfo());

    if (task) {
      const left = GEN.durationMs - (performance.now() - phaseStart);
      banner.setTimer(left);
      if (left <= 0) end('time');
    } else if (phase === 0) {
      const left = cfg.exploreMs - (performance.now() - phaseStart);
      banner.setTimer(left);
      if (left <= 0) nextPhase();
    } else {
      banner.setTimer(null);
    }
    if (cfg.debug) {
      hud.textContent =
        chanceText +
        `tick ${state.tick}  hash ${hashWorld(state)}  fps ${fps.toFixed(0)}\n` +
        `hier=${cfg.hier ? 1 : 0} composition=${cfg.composition ? 'yes' : 'no'} movement=${cfg.movement} chance=${cfg.chance} cross=${cfg.cross.toFixed(2)} skin=${cfg.skin} seed=${cfg.seed} eps=${cfg.eps}\n` +
        `alive: ${[0, 1, 2].map((t) => state.entities.filter((e) => e.alive && e.tier === t).length).join('/')} (cells/organisms/herds)` +
        `  events=${session.logger.events.length}\n` +
        `keys: Esc clear · S swap realisation (debug)`;
    }
  };

  // debug: the size-pair chance per encounter (chanceOf) for this world's config, fixed for the session
  const SIZES = ['cell', 'org', 'herd'];
  const matrix = (rule: 'lock' | 'catalysis') => [0, 1, 2].map((a) => [0, 1, 2].map((b) => chanceOf(state.config, rule, a, b)));
  const chanceText = (() => {
    const on = { lock: state.config.dyn?.lock === true, catalysis: state.config.dyn?.catalysis === true };
    const head = (rule: 'lock' | 'catalysis') => `${(rule === 'lock' ? 'lock & key' : 'catalysis') + (on[rule] ? '' : ' (off)')}`.padEnd(18) + SIZES.map((x) => x.padStart(6)).join('');
    const row = (rule: 'lock' | 'catalysis', a: number) => SIZES[a].padEnd(18) + matrix(rule)[a].map((p) => p.toFixed(2).padStart(6)).join('');
    const lines = [`${head('lock')}    ${head('catalysis')}`];
    for (const a of [0, 1, 2]) lines.push(`${row('lock', a)}    ${row('catalysis', a)}`);
    const how = cfg.pairChance ? `pairs=draw total=${cfg.total} cap=${cfg.cap}` : `chance=${cfg.chance}, cross w=${cfg.cross.toFixed(3)}`;
    return `chance per encounter (${how})\n${lines.join('\n')}\n`;
  })();
  if (cfg.debug) {
    console.log(chanceText);
    console.table(Object.fromEntries(['lock', 'catalysis'].flatMap((rule) => [0, 1, 2].map((a) => [`${rule} ${SIZES[a]}`, Object.fromEntries(SIZES.map((x, b) => [x, +matrix(rule as 'lock' | 'catalysis')[a][b].toFixed(3)]))]))));
  }

  const inspectInfo = (): InspectInfo | null => {
    if (selected < 0) return null;
    const e = state.entities[selected];
    const n = layout[selected];
    const c = colourOf(selected);
    if (!e || !n || !c) return null;
    return {
      colour: c.css,
      colourName: c.name,
      size: n.r,
      speed: Math.round(Math.hypot(e.vx, e.vy)),
      parts: cfg.composition ? e.children.length : 0, // composition=no: parts are never visible
      debug: cfg.debug ? `id ${e.id} · tier ${e.tier} · type ${e.type} · r${e.realisation} · health ${e.health.toFixed(2)}` : undefined,
    };
  };

  const camTimer = window.setInterval(() => session.log('camera', renderer.camera.state()), CAMERA_SAMPLE_MS);
  const backupTimer = window.setInterval(() => saveBackup(session), BACKUP_MS);
  renderer.app.ticker.add(frame);

  let ended = false;
  function end(reason: 'continue' | 'time' = 'continue'): void {
    if (ended) return;
    ended = true;
    renderer.app.ticker.remove(frame);
    window.clearInterval(camTimer);
    window.clearInterval(backupTimer);
    notepad.dispose();
    if (task) {
      session.log('task_end', { task, success: success !== null, success_tick: success?.tick ?? null, tiers: success?.tiers ?? null, reason, spawns });
      session.log('phase', { from: `task_${task}`, to: 'end', index: 1 });
      session.log('final_state', { task, success: success !== null, spawns });
    } else {
      notepad.flush('end');
      session.log('phase', { from: PHASES[phase].key, to: 'end', index: PHASES.length });
      session.log('final_state', { report: report.answers(), notes: notepad.text });
    }
    const hash = session.end();
    const saved = saveBackup(session);
    input.dispose();
    renderer.destroy();
    shell.remove();
    finish({ final_hash: hash, final_tick: state.tick, n_events: session.logger.events.length, backup_saved: saved });
  }

  if (cfg.debug) {
    // test hook (debug only): lets automated run-throughs find entities on screen
    (window as unknown as Record<string, unknown>).__sandbox = {
      state,
      layout: () => layout,
      camera: renderer.camera,
      worldToScreen: (x: number, y: number) => {
        const c = renderer.camera;
        const r = renderer.canvas.getBoundingClientRect();
        return [r.left + (x - c.x) * c.zoom + c.viewW / 2, r.top + (y - c.y) * c.zoom + c.viewH / 2];
      },
    };
  }

  session.log('camera', renderer.camera.state());
  if (task) startTask();
  else enterPhase(0);
  return done;
}
