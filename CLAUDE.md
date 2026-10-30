# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**RIMFALL**: an original browser game in the vector tube-shooter genre. The player moves around the near rim of a 3D "web" of lanes and shoots enemies climbing up from the far end. It's built with TypeScript, Vite, Canvas 2D and Vitest, with no runtime dependencies and no asset files (audio is synthesized).

Scope constraint: this is an original game in that genre, **not** a recreation of any specific existing game. Keep enemy designs, names, level shapes, scoring and presentation original.

## Commands

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # tsc typecheck + production build into dist/
npm run preview      # serve dist/
npm run typecheck    # tsc only
npm test             # vitest run (all tests)
npx vitest run src/game/game.test.ts        # one file
npx vitest run -t "splits a splitter"       # one test by name
```

## Architecture

There is a strict split between pure game logic and browser-facing code:

- `src/game/`: pure, deterministic simulation with no DOM access. It's the only code under test.
  - `types.ts`: the `Game` state object, `Enemy`, `FrameInput` and `GameEvent` types.
  - `game.ts`: `update(game, input, dt)` advances the state machine (`title → playing ⇄ dying → gameover`, `playing → warping → playing`). All tuning constants live at the top of this file.
  - `web.ts`: lane geometry. Lateral positions are `u` in lane units (lane `i` spans `[i, i+1)`, center `i + 0.5`). Closed webs wrap and open webs clamp. Always go through `wrapU`/`laneOf`/`laneDelta` instead of doing the arithmetic directly. `makeWeb` normalizes closed webs to counter-clockwise screen winding, so +u means "right" at the bottom of every web.
  - `levels.ts`: web shapes (cycled by level, resampled to equal lane widths), the enemy-unlock schedule, and wave generation. Open webs go through `openWeb()`, which lowers them below the camera so they don't render edge-on.
  - `rng.ts`: seeded PRNG. All in-game randomness must use `game.rng`, so that tests stay deterministic.
- `src/render/renderer.ts`: draws a `Game` snapshot using a perspective projection (`depth` 0 = rim, 1 = far end). Camera motion for the level intro and the warp is derived from `mode`/`modeTime`/`levelTime`, not stored in game state. Enemy and player shapes are 2D polylines in a lane-local frame (`across` the lane, `toward` the viewer). Particles and stars live only in the renderer.
- `src/audio/sfx.ts`: WebAudio-synthesized effects, keyed by `GameEvent` type.
- `src/input.ts`: keyboard, mouse (with pointer lock) and touch, converted to a per-step `FrameInput`.
- `src/main.ts`: runs a fixed 120 Hz simulation step. After stepping, it passes `game.events` to the renderer and audio, then clears it. Simulation code emits events instead of calling audio or rendering directly. The high score is kept in `localStorage`.

## Debugging

In dev builds, `window.game` and `window.setupLevel` are exposed. For example, run `setupLevel(game, 9)` in the console (or via Playwright `page.evaluate`) to jump to a level, or clear `game.enemies`/`game.spawnQueue` to trigger a warp.
