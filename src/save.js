import { LEVELS } from './sim/data/levels.js';
import { PERKS } from './sim/data/perks.js';

const KEY = 'cinderhold.save.v1';

// Unique ids for maps and replays: time, a per-session counter (several can
// be made in the same millisecond) and a random tail (two tabs, one save).
let idSeq = 0;
function newId(prefix) {
  idSeq = (idSeq + 1) % 1296;
  return `${prefix}${Date.now().toString(36)}${idSeq.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296).toString(36)}`;
}
const MAX_CUSTOM_MAPS = 40;
const MAX_REPLAYS = 12;
const ENDLESS_RUNS = 5;
const MAX_REPLAY_BYTES = 120000;

export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  muted: false,
  quality: 'high',
  showFps: false,
  heatmap: true,
  colorblind: false,
  planPause: false,
  minimap: true,
  reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

function fresh() {
  return {
    version: 1,
    levels: {}, // id -> { stars, heroic, bestEndless, wins }
    perks: [],
    seen: [], // enemy types already introduced to the player
    tutorialDone: false,
    difficulty: 'normal',
    settings: { ...DEFAULT_SETTINGS },
    playSeconds: 0,
    feats: [],
    daily: {}, // date -> { won, lives, maxLives, wavesCleared, attempts }
    customMaps: [],
    replays: [], // { id, name, kind, difficulty, date, result, replay } // { id, name, theme, tier, waves, rows, updated, wins }
    totals: { kills: 0, built: 0, battles: 0, wins: 0, byType: {}, byTower: {} },
  };
}

// Progress lives in localStorage. Storage can be unavailable (private mode,
// blocked cookies); the game then simply runs without persistence.
export class Save {
  constructor() {
    this.data = fresh();
    this.persistHint = null;
    this.onPersistFailureHint = null;
    this._persistHintShown = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          const base = fresh();
          this.data = {
            ...base,
            ...parsed,
            settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
            totals: { ...base.totals, ...parsed.totals },
          };
        }
      }
    } catch {
      // ignore: start fresh
    }
    // Drop perks that no longer exist or no longer fit the star budget.
    this.data.perks = this.data.perks.filter((id) => PERKS.some((p) => p.id === id));
    while (this.starsSpent() > this.starsEarned()) this.data.perks.pop();
  }

  _write() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
  }

  // Returns { ok, recovered?, hint? }. Never throws: a full or blocked store
  // must not crash a battle. On QuotaExceeded (or any write failure), drop
  // the oldest replay and retry once. If that still fails, put the replay
  // back in memory so we do not silently destroy it, leave the previous
  // stored save untouched, and surface a one-time Export hint.
  persist() {
    try {
      this._write();
      return { ok: true };
    } catch {
      // try recovery below
    }
    const list = this.data.replays;
    if (list.length) {
      let oldest = 0;
      for (let i = 1; i < list.length; i++) {
        if ((list[i].date || 0) < (list[oldest].date || 0)) oldest = i;
      }
      const [removed] = list.splice(oldest, 1);
      try {
        this._write();
        return { ok: true, recovered: true };
      } catch {
        list.splice(oldest, 0, removed);
      }
    }
    const result = { ok: false };
    if (!this._persistHintShown) {
      this._persistHintShown = true;
      result.hint = 'Progress could not be saved. Use Export save in Settings to keep a copy.';
      this.persistHint = result.hint;
      if (typeof this.onPersistFailureHint === 'function') this.onPersistFailureHint(result.hint);
    }
    return result;
  }

  get settings() {
    return this.data.settings;
  }

  level(id) {
    return this.data.levels[id] || { stars: 0, heroic: false, bestEndless: 0, wins: 0 };
  }

  isUnlocked(idx) {
    if (idx === 0) return true;
    return this.level(LEVELS[idx - 1].id).stars > 0;
  }

  endlessUnlocked() {
    return this.level(LEVELS[2].id).stars > 0;
  }

  campaignDone() {
    return this.level(LEVELS[LEVELS.length - 1].id).stars > 0;
  }

  starsEarned() {
    return LEVELS.reduce((sum, l) => sum + this.level(l.id).stars, 0);
  }

  starsSpent() {
    return this.data.perks.reduce((sum, id) => sum + (PERKS.find((p) => p.id === id)?.cost || 0), 0);
  }

  starsFree() {
    return this.starsEarned() - this.starsSpent();
  }

  hasPerk(id) {
    return this.data.perks.includes(id);
  }

  togglePerk(id) {
    const perk = PERKS.find((p) => p.id === id);
    if (!perk) return false;
    if (this.hasPerk(id)) {
      this.data.perks = this.data.perks.filter((p) => p !== id);
    } else {
      if (this.starsFree() < perk.cost) return false;
      this.data.perks.push(id);
    }
    this.persist();
    return true;
  }

  // Records a finished campaign battle. Returns what changed for the UI.
  recordWin(id, stars, difficulty, time) {
    const prev = this.level(id);
    const next = { ...prev, wins: (prev.wins || 0) + 1 };
    if (time && (!prev.bestTime || time < prev.bestTime)) next.bestTime = time;
    next.stars = Math.max(prev.stars, stars);
    if (difficulty === 'heroic') next.heroic = true;
    this.data.levels[id] = next;
    this.persist();
    return { newStars: next.stars - prev.stars, firstWin: prev.stars === 0, heroic: difficulty === 'heroic' && !prev.heroic };
  }

  // Keeps the best five endless runs per map (wave reached, then kills).
  // Returns true when this run is a new best.
  recordEndless(id, wave, { kills = 0, difficulty = 'normal' } = {}) {
    const prev = this.level(id);
    const best = Math.max(prev.bestEndless || 0, wave);
    const runs = [...(prev.endlessRuns || []), { wave, kills, difficulty, date: Date.now() }]
      .sort((a, b) => b.wave - a.wave || b.kills - a.kills)
      .slice(0, ENDLESS_RUNS);
    this.data.levels[id] = { ...prev, bestEndless: best, endlessRuns: runs };
    this.persist();
    return best > (prev.bestEndless || 0);
  }

  endlessRuns(id) {
    return this.level(id).endlessRuns || [];
  }

  markSeen(type) {
    if (this.data.seen.includes(type)) return false;
    this.data.seen.push(type);
    this.persist();
    return true;
  }

  hasFeat(id) {
    return this.data.feats.includes(id);
  }

  addFeat(id) {
    if (this.hasFeat(id)) return false;
    this.data.feats.push(id);
    this.persist();
    return true;
  }

  // Adds a finished battle's numbers to the lifetime totals.
  addTotals(stats, won, towers = {}) {
    const t = this.data.totals;
    t.byTower = t.byTower || {};
    for (const [type, v] of Object.entries(towers)) {
      const o = t.byTower[type] || (t.byTower[type] = { built: 0, kills: 0, damage: 0 });
      o.built += v.built;
      o.kills += v.kills;
      o.damage += Math.round(v.damage);
    }
    t.kills += stats.kills;
    t.byType = t.byType || {};
    for (const [type, n] of Object.entries(stats.killsByType || {})) t.byType[type] = (t.byType[type] || 0) + n;
    t.built += stats.built;
    t.battles += 1;
    if (won) t.wins += 1;
  }

  addPlayTime(sec) {
    this.data.playSeconds += sec;
  }

  // ---------------------------------------------------------------- daily trial

  dailyResult(date) {
    return this.data.daily[date] || null;
  }

  // Keeps the best attempt for the day: a win beats a loss, more lives or
  // more waves beat fewer.
  recordDaily(date, { won, lives, maxLives, wavesCleared }) {
    const prev = this.data.daily[date];
    const attempts = (prev?.attempts || 0) + 1;
    const better = !prev || (won && !prev.won) || (won === prev.won && (won ? lives > prev.lives : wavesCleared > prev.wavesCleared));
    this.data.daily[date] = better ? { won, lives, maxLives, wavesCleared, attempts } : { ...prev, attempts };
    // Old trials are only needed for the streak; keep two months.
    const dates = Object.keys(this.data.daily).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - 60))) delete this.data.daily[d];
    this.persist();
    return better;
  }

  // ---------------------------------------------------------------- replays

  listReplays() {
    return [...this.data.replays].sort((a, b) => b.date - a.date);
  }

  getReplay(id) {
    return this.data.replays.find((r) => r.id === id) || null;
  }

  // Keeps the newest few replays; very long ones (marathon endless runs) are
  // not stored so they cannot crowd out the rest of the save.
  addReplay(meta, replay) {
    if (JSON.stringify(replay).length > MAX_REPLAY_BYTES) return null;
    const id = newId('r');
    this.data.replays = [{ ...meta, id, date: Date.now(), replay }, ...this.listReplays()].slice(0, MAX_REPLAYS);
    this.persist();
    return id;
  }

  deleteReplay(id) {
    this.data.replays = this.data.replays.filter((r) => r.id !== id);
    this.persist();
  }

  // ---------------------------------------------------------------- custom maps

  listMaps() {
    return [...this.data.customMaps].sort((a, b) => b.updated - a.updated);
  }

  getMap(id) {
    return this.data.customMaps.find((m) => m.id === id) || null;
  }

  // Inserts or updates a map; returns its id.
  saveMap(map) {
    const now = Date.now();
    const id = map.id || newId('m');
    const entry = { ...this.getMap(id), ...map, id, rows: [...map.rows], updated: now };
    entry.wins = entry.wins || 0;
    this.data.customMaps = [...this.data.customMaps.filter((m) => m.id !== id), entry];
    if (this.data.customMaps.length > MAX_CUSTOM_MAPS) this.data.customMaps = this.listMaps().slice(0, MAX_CUSTOM_MAPS);
    this.persist();
    return id;
  }

  deleteMap(id) {
    this.data.customMaps = this.data.customMaps.filter((m) => m.id !== id);
    this.persist();
  }

  recordMapWin(id) {
    const m = this.getMap(id);
    if (!m) return;
    m.wins = (m.wins || 0) + 1;
    this.persist();
  }

  // Save transfer between browsers: a plain JSON string.
  exportString() {
    return JSON.stringify(this.data);
  }

  importString(str) {
    let parsed;
    try {
      parsed = JSON.parse(str);
    } catch {
      return false;
    }
    if (!parsed || parsed.version !== 1 || !parsed.levels || typeof parsed.levels !== 'object' || Array.isArray(parsed.levels)) return false;
    // Older saves may omit perks; a present value must be usable on reload.
    if (parsed.perks !== undefined && (!Array.isArray(parsed.perks) || !parsed.perks.every((id) => typeof id === 'string'))) return false;
    // These collections are used directly by progress and custom-map methods.
    // Omitted fields retain the defaults for older saves.
    for (const key of ['seen', 'feats', 'customMaps', 'replays']) {
      if (parsed[key] !== undefined && !Array.isArray(parsed[key])) return false;
    }
    for (const key of ['daily', 'settings', 'totals']) {
      const value = parsed[key];
      if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return false;
    }
    const base = fresh();
    this.data = {
      ...base,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      totals: { ...base.totals, ...parsed.totals },
    };
    this.persist();
    return true;
  }

  reset() {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.persist();
  }
}
