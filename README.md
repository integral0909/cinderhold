# Cinderhold

[![CI](https://github.com/integral0909/cinderhold/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/integral0909/cinderhold/actions/workflows/ci.yml)

A 3D tower-defense game for the browser, built with [Three.js](https://threejs.org/).

The ash tide is rolling down the valley. Build towers along the roads, break the
waves before they reach the Hold, and push all the way to the furnace at the
heart of the ash.

![Title screen](docs/screenshots/title.png)

| | |
| --- | --- |
| ![Frostmere Pass](docs/screenshots/frostmere.png) | ![Cinderhold](docs/screenshots/cinderhold.png) |

- **10-level campaign** across six biomes (meadow, autumn woods, desert, snow,
  fen and volcanic caldera), 10 to 25 waves each, with two boss types.
- **7 towers, 3 tiers each**: Bolt Turret, Ember Cannon, Rime Spire, Storm Coil,
  Siege Mortar, Cinder Brazier and the War Banner. Each has its own role:
  anti-air, splash, slow, armor-piercing chains, long-range artillery, area
  burn and support. Towers earn veteran ranks from kills.
- **Commander abilities**: Meteor, Frost Nova and War Chest on cooldowns.
- **11 enemy types** with distinct mechanics: armor, regenerating shields,
  healers, fliers, units that split on death, tunnellers, and two bosses.
- **Targeting modes** per tower (first, last, strongest, closest), selling,
  early-wave bonuses, 1×/2×/3× speed.
- **Three difficulties**, star ratings, and a **War Council** of twelve perks
  bought with stars (refundable at any time).
- **16 feats** to earn, a battle chart on every result screen, lifetime records, per-level best times, and save
  export/import for moving progress between browsers.
- **Endless Siege** on any cleared map, with its own escalating roster.
- **Daily Trial**: one map and two of nine rule-bending modifiers, the same
  for every player each day, with a win streak.
- **Map Workshop**: paint your own battlefields with live route preview and
  validation, play them on any difficulty, and share them as short codes.
- **Codex** with full per-tier tower stats and enemy kill counts, an in-game
  tutorial on the first level, and a live bot-played battle behind the title
  screen.
- **Replays** of every finished battle, rebuilt exactly from your commands.
- Minimap, damage meter, placement heatmap, three-wave forecast, boss health
  bar, mortar landing markers, range overlay (R), photo mode, passing weather.
- Gamepad support, colour-blind palette, reduce-motion setting, optional
  hold between waves and automatic graphics fallback on slow machines.
- All models are built from primitives in code, all sound effects and music
  are synthesised at runtime with the Web Audio API, and icons are
  hand-written SVG. No external assets, no network calls, no API keys.

A full campaign run takes well over an hour on Normal; the automated
playthrough below covers about 110 minutes of game time with an efficient bot
that calls every wave early.

## Running

Requires Node.js 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build:

```sh
npm run build      # outputs dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is a static site and can be hosted anywhere. Progress is saved to the
browser's localStorage.

## Controls

| Input | Action |
| --- | --- |
| Left click | Build the chosen tower / select a tower |
| 1 – 6 | Choose a tower to build |
| Shift + click | Keep building the same tower |
| Right drag | Rotate the camera |
| Wheel / pinch | Zoom |
| Middle drag, WASD, arrow keys | Pan |
| Q / E / Z | Meteor (then click a spot) / Frost Nova / War Chest |
| C / Home | Reset the camera |
| R | Show every tower's range |
| H | Placement heatmap while building |
| Space | Send the next wave (early calls pay a bonus) |
| U / X / T | Upgrade / sell / cycle targeting of the selected tower |
| F | Cycle game speed |
| Esc / P | Cancel, deselect, pause |
| G | Toggle fullscreen |
| N | Show or hide the minimap |
| K | Damage meter |
| O | Photo mode; Enter saves a PNG of the view |
| M | Mute |

Touch: tap to build or select, one-finger drag pans, two fingers zoom and
rotate.

Gamepad (standard layout): the left stick or D-pad moves a tile cursor, A
builds or selects, B cancels, LB/RB pick a tower, X upgrades, LT sells, Y
sends the wave, RT changes speed, the right stick orbits and zooms, Start
pauses and Back shows every range. Menus work with the D-pad, A and B.

## Project layout

```
src/
  sim/            deterministic rules engine (no rendering, runs in Node)
    data/         towers, enemies, levels, perks
    map.js        ASCII map parsing and enemy routes
    waves.js      seeded wave generator
    game.js       the game state machine (fixed 30 Hz ticks)
    bot.js        auto-player used by tests, the playthrough script and the title demo
    daily.js      Daily Trial generation and win streaks
    mapcodec.js   custom map validation and share codes
    mapgen.js     random map generator
    replay.js     replays from the recorded command log
    coverage.js   road coverage scores (bot and placement heatmap)
  render/         Three.js scene: board, models, effects, camera
  audio/          Web Audio sound effects and generative music
  input/          gamepad input
  ui/             HUD and menu screens (plain DOM)
  assets/icons/   SVG icons
  save.js         localStorage persistence
  main.js         game loop, input and glue
tests/            Vitest suites
scripts/          headless campaign playthrough
```

The simulation is separate from rendering: the renderer reads game state and
consumes an event stream (`fire`, `impact`, `death`, `leak`, …) after each
update. This keeps the rules testable in Node and lets the same code drive
both the browser and the headless playthrough.

## Tests

```sh
npm test               # unit tests + bot plays every level on Normal
npm run playthrough    # per-level report: result, lives, kills, game time
npm run playthrough -- --difficulty heroic
npm run playthrough -- --endless
npm run balance        # win rates per level, difficulty and bot skill
npm run lint
```

The campaign test fails if any level cannot be beaten on Normal, if the run
stalls, or if the whole campaign takes less than an hour of game time.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

| Job | What it checks |
| --- | --- |
| lint | ESLint over the whole repo |
| test | the Vitest suite on Node 20, 22 and 24 |
| playthrough | the bot beats all ten levels on Normal (Heroic is reported only) |
| build | a production build, uploaded as the `cinderhold-dist` artifact |

Dependabot opens weekly npm updates and monthly action updates.

The same checks run locally, without GitHub, with:

```sh
npm run ci          # run the pipeline
npm run ci:report   # run it and post the result to GitHub as the ci/local status
```

`ci:report` is a fallback for when GitHub-hosted runners are unavailable: it
posts a `ci/local` commit status instead. It needs a token with repo access in
`GITHUB_TOKEN` (or a stored git credential) and refuses to run on a dirty
working tree.

## License

MIT. See [LICENSE](LICENSE).
