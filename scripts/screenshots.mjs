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

// same-level dynamics on at every level, contents always shown so bonds and spinning cells are visible
{
  const page = await openSandbox('?seed=42&debug=1&short=1&reveal=0&lock=all&catalysis=all&similar=all');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/hier1_dynamics.png` });
  // drop a loose mint cell onto the nearest loose violet one: they should bind (lock & key)
  await page.locator('[data-speed="0"]').click();
  const pair = await page.evaluate(() => {
    const sb = window.__sandbox;
    const free = sb.state.entities.filter((e) => e.alive && e.tier === 0 && e.parent < 0 && e.bond < 0);
    let best = null;
    for (const a of free.filter((e) => e.type === 0)) {
      for (const b of free.filter((e) => e.type === 1)) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || d < best.d) best = { a: a.id, b: b.id, d };
      }
    }
    const a = sb.state.entities[best.a];
    const b = sb.state.entities[best.b];
    sb.camera.x = (a.x + b.x) / 2;
    sb.camera.y = (a.y + b.y) / 2;
    sb.camera.zoom = Math.min(5, 500 / Math.max(best.d, 50));
    return best;
  });
  await page.waitForTimeout(200);
  let [x, y] = await screenPos(page, pair.a);
  await page.mouse.click(x, y);
  const [bx, by] = await screenPos(page, pair.b);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((bx - x) * i) / 10, y + ((by - y) * i) / 10);
  await page.mouse.up();
  await page.locator('[data-speed="1"]').click();
  await page.waitForTimeout(1500);
  const bond = await page.evaluate((id) => window.__sandbox.state.entities[id].bond, pair.a);
  console.log(`${OUT}/hier1_dynamics_zoom.png: dropped mint #${pair.a} on violet #${pair.b} -> bond ${bond}`);
  await page.evaluate((id) => {
    const sb = window.__sandbox;
    const e = sb.state.entities[id];
    sb.camera.x = e.x;
    sb.camera.y = e.y;
    sb.camera.zoom = 5;
  }, pair.a);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/hier1_dynamics_zoom.png` });
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
    sb.camera.x = herd.x;
    sb.camera.y = herd.y;
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

  // drag it back onto its old organism to re-join
  [x, y] = await screenPos(page, ids.cell2);
  const [ox, oy] = await screenPos(page, ids.org);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((ox - x) * i) / 10, y + ((oy - y) * i) / 10);
  await page.mouse.up();
  const rejoined = await page.evaluate((id) => window.__sandbox.state.entities[id].parent, ids.cell2);
  console.log('drop re-joined cell parent =', rejoined, '(organism', ids.org + ')');

  // drop one loose cell onto another: they combine into a new organism
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
  const [bx, by] = await screenPos(page, pair.a);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + ((bx - x) * i) / 10, y + ((by - y) * i) / 10);
  await page.mouse.up();
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
