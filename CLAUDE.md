# CLAUDE.md

Guidance for Claude instances working in this repository. Read this first, then `README.md` (the full reference for
URL parameters, mechanisms, log format and defaults).

## What this project is

A browser experiment, still a mockup, on **how people come to see levels of organisation**. Participants explore a 2D
sandbox of made-up "alien life". Cells make up organisms (membranes), and organisms make up herds (hazes). Then they
group what they saw and write rules about it. The study asks whether, and how, people come to see these levels on their own:
- as distinct wholes;
- with their own laws;
- with causes acting within and across levels.

Phases (Explore + Report in one jsPsych trial, then one trial per generalisation task):
1. **Explore:** 6 min, or 60 s with `short=1`. The instructions never mention levels.
2. **Report:** three steps in a fixed order, with no going back. An open description; fill-in-the-blank rules built from
   picture tokens (no level names, the word used is "scale"), after a worked example; then an open "how would you
   organise it" question. The text is in `REPORT` in `src/ui/report.ts`. A notepad is available throughout. Avoid priming:
   never name levels or reveal mechanisms in participant-facing text.
3. **Generalisation:** two 1-minute tasks in a fresh empty world (same seed). Participants drop elements in from a picture
   palette and try to make an effect happen: "make two things stick together" (success = cell lock & key) and "make
   something start spinning" (success = organism catalysis). Settings and text are in `GEN` in
   `src/experiment/generalisation.ts`. Each task is its own `Session`. The data file is the main log plus
   `generalisation: [taskLog, taskLog]`, and every log replays on its own.

Everything participants do is logged, and the world is **deterministic**, so any session can be replayed exactly.

**Experimental manipulations are URL parameters** (see README "URL parameters"):

| param | conditions |
|---|---|
| `hier` | hierarchy vs flat |
| `size` | size tracks level vs size is irrelevant |
| `chance` | graded / uniform / no within-level interactions |
| `laws` | seed-drawn forces vs random walk |

Keep conditions comparable: a change meant for one condition must not silently alter another.

## The world, briefly

- **Three levels:** cells (0), organisms (1), herds (2).
- **Four types at every level,** numbered the same way: `0 light blue, 1 purple, 2 red, 3 green`. Only cells draw a shape:
  circle, triangle, square, star. Organisms and herds are plain colour.
- **Composition** (what makes up what) is set in `COMPOSITION` in `src/sim/world.ts`. The default is `'same'`: a colour is made only
  of its own colour. Size bands (`org`, `herd`) make composites drain and fall apart outside `[min, unstable)`.
- **Within-level mechanisms** (`DYNAMICS`, `PAIR_RULES`) only ever act between two things of the **same** level:
  - **lock & key:** purple + green bind;
  - **catalysis:** light blue makes red spin;
  - **similarity** (optional);
  - **laws:** seed-drawn attract/repel matrices.
- **Lock & key and catalysis fire by chance, once per encounter.** An encounter starts when two things come within
  `rangeMargin`, and they must move beyond `apartMargin` before they can roll again. A link line shows the roll for
  `revealTicks`, then it stays (bound), fades (spin) or breaks (failed).
- **Participants compose by hand:** drop-to-join, drag + C to combine a touching group, Shift-drag to detach.

## Repository structure

```
src/
  config.ts        URL parsing + DEFAULTS (the app's defaults); simConfigOf() passes the sim's part on
  sim/             PURE, deterministic simulation: no DOM, no Pixi, no Math.random (enforced by tests)
    world.ts       entity types, DYNAMICS / COMPOSITION / PAIR_RULES / P, generation, applyAction, step
    rng.ts         mulberry32 + gauss + hash01: the only randomness
    dmath.ts       cross-engine deterministic sin/cos/hypot
    hash.ts        state hash used to verify replays
  render/          Pixi renderer, skins (colours/shapes), camera, pure layout + hit testing, pointer -> Action
  log/             Logger (event stream) and Session (world + log; used by app and tests)
  ui/              report phase, picture tokens (tokens.ts), notepad, inspect panel, controls legend, time controls
  experiment/      jsPsych timeline, SandboxPlugin, the app loop (main + task mode), generalisation.ts (GEN), download/backup
  replay.ts        replays a log through sim/ and checks every logged hash
scripts/           screenshots.mjs (Playwright run-through; re-records the replay fixture), replay.mjs (CLI)
tests/             vitest: sim.test.ts (behaviour, determinism, replay), layout.test.ts, architecture.test.ts
  fixtures/browser-session.json   a real Chromium session log that must replay exactly
screenshots/       output of `npm run screenshots` (git-ignored: regenerate locally and look at them)
```

The data flow: input → `Action` → `Session.act` (logged) → `applyAction`. Then each tick, `step` → sim events (logged)
→ `computeLayout` → `Renderer.draw`. The renderer only **reads** the world.

## Commands

```bash
npm install
npm run dev            # http://localhost:5173/?seed=42&short=1&debug=1
npm test               # vitest (~120 tests, a few seconds)
npm run build          # strict typecheck + bundle
npm run screenshots    # Playwright: screenshots + full run-through; re-records tests/fixtures/browser-session.json
npm run replay -- tests/fixtures/browser-session.json
```

`debug=1` gives the HUD, entity labels, the `S` swap key, the phase skip button, and the `window.__sandbox` hook used by scripts.

## Rules that must not be broken

1. **`src/sim/` stays pure and deterministic.** `tests/architecture.test.ts` enforces this:
   - it imports only from `src/sim/`;
   - no `window`, `document`, `performance`, `Date.now` or `Math.random`;
   - no `Math.sin/cos/hypot/pow/...` and no `**`: use `dmath.ts` (`dsin`, `dcos`, `dhypot`). Chromium and Node disagree in the last bit
     otherwise, and browser logs would not replay;
   - all randomness goes through `rng.ts` with the world's `s.rng`. Iterate in a fixed order (ascending id) wherever a roll or
     the order of side effects matters.
2. **Anything that can change future behaviour is world state:**
   - it is hashed in `hash.ts`;
   - it is included in `snapshotWorld`;
   - examples: `bond`, `spin`, `contacts` (encounters).
   Render-only state (wobble, line animations) must not live in the sim.
3. **Participant actions go through `Session.act`**, so they are logged and replayable. Never mutate the world from UI code.
4. **Any change to the simulation invalidates old logs.** After changing `sim/`, `DYNAMICS`, `COMPOSITION`, `PAIR_RULES`, `P`
   or a sim-affecting default:
   - run `npm run screenshots` to re-record the fixture;
   - then run `npm test` and `npm run replay -- tests/fixtures/browser-session.json`;
   - say so in your report.
5. **New URL parameters** are parsed in `src/config.ts`, added to `Config` and `DEFAULTS`, and passed through
   `simConfigOf` if the sim needs them. They are then echoed into the log header automatically. Optional `SimConfig` fields default
   to the old behaviour when missing, so tests that build worlds with `createWorld({...})` keep working.

## Conventions and good practice

- **Label tunable settings with `// TUNE:`.** The user edits these by hand. Every knob a researcher might change gets one:
  - in `DYNAMICS`, `COMPOSITION`, `PAIR_RULES`, `P` and `DEFAULTS`;
  - with a short comment saying what it does, its units (world units; ticks are 1/30 s), and per-level arrays written
    `[cells, organisms, herds]`.
  Keep the banner comments at the top of these blocks up to date.
- **Name colours and levels consistently:** "light blue / purple / red / green", "cells / organisms / herds". The participant-facing
  biology skin says "membranes" and "hazes". Use type numbers in code with the colour named in a comment.
- **Match the surrounding style:** TypeScript strict, small pure functions, comment density as in the file you edit. Comments
  explain *why*, not *what*.
- **Keep the README in step** with any behaviour, parameter, log-format or default change. It is the reference the
  researcher reads. When you add a log event, add it to the "Data format" table.
- **Tests:**
  - every behaviour change gets a test in `tests/sim.test.ts`, deterministic, using the helpers there
    (`dynWorld`, `smallWorld`, `meetPair`, `place`, `ticks`, `withSettings` for temporarily changing `DYNAMICS` / `COMPOSITION`);
  - for chance-based rules, test with chance 1 / ~0 for exact behaviour, plus one statistical test (≥300 trials, ±0.08);
  - tests read `DYNAMICS` values rather than hard-coding them.
- **Verify in the real app, not just tests:**
  - for anything visible or interactive, run `npm run screenshots` (or a small Playwright script under `scripts/`, deleted
    afterwards) and look at the images;
  - scratch probes go in a temporary `tests/tmp_*.test.ts` and are deleted after use.
- **Measure before you claim.** Questions like "is X uniform / buggy / too strong?" are answered with a probe that prints numbers
  (rates, counts, distances), then fixed with a test that would have caught it.
- **Ask before changing a design decision.** The user designs the study. When a request is ambiguous (what a probability means,
  what a mechanism should look like, whether something is a condition or a default), ask concise multiple-choice questions
  with a recommended option. Don't silently change existing defaults the user set by hand (e.g. `laws: false` in `DEFAULTS`).
- **Report honestly:** what changed, what was verified and how, what still differs from what was asked, and whether old logs
  still replay.

## Git

- Work on what the user asks; commit only when asked. The user also commits their own work, so check `git status` / `git log`
  first.
- Commit messages: a short summary line, then bullet points on what changed and why. End with the attribution trailer
  the harness specifies.
- Commit `tests/fixtures/browser-session.json` along with sim changes, so the fixture matches the code.
- Never commit `node_modules/`, `dist/` or `screenshots/` (all git-ignored).
- Other Claude instances may be working in parallel. Check `git status` before large edits, and don't revert changes you
  didn't make; mention them instead.
