# Changelog

## Unreleased

- Accessibility: menu screens are announced as dialogs and take focus when
  opened, the tower panel close button has a clearer name, HUD buttons show a
  focus ring, and wave starts and lives lost are announced to screen readers.

## 1.3.0

- Replays: every finished battle is saved (last twelve) and can be watched
  again; the deterministic simulation rebuilds it from the command log.
- Commander abilities: Meteor, Frost Nova and War Chest with cooldowns,
  unlocked during the campaign.
- New tower: the War Banner, a support tower that boosts nearby towers.
- New enemy: the Cinder Mole, which tunnels under the road out of reach.
- Tower veterancy: ranks at 25, 75 and 200 kills for extra damage.
- Gamepad support for battles and menus.
- Placement heatmap while building, a minimap, a damage meter, a three-wave
  forecast with wave tags, and an optional hold between waves.
- Random maps in the Workshop, a two-week history on the Daily Trial screen,
  an endless leaderboard, per-tower lifetime stats and a photo mode.
- Passing weather: rain, fen thunderstorms and desert sandstorms.
- Colour-blind friendly palette option.
- Fixes: stricter save import validation, map names cut at whole
  characters, the bot now changes targeting through a real command.

## 1.2.0

- Map Workshop: a tile editor with undo/redo, live route preview and
  validation; custom maps are saved, played with your difficulty and perks,
  and shared as `CH1.` codes.
- Daily Trial: a date-seeded map with two of nine modifiers (Swift Tide,
  Ironclad, Stubborn, Skyborne, Frenzy, Lean Times, Dear Stone, Fragile
  Walls, No Retreat), best result per day and a win streak.
- Result screens chart lives, gold and enemies over the battle.
- Two new feats for the Daily Trial; campaign feats no longer trigger on
  custom maps.
- CI split into lint, Node 20/22/24 tests, playthrough and build jobs, plus
  Dependabot and `npm run ci` / `npm run ci:report` for running it locally.

## 1.1.0

- Feats (14 achievements), a Records screen with lifetime stats, kills per
  enemy type in the codex and fastest-win times per level.
- Two new perks: Spyglasses and Dry Kindling.
- Save export and import from Settings.
- Boss health bar, mortar landing markers, range overlay for every tower (R),
  range preview on hover, ground shadows for fliers, death animations, hit
  squash, a smoking Hold when badly damaged, lava embers and victory
  fireworks.
- Full refund for towers sold before the first wave or within 5 seconds.
- Reduce-motion setting, fullscreen toggle (G), camera reset (C/Home), Esc to
  go back in menus, remembered game speed, countdown ticks, music crossfades.
- Balance: Heroic reworked to be harder early and fairer late, gentler boss
  health scaling, Caldera Gate made tougher. See docs/balance.md.
- Fixes: leaked warden shield and portal materials, a shared material being
  recoloured by the Hold, hotkeys firing while typing, rounding of perk-boosted
  stats.
- Tooling: ESLint, save/feat/endless test suites, `npm run balance`.

## 1.0.0

- Ten-level campaign, six towers with three tiers, ten enemy types, endless
  mode, perks, codex, tutorial, synthesised audio.
