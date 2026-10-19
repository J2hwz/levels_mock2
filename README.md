# Levels sandbox (mockup v0)

A runnable mockup of a browser experiment on **how people come to see levels of organisation**.
Participants explore a 2D sandbox of made-up alien life (cells → organisms → herds), then group
what they saw and write rules about it. This is a click-through test build, not a finished study.

Stack: Vite + TypeScript (strict) · PixiJS v8 · jsPsych v8 · Vitest · Playwright (screenshots only).

## Run it

```bash
npm install
npm run dev          # opens on http://localhost:5173
npm test             # vitest: determinism, replay, conditions, size dial, architecture
npm run build        # typecheck + production bundle in dist/

# optional
npx playwright install chromium   # once
npm run screenshots  # 4 conditions + abstract skin + full scripted run-through -> screenshots/
npm run replay -- path/to/levels-sandbox-42-....json   # verify a downloaded log
```

Quick test link: `http://localhost:5173/?seed=42&short=1&debug=1`

## URL parameters

| param   | values                    | default    | meaning |
|---------|---------------------------|------------|---------|
| `hier`  | `1` \| `0`                | `1`        | hierarchy condition (cells/organisms/herds) vs flat (cells only) |
| `size`  | `proxy` \| `irrelevant`   | `proxy`    | size grows with tier vs size drawn at random regardless of tier |
| `skin`  | `biology` \| `abstract`   | `biology`  | rendering only; the simulation is identical |
| `seed`  | integer                   | random     | world seed (the random default is logged in the header) |
| `eps`   | 0..1                      | `0.05`     | cross-unit leakage |
| `short` | `1`                       | off        | Explore phase lasts 60 s instead of 6 min |
| `debug` | `1`                       | off        | HUD (tick, hash, fps), entity labels, `S` = swap realisation, "skip ▸" phase button, `window.__sandbox` test hook |

All parsed in `src/config.ts` and echoed into the session header.

## Participant controls

| input | effect |
|---|---|
| hover | highlight the deepest thing under the cursor |
| click | select it; **click again on the same spot** → its parent (cell → organism → herd → back to cell) |
| Esc / click empty space | clear selection |
| drag the selected thing (or any part of it) | move it with all its parts |
| Shift + drag | detach the selected thing from its parent, then drag it |
| drop a free thing on/near a compatible parent | it joins (if the recipe allows) |
| I | isolate: freeze everything except the selection and its parts; I again releases |
| wheel / drag background | zoom / pan |
| ❚❚ 0.5× 1× 2× | time controls |
| S (debug only) | `swapRealisation` on the selection |

A **controls legend** (top right of the world) lists all of these throughout the sandbox, so participants
don't have to remember them. The `I` row highlights while isolation is on. It can be collapsed with "hide";
each toggle is logged as a `legend` event `{open}`.

The inspect panel (bottom left) shows only observable properties: colour, size, speed, number of visible parts.
Tier names appear only with `debug=1`.

## Phases (inside `SandboxPlugin`)

1. **Explore**: timed (6 min, or 60 s with `short=1`). The instructions never mention levels.
2. **Organise**: the notebook panel appears: create named groups, add the selected entity as an example, nest groups with the "part of" dropdown. Continue button.
3. **Theorise**: rule cards ("This rule is about [group]", "When…", "Then…") plus a free-text notes box. Not scored. Finish button.

The world keeps running in phases 2 and 3. jsPsych timeline: welcome → 3 instruction pages → sandbox → end screen with a download button.

## Architecture

```
src/
  config.ts        dials + URL parsing
  sim/             pure, deterministic; imports nothing outside sim/ (enforced by tests)
    rng.ts         mulberry32; the only randomness
    dmath.ts       cross-engine deterministic sin/cos/hypot (see "Determinism")
    world.ts       entity types, grammar + generation, applyAction, step
    hash.ts        64-bit FNV-style hash of the exact float64 state
  render/          Pixi renderer, camera, skins, pure layout/hit-testing, pointer→Action input
  log/             logger (event stream) + Session (world + log; used by the app and by tests)
  ui/              notebook, rule cards, inspect panel, time controls, phase banner
  experiment/      jsPsych timeline, SandboxPlugin, sandbox app loop, download/backup
  replay.ts        replay a log through sim/ and check every logged hash
scripts/           screenshots.mjs (Playwright), replay.mjs (CLI)
tests/             vitest; fixtures/browser-session.json is a real Chromium run-through log
```

The simulation runs at a fixed 30 ticks/s, decoupled from the frame rate (an accumulator scaled by the speed setting,
at most 8 ticks per frame). Every participant action is an `Action` applied at the current tick;
`step(state, actions)` applies them and advances one tick. All tiers update every tick.

### How each mechanic maps to a property of levels

| property | mechanic (hier=1) |
|---|---|
| composition / near-decomposability | members are held by springs to slots around their parent's centre; same-tier type matrices act at full strength between **siblings** and at `eps` between non-siblings; members push back on their parent at `eps` |
| level-specific laws | organism centres move by the organism matrix, herd centres by the herd matrix, plus a per-kind cruise and turn rate, so herd motion is predictable from herd-level laws alone |
| multiple realisation | each species and herd kind has 2 recipes from the grammar; `swap` rebuilds with the other recipe and the trajectory is unchanged (tested) |
| downward causation, organism → cell | hormone = smoothed mean stress of the organism's cells (stress = crowding by cells of *other* organisms). Each cell reads a **noisy** copy of its own organism's hormone; above threshold it jitters and repels neighbours, and its colour shifts toward red |
| downward causation, herd → organism | density = expected slot spacing / mean nearest-neighbour distance of its organisms. Each organism reads a noisy copy and drifts outward when density > 1, inward when < 1 |
| light goal | organism health falls while the hormone is above threshold and recovers otherwise; at 0 the organism falls apart into free cells (`organism_death` event) |

**Flat (hier=0):** the same cells (count and types) scattered at random, no parents or springs, one uniform matrix for
all cell pairs, no hormone or density. Health belongs to 6 fixed circular regions and falls when a region is overcrowded.

## Data format

Download: `levels-sandbox-<seed>-<ISO timestamp>.json`. A copy is kept in `localStorage` (key in
`levels-sandbox-last`), refreshed every 10 s, at each phase change and at the end.

```jsonc
{
  "header": {
    "app": "levels-sandbox", "version": "0.0.1", "git_hash": "7c6c013",
    "started_at": "2026-10-19T05:05:46.123Z", "seed": 42,
    "config": { "hier": true, "size": "proxy", "skin": "biology", "seed": 42, "eps": 0.05, "short": false, "debug": false, "exploreMs": 360000, "seedFromUrl": true },
    "user_agent": "...", "screen": { "width": 1920, "height": 1080, "dpr": 1, "viewport_w": 1400, "viewport_h": 900 }
  },
  "events": [ { "t_tick": 0, "t_ms": 0.1, "type": "session_start", "payload": { "hash": "..." } }, ... ]
}
```

`t_tick` = sim tick when logged; `t_ms` = ms since the session started (wall clock).

| type | payload |
|---|---|
| `session_start` | `{hash}` of the generated world |
| `action` | an `Action`: `select{id}`, `dragStart{id,x,y}`, `dragMove{id,x,y}`, `dragEnd{id}`, `detach{id}`, `join{id,parent}`, `isolate{id}`, `speed{speed}`, `swap{id}`. Coordinates are sim/world units |
| `hover` | `{id}` on every hover-target change (`null` = nothing) |
| `camera` | `{x, y, zoom}` every 250 ms |
| `hash` | `{hash}` every 30 ticks (1 s of sim time) |
| `snapshot` | full world (all live entities, every field) every 300 ticks (10 s of sim time), plus at start and end |
| `organism_death` | `{id, cause: "health"\|"empty", cells}` |
| `herd_dissolved`, `region_depleted`, `swapped` | sim events |
| `phase` | `{from, to, index}` |
| `notebook` | diff: `create`, `rename{from,to}`, `delete{reparented}`, `add_example{entity}`, `remove_example`, `set_parent{from,to}` |
| `rule` | diff: `create`, `delete{card}`, `set_about`, `set_when`, `set_then` (each `{from,to}`), `notes{from,to}` |
| `final_state` | `{notebook, rules, notes}` |
| `session_end` | `{tick, hash}`, the hash the replay must reproduce |
| `legend` | `{open}` when the controls legend is hidden/shown |
| `download` | `{file}` |

### Determinism and replay

`replay(log)` rebuilds the world from `header.config`, applies each logged action at its `t_tick` (actions logged at tick
*t* were applied before the step *t → t+1*), checks every `hash` event and the final hash. `npm run replay -- file.json`
does this from the command line.

Same-engine determinism was not enough: **Chromium 156 and Node 26 disagree in the last bit of `Math.sin`/`Math.cos`**,
so a browser log diverged in Node by tick 4. `sim/` therefore uses `sim/dmath.ts` (polynomial sin/cos and
`sqrt(x²+y²)`), built only from IEEE-754 correctly rounded operations. A test bans the other `Math.*` functions in `sim/`,
and `tests/fixtures/browser-session.json` (recorded by Playwright in Chromium) must replay exactly. **Any change to the sim
invalidates old logs:** re-run `npm run screenshots` to refresh the fixture.

## Defaults chosen

Where the brief left something open, I chose the following.

**World**
- World is 2400 × 1600 units with soft walls. The camera starts fitted to the whole world.
- Grammar: 3 cell types, 3 species, 2 herd kinds. Each species has 2 recipes (realisations): recipe 0 is ≥60 % its "own" cell type, recipe 1 is ≥60 % the next type, so swaps look different. The same holds for herd kinds over species. **Generation always uses recipe 0**, so a species looks consistent until someone swaps.
- 5 herds (kinds alternate, the 5th is random), 6 lone organisms, then free cells to reach ~175 cells (15–70 free). The generated herd recipe is capped at 5 organisms so the total stays ≤ 200; recipe 1 (6 organisms max) appears only via swap. Tests check 150–200 cells over 32 seeds.
- The laws (3×3 cell, 3×3 organism, 2×2 herd matrices, cruise speeds and turn rates) are drawn from the seed, so each seed is a different "physics".
- Interaction kernel is particle-life style: repulsive core below `rmin`, matrix-weighted triangular kernel up to `rmax`.
- **Free cells feel all cells at full strength.** They sit in no unit, so there is no boundary to leak across. This makes them drift into organisms and cause crowding. Without it nothing ever got stressed and the goal never came into play.
- Collision repulsion is always full strength (it is physical contact, not a "law").
- `eps` scales (a) the matrix between non-sibling same-tier entities and (b) the push-back of members on their parent. There is no direct cell ↔ organism-centre force.
- Only free (top-level) organisms and herds self-propel (cruise along their heading, which turns at a per-kind rate). Members are carried by springs.
- The hormone threshold is 0.25. Health decays at 0.15 × excess per s and recovers at 0.03 per s. In a 3-min probe (seed 42, no interaction) about 3 organisms died.
- A herd dissolves when it has no organisms left. An organism emptied by detaching dies with `cause: "empty"`.
- **Join rule:** a free entity can join a parent one tier up if the parent is below the maximum size (7 cells / 6 organisms) and the entity's type appears in *any* recipe of the parent's species/kind. It joins the nearest such parent within its radius + 25 units. The join is decided in the UI at drop time via the pure `findJoinTarget` and logged as an explicit `join` action.
- Isolate: only the isolated subtree is simulated, and it feels no forces from frozen entities. Springs to a frozen parent still act.
- Dragging translates the entity and its whole subtree to the pointer. The dragged entity is held still (velocity 0) while held. At most one `dragMove` is logged per frame.
- Time speed and selection are logged as actions but do not change the world. While paused, actions (e.g. drags) still apply immediately.
- **Flat condition:** cells are re-scattered at random (not at their hierarchical positions). The "single uniform matrix" is **all zeros**: a probe showed that any positive uniform attraction (even 0.02–0.05) makes clumps where 77–100 % of close pairs persist over 20 s, contradicting "groups never stabilise". At 0, pairings are transient (~40 %). Flat cells get more random motion (60 vs 30).
- Flat health regions: 6 circles (r = 230) on a 3 × 2 grid. Region stress is the smoothed cell count inside divided by the count expected under uniform spread. Health falls when that ratio exceeds 1.5.

**Display**
- `size=irrelevant`: each *free-standing* entity's radius is a hash of (seed, id) drawn uniformly from 6–56 world units, whatever its tier. Members are drawn as a scaled copy of the physical layout fitted inside the parent. Positions on screen equal sim positions for free-standing entities, but physics still uses physical sizes, so a tiny-looking herd still takes up its physical space in collisions.
- The radius–tier correlation test is computed over **free-standing entities**, pooled over 40 seeds (|r| < 0.1), and also over the per-entity draw for all entities. A nested member is necessarily smaller than its parent, so over all *drawn* nested entities radius cannot be fully tier-independent if members must fit inside parents. A proxy-mode control test asserts r > 0.7, so the test has teeth.
- Tier cues in `irrelevant`: cells solid, organisms a membrane, herds a dashed boundary. In `proxy`, herds have a faint solid boundary.
- Stress colour shift: the cell colour blends toward red by up to 65 % as the noisy hormone signal approaches 0.6.
- Health bar above each organism (green → red), and above each region in the flat condition.
- Biology skin: dark background, translucent cells with a type-specific nucleus (dot / triangle / hexagon), wobbly membranes. Abstract skin: light background, solid circle / triangle / hexagon glyphs, plain outlines.
- Membrane wobble is cosmetic and render-only (it does not touch the sim).

**Interaction and UI**
- Selection: the first click selects the deepest hit (lowest tier, nearest centre). Clicking the same spot again climbs to the parent; past the top it wraps back to the deepest. Clicking empty space clears the selection.
- A click becomes a drag after 4 px of movement. Dragging starts only if the pointer went down on the selection or one of its parts; otherwise the drag pans.
- Inspect panel "size" is the on-screen radius in world units; "speed" is world units per second.
- Notebook: free-text group names, examples shown as `#id` chips with a colour swatch (clicking one selects it and centres the camera). Deleting a group moves its children up to the deleted group's parent. The "part of" dropdown excludes the group itself and its descendants (no cycles).
- Text edits (group names, When/Then, notes) are logged on `change` (blur / Enter), not per keystroke.
- Organise and Theorise are untimed (Continue / Finish buttons). Explore uses wall-clock time and keeps counting while paused.
- Hash every 1 s and snapshots every 10 s are in **sim time** (ticks), so pausing does not create redundant snapshots.
- The session (world + log) is created when the instructions finish, so `t_ms = 0` is the start of the sandbox.
- The default seed is random (`Math.random` in `config.ts`, not in `sim/`) and is recorded in the header.

## Known limitations

- `localStorage` is ~5 MB; a long session with many snapshots may exceed it. The backup then fails silently (the download still works; the jsPsych trial records `backup_saved`).
- In `size=irrelevant`, what you see and what collides are not the same thing (see above).
- Join only re-attaches to an *existing* parent; free cells cannot found a new organism.
- Tested headless in Chromium only (Playwright). Not yet checked in Firefox/Safari, on touch devices or on small screens.
- Headless Chromium draws at ~30–50 fps with software rendering. A normal GPU browser should be at 60.

## Next steps

- Server/database for data upload; Prolific integration (PID, completion code, return URL).
- Scoring of rule cards (coding scheme, inter-rater tool, or automated matching to the generative laws).
- Prediction challenges (e.g. "where will this herd be in 5 s?") to measure level-specific understanding.
- Audio, gaze tracking (out of scope for v0).
- Art polish; accessibility (colour-blind-safe palettes, keyboard selection).
- Tune dynamics per seed (some seeds are calmer than others) and pick a fixed seed set for the study.
- Founding new organisms from free cells; richer join recipes.
- Compress logs (delta snapshots) to stay within storage limits for longer sessions.
