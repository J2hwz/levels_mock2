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
npm run replay -- path/to/levels-sandbox-42-....json   # verify a downloaded file (main session + each task)
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
| `move`  | `1` \| `0`                | `1`        | `1`: things drift (self-propulsion, laws, noise). `0`: still world, nothing moves unless dragged |
| `laws`  | `1` \| `0`                | `1`        | `0`: no laws. The interaction matrices, swimming and turning are zeroed. Every free-standing cell, organism and herd does a persistent random walk instead: it heads in a random direction that drifts (~3 s persistence) and bounces off walls, the same for every type. Contact, springs, downward causation and `lock`/`catalysis`/`similar` still apply. The starting world is identical to `laws=1` for the same seed |
| `wander`| 0..5                      | `1`        | `laws=0` only: strength of the random walk. `0` = jiggle on the spot. At `1`, organisms from different units meet ~13 times per 2 min (laws on: ~17) |
| `reveal`| `1` \| `0`                | `1`        | `1`: organisms and herds show only their colour until hovered. `0`: contents always visible |
| `lock`  | `1` \| `0`                | `1`        | lock & key at every level (purple + green bind; chance per encounter 90 % cells / 40 % organisms / 10 % herds) |
| `catalysis` | `1` \| `0`            | `1`        | catalysis at every level (light blue makes red spin; chance per encounter 40 % cells / 90 % organisms / 10 % herds) |
| `similar` | levels                  | none       | similarity ("birds of a feather") at these levels |
| `org`   | `min-unstable`            | `5-8`      | membrane size band: stable with 5–7 cells, drains below 5 or at 8+ |
| `herd`  | `min-unstable`            | `3-7`      | haze size band: stable with 3–6 membranes |
| `free`  | 0..600                    | `140`      | number of loose cells floating around at the start |
| `herds` | 0..12                     | `7`        | number of herds (hazes) at the start |
| `lone`  | 0..40                     | `18`       | number of lone organisms (membranes) at the start |
| `same`  | `0` \| `1`                | `0`        | `0`: same-colour cells never attract each other through the laws (same-colour repulsion and all other laws stay). `1`: the seed decides, as before |
| `chance` | `graded` \| `uniform` \| `none` | `graded` | how likely lock & key and catalysis are per encounter. `graded`: the per-level tables `DYNAMICS.lockChance` / `catChance` (lock 90 / 40 / 10 %, catalysis 40 / 90 / 10 % for cells / organisms / herds). `uniform`: the mean of each table at every level (both 46.7 %). `none`: 0 everywhere, no interactions at all, so composition is the only mechanism (also no pre-binding pull or bound-cell push). Laws and similarity are separate switches |
| `short` | `1`                       | off        | Explore phase lasts 60 s instead of 6 min |
| `debug` | `1`                       | off        | HUD (tick, hash, fps), entity labels, `S` = swap realisation, "skip ▸" phase button, `window.__sandbox` test hook |

All parsed in `src/config.ts` and echoed into the session header.

## Tuning the interactions

Every setting you can change is marked `TUNE:` in the code (search for `TUNE`). The URL only switches things on and off
for one run. To change a default, or to change *which* elements interact and *how strongly*, edit the code.

### Where things live

| what you want to change | where | notes |
|---|---|---|
| turn a mechanism on/off by default (`laws`, `same`, `lock`, `catalysis`) | `DEFAULTS` in `src/config.ts` | the URL overrides it per run |
| turn similarity on by default at some levels | `parseConfig` in `src/config.ts`: `similar: levels(q.get('similar') ?? '0')` | `'0'` cells, `'0,1'` cells + organisms, `'all'` |
| size bands, starting counts, movement | `DEFAULTS` in `src/config.ts` (`org`, `herd`, `free`, `herds`, `lone`, `move`, `wander`) | |
| **how cells make organisms and organisms make herds (composition)** | `COMPOSITION` in `src/sim/world.ts` | see "Composition" below |
| which types bind (lock & key) | `DYNAMICS.lockPairs` in `src/sim/world.ts` | |
| how likely lock & key is at each level | `DYNAMICS.lockChance` `[cells, organisms, herds]` | `0` switches that level off |
| which type makes which spin (catalysis) | `DYNAMICS.catalysis` | `[catalyst, target]` |
| how likely catalysis is at each level | `DYNAMICS.catChance` `[cells, organisms, herds]` | `0` switches that level off |
| how near is "near" (interaction range), how far is "apart", how long the roll is shown | `DYNAMICS.rangeMargin`, `DYNAMICS.apartMargin`, `DYNAMICS.revealTicks` | per level `[cells, organisms, herds]`; ticks are 1/30 s |
| strengths of lock & key, catalysis, similarity | `DYNAMICS` (`bondK`, `lockAttract`, `lockRepel`, `catSpin`, `catDecay`, `simGain`, ...) | per level `[cells, organisms, herds]`; each has a comment |
| **exactly which pairs attract or repel (the laws)** | `PAIR_RULES.laws` in `src/sim/world.ts` | `null` = left to the seed |
| **exactly which types take part in similarity** | `PAIR_RULES.similarTypes`, `PAIR_RULES.similarRepel` | |
| ranges and overall strength of the laws, contact repulsion | `P.rmin`, `P.rmax`, `P.gain`, `P.repel` in `src/sim/world.ts` | per level `[cells, organisms, herds]` |

### Type numbers

There are four elements at every level, numbered the same way and grouped by colour. Both skins use these colours.
Only cells carry a shape; organisms and herds are just the colour.

| number | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| colour (every level) | light blue | purple | red | green |
| cell shape | circle | triangle | square | star |

### Composition

How cells make up organisms and organisms make up herds is set in **one place: `COMPOSITION` in `src/sim/world.ts`**
(marked `TUNE:`). Change `mode` to pick a rule:

| `mode` | rule | example |
|---|---|---|
| `'same'` (default) | a colour is made only of its own colour | a purple organism = 5 purple cells; a purple herd = 4 purple organisms |
| `'pairs'` | a colour is made of itself and its partner `pairs[colour]`, `pairShare` (60 %) own colour | `pairs: [3, 2, 1, 0]`: purple organism = 3 purple + 2 red cells |
| `'mostly'` | at least `mostlyShare` (60 %) own colour, the rest drawn at random by the seed | (the old rule) |
| `'custom'` | exactly the counts in `custom` | see below |

- **Sizes:** `sizes.organism = [5, 7]` and `sizes.herd = [4, 6]` are the members per recipe. Each colour has two recipes:
  recipe 0 is used to build the world, and recipe 1 only by the debug swap (`S`). Sizes are clamped into the size bands
  (`org`, `herd`).
- **Custom ratios:** `custom.organism[colour]` and `custom.herd[colour]` each list recipes as counts of
  `[light blue, purple, red, green]`. For example, purple organisms of 3 purple + 2 green cells (and a 7-cell second recipe):
  ```ts
  mode: 'custom',
  custom: {
    organism: [ [[5,0,0,0],[7,0,0,0]], [[0,3,0,2],[0,4,0,3]], [[0,0,5,0],[0,0,7,0]], [[0,0,0,5],[0,0,0,7]] ],
    herd:     [ [[4,0,0,0],[6,0,0,0]], [[0,4,0,0],[0,6,0,0]], [[0,0,4,0],[0,0,6,0]], [[0,0,0,4],[0,0,0,6]] ],
  },
  ```
- **What follows from the recipes:**
  - A thing can **join** a parent if its colour appears in a recipe of the parent's colour.
  - Loose things can **combine** if one colour's recipes accept all of them; the new parent takes that colour.
  - With `'same'`, only same-colour things join or combine, and a whole never contains two colours.
- **Starting world:** herds cycle through the four colours; lone organisms and loose cells get random colours.

### Specifying exactly who interacts with whom

- **Lock & key:** `DYNAMICS.lockPairs` lists the pairs that bind, e.g. `[[1, 3]]` = purple and green. Add pairs like
  `[[1, 3], [0, 2]]`. Each thing binds to at most one partner. `DYNAMICS.lockChance` sets how likely an encounter is to
  bind at each level.
- **Catalysis:** `DYNAMICS.catalysis` lists `[catalyst, target]`, e.g. `[[0, 2]]` = light blue makes red spin. Add more, e.g.
  `[[0, 2], [3, 1]]`. `DYNAMICS.catChance` sets how likely an encounter is to make the target spin at each level.
- **Laws (general attract/repel):** `PAIR_RULES.laws[level][i][j]` says how strongly type `i` is pulled toward type `j`.
  The row is the one that moves; the column is the one it reacts to. It is not symmetric, so set both `[i][j]` and `[j][i]`
  for a mutual effect.
  - `null` (default): drawn by the seed;
  - a number from `-1` to `1`: fixed for every seed (`+` attract, `-` repel, `0` no interaction);
  - the value is multiplied by `P.gain[level]` (150 / 60 / 70).
- **Similarity:** when `similar` is on at a level, `PAIR_RULES.similarTypes[level]` lists the types that take part.
  - Two listed types of the same kind attract.
  - Two different listed types repel, unless `PAIR_RULES.similarRepel[level]` is `false`.
  - Unlisted types ignore similarity entirely.
  - The default lists every type, so it acts on everyone.

Examples (edit `PAIR_RULES` in `src/sim/world.ts`):

```ts
// 1. at cell level, only purple and green attract each other; nothing else attracts or repels through the laws
laws: [
  [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0], [0, 1, 0, 0]],   // cells
  /* organisms, herds unchanged */ ...
],

// 2. red organisms flee light blue ones (the rest left to the seed)
laws[1] = [[null, null, null, null], [null, null, null, null], [-1, null, null, null], [null, null, null, null]]   // row red (2), column light blue (0)

// 3. similarity only among light blue and red cells, and without the push-apart (run with ?similar=0)
similarTypes: [[0, 2], [0, 1, 2, 3], [0, 1, 2, 3]],
similarRepel: [false, true, true],
```

### Order of precedence (laws)

1. The seed draws every law entry.
2. `same=0` (default) removes same-colour attraction between cells.
3. `PAIR_RULES.laws` overwrites the entries it names, so an explicit entry wins over `same=0`.

`laws=0` zeroes every entry and ignores `PAIR_RULES.laws`. The flat condition (`hier=0`) always keeps its all-zero laws.

### Good to know

- **Old logs stop replaying.** Any change to `DYNAMICS`, `COMPOSITION`, `PAIR_RULES`, `P` or a default that alters the simulation does this.
  After changing them, run `npm run screenshots` (it re-records `tests/fixtures/browser-session.json`), then `npm test`.
- **Tests don't follow your defaults.** They build their own worlds, so a changed default doesn't change what they check.
  They read `DYNAMICS` values rather than hard-coding them, but behaviour tests (e.g. "a bound pair stays touching", "similarity
  gathers like cells") can fail if you change a strength a lot. That tells you the behaviour itself changed.
- **The URL can't change pair tables.** It switches mechanisms on and off; the tables are edited in code. A changed table applies
  to every run, but it is not recorded in the log header, so note what you changed alongside the data.

## Participant controls

| input | effect |
|---|---|
| hover | highlight the deepest thing under the cursor; with `reveal=1` this also opens the thing it sits in to show everything inside |
| click | select it; **click again on the same spot** → its parent (cell → organism → herd → back to cell) |
| Esc / click empty space | clear selection |
| drag the selected thing (or any part of it) | move it with all its parts (and its lock & key partner) |
| Shift + drag | a member leaves its parent, taking its lock & key partner along (the pair stays attached); a free bound cell is pulled off its partner |
| drop things together | nothing is built: they just meet (so lock & key and catalysis can be seen) |
| C while dragging | join the compatible parent it touches, else combine it with every loose same-level thing touching it into a new parent one level up (2+ cells → organism, 2+ organisms → herd, if the grammar allows); the drag continues with the result |
| I | isolate: freeze everything except the selection and its parts; I again releases |
| wheel / drag background | zoom / pan |
| ❚❚ 0.5× 1× 2× | time controls |
| S (debug only) | `swapRealisation` on the selection |

A **controls legend** (top right of the world) lists all of these throughout the sandbox, so participants
don't have to remember them. The `I` row highlights while isolation is on. It can be collapsed with "hide";
each toggle is logged as a `legend` event `{open}`.

A **notepad** (bottom right of the world) lets participants write notes at any time, in every phase; the same text
carries through Explore and Report. It starts closed as a small "✎ notepad" button and is hidden again with
"hide". Typing in it never triggers sandbox keys (I, C, S, Esc). The text is logged as a `notepad` event when typing
pauses for 2 s, when it is hidden, and at the end (only if it changed); each show/hide is a `notepad_toggle` event. The
instruction page mentions it. Code: `src/ui/notepad.ts`.

The inspect panel (bottom left) shows only observable properties: colour, size, speed, number of visible parts.
Tier names appear only with `debug=1`.

## Phases (inside `SandboxPlugin`)

1. **Explore**: timed (6 min, or 60 s with `short=1`). The instructions never mention levels.
2. **Report**: untimed, in a side panel next to the live world (participants can still poke things to check, and the
   notepad stays available). Three steps in a fixed order; **Next** hides a step for good, so later steps can't
   change earlier answers (and the structured step can't prime the open ones):
   1. *Describe the world* (open): "Suppose you are describing this world to another player who has never seen it.
      What would you tell them?" Nothing else is shown yet.
   2. *Rules* (fill in the blanks): a palette of picture tokens of all 12 elements (4 colours × 3 sizes, drawn as in the
      world, grouped by size, no names; the only word used for levels is "scale"). Participants drag a token into a
      blank (or click a token, then a blank; click a filled blank to empty it) and add as many rules as they like:
      - "When [ ] is near [ ], ______" (outcome in free text, so nothing about binding or spinning is suggested);
      - "[n] × [ ] make up [ ]";
      - "Other rule" (free text).
      A greyed worked example comes first, built from the real recipe of the green organism (default:
      "5 × [small green] make up [medium green]"), so it is always true for the current `COMPOSITION`.
   3. *Organising the world* (open): "If you had to sort everything in this world into groups, how would you do it?
      Explain your groups." **Finish** ends the sandbox.

   All report text (titles, questions, sentence parts, palette header) is in `REPORT` in `src/ui/report.ts` (`TUNE:`).
   Not scored in this mockup.

3. **Generalisation**: after the Report (so its prompts can't prime the report), an intro page and two tasks of
   1 minute each. Each task is a **fresh, empty world** with the same seed, so it has the same laws and recipes as the
   exploration world, and participants drag elements into it from a palette of all 12 pictures (the report's pictures;
   only cells in the flat condition). A dropped larger thing arrives already made of its recipe-0 parts. The prompt
   describes only the effect:
   - **Task 1:** "Make two things stick together." Success = two **cells** bind by lock & key (the 90 % graded case).
   - **Task 2:** "Make something start spinning." Success = an **organism** is made to spin by catalysis (the 90 % case).

   Other outcomes (binding or spinning at another scale, combining with C) are logged but don't count. On success a
   "Done!" message appears and **Continue** is enabled; otherwise the task ends when the minute is up. The chances are
   the participant's own `chance` condition (under `none` the tasks can't succeed). At most 30 drops per task; no notepad.
   Text, order, duration, drop limit and the target `{rule, tier}` of each task are in `GEN` in
   `src/experiment/generalisation.ts` (`TUNE:`).

jsPsych timeline: welcome → 3 instruction pages → sandbox (Explore + Report) → generalisation intro → task lock →
task catalysis → end screen with a download button.

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
  ui/              report (questions), picture tokens (tokens.ts), notepad, inspect panel, time controls, phase banner
  experiment/      jsPsych timeline, SandboxPlugin, sandbox app loop (main + task mode), generalisation.ts (GEN), download/backup
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
| downward causation, organism → cell | hormone = smoothed mean stress of the organism's cells (stress = crowding by cells of *other* organisms). Each cell reads a **noisy** copy of its own organism's hormone; above threshold it jitters and repels neighbours, and it darkens and flickers |
| downward causation, herd → organism | density = expected slot spacing / mean nearest-neighbour distance of its organisms. Each organism reads a noisy copy and drifts outward when density > 1, inward when < 1 |
| light goal | organism health falls while the hormone is above threshold and recovers otherwise; at 0 the organism falls apart into free cells (`organism_death` event) |

**Flat (hier=0):** the same cells (count and types) scattered at random, no parents or springs, one uniform matrix for
all cell pairs, no hormone or density. Health belongs to 6 fixed circular regions and falls when a region is overcrowded.

## Data format

Download: `levels-sandbox-<seed>-<ISO timestamp>.json`. A copy is kept in `localStorage` (key in
`levels-sandbox-last`), refreshed every 10 s, at each phase change, after each task and at the end.

The file is the main session's log (`header`, `events`) plus `generalisation`: one ordinary log per task, each with its own
`header` (its `config` adds `task` and `herds: 0, lone: 0, free: 0`) and `events`, so each task world replays on its own.
Task logs have the same event types, plus `task_success {task, tick}`, `task_end {task, success, success_tick, reason:
"continue"|"time", spawns}`, and `final_state {task, success, spawns}`.

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
| `action` | an `Action`: `select{id}`, `dragStart{id,x,y}`, `dragMove{id,x,y}`, `dragEnd{id}`, `detach{id}`, `join{id,parent}`, `combine{ids}` (2+, dragged first), `isolate{id}`, `speed{speed}`, `swap{id}`, `spawn{tier, type, x, y}` (generalisation tasks: a dropped element). Coordinates are sim/world units |
| `hover` | `{id}` on every hover-target change (`null` = nothing) |
| `camera` | `{x, y, zoom}` every 250 ms |
| `hash` | `{hash}` every 30 ticks (1 s of sim time) |
| `snapshot` | full world (all live entities, every field) every 300 ticks (10 s of sim time), plus at start and end |
| `organism_death` | `{id, cause: "health"\|"empty"\|"size", cells}` (`size`: it fell apart outside its size band) |
| `founded` | `{id, tier, type, realisation, members}` when a `combine` creates a new organism/herd |
| `herd_dissolved` | `{id}` when emptied; `{id, cause: "size", organisms}` when it fell apart outside its size band |
| `encounter` | `{rule: "lock"\|"catalysis", tier, a, b, ok}`: a roll took effect after its reveal; `ok` = they bound / the target started spinning (false if the roll failed or they left range in time) |
| `region_depleted`, `swapped` | sim events |
| `phase` | `{from, to, index}` |
| `report` | `step{step}` (0 describe, 1 rules, 2 organise); `answer{q: "describe"\|"organise", from, to}`; `rule_add{id, kind: "interaction"\|"makeup"\|"other"}`; `rule_set{id, field, from, to}`; `rule_delete{id, rule}`. Tokens are `{tier, type}` (level and colour) |
| `notepad` | `{text, reason: "pause"\|"hide"\|"end"}`: the full notepad text, when typing paused for 2 s, when it was hidden, or at the end (only if it changed since the last report) |
| `notepad_toggle` | `{open}` when the notepad is shown/hidden |
| `final_state` | `{report: {describe, rules, organise}, notes}` (`notes` = the notepad text). Rules: `{kind: "interaction", a, b, outcome}`, `{kind: "makeup", n, member, whole}`, `{kind: "other", text}` |
| `session_end` | `{tick, hash}`, the hash the replay must reproduce |
| `legend` | `{open}` when the controls legend is hidden/shown |
| `download` | `{file}` |

### Determinism and replay

`replay(log)` rebuilds the world from `header.config`, applies each logged action at its `t_tick` (actions logged at tick
*t* were applied before the step *t → t+1*), checks every `hash` event and the final hash. `npm run replay -- file.json`
does this from the command line, for the main session and every `generalisation` task log.

Same-engine determinism was not enough: **Chromium 156 and Node 26 disagree in the last bit of `Math.sin`/`Math.cos`**,
so a browser log diverged in Node by tick 4. `sim/` therefore uses `sim/dmath.ts` (polynomial sin/cos and
`sqrt(x²+y²)`), built only from IEEE-754 correctly rounded operations. A test bans the other `Math.*` functions in `sim/`,
and `tests/fixtures/browser-session.json` (recorded by Playwright in Chromium) must replay exactly. **Any change to the sim
invalidates old logs:** re-run `npm run screenshots` to refresh the fixture.

## Defaults chosen

Where the brief left something open, I chose the following.

**World**
- World is 2400 × 1600 units with soft walls. The camera starts fitted to the whole world.
- Grammar: 4 colours at every level (light blue, purple, red, green). Each colour of organism and herd has 2 recipes (realisations), built from `COMPOSITION` (default `'same'`: own colour only, 5 / 7 cells and 4 / 6 organisms). **Generation always uses recipe 0**; recipe 1 appears only via the debug swap.
- `herds` herds (default 7; they cycle through the four colours), `lone` lone organisms (default 18; skipped if cells inside organisms would exceed 380), then `free` loose cells (default 140). Defaults live in `DEFAULTS` in `src/config.ts`. Each starting herd has 4 organisms of 5 cells (recipe 0 of `COMPOSITION`). With 7 herds that gives 46 organisms and ~370 cells at the start (seed 42: 370 cells, 46 organisms). Tests check the loose-cell count and the cap over 32 seeds. More loose cells means more crowding: at seed 42 about 5 organisms die in 3 min with 120 loose cells (2 with 50, 9 with 200).
- The laws (3×3 cell, 3×3 organism, 2×2 herd matrices, cruise speeds and turn rates) are drawn from the seed, so each seed is a different "physics".
- **Same-colour attraction (`same`):** the cell law matrix is drawn per seed, so for roughly half the seeds' cell types same-colour cells attract (the values depend on the seed). With `same=0` (default) any positive same-colour entry is set to 0. Similarity (`similar`) is a separate, opt-in attraction and is not affected.
- Interaction kernel is particle-life style: repulsive core below `rmin`, matrix-weighted triangular kernel up to `rmax`.
- **Free cells feel all cells at full strength.** They sit in no unit, so there is no boundary to leak across. This makes them drift into organisms and cause crowding. Without it nothing ever got stressed and the goal never came into play.
- Collision repulsion is always full strength (it is physical contact, not a "law"). It also acts **between levels** (see Mechanisms).
- `eps` scales (a) the matrix between non-sibling same-tier entities and (b) the push-back of members on their parent. There is no direct cell ↔ organism-centre force.
- Only free (top-level) organisms and herds self-propel (cruise along their heading, which turns at a per-kind rate). Members are carried by springs.
- The hormone threshold is 0.25. Health decays at 0.15 × excess per s and recovers at 0.03 per s. In a 3-min probe (seed 42, no interaction) about 3 organisms died.
- A herd dissolves when it has no organisms left. An organism emptied by detaching dies with `cause: "empty"`.
- **Size bands** (`org`, `herd`): a membrane is stable with `[min, unstable)` cells (default 5–7), a haze with `[min, unstable)`
  membranes (default 3–6). Outside its band a composite loses 0.05 health/s (~20 s to fall apart), on top of the hormone decay;
  it recovers only inside its band. At 0 it falls apart into free parts (`cause: "size"`). Herds now carry health too; their bar
  shows only when below full. Generated recipes use only stable sizes (organisms `[min, unstable-1]`, herds `[min, unstable-2]`
  for recipe 0 to stay within the cell budget).
- **Join rule:** a free entity can join a parent one tier up if the parent is below its unstable size (8 cells / 7 organisms by default, so a participant can over-fill it by one and make it drain) and the entity's type appears in *any* recipe of the parent's species/kind. A bound pair joins together, so there must be room and a fitting type for both. It joins the nearest such parent within the two radii + 25 units. The join happens only when C is pressed while dragging (via the pure `findJoinTarget`) and is logged as an explicit `join` action.
- **Combine rule:** on C, if no parent takes the dragged entity, it and the loose same-tier things touching it (`findCombineGroup`, logged as `combine`) found a new parent one tier up, at their
  centroid. A bound member's partner must be in the group (pairs are never split). Its species/herd kind must accept every type (each type appears in some recipe, as for join); among those, the
  recipe covering most of the founders' types wins, with ties going to the lowest kind and then the lowest recipe. A founded composite usually starts below the size band, so it drains unless it is grown to the minimum by ordinary joins. Combining is off in the flat condition and while isolation is on, because the new
  parent would sit outside the isolated set.
- Isolate: only the isolated subtree is simulated, and it feels no forces from frozen entities. Springs to a frozen parent still act.
- Dragging translates the entity and its whole subtree to the pointer. The dragged entity is held still (velocity 0) while held. At most one `dragMove` is logged per frame.
- Time speed and selection are logged as actions but do not change the world. While paused, actions (e.g. drags) still apply immediately.
- **Flat condition:** cells are re-scattered at random (not at their hierarchical positions). The "single uniform matrix" is **all zeros**: a probe showed that any positive uniform attraction (even 0.02–0.05) makes clumps where 77–100 % of close pairs persist over 20 s, contradicting "groups never stabilise". At 0, pairings are transient (~40 %). Flat cells get more random motion (60 vs 30).
- Flat health regions: 6 circles (r = 230) on a 3 × 2 grid. Region stress is the smoothed cell count inside divided by the count expected under uniform spread. Health falls when that ratio exceeds 1.5.

**Mechanisms** (`lock` and `catalysis` on by default; `similar` off by default)

The rules are kept in `DYNAMICS` in `src/sim/world.ts`. Lock & key and catalysis act at **every level**, but only ever
between two things of the **same** level (a cell never binds to or spins an organism). How likely they are is graded by level.

**Chance per encounter.** Two eligible things of the same level are **near** when the gap between their edges is below
`rangeMargin` (10 / 20 / 60 units for cells / organisms / herds). The moment they come near, also while one of them is
being dragged, the dice are rolled **once** for each rule that applies. They then have to **move apart** (gap above
`apartMargin`: 20 / 40 / 120) and come near again before they can roll again; wiggling in between never re-rolls. Members of
the same whole get one roll when they first become siblings. Rolls use the seeded random generator in a fixed order, so runs
replay exactly. The chances depend on the `chance` condition (`graded` tables, `uniform` means, or `none`); a chance of `0`
switches the rule off at that level.

**What participants see.** As soon as the dice are rolled, a **line links the two** (white for lock & key, the catalyst's
colour for catalysis). It grows out from the middle and pulses for `revealTicks` (0.4 s), then the result takes effect:
- lock & key: they **snap together** and the line tightens into the bond. If one of them is being dragged, the other comes
  along with the drag;
- catalysis: the line fades and the target **starts spinning**, for as long as the two stay near;
- failure, or the pair left range before the reveal ended: the line **breaks**. The two halves pull back and fade.

Each result is logged as an `encounter` event.

| mechanism | rule | chance per encounter (cells / organisms / herds) | other settings |
|---|---|---|---|
| lock & key | A purple and a green thing **bind** when two free, unbound ones of the same level come near and the roll succeeds. Before that, two free, unbound ones **pull gently together** (within 40 / 90 / 260 units; strength 50 / 20 / 8 at contact; needs `move=1`). The pull stops once their encounter has been rolled. A spring holds a bound pair touching, and it is dragged as one. Only Shift-drag separates them. Inside a whole (possible only with mixed recipes), unbound purple and green members pair up. A pair stays attached when it joins or combines, and sits together on its parent's ring. A bound cell **mildly pushes away other cells** within 30 units, so pairs don't clump | **90 % / 40 % / 10 %** | bond spring 60 / 30 / 8 |
| catalysis | A light blue thing near a red one of the same level makes the red one **spin**, if the roll succeeds, for as long as they stay near. After contact ends it keeps spinning, slowing by 4 % per tick, and stops ~2 s later. A spinning cell turns its shape; a spinning organism or herd turns its ring of members, with a rim dot showing its orientation. Inside a whole (mixed recipes only), a catalyst and its target sit together | **40 % / 90 % / 10 %** | spin 3 / 3 / 1 rad/s |
| similarity | like types attract, unlike types repel, with the same kernel as the laws. Purple–green pairs are exempt from the repulsion while lock is on | – (a force, always on where switched on) | gain 45 / 18 / 20 |

The encounters already rolled for are world state (`contacts`). Like `bond` and `spin`, they are hashed and in snapshots.
Bond and spin are entity state (`bond`, `spin`) and are hashed. Similarity needs `move=1` (it is a force); lock & key and
catalysis also work with `move=0`.

**Building only on C.** Dropping things together never builds anything. It just lets them meet, so a participant can see
whether two cells lock, or whether one organism sets another spinning. Pressing **C while dragging** builds:
1. if the dragged thing touches a compatible parent one level up (`findJoinTarget`, within the two radii + 25), it joins it;
2. otherwise it and every loose same-level thing touching it, and so on outward (`findCombineGroup`; gap < 8 for cells,
   < 20 for organisms), each with its bond partner, found a new parent one level up (`combine{ids}`);
3. otherwise nothing happens; the dragged thing flashes red and `combine_refused` is logged.
After a successful C the drag carries on with the whole it is now part of.

**Collision between levels.** Free-standing things of different levels can't overlap: a loose cell can't pass through an
organism or a herd, and a lone organism can't pass through a herd. The push (40 per unit of overlap) is shared by mass
(number of cells inside), so a cell bounces off a herd rather than shoving it. Members are protected by their
free-standing ancestor's outline. Same-level collision is unchanged.

**What this does to the rest of the world** (probe: 10 seeds × 2 min, default dials, laws on, before → after this change; measured with the earlier, smaller starting world of 6 lone organisms and 120 loose cells):
- loose cells can no longer get into organisms or herds, so crowding mostly stops. Organism deaths fell from 3.6 to 0.6 per
  seed and time above the hormone threshold from 7.9 % to 0.8 %, so the health goal is now mostly quiet;
- organisms from different units met 13.6 times per seed (was 18.6), as lone organisms now stop at herd edges
  (`laws=0`: 6.9, was 12.2);
- with lock on, the largest loose-cell clump averaged 3.3 cells, max 10 (was 6.4, max 32).

**Still world and reveal**
- `move=0` (optional; drifting is the default) turns off everything that makes things wander: self-propulsion and turning, the same-tier law matrices, free-cell
  noise, stress jitter and repulsion, and herd-density drift. Contact repulsion, springs, walls and damping stay, so joined or
  combined members still slide into their slots and things don't overlap. Stress, hormone and health are still computed, so
  crowding that participants cause can still harm organisms. The `move=0` world is still a deterministic mode with its own
  hashes.
- `reveal=1` (default): a top-level organism or herd is drawn as a solid patch of its colour, and its parts aren't drawn. It opens and shows
  everything inside it while anything in it is hovered, selected or isolated. Hit-testing is unchanged. Cell stress colouring
  is only visible on open things.

**Display**
- `size=irrelevant`: each *free-standing* entity's radius is a hash of (seed, id) drawn uniformly from 6–56 world units, whatever its tier. Members are drawn as a scaled copy of the physical layout fitted inside the parent. Positions on screen equal sim positions for free-standing entities, but physics still uses physical sizes, so a tiny-looking herd still takes up its physical space in collisions.
- The radius–tier correlation test is computed over **free-standing entities**, pooled over 40 seeds (|r| < 0.1), and also over the per-entity draw for all entities. A nested member is necessarily smaller than its parent, so over all *drawn* nested entities radius cannot be fully tier-independent if members must fit inside parents. A proxy-mode control test asserts r > 0.7, so the test has teeth.
- Tier cues in `irrelevant`: cells solid, organisms a membrane, herds a dashed boundary. In `proxy`, herds have a faint solid boundary.
- Stress cue: a stressed cell darkens (up to 55 % toward black) and flickers as the noisy hormone signal approaches 0.6. It no longer turns red, because red is now an element colour.
- Health bar above each organism (green → red), and above each region in the flat condition.
- Biology skin: dark background, translucent cells with a type-specific nucleus (dot / triangle / hexagon), wobbly membranes. Abstract skin: light background, solid circle / triangle / hexagon glyphs, plain outlines.
- Membrane wobble is cosmetic and render-only (it does not touch the sim).

**Interaction and UI**
- Selection: the first click selects the deepest hit (lowest tier, nearest centre). Clicking the same spot again climbs to the parent; past the top it wraps back to the deepest. Clicking empty space clears the selection.
- A click becomes a drag after 4 px of movement. Dragging starts only if the pointer went down on the selection or one of its parts; otherwise the drag pans.
- Inspect panel "size" is the on-screen radius in world units; "speed" is world units per second.
- Report text edits are logged on `change` (blur / Enter), not per keystroke. The notepad is logged when typing pauses for 2 s, when it is hidden, and at the end.
- Report is untimed (Next / Finish buttons). Explore uses wall-clock time and keeps counting while paused.
- Hash every 1 s and snapshots every 10 s are in **sim time** (ticks), so pausing does not create redundant snapshots.
- The session (world + log) is created when the instructions finish, so `t_ms = 0` is the start of the sandbox.
- The default seed is random (`Math.random` in `config.ts`, not in `sim/`) and is recorded in the header.

## Known limitations

- `localStorage` is ~5 MB; a long session with many snapshots may exceed it. The backup then fails silently (the download still works; the jsPsych trial records `backup_saved`).
- In `size=irrelevant`, what you see and what collides are not the same thing (see above).
- Tested headless in Chromium only (Playwright). Not yet checked in Firefox/Safari, on touch devices or on small screens.
- Headless Chromium draws at ~30–50 fps with software rendering. A normal GPU browser should be at 60.

## Next steps

- Server/database for data upload; Prolific integration (PID, completion code, return URL).
- Scoring of the report (coding scheme for the open answers; automated matching of the token rules to `DYNAMICS` / `COMPOSITION`).
- Prediction challenges (e.g. "where will this herd be in 5 s?") to measure level-specific understanding.
- Audio, gaze tracking (out of scope for v0).
- Art polish; accessibility (colour-blind-safe palettes, keyboard selection).
- Tune dynamics per seed (some seeds are calmer than others) and pick a fixed seed set for the study.
- Richer join/combine recipes (e.g. recipe-exact founding).
- Seed-drawn or URL-configurable dynamics tables (currently fixed in `DYNAMICS`).
- Compress logs (delta snapshots) to stay within storage limits for longer sessions.
