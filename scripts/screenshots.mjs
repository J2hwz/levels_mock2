// Playwright: screenshots of the four hier x size conditions (debug=1), plus a full
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
  for (let i = 0; i < 3; i++) await page.locator('#jspsych-instructions-next').click();
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

// ---- 1. four conditions
for (const hier of [1, 0]) {
  for (const size of ['proxy', 'irrelevant']) {
    const q = `?hier=${hier}&size=${size}&seed=42&debug=1&short=1`;
    const page = await openSandbox(q);
    await page.waitForTimeout(3000);
    const [c, o, h] = await stats(page);
    const file = `${OUT}/hier${hier}_${size}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}: cells=${c} organisms=${o} herds=${h}`);
    // zoomed view on the first herd (or the centre in flat)
    await page.evaluate(() => {
      const sb = window.__sandbox;
      const herd = sb.state.entities.find((e) => e.alive && e.tier === 2);
      const n = herd ? sb.layout()[herd.id] : { x: 1200, y: 800 };
      sb.camera.x = n.x;
      sb.camera.y = n.y;
      sb.camera.zoom = herd ? Math.min(6, 300 / Math.max(n.r, 20)) : 1.6;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/hier${hier}_${size}_zoom.png` });
    await page.close();
  }
}

// abstract skin, one shot per hierarchy condition
for (const hier of [1, 0]) {
  const page = await openSandbox(`?hier=${hier}&skin=abstract&seed=42&debug=1&short=1`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/hier${hier}_abstract.png` });
  await page.close();
}

// mechanisms (lock & key: purple + green; catalysis: light blue makes red spin; every level, by chance), contents always shown
{
  const page = await openSandbox('?seed=42&debug=1&short=1&reveal=0');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/hier1_dynamics.png` });
  await page.locator('[data-speed="0"]').click();

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
    await page.locator('[data-speed="1"]').click();
    await page.waitForTimeout(700);
    await page.locator('[data-speed="0"]').click();
    await page.screenshot({ path: `${OUT}/mech_catalysis_in_herd.png` });
  }
  console.log('organism with a lock pair inside:', inside.org?.id, '| herd with a spinning target, member spins:', inside.herd?.spin);

  // drop a loose purple cell next to a loose green one: they bind (90% of encounters at cell level)
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
  await dragTo(pair.a, B.x - 11, B.y);
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(800);
  await page.locator('[data-speed="0"]').click();
  A = await ent(pair.a);
  console.log(`dropped purple #${pair.a} beside green #${pair.b}: bond ${A.bond}, parent ${A.parent}`);
  await look(A.x, A.y, 6);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/mech_lock_bound_pair.png` });

  // drop a lone light blue organism against a lone red one: the red one spins (90% of encounters), and keeps spinning a while after
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
    await dragTo(orgs.cat, T.x - rT, T.y);
    await page.locator('[data-speed="1"]').click();
    await page.waitForTimeout(600);
    const during = (await ent(orgs.tgt)).spin;
    const dbg = await page.evaluate(({ c, t }) => {
      const s = window.__sandbox.state;
      const C = s.entities[c];
      const T = s.entities[t];
      return { sel: document.querySelector('.inspect')?.textContent?.slice(0, 40), cat: [C.x | 0, C.y | 0, C.parent], tgt: [T.x | 0, T.y | 0, T.parent], d: Math.hypot(C.x - T.x, C.y - T.y) | 0 };
    }, { c: orgs.cat, t: orgs.tgt });
    console.log('catalysis demo debug', JSON.stringify(dbg), 'aimed gap', rT);
    await page.screenshot({ path: `${OUT}/mech_catalysis_touch.png` });
    console.log(`light blue #${orgs.cat} dropped against red #${orgs.tgt}: red spin ${during.toFixed(2)} rad/s`);
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
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(1500);
  await page.locator('[data-speed="0"]').click();
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
  const page = await openSandbox('?hier=1&size=proxy&seed=7&debug=1&short=1');
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
  await page.locator('[data-speed="0"]').click();
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
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(800);
  await page.locator('[data-speed="0"]').click();

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
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/runthrough_1b_combine.png` });

  // isolate, wheel zoom, pan, speeds
  await page.keyboard.press('i');
  await page.locator('[data-speed="2"]').click();
  await page.waitForTimeout(800);
  await page.keyboard.press('i');
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 300);
  await page.mouse.move(100, 120);
  await page.mouse.down();
  await page.mouse.move(160, 170, { steps: 5 });
  await page.mouse.up();
  await page.locator('[data-speed="0.5"]').click();
  await page.screenshot({ path: `${OUT}/runthrough_1_explore.png` });

  // phase 2: organise
  await page.locator('#phase-skip').click();
  await page.locator('[data-speed="0"]').click();
  await page.evaluate((id) => {
    const sb = window.__sandbox;
    const n = sb.layout()[id];
    sb.camera.x = n.x;
    sb.camera.y = n.y;
    sb.camera.zoom = 2.2;
  }, ids.org);
  await page.waitForTimeout(200);
  [x, y] = await screenPos(page, ids.cell);
  await page.mouse.click(x, y);
  await page.locator('.notebook input[type=text]').first().fill('dots');
  await page.locator('#nb-create').click();
  await page.locator('[data-group="g1"] button', { hasText: '+ selected' }).click();
  await page.mouse.click(x, y); // organism
  await page.locator('.notebook input[type=text]').first().fill('blobs');
  await page.locator('#nb-create').click();
  await page.locator('[data-group="g2"] button', { hasText: '+ selected' }).click();
  await page.locator('[data-group="g1"] select').selectOption('g2');
  await page.locator('[data-group="g1"] input').fill('little dots');
  await page.locator('[data-group="g1"] input').press('Enter');
  await page.locator('.notebook input[type=text]').first().fill('temp');
  await page.locator('#nb-create').click();
  await page.locator('[data-group="g3"] button.danger').click();
  await page.screenshot({ path: `${OUT}/runthrough_2_organise.png` });

  // phase 3: theorise
  await page.locator('#phase-continue').click();
  await page.locator('#rules-add').click();
  await page.locator('[data-card="r1"] select').selectOption('g2');
  await page.locator('[data-card="r1"] textarea').nth(0).fill('two blobs get too close');
  await page.locator('[data-card="r1"] textarea').nth(1).fill('their dots turn red and shake');
  await page.locator('#rules-notes').fill('the hazes drift in circles');
  await page.locator('#rules-notes').blur();
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/runthrough_3_theorise.png` });
  await page.locator('#phase-continue').click();

  // end screen: download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download-data').click()]);
  const path = 'tests/fixtures/browser-session.json';
  await dl.saveAs(path);
  console.log('downloaded', dl.suggestedFilename(), '->', path);
  const backup = await page.evaluate(() => {
    const k = localStorage.getItem('levels-sandbox-last');
    return k ? (localStorage.getItem(k)?.length ?? 0) : 0;
  });
  console.log('localStorage backup bytes:', backup);
  await page.screenshot({ path: `${OUT}/runthrough_4_end.png` });
  await page.close();
}

await browser.close();
await server.close();
if (errors.length) {
  console.error('BROWSER ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('ok');
