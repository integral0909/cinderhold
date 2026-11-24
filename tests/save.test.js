import { beforeEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Save } from '../src/save.js';

const KEY = 'cinderhold.save.v1';

function mockStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

describe('Save', () => {
  let store;
  beforeEach(() => {
    store = mockStorage();
  });

  it('starts fresh with only the first level unlocked', () => {
    const s = new Save();
    expect(s.isUnlocked(0)).toBe(true);
    expect(s.isUnlocked(1)).toBe(false);
    expect(s.starsEarned()).toBe(0);
    expect(s.endlessUnlocked()).toBe(false);
  });

  it('records wins, keeps the best star count and unlocks the next level', () => {
    const s = new Save();
    const first = s.recordWin(LEVELS[0].id, 2, 'normal');
    expect(first).toEqual({ newStars: 2, firstWin: true, heroic: false });
    expect(s.isUnlocked(1)).toBe(true);
    const worse = s.recordWin(LEVELS[0].id, 1, 'normal');
    expect(worse.newStars).toBe(0);
    expect(s.level(LEVELS[0].id).stars).toBe(2);
    expect(s.level(LEVELS[0].id).wins).toBe(2);
    expect(s.recordWin(LEVELS[0].id, 3, 'heroic')).toEqual({ newStars: 1, firstWin: false, heroic: true });
  });

  it('keeps the fastest winning time', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal', 300);
    s.recordWin(LEVELS[0].id, 3, 'normal', 420);
    s.recordWin(LEVELS[0].id, 3, 'normal', 250);
    expect(s.level(LEVELS[0].id).bestTime).toBe(250);
  });

  it('persists across instances', () => {
    const a = new Save();
    a.recordWin(LEVELS[0].id, 3, 'normal');
    a.settings.music = 0.1;
    a.persist();
    const b = new Save();
    expect(b.level(LEVELS[0].id).stars).toBe(3);
    expect(b.settings.music).toBe(0.1);
  });

  it('only lets you adopt perks you can afford, and refunds them', () => {
    const s = new Save();
    expect(s.togglePerk('tools')).toBe(false);
    s.recordWin(LEVELS[0].id, 3, 'normal');
    expect(s.togglePerk('tools')).toBe(true);
    expect(s.starsFree()).toBe(0);
    expect(s.togglePerk('purse')).toBe(false);
    expect(s.togglePerk('tools')).toBe(true);
    expect(s.starsFree()).toBe(3);
    expect(s.togglePerk('nonsense')).toBe(false);
  });

  it('drops perks it no longer knows or can no longer afford', () => {
    store.set(KEY, JSON.stringify({ version: 1, perks: ['ghost', 'tools'], levels: { [LEVELS[0].id]: { stars: 2 } } }));
    const s = new Save();
    expect(s.data.perks).toEqual([]);
  });

  it('survives corrupt or unavailable storage', () => {
    store.set(KEY, '{not json');
    expect(new Save().starsEarned()).toBe(0);
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new Save();
    expect(() => s.recordWin(LEVELS[0].id, 3, 'normal')).not.toThrow();
  });

  it('keeps settings when progress is reset', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal');
    s.settings.quality = 'low';
    s.reset();
    expect(s.starsEarned()).toBe(0);
    expect(s.settings.quality).toBe('low');
  });

  it('exports and imports progress', () => {
    const a = new Save();
    a.recordWin(LEVELS[0].id, 3, 'normal');
    const text = a.exportString();
    a.reset();
    expect(a.starsEarned()).toBe(0);
    expect(a.importString(text)).toBe(true);
    expect(a.starsEarned()).toBe(3);
    expect(a.importString('garbage')).toBe(false);
    expect(a.importString('{"version":2}')).toBe(false);
    expect(a.starsEarned()).toBe(3);
  });

  it('rejects malformed perk and level containers without replacing progress', () => {
    const save = new Save();
    save.recordWin(LEVELS[0].id, 3, 'normal');
    const original = store.get(KEY);
    for (const value of [
      { version: 1, levels: {}, perks: null },
      { version: 1, levels: {}, perks: [null] },
      { version: 1, levels: null },
      { version: 1, levels: [] },
    ]) {
      expect(save.importString(JSON.stringify(value))).toBe(false);
      expect(store.get(KEY)).toBe(original);
      expect(save.starsEarned()).toBe(3);
      expect(new Save().starsEarned()).toBe(3);
    }
    expect(save.importString(JSON.stringify({ version: 1, levels: {} }))).toBe(true);
    expect(new Save().data.perks).toEqual([]);
  });

  it('rejects malformed progress collections without replacing an existing save', () => {
    const save = new Save();
    save.recordWin(LEVELS[0].id, 3, 'normal');
    const original = store.get(KEY);
    for (const key of ['seen', 'feats', 'customMaps', 'daily', 'settings', 'totals']) {
      expect(save.importString(JSON.stringify({ version: 1, levels: {}, [key]: null }))).toBe(false);
      expect(store.get(KEY)).toBe(original);
      const reloaded = new Save();
      expect(reloaded.starsEarned()).toBe(3);
      expect(reloaded.markSeen('fictional')).toBe(true);
      expect(reloaded.hasFeat('fictional')).toBe(false);
      expect(reloaded.listMaps()).toEqual([]);
      // Restore the original after markSeen persisted its change.
      store.set(KEY, original);
    }
  });

  it('stores, updates and deletes custom maps', () => {
    const s = new Save();
    const rows = LEVELS[0].map;
    const id = s.saveMap({ name: 'A', theme: 'snow', tier: 'gentle', waves: 10, rows });
    expect(s.getMap(id).name).toBe('A');
    expect(s.saveMap({ id, name: 'B', theme: 'snow', tier: 'gentle', waves: 10, rows })).toBe(id);
    expect(s.listMaps()).toHaveLength(1);
    expect(s.getMap(id).name).toBe('B');
    s.recordMapWin(id);
    s.saveMap({ id, name: 'C', theme: 'snow', tier: 'gentle', waves: 10, rows });
    expect(s.getMap(id).wins).toBe(1);
    expect(new Save().getMap(id).name).toBe('C');
    s.deleteMap(id);
    expect(s.listMaps()).toEqual([]);
  });

  it('keeps at most 40 custom maps, newest first', () => {
    const s = new Save();
    for (let i = 0; i < 45; i++) s.saveMap({ id: `x${i}`, name: `M${i}`, theme: 'meadow', tier: 'gentle', waves: 10, rows: LEVELS[0].map });
    expect(s.listMaps()).toHaveLength(40);
  });

  it('never hands out the same id twice, even within one millisecond', () => {
    const s = new Save();
    const ids = new Set();
    for (let i = 0; i < 300; i++) ids.add(s.addReplay({ name: `R${i}` }, { v: 1, log: [] }));
    for (let i = 0; i < 300; i++) ids.add(s.saveMap({ name: `M${i}`, theme: 'meadow', tier: 'gentle', waves: 10, rows: LEVELS[0].map }));
    expect(ids.size).toBe(600);
  });

  it('keeps the twelve newest replays and skips huge ones', () => {
    const s = new Save();
    const replay = { v: 1, log: [[0, 'wave']] };
    let first;
    for (let i = 0; i < 14; i++) {
      const id = s.addReplay({ name: `R${i}`, kind: 'campaign' }, replay);
      if (i === 0) first = id;
    }
    expect(s.listReplays()).toHaveLength(12);
    expect(s.getReplay(first)).toBeNull();
    expect(s.listReplays()[0].name).toBe('R13');
    const huge = { v: 1, log: Array.from({ length: 20000 }, (_, i) => [i, 'wave']) };
    expect(s.addReplay({ name: 'huge' }, huge)).toBeNull();
    const id = s.listReplays()[0].id;
    s.deleteReplay(id);
    expect(s.getReplay(id)).toBeNull();
  });

  it('keeps the five best endless runs per map', () => {
    const s = new Save();
    for (const [wave, kills] of [[10, 100], [30, 900], [20, 400], [30, 950], [5, 10], [25, 600], [12, 120]]) {
      s.recordEndless(LEVELS[0].id, wave, { kills });
    }
    expect(s.endlessRuns(LEVELS[0].id).map((r) => [r.wave, r.kills])).toEqual([[30, 950], [30, 900], [25, 600], [20, 400], [12, 120]]);
    expect(s.level(LEVELS[0].id).bestEndless).toBe(30);
    expect(s.endlessRuns(LEVELS[1].id)).toEqual([]);
  });

  it('remembers the best endless wave', () => {
    const s = new Save();
    expect(s.recordEndless(LEVELS[0].id, 12)).toBe(true);
    expect(s.recordEndless(LEVELS[0].id, 8)).toBe(false);
    expect(s.level(LEVELS[0].id).bestEndless).toBe(12);
  });

  it('drops the oldest replay and retries once when storage is full', () => {
    const s = new Save();
    s.data.replays = [
      { id: 'r-old', name: 'old', date: 1, replay: { v: 1, log: [] } },
      { id: 'r-new', name: 'new', date: 2, replay: { v: 1, log: [] } },
    ];
    let attempts = 0;
    globalThis.localStorage.setItem = (k, v) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(k, String(v));
    };
    const result = s.persist();
    expect(result).toEqual({ ok: true, recovered: true });
    expect(s.listReplays().map((r) => r.name)).toEqual(['new']);
    expect(JSON.parse(store.get(KEY)).replays.map((r) => r.name)).toEqual(['new']);
    expect(s.persistHint).toBeNull();
  });

  it('reports a one-time export hint and does not destroy memory or stored data if the retry also fails', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal');
    const original = store.get(KEY);
    s.data.replays = [
      { id: 'r-old', name: 'old', date: 1, replay: { v: 1, log: [] } },
      { id: 'r-new', name: 'new', date: 2, replay: { v: 1, log: [] } },
    ];
    const hints = [];
    s.onPersistFailureHint = (msg) => hints.push(msg);
    globalThis.localStorage.setItem = () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const first = s.persist();
    expect(first.ok).toBe(false);
    expect(first.hint).toMatch(/Export save/);
    expect(hints).toEqual([first.hint]);
    expect(s.listReplays().map((r) => r.name).sort()).toEqual(['new', 'old']);
    expect(store.get(KEY)).toBe(original);
    expect(s.starsEarned()).toBe(3);
    const second = s.persist();
    expect(second).toEqual({ ok: false });
    expect(hints).toHaveLength(1);
  });

  it('still does not throw when storage is unavailable, but reports the write failure', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal');
    const original = store.get(KEY);
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => s.recordWin(LEVELS[0].id, 2, 'normal')).not.toThrow();
    expect(s.persist().ok).toBe(false);
    // Previous stored save is untouched because the later writes never landed.
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
    expect(store.get(KEY)).toBe(original);
  });

  it('addReplay recovers by dropping the oldest replay when the first write fails', () => {
    const s = new Save();
    s.data.replays = [
      { id: 'r-old', name: 'old', date: 1, replay: { v: 1, log: [] } },
      { id: 'r-new', name: 'new', date: 2, replay: { v: 1, log: [] } },
    ];
    s.persist();
    let attempts = 0;
    globalThis.localStorage.setItem = (k, v) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(k, String(v));
    };
    const id = s.addReplay({ name: 'newest' }, { v: 1, log: [] });
    expect(id).toBeTruthy();
    expect(attempts).toBe(2);
    expect(s.listReplays().map((r) => r.name)).toEqual(['newest', 'new']);
    expect(JSON.parse(store.get(KEY)).replays.map((r) => r.name).sort()).toEqual(['new', 'newest']);
    expect(s.persistHint).toBeNull();
  });

  it('addReplay uses the main.js toast hook and keeps memory and stored data if the retry fails', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal');
    s.data.replays = [
      { id: 'r-old', name: 'old', date: 1, replay: { v: 1, log: [] } },
      { id: 'r-new', name: 'new', date: 2, replay: { v: 1, log: [] } },
    ];
    s.persist();
    const original = store.get(KEY);
    const toasts = [];
    const hud = { toast: (msg) => toasts.push(msg) };
    // Same assignment as src/main.js after Hud is created.
    s.onPersistFailureHint = (msg) => hud.toast(msg);
    globalThis.localStorage.setItem = () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    };
    const id = s.addReplay({ name: 'newest' }, { v: 1, log: [] });
    expect(id).toBeTruthy();
    expect(toasts).toEqual([s.persistHint]);
    expect(s.persistHint).toMatch(/Export save/);
    expect(s.listReplays().map((r) => r.name).sort()).toEqual(['new', 'newest', 'old']);
    expect(store.get(KEY)).toBe(original);
    expect(s.starsEarned()).toBe(3);
    s.recordWin(LEVELS[0].id, 2, 'normal');
    expect(toasts).toHaveLength(1);
  });

  it('main.js wires persist failures to the existing hud.toast after Hud is created', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const mainPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../src/main.js');
    const main = fs.readFileSync(mainPath, 'utf8');
    expect(main).toMatch(/const hud = new Hud\([^;]+;\s*const screens = new Screens\([^;]+;\s*hud\.detach\(\);\s*save\.onPersistFailureHint = \(msg\) => hud\.toast\(msg\);/s);
  });
});
