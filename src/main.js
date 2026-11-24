import './style.css';
import { LEVELS } from './sim/data/levels.js';
import { ENEMIES } from './sim/data/enemies.js';
import { TOWER_ORDER } from './sim/data/towers.js';
import { Game } from './sim/game.js';
import { Bot } from './sim/bot.js';
import { World } from './render/world.js';
import { Audio } from './audio/audio.js';
import { Save } from './save.js';
import { checkFeats } from './achievements.js';
import { customLevel } from './sim/mapcodec.js';
import { dailyTrial, dateKey, streak } from './sim/daily.js';
import { makeReplay, ReplayDriver } from './sim/replay.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { toggleFullscreen } from './ui/dom.js';
import { GamepadInput } from './input/gamepad.js';
import { ABILITIES } from './sim/data/abilities.js';

const save = new Save();
const audio = new Audio(save);
const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');

let world;
try {
  world = new World(stage, overlay, { quality: save.settings.quality });
} catch (err) {
  document.getElementById('nogl').hidden = false;
  throw err;
}

// session: the battle (or title-screen demo) currently running.
let session = null;
let lastFrame = performance.now();
let fpsAvg = 60;

const actions = {
  onTitle: () => {
    if (!session || !session.demo) startDemo();
    audio.setMusic('title');
  },
  startLevel: (idx, difficulty, endless) => startBattle({ level: LEVELS[idx], levelIdx: idx, difficulty, endless, kind: 'campaign' }),
  startCustom: (spec) => startBattle(spec),
  playMap: (id) => {
    const m = save.getMap(id);
    if (!m) return;
    const { level, levelIdx } = customLevel(m, id);
    startBattle({ level, levelIdx, difficulty: save.data.difficulty, kind: 'custom', mapId: id });
  },
  playDaily: () => {
    const t = dailyTrial(dateKey());
    startBattle({
      level: t.level, levelIdx: t.levelIdx, difficulty: save.data.difficulty, kind: 'daily', modifiers: t.modifiers, date: t.date,
    });
  },
  onCustomResult: (s, abandoned) => {
    const g = s.game;
    const won = g.status === 'won' && !abandoned;
    if (s.kind === 'custom' && won) save.recordMapWin(s.spec.mapId);
    if (s.kind === 'daily') {
      save.recordDaily(s.spec.date, { won, lives: g.lives, maxLives: g.maxLives, wavesCleared: g.stats.wavesCleared });
      if (won) return { dailyStreak: streak(save.data.daily, s.spec.date) };
    }
    return null;
  },
  restart: () => {
    if (!session || session.demo) return;
    startBattle(session.spec);
  },
  watchReplay: (id) => {
    const entry = save.getReplay(id);
    if (!entry) return;
    const r = entry.replay;
    startBattle({
      level: r.level, levelIdx: r.levelIdx, difficulty: r.difficulty, endless: r.endless, modifiers: r.modifiers,
      kind: 'replay', replay: r, replayId: id,
    });
  },
  quitToMenu: (where = 'levels') => {
    setPhotoMode(false);
    if (session?.replay) where = 'replays';
    if (session && !session.demo && !session.recorded) recordResult(true);
    hud.detach();
    startDemo();
    if (where === 'endless') screens.endless();
    else if (where === 'workshop') screens.workshop();
    else if (where === 'daily') screens.daily();
    else if (where === 'title') screens.title();
    else if (where === 'replays') screens.replays();
    else screens.levels();
  },
  resume: () => setPaused(false),
  togglePause: () => setPaused(!session?.paused),
  setSpeed: (n) => {
    if (!session || session.demo) return;
    session.speed = n;
    save.data.speed = n;
    save.persist();
  },
  callWave: () => {
    if (!commandable() || session.paused) return;
    const g = session.game;
    if (g.waveIndex >= g.totalWaves || g.isOver()) return;
    setPlanning(false);
    const bonus = g.callWave();
    if (bonus > 0) {
      session.earlyCalls++;
      hud.toast(`Early call: +${bonus} gold`);
      feats('early');
    }
  },
  selectBuild: (type) => {
    if (!commandable()) return;
    if (session.buildType === type) {
      setBuild(null);
      return;
    }
    const g = session.game;
    if (g.towerAllowed(type) && g.gold < g.buildCost(type)) {
      hud.nudge(type);
      audio.play('error');
      hud.toast(`Need ${g.buildCost(type) - g.gold} more gold`);
      return;
    }
    setBuild(type);
  },
  // Instant abilities fire at once; targeted ones enter aim mode and fire on
  // the next click.
  useAbility: (id) => {
    if (!commandable() || session.paused) return;
    const g = session.game;
    if (!g.canCast(id)) {
      audio.play('error');
      if (g.abilityAllowed(id) && g.status !== 'playing') hud.toast('Abilities work once the first wave is out');
      return;
    }
    if (ABILITIES[id].targeted) {
      setBuild(null);
      select(null);
      session.aim = session.aim === id ? null : id;
      updateCursor();
      return;
    }
    g.cast(id);
  },
  // Minimap click: slide the camera so it looks at this point.
  lookAt: (x, y) => world.lookAt(x, y),
  deselect: () => select(null),
  upgrade: () => {
    const t = session?.selected;
    if (!t || !commandable()) return;
    if (!session.game.upgrade(t.id)) audio.play('error');
  },
  sell: () => {
    const t = session?.selected;
    if (!t || !commandable()) return;
    if (!session.game.sell(t.id)) {
      audio.play('error');
      return;
    }
    select(null);
  },
  cycleTarget: () => {
    const t = session?.selected;
    if (!t || !commandable()) return;
    session.game.cycleTargeting(t.id);
    audio.play('click');
  },
  applySettings: () => {
    audio.applyVolumes();
    world.reduceMotion = save.settings.reduceMotion;
    world.setPalette(save.settings.colorblind ? 'colorblind' : 'standard');
    document.body.classList.toggle('colorblind', !!save.settings.colorblind);
    hud.setMinimap(save.settings.minimap);
    refreshHeatmap();
    if (world.quality !== save.settings.quality) world.setQuality(save.settings.quality);
  },
  tutorialDone: () => {
    save.data.tutorialDone = true;
    save.persist();
  },
};

world.reduceMotion = save.settings.reduceMotion;
world.onThunder = () => {
  if (session && !session.demo) audio.play('thunder', { force: true });
};
world.setPalette(save.settings.colorblind ? 'colorblind' : 'standard');
document.body.classList.toggle('colorblind', !!save.settings.colorblind);

const ctx = { save, audio, actions };
const hud = new Hud(document.getElementById('hud'), ctx);
const screens = new Screens(document.getElementById('screens'), ctx);
hud.detach();
save.onPersistFailureHint = (msg) => hud.toast(msg);

// ---------------------------------------------------------------- sessions

function startDemo() {
  // The title screen plays a real battle in the background with the bot.
  const unlocked = LEVELS.filter((_, i) => save.isUnlocked(i));
  const idx = Math.floor(Math.random() * Math.min(unlocked.length, LEVELS.length));
  const game = new Game({ level: LEVELS[idx], levelIdx: idx, difficulty: 'casual' });
  session = { game, demo: true, bot: new Bot(game, { seed: Date.now() & 0xffff, skill: 0.8 }), speed: 1, paused: false };
  world.load(game);
  world.controls.autoRotate = true;
  world.controls.autoRotateSpeed = 0.35;
  audio.setMusic('title');
}

// spec: { level, levelIdx, difficulty, endless, kind, modifiers }. kind is
// 'campaign' for the ten story levels; other kinds never touch campaign
// progress. levelIdx sets the difficulty curve the wave generator uses.
function startBattle(spec) {
  const { level, levelIdx, difficulty, endless = false, kind = 'campaign', modifiers = [] } = spec;
  // A replay rebuilds the game from its own recorded setup, perks included.
  const driver = spec.replay ? new ReplayDriver(spec.replay) : null;
  const game = driver ? driver.game : new Game({ level, levelIdx, difficulty, perks: save.data.perks, endless, modifiers });
  const speed = [1, 2, 3].includes(save.data.speed) ? save.data.speed : 1;
  session = {
    game, spec, kind, demo: false, replay: driver, speed, paused: false, buildType: null, selected: null, recorded: false, earlyCalls: 0,
  };
  world.controls.autoRotate = false;
  world.load(game);
  screens.hide();
  hud.attach(game, { tutorial: kind === 'campaign' && levelIdx === 0 && !endless && !save.data.tutorialDone, replay: !!driver });
  audio.unlock();
  audio.setMusic(level.theme);
  audio.setIntensity(0);
  hud.announce(level.name, driver ? 'Replay' : endless ? 'Endless Siege' : level.intro, 'intro');
  hud.setModifiers(modifiers);
}

function setPaused(p) {
  if (!session || session.demo || session.game.isOver()) return;
  session.paused = p;
  if (p) {
    setBuild(null);
    screens.pause(session.game);
  } else {
    screens.hide();
  }
}

function setBuild(type) {
  if (!session || session.demo) return;
  if (type && !session.game.towerAllowed(type)) return;
  session.buildType = type;
  if (type) session.aim = null;
  refreshHeatmap();
  hud.setBuild(type);
  if (type) select(null);
  if (!type) world.setGhost(null);
  else if (lastTile) updateCursor();
}

function select(tower) {
  if (!session) return;
  session.selected = tower;
  world.setSelected(tower);
  hud.select(tower);
}

function refreshHeatmap() {
  world.setHeatmap(session?.game, save.settings.heatmap && session?.buildType ? session.buildType : null);
}

// Planning pause: the battle holds between waves until the player sends the
// next one. Unlike a real pause, building and upgrading still work.
function setPlanning(on) {
  if (!session || !!session.planning === on) return;
  session.planning = on;
  hud.setPlanning(on);
}

// Commands come from the player only in a live battle, not in the title
// demo or while watching a replay.
function commandable() {
  return !!session && !session.demo && !session.replay;
}

function feats(event, extra = {}) {
  if (session.replay) return;
  const battle = { earlyCalls: session.earlyCalls, kind: session.kind, streak: streak(save.data.daily, dateKey()) };
  const earned = checkFeats({ event, game: session.game, save, battle, ...extra });
  for (const f of earned) {
    hud.featCard(f);
    audio.play('upgrade', { force: true });
  }
}

function recordResult(abandoned = false) {
  const g = session.game;
  session.recorded = true;
  if (session.replay) return null;
  if (!abandoned) {
    session.replayId = save.addReplay({
      name: g.level.name, kind: session.kind, difficulty: g.difficulty, endless: g.endless,
      result: { status: g.status, waves: g.stats.wavesCleared, lives: g.lives, maxLives: g.maxLives, time: g.time },
    }, makeReplay(g));
  }
  save.addPlayTime(g.time);
  if (!session.replay) save.addTotals(g.stats, g.status === 'won' && !abandoned, g.towerSummary());
  if (session.kind !== 'campaign') {
    save.persist();
    return actions.onCustomResult?.(session, abandoned) ?? null;
  }
  if (g.endless) {
    const newBest = save.recordEndless(g.level.id, g.stats.wavesCleared, { kills: g.stats.kills, difficulty: g.difficulty });
    save.persist();
    return { newBest };
  }
  if (g.status === 'won' && !abandoned) return save.recordWin(g.level.id, g.stars(), g.difficulty, g.time);
  save.persist();
  return null;
}

// ---------------------------------------------------------------- events

function handleEvents(events) {
  const s = session;
  for (const ev of events) {
    world.handle(ev);
    if (s.demo) continue;
    audio.handle(ev);
    switch (ev.type) {
      case 'wave': {
        const wave = s.game.wave(ev.index);
        if (ev.boss) {
          const boss = wave.groups.find((g) => ENEMIES[g.type].boss);
          hud.announce(ENEMIES[boss.type].name, 'A boss approaches the Hold', 'boss');
        } else {
          hud.announce(`Wave ${ev.index + 1}`, s.game.endless ? '' : `of ${s.game.totalWaves}`);
        }
        for (const g of wave.groups) {
          if (save.markSeen(g.type)) hud.enemyCard(g.type);
        }
        hud.tutorialEvent('wave');
        break;
      }
      case 'build':
      case 'upgrade':
        hud.tutorialEvent(ev.type);
        feats(ev.type, { tower: ev.tower });
        break;
      case 'death':
        if (ev.enemy.boss) feats('death', { enemy: ev.enemy });
        break;
      case 'cleared':
        if (ev.index >= 1) hud.tutorialEvent('cleared2');
        if (save.settings.planPause && !s.replay && s.game.waveIndex < s.game.totalWaves) setPlanning(true);
        if (s.game.endless) feats('cleared');
        break;
      case 'leak':
        hud.flashDamage();
        break;
      case 'won':
      case 'lost': {
        setBuild(null);
        select(null);
        const outcome = recordResult();
        feats(ev.type);
        audio.play(ev.type === 'won' ? 'win' : 'lose', { force: true });
        audio.setIntensity(0);
        setTimeout(() => {
          if (session === s) screens.result(s.game, outcome, { replay: !!s.replay, replayId: s.replayId || s.spec.replayId });
        }, 1400);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- input

const canvas = world.renderer.domElement;
let down = null;
let lastTile = null;
let lastPointer = null;
let padTile = null;

function updateCursor() {
  if (!session || session.demo) return;
  if (padTile && !lastPointer) {
    if (session.aim) world.setAim({ x: padTile.c + 0.5, y: padTile.r + 0.5 }, ABILITIES[session.aim].radius);
    else world.setAim(null);
    showCursor(padTile, true);
    return;
  }
  if (!lastPointer) return;
  if (session.aim) {
    world.setAim(world.pickPoint(lastPointer.x, lastPointer.y), ABILITIES[session.aim].radius);
    return;
  }
  world.setAim(null);
  showCursor(world.pickTile(lastPointer.x, lastPointer.y), false);
}

// Highlights a tile, with a build ghost when a tower is being placed. The
// gamepad cursor always shows its tile, even on empty ground.
function showCursor(tile, fromPad) {
  const g = session.game;
  lastTile = tile;
  if (!tile) {
    world.setHover(null);
    world.setGhost(null);
    world.setHoverTower(null);
    canvas.style.cursor = 'default';
    return;
  }
  if (session.buildType) {
    const ok = g.canBuild(session.buildType, tile.c, tile.r);
    world.setGhost(session.buildType, tile, ok);
    world.setHover(tile, ok ? world.palette.ok : world.palette.bad);
    canvas.style.cursor = ok ? 'copy' : 'not-allowed';
  } else {
    const t = g.towerAt(tile.c, tile.r);
    world.setGhost(null);
    world.setHover(t || fromPad ? tile : null, t ? 0xffe08a : 0xffffff);
    world.setHoverTower(t);
    canvas.style.cursor = t ? 'pointer' : 'default';
  }
}

canvas.addEventListener('pointermove', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  padTile = null;
  updateCursor();
});

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
});

canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const btn = down.button;
  down = null;
  if (moved > 6 || !session || session.demo || session.paused) return;
  if (session.replay) {
    // Watching: clicks only inspect towers.
    if (btn === 0) {
      const tile = world.pickTile(e.clientX, e.clientY);
      select(tile ? session.game.towerAt(tile.c, tile.r) : null);
    }
    return;
  }
  lastPointer = { x: e.clientX, y: e.clientY };
  if (btn === 2) {
    session.aim = null;
    world.setAim(null);
    setBuild(null);
    select(null);
    return;
  }
  if (btn !== 0) return;
  click(world.pickTile(e.clientX, e.clientY), e.shiftKey, world.pickPoint(e.clientX, e.clientY));
});

canvas.addEventListener('pointerleave', () => {
  world.setHover(null);
  world.setGhost(null);
  world.setHoverTower(null);
  lastPointer = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function click(tile, keepBuilding, point = null) {
  const g = session.game;
  if (g.isOver()) return;
  if (session.aim) {
    const p = point || (tile && { x: tile.c + 0.5, y: tile.r + 0.5 });
    if (p && g.cast(session.aim, p.x, p.y)) session.aim = null;
    else audio.play('error');
    updateCursor();
    return;
  }
  if (!tile) {
    select(null);
    return;
  }
  if (session.buildType) {
    const type = session.buildType;
    const existing = g.towerAt(tile.c, tile.r);
    if (existing) {
      setBuild(null);
      select(existing);
      return;
    }
    if (g.canBuild(type, tile.c, tile.r)) {
      g.build(type, tile.c, tile.r);
      refreshHeatmap();
      if (!keepBuilding || g.gold < g.buildCost(type)) setBuild(null);
    } else {
      audio.play('error');
      if (g.gold < g.buildCost(type)) hud.toast('Not enough gold');
    }
    updateCursor();
    return;
  }
  select(g.towerAt(tile.c, tile.r) || null);
}

const PAN_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'KeyM') {
    save.settings.muted = !save.settings.muted;
    save.persist();
    audio.applyVolumes();
    if (session && !session.demo) hud.toast(save.settings.muted ? 'Sound off' : 'Sound on');
    return;
  }
  if (e.code === 'Escape' && screens.current && screens.current !== 'title' && screens.current !== 'result') {
    if (screens.back()) return;
  }
  if (e.code === 'KeyG') {
    toggleFullscreen();
    return;
  }
  if (!session || session.demo) return;
  if (photo || e.code === 'KeyO') {
    if (e.code === 'KeyO' || e.code === 'Escape') setPhotoMode(!photo);
    else if (e.code === 'Enter') savePicture();
    else if (PAN_KEYS[e.code]) world.setPanKey(PAN_KEYS[e.code], true);
    return;
  }
  if (PAN_KEYS[e.code] && !session.paused) {
    world.setPanKey(PAN_KEYS[e.code], true);
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (screens.current && screens.current !== 'pause') return;
    if (session.paused) setPaused(false);
    else if (e.code === 'Escape' && (session.buildType || session.selected || session.aim)) {
      session.aim = null;
      world.setAim(null);
      setBuild(null);
      select(null);
    } else setPaused(true);
    return;
  }
  if (session.paused || session.game.isOver()) return;
  if (session.replay) {
    if (e.code === 'KeyK') hud.meter.toggle();
    if (e.code === 'KeyF') actions.setSpeed((session.speed % 3) + 1);
    if (e.code === 'KeyC' || e.code === 'Home') world.frameCamera();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= TOWER_ORDER.length) {
    actions.selectBuild(TOWER_ORDER[n - 1]);
    return;
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      actions.callWave();
      break;
    case 'KeyU':
      actions.upgrade();
      break;
    case 'KeyX':
    case 'Delete':
    case 'Backspace':
      actions.sell();
      break;
    case 'KeyT':
      actions.cycleTarget();
      break;
    case 'KeyF':
      actions.setSpeed((session.speed % 3) + 1);
      break;
    case 'KeyQ':
      actions.useAbility('meteor');
      break;
    case 'KeyE':
      actions.useAbility('nova');
      break;
    case 'KeyZ':
      actions.useAbility('chest');
      break;
    case 'KeyK':
      hud.meter.toggle();
      break;
    case 'KeyN':
      save.settings.minimap = !save.settings.minimap;
      save.persist();
      hud.setMinimap(save.settings.minimap);
      break;
    case 'KeyH':
      save.settings.heatmap = !save.settings.heatmap;
      save.persist();
      refreshHeatmap();
      hud.toast(save.settings.heatmap ? 'Placement heatmap on' : 'Placement heatmap off');
      break;
    case 'KeyR':
      world.setShowRanges(!world.showRanges);
      hud.toast(world.showRanges ? 'Showing all tower ranges' : 'Tower ranges hidden');
      break;
    case 'KeyC':
    case 'Home':
      world.frameCamera();
      break;
  }
});

// HUD buttons must not keep keyboard focus: Space would otherwise both fire
// the shortcut and activate the focused button.
document.getElementById('hud').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) b.blur();
});

window.addEventListener('keyup', (e) => {
  if (PAN_KEYS[e.code]) world.setPanKey(PAN_KEYS[e.code], false);
});

window.addEventListener('blur', () => {
  for (const k of ['up', 'down', 'left', 'right']) world.setPanKey(k, false);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (session && !session.demo && !session.game.isOver() && !session.paused) setPaused(true);
    audio.suspend();
  } else {
    audio.resume();
  }
});

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (session && !session.demo) setPaused(true);
});

// ---------------------------------------------------------------- photo mode

let photo = null;

function setPhotoMode(on) {
  if (!session || session.demo || !!photo === on) return;
  document.body.classList.toggle('photo-mode', on);
  if (on) {
    setBuild(null);
    select(null);
    photo = document.createElement('div');
    photo.className = 'photo-bar';
    const shoot = document.createElement('button');
    shoot.className = 'btn small primary';
    shoot.textContent = 'Save picture (Enter)';
    shoot.addEventListener('click', savePicture);
    const exit = document.createElement('button');
    exit.className = 'btn small';
    exit.textContent = 'Exit (O)';
    exit.addEventListener('click', () => setPhotoMode(false));
    photo.append('Photo mode', shoot, exit);
    document.body.appendChild(photo);
  } else {
    photo.remove();
    photo = null;
  }
}

function savePicture() {
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `cinderhold-${session.game.level.id.replace(/[^a-z0-9]+/gi, '-')}-${stamp}.png`;
  a.href = world.capture();
  a.click();
  audio.play('click');
}

// ---------------------------------------------------------------- gamepad

const pad = new GamepadInput();
let padAnnounced = false;

function handleGamepad(dt) {
  const input = pad.update(dt);
  if (pad.connected && !padAnnounced) {
    padAnnounced = true;
    if (session && !session.demo) hud.toast('Controller connected');
  }
  if (!pad.connected) return;
  if (screens.current) {
    menuPad(input);
    return;
  }
  if (!session || session.demo) return;
  if (input.camera.x || input.camera.y) world.orbit(input.camera.x * dt * 2, input.camera.y * dt * 10);
  if (input.move) movePadCursor(input.move.dx, input.move.dy);
  for (const intent of input.presses) padIntent(intent);
}

function movePadCursor(dx, dy) {
  const { w, h } = session.game.map;
  if (!padTile) padTile = lastTile || { c: Math.floor(w / 2), r: Math.floor(h / 2) };
  // Up on the stick is away from the camera, whichever way it faces.
  const [mx, my] = world.screenToGrid(dx, dy);
  padTile = { c: Math.max(0, Math.min(w - 1, padTile.c + mx)), r: Math.max(0, Math.min(h - 1, padTile.r + my)) };
  lastPointer = null;
  updateCursor();
}

function padIntent(intent) {
  const g = session.game;
  switch (intent) {
    case 'confirm':
      if (!padTile) movePadCursor(0, 0);
      else if (session.replay) select(g.towerAt(padTile.c, padTile.r));
      else click(padTile, false);
      break;
    case 'cancel':
      if (session.buildType || session.selected) {
        setBuild(null);
        select(null);
      }
      break;
    case 'upgrade':
      actions.upgrade();
      break;
    case 'sell':
      actions.sell();
      break;
    case 'wave':
      actions.callWave();
      break;
    case 'speed':
      actions.setSpeed((session.speed % 3) + 1);
      break;
    case 'ranges':
      world.setShowRanges(!world.showRanges);
      break;
    case 'pause':
      actions.togglePause();
      break;
    // Meteor lands straight on the pad cursor; no separate aiming step.
    case 'meteor':
      if (commandable() && padTile && g.cast('meteor', padTile.c + 0.5, padTile.r + 0.5)) break;
      audio.play('error');
      break;
    case 'nova':
      actions.useAbility('nova');
      break;
    case 'prevTower':
    case 'nextTower': {
      const allowed = TOWER_ORDER.filter((t) => g.towerAllowed(t));
      const i = allowed.indexOf(session.buildType);
      const step = intent === 'nextTower' ? 1 : -1;
      const next = allowed[(i + step + allowed.length + (i < 0 && step < 0 ? 1 : 0)) % allowed.length];
      if (commandable()) {
        session.buildType = null;
        actions.selectBuild(next);
      }
      if (!padTile) movePadCursor(0, 0);
      else updateCursor();
      break;
    }
  }
}

// In menus the pad moves focus between buttons, A presses, B goes back.
function menuPad(input) {
  const buttons = [...document.querySelectorAll('#screens button:not([disabled])')];
  if (!buttons.length) return;
  if (input.move) {
    const i = buttons.indexOf(document.activeElement);
    const step = input.move.dy || input.move.dx;
    buttons[(i < 0 ? 0 : i + step + buttons.length) % buttons.length].focus();
  }
  for (const intent of input.presses) {
    if (intent === 'confirm') {
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement && el.closest('#screens')) el.click();
      else buttons[0].focus();
    } else if (intent === 'cancel' || (intent === 'pause' && screens.current === 'pause')) {
      screens.back();
    }
  }
}

// ---------------------------------------------------------------- loop

// If a battle runs well below 35 fps for several seconds, step graphics
// quality down once per level of quality so slower machines stay playable.
let slowFor = 0;
function adaptQuality(dt) {
  if (session.paused || document.hidden) return;
  slowFor = fpsAvg < 35 ? slowFor + dt : 0;
  if (slowFor < 6) return;
  slowFor = 0;
  const next = { high: 'medium', medium: 'low' }[save.settings.quality];
  if (!next) return;
  save.settings.quality = next;
  save.persist();
  world.setQuality(next);
  hud.toast(`Graphics set to ${next} to keep things smooth`);
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (realDt > 0) fpsAvg += (1 / realDt - fpsAvg) * 0.05;
  handleGamepad(realDt);
  if (!session) return;

  const g = session.game;
  let alpha = 1;
  if (!session.paused && !session.planning) {
    const dt = realDt * session.speed;
    if (session.bot) session.bot.update(dt);
    alpha = g.update(dt);
    // The demo restarts on a fresh map when its battle ends.
    if (session.demo && g.isOver()) {
      startDemo();
      return;
    }
  }
  handleEvents(g.drainEvents());
  if (!session.demo) {
    adaptQuality(realDt);
    // Tick through the last three seconds before an automatic wave.
    const secs = g.countdown === null ? null : Math.ceil(g.countdown);
    if (secs !== null && secs <= 3 && secs !== session.lastTick && !session.paused) audio.play('tick');
    session.lastTick = secs;
    const busy = g.enemies.length + g.spawners.length;
    const boss = g.enemies.some((e) => e.boss);
    audio.setIntensity(boss ? 1 : busy > 0 ? 0.7 : 0.2);
    hud.update(session, fpsAvg);
  }
  world.sync(g, alpha);
  world.update(session.paused ? 0 : realDt * Math.min(session.speed, 2), g);
  world.render();
}

screens.title();
requestAnimationFrame(frame);

// Expose a tiny handle for debugging from the console.
window.cinderhold = {
  get session() {
    return session;
  },
  save,
  world,
  start: (idx, difficulty = 'normal', endless = false) => actions.startLevel(idx, difficulty, endless),
  // Lets the built-in bot play the current battle (used for soak testing).
  autoplay: () => {
    if (session && !session.demo) session.bot = new Bot(session.game);
  },
};
