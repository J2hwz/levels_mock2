// Playwright: screenshots of the conditions (composition yes / no, flat; debug=1), plus a full
// scripted run-through whose downloaded log is saved as a replay fixture.
// Usage: npm run screenshots

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });
mkdirSync('tests/fixtures', { recursive: true });

const server = await createServer({ server: { port: 5179, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch();
const errors = [];

async function openSandbox(query) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${query}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  await page.goto(`${base}/${query}`);
  await page.getByRole('button', { name: 'Begin' }).click();
  for (let i = 0; i < 4; i++) await page.locator('#jspsych-instructions-next').click();
  await page.waitForSelector('canvas.world-canvas');
  return page;
}

/** screen position of an entity's display centre */
async function screenPos(page, id) {
  return page.evaluate((id) => {
    const sb = window.__sandbox;
    const n = sb.layout()[id];
    return sb.worldToScreen(n.x, n.y);
  }, id);
}

async function stats(page) {
  return page.evaluate(() => {
    const s = window.__sandbox.state;
    const alive = s.entities.filter((e) => e.alive);
    return [0, 1, 2].map((t) => alive.filter((e) => e.tier === t).length);
  });
}

// ---- 1. conditions: composition yes / no (hierarchy), plus the flat world
for (const [name, q0] of [['hier1_composition_yes', 'hier=1&composition=yes'], ['hier1_composition_no', 'hier=1&composition=no'], ['hier0', 'hier=0']]) {
  const page = await openSandbox(`?${q0}&seed=42&debug=1&short=1`);
  await page.waitForTimeout(3000);
  const [c, o, h] = await stats(page);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  console.log(`${file}: cells=${c} organisms=${o} herds=${h}`);
  // zoomed view on the first herd (or the centre in flat), with the pointer hovering it: composition=no shows nothing inside
  const centre = await page.evaluate(() => {
    const sb = window.__sandbox;
    const herd = sb.state.entities.find((e) => e.alive && e.tier === 2);
    const n = herd ? sb.layout()[herd.id] : { x: 1200, y: 800 };
    sb.camera.x = n.x;
    sb.camera.y = n.y;
    sb.camera.zoom = herd ? Math.min(6, 300 / Math.max(n.r, 20)) : 1.6;
    return herd ? herd.id : -1;
  });
  await page.waitForTimeout(300);
  if (centre >= 0) {
    const [x, y] = await screenPos(page, centre);
    await page.mouse.move(x, y);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}_zoom_hover.png` });
  await page.close();
}

// abstract skin, one shot per hierarchy condition
for (const hier of [1, 0]) {
  const page = await openSandbox(`?hier=${hier}&skin=abstract&seed=42&debug=1&short=1`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/hier${hier}_abstract.png` });
  await page.close();
}

// across sizes (cross=1: only different-size pairs interact): a purple cell dragged onto a green organism binds,
// then lets go after DYNAMICS.bondTicks (12 s)
{
  const page = await openSandbox('?seed=42&debug=1&short=1&reveal=0&cross=1&move=0');
  await page.waitForTimeout(500);
  // a free green organism and the free purple cell nearest to it, both in view
  const ids = await page.evaluate(() => {
    const s = window.__sandbox.state;
    const org = s.entities.find((e) => e.alive && e.tier === 1 && e.parent < 0 && e.type === 3);
    const cells = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.type === 1);
    const cell = cells.reduce((best, c) => (Math.hypot(c.x - org.x, c.y - org.y) < Math.hypot(best.x - org.x, best.y - org.y) ? c : best));
    const d = Math.hypot(cell.x - org.x, cell.y - org.y);
    Object.assign(window.__sandbox.camera, { x: (org.x + cell.x) / 2, y: (org.y + cell.y) / 2, zoom: Math.min(3, 500 / Math.max(d, 1)) });
    return { org: org.id, cell: cell.id };
  });
  await page.waitForTimeout(200);
  // drop point: just off the organism's edge, on the cell's side (target[0..1]); pulled-away point (target[2..3])
  const target = await page.evaluate(({ org, cell }) => {
    const s = window.__sandbox.state;
    const o = s.entities[org];
    const c = s.entities[cell];
    const r = window.__sandbox.layout()[org].r;
    const d = Math.hypot(c.x - o.x, c.y - o.y) || 1;
    const k = r + 6 + 4;
    return [o.x + ((c.x - o.x) / d) * k, o.y + ((c.y - o.y) / d) * k, o.x + ((c.x - o.x) / d) * (k + 100), o.y + ((c.y - o.y) / d) * (k + 100)];
  }, ids);
  const [x, y] = await screenPos(page, ids.cell);
  await page.mouse.click(x, y);
  await page.waitForTimeout(200);
  /** drag the (selected) cell to world point (wx, wy) */
  const dragCell = async (wx, wy) => {
    const [x, y] = await screenPos(page, ids.cell);
    const [tx, ty] = await page.evaluate(([wx, wy]) => window.__sandbox.worldToScreen(wx, wy), [wx, wy]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(x + ((tx - x) * i) / 12, y + ((ty - y) * i) / 12);
    await page.mouse.up();
  };
  // the cell-organism chance is below 1: on a failed roll, pull it away and try again (up to 5 times)
  for (let attempt = 0; attempt < 5; attempt++) {
    await dragCell(target[0], target[1]);
    await page.waitForTimeout(700);
    if ((await page.evaluate(({ cell }) => window.__sandbox.state.entities[cell].bond, ids)) >= 0) break;
    await dragCell(target[2], target[3]);
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `${OUT}/cross_size_bond.png` });
  const bond = await page.evaluate(({ cell }) => window.__sandbox.state.entities[cell].bond, ids);
  await page.waitForTimeout(12500);
  const later = await page.evaluate(({ cell }) => window.__sandbox.state.entities[cell].bond, ids);
  console.log(`cross=1: purple cell #${ids.cell} next to green organism #${ids.org}: bond ${bond} (organism ${ids.org}); 12.5 s later: bond ${later}`);
  await page.close();
}

// mechanisms (lock & key: purple + green; catalysis: light blue makes red spin; every level, by chance), contents always shown
{
  const page = await openSandbox('?seed=42&debug=1&short=1&reveal=0&cross=0&move=0');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/hier1_dynamics.png` });

  /** centre the camera on a world point */
  const look = (x, y, zoom) => page.evaluate(([x, y, zoom]) => Object.assign(window.__sandbox.camera, { x, y, zoom }), [x, y, zoom]);
  /** drag entity `id` (already selected) so its centre lands on world point (wx, wy); press C before letting go if asked */
  const dragTo = async (id, wx, wy, pressC = false) => {
    const [x, y] = await screenPos(page, id);
    const [tx, ty] = await page.evaluate(([wx, wy]) => window.__sandbox.worldToScreen(wx, wy), [wx, wy]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((tx - x) * i) / 10, y + ((ty - y) * i) / 10);
    if (pressC) await page.keyboard.press('c');
    await page.mouse.up();
  };
  /** drag entity `id` (already selected) onto world point (wx, wy) and keep holding it; returns a release function */
  const dragHold = async (id, wx, wy) => {
    const [x, y] = await screenPos(page, id);
    const [tx, ty] = await page.evaluate(([wx, wy]) => window.__sandbox.worldToScreen(wx, wy), [wx, wy]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((tx - x) * i) / 10, y + ((ty - y) * i) / 10);
    return () => page.mouse.up();
  };
  const ent = (id) => page.evaluate((id) => {
    const e = window.__sandbox.state.entities[id];
    return { x: e.x, y: e.y, parent: e.parent, bond: e.bond, spin: e.spin, alive: e.alive };
  }, id);

  // an organism with a lock & key pair inside, and a herd with a catalyst + target pair (only with mixed recipes)
  const inside = await page.evaluate(() => {
    const s = window.__sandbox.state;
    const org = s.entities.find((e) => e.alive && e.tier === 1 && e.children.some((c) => s.entities[c].bond >= 0));
    const herd = s.entities.find((h) => h.alive && h.tier === 2 && h.children.some((c) => s.entities[c].spin > 0));
    return { org: org && { id: org.id, x: org.x, y: org.y }, herd: herd && { id: herd.id, x: herd.x, y: herd.y, spin: herd.children.map((c) => s.entities[c].spin.toFixed(2)) } };
  });
  if (inside.org) {
    await look(inside.org.x, inside.org.y, 7);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/mech_lock_inside_organism.png` });
  }
  if (inside.herd) {
    await look(inside.herd.x, inside.herd.y, 2.6);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/mech_catalysis_in_herd.png` });
  }
  console.log('organism with a lock pair inside:', inside.org?.id, '| herd with a spinning target, member spins:', inside.herd?.spin);

  // drag a loose purple cell into range of a loose green one (time running): a line links them while the roll is
  // revealed, then they snap together and the green follows the drag (90% of encounters at cell level)
  const pair = await page.evaluate(() => {
    const s = window.__sandbox.state;
    const free = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.bond < 0);
    let best = null;
    for (const a of free.filter((e) => e.type === 1))
      for (const b of free.filter((e) => e.type === 3)) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || d < best.d) best = { a: a.id, b: b.id, d };
      }
    return best;
  });
  let A = await ent(pair.a);
  let B = await ent(pair.b);
  await look((A.x + B.x) / 2, (A.y + B.y) / 2, Math.min(5, 500 / Math.max(pair.d, 50)));
  await page.waitForTimeout(200);
  const [ax, ay] = await screenPos(page, pair.a);
  await page.mouse.click(ax, ay);
  B = await ent(pair.b);
  let release = await dragHold(pair.a, B.x - 16, B.y);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/mech_lock_roll.png` });
  await page.waitForTimeout(700);
  A = await ent(pair.a);
  await page.screenshot({ path: `${OUT}/mech_lock_bound_pair.png` });
  console.log(`dragged purple #${pair.a} into range of green #${pair.b} (still held): bond ${A.bond}`);
  await release();

  // drag a lone light blue organism into range of a lone red one (time running): a line, then the red one spins (90%)
  const orgs = await page.evaluate(() => {
    const s = window.__sandbox.state;
    const lone = s.entities.filter((e) => e.alive && e.tier === 1 && e.parent < 0);
    // a catalyst with no loose cell over its centre, so one click there selects the organism itself
    const clear = (o) => !s.entities.some((c) => c.alive && c.tier === 0 && c.parent < 0 && Math.hypot(c.x - o.x, c.y - o.y) < 15);
    // the closest such pair, so both fit on screen
    let best = null;
    for (const cat of lone.filter((e) => e.type === 0 && clear(e)))
      for (const tgt of lone.filter((e) => e.type === 2)) {
        const d = Math.hypot(cat.x - tgt.x, cat.y - tgt.y);
        if (!best || d < best.d) best = { cat: cat.id, tgt: tgt.id, d };
      }
    return best;
  });
  if (orgs) {
    const T = await ent(orgs.tgt);
    const Cg = await ent(orgs.cat);
    // frame both organisms so the catalyst can be clicked
    // keep both well inside the canvas (clear of the banner and the controls legend)
    await look((T.x + Cg.x) / 2, (T.y + Cg.y) / 2, Math.min(2.5, 550 / Math.max(Math.hypot(T.x - Cg.x, T.y - Cg.y), 1)));
    await page.waitForTimeout(200);
    const [cx, cy] = await screenPos(page, orgs.cat);
    // select the catalyst organism: its centre has no cell on it, so one click selects the organism itself
    await page.mouse.click(cx, cy);
    const rT = await page.evaluate(({ c, t }) => {
      const s = window.__sandbox.state;
      const r = (e) => 6 + 2.4 * e.children.length + 9;
      return r(s.entities[c]) + r(s.entities[t]) + 4;
    }, { c: orgs.cat, t: orgs.tgt });
    const T2 = await ent(orgs.tgt);
    release = await dragHold(orgs.cat, T2.x - rT, T2.y);
    // the target keeps wandering while time runs: finish the drag where it is now
    const T3 = await ent(orgs.tgt);
    const [fx, fy] = await page.evaluate(([wx, wy]) => window.__sandbox.worldToScreen(wx, wy), [T3.x - rT, T3.y]);
    await page.mouse.move(fx, fy);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/mech_catalysis_roll.png` });
    await page.waitForTimeout(700);
    const during = (await ent(orgs.tgt)).spin;
    const dbg = await page.evaluate(({ c, t }) => {
      const s = window.__sandbox.state;
      const C = s.entities[c];
      const T = s.entities[t];
      return { sel: document.querySelector('.inspect')?.textContent?.slice(0, 40), cat: [C.x | 0, C.y | 0, C.parent], tgt: [T.x | 0, T.y | 0, T.parent], d: Math.hypot(C.x - T.x, C.y - T.y) | 0 };
    }, { c: orgs.cat, t: orgs.tgt });
    console.log('catalysis demo debug', JSON.stringify(dbg), 'aimed gap', rT);
    await page.screenshot({ path: `${OUT}/mech_catalysis_touch.png` });
    await release();
    console.log(`light blue #${orgs.cat} dragged into range of red #${orgs.tgt} (still held): red spin ${during.toFixed(2)} rad/s`);
  } else {
    console.log('no lone light blue + red organisms in this seed: catalysis touch demo skipped');
  }

  // drop a loose cell onto the middle of a herd: collision between levels pushes it back out
  const hc = await page.evaluate(() => {
    const s = window.__sandbox.state;
    const herd = s.entities.find((e) => e.alive && e.tier === 2);
    const cell = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.bond < 0)
      .sort((a, b) => Math.hypot(a.x - herd.x, a.y - herd.y) - Math.hypot(b.x - herd.x, b.y - herd.y))[0];
    return { herd: herd.id, cell: cell.id };
  });
  const H = await page.evaluate((id) => {
    const e = window.__sandbox.state.entities[id];
    return { x: e.x, y: e.y, r: window.__sandbox.layout()[id].r };
  }, hc.herd);
  const C0 = await ent(hc.cell);
  await look((H.x + C0.x) / 2, (H.y + C0.y) / 2, 1.5);
  await page.waitForTimeout(200);
  const [hx, hy] = await screenPos(page, hc.cell);
  await page.mouse.click(hx, hy);
  await dragTo(hc.cell, H.x + H.r * 0.5, H.y);
  await page.waitForTimeout(1500);
  const C1 = await ent(hc.cell);
  const Hn = await page.evaluate((id) => {
    const e = window.__sandbox.state.entities[id];
    return { x: e.x, y: e.y, r: window.__sandbox.layout()[id].r };
  }, hc.herd);
  console.log(`cell #${hc.cell} dropped inside herd #${hc.herd}: now ${(Math.hypot(C1.x - Hn.x, C1.y - Hn.y) - Hn.r).toFixed(1)} units outside its edge`);
  await look(C1.x, C1.y, 2.5);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/mech_collision_herd_edge.png` });
  await page.close();
}

// ---- 2. full run-through (hier=1, proxy) through every phase, then download the log
{
  const page = await openSandbox('?hier=1&seed=7&debug=1&short=1&cross=0&move=0');
  await page.waitForTimeout(1000);
  // zoom onto a herd
  const ids = await page.evaluate(() => {
    const sb = window.__sandbox;
    const s = sb.state;
    const herd = s.entities.find((e) => e.alive && e.tier === 2);
    const org = s.entities[herd.children[0]];
    // centre on the organism (not the herd), so the controls legend never covers it
    sb.camera.x = org.x;
    sb.camera.y = org.y;
    sb.camera.zoom = 2.2;
    return { herd: herd.id, org: org.id, cell: org.children[0], cell2: org.children[1] };
  });
  await page.waitForTimeout(200);
  await page.keyboard.press('Digit1'); // harmless key
  // pause so positions are stable for clicking
  await page.waitForTimeout(200);

  // the inspect panel redraws on the next frame: wait for it before reading
  const sel = async () => (await page.waitForTimeout(100), page.evaluate(() => document.querySelector('.inspect')?.textContent ?? ''));
  let [x, y] = await screenPos(page, ids.cell);
  await page.mouse.click(x, y);
  const s1 = await sel();
  await page.mouse.click(x, y); // climb to organism
  const s2 = await sel();
  await page.mouse.click(x, y); // climb to herd
  const s3 = await sel();
  console.log('click-climb inspect:', [s1, s2, s3].map((t) => t.replace(/\s+/g, ' ').slice(0, 60)));

  // select the organism again and drag it
  await page.keyboard.press('Escape');
  await page.mouse.click(x, y);
  await page.mouse.click(x, y);
  [x, y] = await screenPos(page, ids.org);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 8, y + i * 4);
  await page.mouse.up();
  await page.waitForTimeout(800);

  // shift-drag a cell out of its organism
  [x, y] = await screenPos(page, ids.cell2);
  await page.keyboard.press('Escape');
  await page.mouse.click(x, y);
  await page.keyboard.down('Shift');
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x - i * 12, y - i * 10);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const detached = await page.evaluate((id) => window.__sandbox.state.entities[id].parent, ids.cell2);
  console.log('shift-drag detached cell parent =', detached);

  // drag it back onto its old organism: dropping alone does not re-join; pressing C while dragging does
  const dragOnto = async (id, ontoId, pressC) => {
    const [fx, fy] = await screenPos(page, id);
    const [ox, oy] = await screenPos(page, ontoId);
    // land just off the target's centre (and never a zero-length drag)
    const [tx, ty] = [ox + 14, oy + 6];
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    // go out and come back in, so the drag always registers even if it starts at the target
    await page.mouse.move(fx + 60, fy - 40, { steps: 4 });
    await page.mouse.move(tx, ty, { steps: 8 });
    if (pressC) await page.keyboard.press('c');
    await page.mouse.up();
  };
  const parentOf = (id) => page.evaluate((id) => window.__sandbox.state.entities[id].parent, id);
  // centre on the organism so nothing (e.g. the controls legend) covers the drop point
  await page.evaluate((id) => { const sb = window.__sandbox; const n = sb.layout()[id]; sb.camera.x = n.x; sb.camera.y = n.y; }, ids.org);
  await page.waitForTimeout(150);
  await dragOnto(ids.cell2, ids.org, false);
  const droppedOnly = await parentOf(ids.cell2);
  await dragOnto(ids.cell2, ids.org, true);
  const rejoined = await parentOf(ids.cell2);
  console.log(`re-join: drop alone -> parent ${droppedOnly}; with C -> parent ${rejoined} (organism ${ids.org})`);

  // drop one loose cell onto another: nothing is built; then C while dragging combines them into a new organism
  const pair = await page.evaluate(() => {
    const sb = window.__sandbox;
    const s = sb.state;
    const fits = (a, b) => s.grammar.species.some((rs) => [a, b].every((t) => rs.some((rc) => rc.includes(t))));
    const free = s.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0);
    const others = s.entities.filter((e) => e.alive && e.tier > 0);
    let best = null;
    for (const a of free) {
      for (const b of free) {
        if (a.id >= b.id || !fits(a.type, b.type)) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        if (others.some((o) => Math.hypot(o.x - mx, o.y - my) < 250)) continue;
        if (!best || d < best.d) best = { a: a.id, b: b.id, d, mx, my };
      }
    }
    sb.camera.x = best.mx;
    sb.camera.y = best.my;
    sb.camera.zoom = Math.min(3, 600 / Math.max(best.d, 50));
    return best;
  });
  await page.waitForTimeout(200);
  [x, y] = await screenPos(page, pair.b);
  await page.mouse.click(x, y);
  await dragOnto(pair.b, pair.a, false);
  console.log('drop one loose cell onto another without C -> parents', await parentOf(pair.a), await parentOf(pair.b));
  await dragOnto(pair.b, pair.a, true);
  const founded = await page.evaluate(({ a, b }) => {
    const s = window.__sandbox.state;
    const p = s.entities[a].parent;
    return p >= 0 && s.entities[b].parent === p ? { id: p, tier: s.entities[p].tier, children: s.entities[p].children } : null;
  }, pair);
  console.log('drop combined two loose cells into', founded);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/runthrough_1b_combine.png` });

  // wheel zoom, pan; I does nothing any more (no isolation)
  const aliveBeforeI = await page.evaluate(() => window.__sandbox.state.entities.filter((e) => e.alive).length);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  console.log('time buttons present:', await page.locator('[data-speed]').count(), '| Controls rows mentioning freeze:', await page.locator('#controls-legend', { hasText: 'freeze' }).count());
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 300);
  await page.mouse.move(100, 120);
  await page.mouse.down();
  await page.mouse.move(160, 170, { steps: 5 });
  await page.mouse.up();
  await page.screenshot({ path: `${OUT}/runthrough_1_explore.png` });

  // notepad: open it, type (the letter c must not combine), pause so it is logged, hide it
  await page.locator('#notepad-open').click();
  await page.locator('#notepad-text').pressSequentially('pink blobs circle each other; cells inside a blob stick together');
  const aliveAfterTyping = await page.evaluate(() => window.__sandbox.state.entities.filter((e) => e.alive).length);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/runthrough_1c_notepad.png` });
  await page.locator('#notepad-hide').click();
  console.log('notepad typed; things alive before pressing I / after typing:', aliveBeforeI, aliveAfterTyping);

  // phase 2: report. The world is hidden and stopped; the notepad is shown open. Step 1: open description only
  await page.locator('#phase-skip').click();
  await page.waitForTimeout(400);
  const reportStart = await page.evaluate(() => ({
    tick: window.__sandbox.state.tick,
    canvasVisible: document.querySelector('canvas.world-canvas').offsetParent !== null,
    notepadOpen: document.querySelector('#notepad').classList.contains('open'),
  }));
  await page.locator('#report-describe').fill('There are coloured blobs made of little dots, and big hazes made of blobs. Purple and green stick together.');
  await page.locator('#report-describe').blur();
  await page.screenshot({ path: `${OUT}/runthrough_2_report_describe.png` });
  await page.locator('#phase-continue').click(); // Next

  // step 2: fill-in-the-blank rules, by dragging picture tokens (and one by click-to-place)
  const tok = (tier, type) => page.locator(`.palette .pick[data-token="${tier}:${type}"]`);
  await page.locator('#report-add-interaction').click();
  await tok(0, 1).dragTo(page.locator('[data-rule="q1"] [data-blank="a"]'));
  await tok(0, 3).dragTo(page.locator('[data-rule="q1"] [data-blank="b"]'));
  await page.locator('[data-rule="q1"] [data-field="outcome"]').fill('they stick together');
  await page.locator('[data-rule="q1"] [data-field="outcome"]').blur();
  await page.locator('#report-add-makeup').click();
  await page.locator('[data-rule="q2"] [data-field="n"]').fill('4');
  await page.locator('[data-rule="q2"] [data-field="n"]').blur();
  await tok(1, 0).click(); // click-to-place
  await page.locator('[data-rule="q2"] [data-blank="member"]').click();
  await tok(2, 0).dragTo(page.locator('[data-rule="q2"] [data-blank="whole"]'));
  await page.locator('#report-add-other').click();
  await page.locator('[data-rule="q3"] [data-field="text"]').fill('light blue things make red things spin');
  await page.locator('[data-rule="q3"] [data-field="text"]').blur();
  // the notes are already open in the world's place: add a line, then hide and reopen them
  await page.locator('#notepad-text').press('End');
  await page.locator('#notepad-text').pressSequentially('\nthe hazes drift in circles');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/runthrough_3_report_rules.png` });
  await page.locator('#notepad-hide').click();
  await page.locator('#notepad-open').click();
  await page.locator('#phase-continue').click(); // Next

  // step 3: open organisation question, then Finish
  await page.locator('#report-organise').fill('By size: dots, blobs and hazes; then by colour within each size.');
  await page.locator('#report-organise').blur();
  await page.screenshot({ path: `${OUT}/runthrough_4_report_organise.png` });
  const reportEndTick = await page.evaluate(() => window.__sandbox.state.tick);
  console.log('report: world canvas visible =', reportStart.canvasVisible, '| notepad open =', reportStart.notepadOpen, '| tick at start / before Finish =', reportStart.tick, reportEndTick);
  await page.locator('#phase-continue').click(); // Finish

  // generalisation: intro page, then two 1-minute tasks in an empty world. Drop the target pair from the palette
  // next to each other; a roll can fail (10%), so drop a fresh pair elsewhere and try again (up to 4 pairs).
  await page.getByRole('button', { name: 'Start' }).click();
  const canvas = page.locator('canvas.world-canvas');
  const doTask = async (name, a, b, gapPx, shot) => {
    await canvas.waitFor();
    await page.waitForTimeout(300);
    const box = await canvas.boundingBox();
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      // clear of the controls legend (top right) and the inspect panel (bottom left)
      const cx = 340 + i * 90;
      const cy = box.height * 0.55 - i * 40;
      await page.locator(`.palette .pick[data-token="${a}"]`).dragTo(canvas, { targetPosition: { x: cx, y: cy } });
      await page.locator(`.palette .pick[data-token="${b}"]`).dragTo(canvas, { targetPosition: { x: cx + gapPx, y: cy } });
      await page.waitForTimeout(1200);
      ok = (await page.locator('#task-status.done').count()) > 0;
    }
    await page.screenshot({ path: `${OUT}/${shot}` });
    console.log(`task ${name}: success shown = ${ok}`);
    if (ok) await page.locator('#phase-continue').click();
    else await page.locator('#phase-skip').click();
  };
  await doTask('lock', '0:1', '0:3', 22, 'runthrough_5_task_lock.png'); // purple + green cells (zoom 2: 11 world units apart)
  await doTask('catalysis', '1:0', '1:2', 124, 'runthrough_6_task_catalysis.png'); // light blue + red organisms

  // end screen: download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download-data').click()]);
  const path = 'tests/fixtures/browser-session.json';
  await dl.saveAs(path);
  console.log('downloaded', dl.suggestedFilename(), '->', path);
  {
    const { readFileSync } = await import('node:fs');
    const log = JSON.parse(readFileSync(path, 'utf8'));
    const notes = log.events.filter((e) => e.type === 'notepad' || e.type === 'notepad_toggle').map((e) => `${e.type}:${e.payload.reason ?? e.payload.open}`);
    const final = log.events.find((e) => e.type === 'final_state');
    console.log('notepad events:', notes.join(' '), '| final notes:', JSON.stringify(final.payload.notes));
    console.log('final report:', JSON.stringify(final.payload.report));
    const reportAt = log.events.findIndex((e) => e.type === 'phase' && e.payload.to === 'report');
    const worldAfter = log.events.slice(reportAt).filter((e) => ['camera', 'hash', 'hover'].includes(e.type)).length;
    console.log('camera/hash/hover events after the report started:', worldAfter);
    for (const g of log.generalisation ?? []) {
      const end = g.events.find((e) => e.type === 'task_end');
      console.log(`generalisation ${g.header.config.task}:`, JSON.stringify(end?.payload), 'spawns logged:', g.events.filter((e) => e.type === 'action' && e.payload.kind === 'spawn').length);
    }
  }
  const backup = await page.evaluate(() => {
    const k = localStorage.getItem('levels-sandbox-last');
    return k ? (localStorage.getItem(k)?.length ?? 0) : 0;
  });
  console.log('localStorage backup bytes:', backup);
  await page.screenshot({ path: `${OUT}/runthrough_7_end.png` });
  await page.close();
}

await browser.close();
await server.close();
if (errors.length) {
  console.error('BROWSER ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('ok');
