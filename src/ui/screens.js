import { LEVELS } from '../sim/data/levels.js';
import { PERKS } from '../sim/data/perks.js';
import { TOWERS, TOWER_ORDER, towerTier } from '../sim/data/towers.js';
import { ENEMIES, ENEMY_ORDER } from '../sim/data/enemies.js';
import { DIFFICULTY } from '../sim/game.js';
import { THEMES } from '../render/themes.js';
import { THEME_NAMES } from '../sim/data/themes.js';
import { FEATS } from '../achievements.js';
import { statLines } from './stats.js';
import { battleChart } from './chart.js';
import { MapEditor, mapThumbnail } from './editor.js';
import { blankMap, decodeMap, encodeMap, TIERS } from '../sim/mapcodec.js';
import { dailyTrial, dateKey, streak } from '../sim/daily.js';
import { randomMap } from '../sim/mapgen.js';
import { modifierById } from '../sim/data/modifiers.js';
import { clear, fill, fmtTime, h, icon, toggleFullscreen } from './dom.js';


const BACK_LABELS = ['Back', 'Cancel', 'Done', 'Resume'];

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Full-screen menus: title, level select, perks, codex, settings, help,
// pause and the end-of-battle report.
export class Screens {
  constructor(container, ctx) {
    this.el = container;
    this.ctx = ctx;
    this.current = null;
  }

  get save() {
    return this.ctx.save;
  }

  click() {
    this.ctx.audio.unlock();
    this.ctx.audio.play('click');
  }

  btn(label, onclick, cls = '') {
    return h(`button.btn${cls ? '.' + cls : ''}`, {
      'data-back': BACK_LABELS.includes(label) || undefined,
      onclick: (e) => {
        this.click();
        onclick(e);
      },
    }, label);
  }

  // Esc in a menu does whatever its Back/Cancel/Done/Resume button does.
  back() {
    const b = this.el.querySelector('button[data-back]');
    if (!b) return false;
    b.click();
    return true;
  }

  hide() {
    this.cleanup?.();
    this.cleanup = null;
    clear(this.el);
    this.el.hidden = true;
    this.current = null;
  }

  mount(name, node, { dim = true, cleanup = null } = {}) {
    this.cleanup?.();
    this.cleanup = cleanup;
    clear(this.el);
    this.el.hidden = false;
    this.el.className = dim ? 'screens dim' : 'screens';
    this.el.appendChild(node);
    this.current = name;
    const heading = node.querySelector('h2');
    if (name !== 'title' && heading) {
      heading.id ||= `screen-title-${name}`;
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      node.setAttribute('aria-labelledby', heading.id);
      node.tabIndex = -1;
    }
    const first = node.querySelector('button:not([disabled])');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
    else if (node.tabIndex === -1) node.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- title

  title() {
    const s = this.save;
    const a = this.ctx.actions;
    const stars = s.starsEarned();
    const node = h('div.title-screen',
      h('div.logo',
        h('div.logo-mark', icon('ember', 'logo-icon')),
        h('h1', 'Cinderhold'),
        h('p.tagline', 'Hold the line against the ash tide'),
      ),
      h('div.menu',
        this.btn(s.starsEarned() ? 'Continue Campaign' : 'Begin Campaign', () => this.levels(), 'primary'),
        this.btn(s.endlessUnlocked() ? 'Endless Siege' : 'Endless Siege (clear level 3)', () => this.endless(), s.endlessUnlocked() ? '' : 'locked'),
        this.btn(h('span', 'War Council ', h('span.pill', icon('star', 'icon tiny'), ` ${s.starsFree()}/${stars}`)), () => this.perks()),
        this.btn(h('span', 'Daily Trial ', s.dailyResult(dateKey())?.won ? h('span.pill', '✓ done') : h('span.pill', 'new')), () => this.daily()),
        this.btn('Map Workshop', () => this.workshop()),
        s.listReplays().length ? this.btn('Replays', () => this.replays()) : null,
        this.btn('Codex', () => this.codex()),
        this.btn(h('span', 'Records ', h('span.pill', `${s.data.feats.length}/${FEATS.length}`)), () => this.records()),
        this.btn('Settings', () => this.settings(() => this.title())),
        this.btn('How to Play', () => this.help(() => this.title())),
      ),
      h('div.footer', `Played ${fmtTime(s.data.playSeconds)}  ·  v1.3  ·  `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.credits(); } }, 'Credits')),
    );
    a.onTitle();
    this.mount('title', node, { dim: false });
  }

  credits() {
    this.mount('credits', h('div.panel.narrow',
      h('h2', 'Credits'),
      h('p', 'Cinderhold — design, code, models, sound and music by integral0909.'),
      h('p', 'Every model is built from primitives in code, every sound is synthesised live with the Web Audio API, and the icons are hand-written SVG. Rendering by Three.js.'),
      h('p.muted', 'Released under the MIT license.'),
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  // ---------------------------------------------------------------- level select

  levels() {
    const s = this.save;
    const grid = h('div.level-grid');
    LEVELS.forEach((level, idx) => {
      const rec = s.level(level.id);
      const unlocked = s.isUnlocked(idx);
      const theme = THEMES[level.theme];
      const card = h('button.level-card', {
        disabled: !unlocked,
        style: { '--swatch': hex(theme.ground), '--swatch2': hex(theme.road), '--sky': hex(theme.sky) },
        onclick: () => {
          this.click();
          this.briefing(idx);
        },
      },
      h('div.level-num', String(idx + 1)),
      h('div.level-info',
        h('div.level-name', unlocked ? level.name : 'Locked'),
        h('div.level-meta', `${THEME_NAMES[level.theme]} · ${level.waves} waves${level.bosses ? ' · boss' : ''}`),
      ),
      h('div.level-stars', [0, 1, 2].map((i) => icon('star', `icon star ${i < rec.stars ? 'on' : 'off'}`)),
        rec.heroic ? h('span.laurel', { title: 'Beaten on Heroic' }, '✦') : null),
      );
      grid.appendChild(card);
    });
    this.mount('levels', h('div.panel.wide',
      h('div.panel-head', h('h2', 'Campaign'), h('div.pill', icon('star', 'icon tiny'), ` ${s.starsEarned()} / ${LEVELS.length * 3}`)),
      grid,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  difficultyPicker() {
    const s = this.save;
    const wrap = h('div.seg');
    const render = () => {
      clear(wrap);
      for (const [id, d] of Object.entries(DIFFICULTY)) {
        wrap.appendChild(h(`button.seg-btn${s.data.difficulty === id ? '.on' : ''}`, {
          onclick: () => {
            this.click();
            s.data.difficulty = id;
            s.persist();
            render();
          },
        }, d.label));
      }
    };
    render();
    return wrap;
  }

  briefing(idx) {
    const level = LEVELS[idx];
    const rec = this.save.level(level.id);
    const newTowers = level.towers.filter((t) => idx === 0 || !LEVELS[idx - 1].towers.includes(t));
    const newEnemies = level.pool.map((p) => p.type).filter((t) => idx === 0 || !LEVELS[idx - 1].pool.some((p) => p.type === t));
    const bosses = [...new Set((level.bosses || []).map((b) => b.type))];
    this.mount('briefing', h('div.panel.narrow',
      h('div.kicker', `Level ${idx + 1}`),
      h('h2', level.name),
      h('p.intro', level.intro),
      newTowers.length ? h('div.chips', h('span.chip-label', 'New towers'), newTowers.map((t) => h('span.chip', icon(t, 'icon small'), TOWERS[t].name))) : null,
      newEnemies.length ? h('div.chips', h('span.chip-label', 'New enemies'), newEnemies.map((t) => h('span.chip', icon(t, 'icon small'), ENEMIES[t].name))) : null,
      bosses.length ? h('div.chips', h('span.chip-label.boss', 'Boss'), bosses.map((t) => h('span.chip.boss', icon(t, 'icon small'), ENEMIES[t].name))) : null,
      h('div.brief-stats', `${level.waves} waves · ${level.startGold} starting gold · ${this.save.data.perks.length} perks active`),
      h('div.label', 'Difficulty'),
      this.difficultyPicker(),
      rec.stars
        ? h('div.muted', `Best: ${rec.stars} star${rec.stars > 1 ? 's' : ''}${rec.heroic ? ', Heroic cleared' : ''}`
          + `${rec.bestTime ? ` · fastest win ${fmtTime(rec.bestTime)}` : ''}`)
        : null,
      h('div.row',
        this.btn('Back', () => this.levels()),
        this.btn('Defend', () => this.ctx.actions.startLevel(idx, this.save.data.difficulty, false), 'primary'),
      ),
    ));
  }

  endless() {
    const s = this.save;
    if (!s.endlessUnlocked()) {
      this.ctx.audio.play('error');
      return;
    }
    const grid = h('div.level-grid');
    LEVELS.forEach((level, idx) => {
      if (!s.isUnlocked(idx) || !s.level(level.id).stars) return;
      const best = s.level(level.id).bestEndless || 0;
      grid.appendChild(h('button.level-card', {
        style: { '--swatch': hex(THEMES[level.theme].ground), '--swatch2': hex(THEMES[level.theme].road) },
        onclick: () => {
          this.click();
          this.ctx.actions.startLevel(idx, 'normal', true);
        },
      },
      h('div.level-num', String(idx + 1)),
      h('div.level-info', h('div.level-name', level.name), h('div.level-meta', best ? `Best: wave ${best}` : 'Not attempted')),
      ));
    });
    // Top runs across every map.
    const runs = LEVELS.flatMap((l) => s.endlessRuns(l.id).map((r) => ({ ...r, map: l.name })))
      .sort((a, b) => b.wave - a.wave || b.kills - a.kills)
      .slice(0, 5);
    const board = runs.length
      ? h('table.stats.records.board',
        h('tr', h('th', '#'), h('th', 'Map'), h('th', 'Wave'), h('th', 'Kills'), h('th', 'When')),
        runs.map((r, i) => h('tr',
          h('td', String(i + 1)), h('td', r.map), h('td', String(r.wave)), h('td', r.kills.toLocaleString()),
          h('td', new Date(r.date).toLocaleDateString()),
        )))
      : null;
    this.mount('endless', h('div.panel.wide',
      h('div.panel-head', h('h2', 'Endless Siege')),
      h('p.muted', 'Every tower, every enemy, no end. Waves grow tougher forever; how long can the Hold stand? Perks apply.'),
      grid,
      board ? h('h3.help-sub', 'Longest stands') : null,
      board,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  // ---------------------------------------------------------------- daily trial

  daily() {
    const s = this.save;
    const today = dateKey();
    const trial = dailyTrial(today);
    const res = s.dailyResult(today);
    const run = streak(s.data.daily, today);
    let result;
    if (!res) result = 'Not attempted yet today.';
    else if (res.won) result = `Won with ${res.lives} of ${res.maxLives} lives left${res.attempts > 1 ? ` (${res.attempts} attempts)` : ''}.`;
    else result = `Best so far: ${res.wavesCleared} of ${trial.level.waves} waves (${res.attempts} attempt${res.attempts > 1 ? 's' : ''}).`;
    this.mount('daily', h('div.panel.narrow',
      h('div.kicker', today),
      h('h2', 'Daily Trial'),
      h('p.intro', `${trial.level.name} · ${THEME_NAMES[trial.level.theme]} · ${trial.level.waves} waves`),
      h('div.mod-list', trial.modifiers.map((id) => {
        const m = modifierById(id);
        return h('div.mod-card', h('div.mod-name', m.name), h('div.mod-blurb', m.blurb));
      })),
      h('p.muted', 'Every player gets the same trial today. All towers are available; your perks and chosen difficulty apply.'),
      h('div.brief-stats', result),
      h('div.brief-stats', run ? `Current streak: ${run} day${run > 1 ? 's' : ''}` : 'Win today to start a streak.'),
      this.dailyHistory(today),
      h('div.label', 'Difficulty'),
      this.difficultyPicker(),
      h('div.row',
        this.btn('Back', () => this.title()),
        this.btn(res?.won ? 'Play again' : 'Take the trial', () => this.ctx.actions.playDaily(), 'primary'),
      ),
    ));
  }

  // The last two weeks of trials: won, tried, or missed.
  dailyHistory(today) {
    const days = [];
    const d = new Date(`${today}T12:00:00`);
    for (let i = 13; i >= 0; i--) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      const k = dateKey(day);
      const r = this.save.dailyResult(k);
      const state = r?.won ? 'won' : r ? 'tried' : 'missed';
      const label = day.toLocaleDateString(undefined, { weekday: 'narrow' });
      const title = `${k}: ${r?.won ? `won, ${r.lives}/${r.maxLives} lives` : r ? `reached wave ${r.wavesCleared}` : 'not played'}`;
      days.push(h(`div.day.${state}${k === today ? '.today' : ''}`, { title }, label));
    }
    return h('div.day-strip', days);
  }

  // ---------------------------------------------------------------- map workshop

  workshop(message = '') {
    const s = this.save;
    const maps = s.listMaps();
    const status = h('div.muted', message);
    const code = h('input.code-input', { type: 'text', placeholder: 'Paste a map code (CH1.…)', spellcheck: false });
    const list = h('div.map-list');
    if (!maps.length) list.appendChild(h('p.muted', 'No maps yet. Start a new one, or paste a code someone shared with you.'));
    for (const m of maps) {
      const tier = TIERS.find((t) => t.id === m.tier)?.name || '';
      list.appendChild(h('div.map-card',
        mapThumbnail(m),
        h('div.map-info',
          h('div.level-name', m.name),
          h('div.level-meta', `${THEME_NAMES[m.theme]} · ${tier} · ${m.waves} waves${m.wins ? ` · won ${m.wins}×` : ''}`),
          h('div.map-actions',
            this.btn('Play', () => this.ctx.actions.playMap(m.id), 'small.primary'),
            this.btn('Edit', () => this.editor(m), 'small'),
            this.btn('Delete', () => this.confirmDelete(m), 'small.danger'),
          ),
        ),
      ));
    }
    this.mount('workshop', h('div.panel.wide',
      h('div.panel-head', h('h2', 'Map Workshop'), h('div.row.tight',
        this.btn('Random map', () => this.editor(randomMap(Date.now() & 0x7fffffff))),
        this.btn('New map', () => this.editor(blankMap()), 'primary'),
      )),
      h('p.muted', 'Design your own battlefields, play them with any difficulty and perks, and share them as short codes. Custom maps never affect campaign stars.'),
      list,
      h('div.import-row', code, this.btn('Import', () => {
        try {
          const m = decodeMap(code.value);
          const id = s.saveMap(m);
          this.workshop(`Imported “${s.getMap(id).name}”.`);
        } catch (e) {
          this.ctx.audio.play('error');
          status.textContent = e.message;
        }
      })),
      status,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  confirmDelete(m) {
    this.mount('delete-map', h('div.panel.narrow',
      h('h2', 'Delete map?'),
      h('p', `“${m.name}” will be gone for good. Copy its share code first if you might want it back.`),
      h('div.row',
        this.btn('Cancel', () => this.workshop()),
        this.btn('Delete', () => {
          this.save.deleteMap(m.id);
          this.workshop();
        }, 'danger'),
      ),
    ));
  }

  editor(map) {
    const status = h('div.muted');
    const playBtn = this.btn('Save & play', () => {
      const id = this.save.saveMap(ed.map);
      this.ctx.actions.playMap(id);
    }, 'primary');
    const ed = new MapEditor(map, {
      onChange: (_, v) => {
        playBtn.disabled = !v.ok;
      },
    });
    const save = () => {
      ed.map.id = this.save.saveMap(ed.map);
      status.textContent = `Saved “${ed.map.name}”.`;
    };
    this.mount('editor', h('div.panel.wide.editor-panel',
      h('div.panel-head', h('h2', map.id ? 'Edit map' : 'New map')),
      ed.controls(),
      h('div.editor-body',
        ed.toolbar,
        h('div.editor-canvas-wrap', ed.canvas),
      ),
      h('p.muted.editor-help', 'Left-drag paints, right-drag erases to ground, 1–7 pick a tile, Ctrl+Z undoes. Dashed lines show the path enemies will take.'),
      ed.status,
      status,
      h('div.row',
        this.btn('Back', () => this.workshop()),
        this.btn('Clear', () => ed.clearAll(), 'danger'),
        this.btn('Copy code', () => {
          const text = encodeMap(ed.map);
          navigator.clipboard?.writeText(text).then(
            () => (status.textContent = 'Share code copied.'),
            () => (status.textContent = text),
          );
        }),
        this.btn('Save', save),
        playBtn,
      ),
    ), { cleanup: () => ed.destroy() });
    ed.refresh();
  }

  // ---------------------------------------------------------------- perks

  perks() {
    const s = this.save;
    const list = h('div.perk-list');
    const head = h('div.pill');
    const render = () => {
      fill(head,icon('star', 'icon tiny'), ` ${s.starsFree()} free of ${s.starsEarned()}`);
      clear(list);
      for (const p of PERKS) {
        const owned = s.hasPerk(p.id);
        const afford = s.starsFree() >= p.cost;
        list.appendChild(h(`button.perk${owned ? '.owned' : ''}${!owned && !afford ? '.poor' : ''}`, {
          onclick: () => {
            if (s.togglePerk(p.id)) {
              this.ctx.audio.unlock();
              this.ctx.audio.play(owned ? 'sell' : 'upgrade');
            } else this.ctx.audio.play('error');
            render();
          },
        },
        h('div.perk-cost', String(p.cost), icon('star', 'icon tiny')),
        h('div.perk-body', h('div.perk-name', p.name), h('div.perk-blurb', p.blurb)),
        h('div.perk-state', owned ? 'Active' : afford ? 'Adopt' : '—'),
        ));
      }
    };
    render();
    this.mount('perks', h('div.panel.wide',
      h('div.panel-head', h('h2', 'War Council'), head),
      h('p.muted', 'Spend stars on lasting advantages. Stars are never lost: click an active perk to refund it.'),
      list,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  // ---------------------------------------------------------------- codex

  codex(tab = 'towers') {
    const seen = new Set(this.save.data.seen);
    const body = h('div.codex');
    if (tab === 'towers') {
      for (const id of TOWER_ORDER) {
        const t = TOWERS[id];
        // One column per tier; the Targets row is the same for all tiers.
        const tiers = [0, 1, 2].map((i) => statLines(id, towerTier(id, i)).filter(([k]) => k !== 'Targets'));
        const table = h('table.tier-table',
          h('tr', h('th', ''), ['I', 'II', 'III'].map((n) => h('th', n))),
          h('tr', h('td', 'Cost'), t.tiers.map((x) => h('td', String(x.cost)))),
          tiers[0].map(([k], r) => h('tr', h('td', k), tiers.map((rows) => h('td', rows[r][1])))),
        );
        body.appendChild(h('div.codex-card',
          icon(id, 'icon big'),
          h('div',
            h('div.codex-name', t.name),
            h('div.codex-blurb', t.blurb),
            h('div.codex-stats',
              t.kind === 'aura'
                ? 'Support · boosts nearby towers'
                : `${t.hitsAir ? (t.hitsGround ? 'Ground & air' : 'Air') : 'Ground only'} · ${t.damageType === 'energy' ? 'Ignores armor' : 'Physical'}`,
            ),
            table,
          ),
        ));
      }
    } else {
      for (const id of ENEMY_ORDER) {
        const e = ENEMIES[id];
        const known = seen.has(id);
        body.appendChild(h(`div.codex-card${known ? '' : '.unknown'}`,
          icon(id, 'icon big'),
          h('div',
            h('div.codex-name', known ? e.name : '???'),
            h('div.codex-blurb', known ? e.blurb : 'Not yet encountered.'),
            known ? h('div.codex-stats',
              `Health ${e.hp}${e.shield ? ` + ${e.shield} shield` : ''}${e.armor ? ` · Armor ${e.armor}` : ''} · Speed ${e.speed} · `,
              `Bounty ${e.bounty} · Costs ${e.lives} ${e.lives > 1 ? 'lives' : 'life'}${e.air ? ' · Flying' : ''}`,
              ` · Slain ${(this.save.data.totals.byType?.[id] || 0).toLocaleString()}`,
            ) : null,
          ),
        ));
      }
    }
    const tabs = h('div.seg',
      h(`button.seg-btn${tab === 'towers' ? '.on' : ''}`, { onclick: () => { this.click(); this.codex('towers'); } }, 'Towers'),
      h(`button.seg-btn${tab === 'enemies' ? '.on' : ''}`, { onclick: () => { this.click(); this.codex('enemies'); } }, 'Enemies'),
    );
    this.mount('codex', h('div.panel.wide', h('div.panel-head', h('h2', 'Codex'), tabs), body, h('div.row', this.btn('Back', () => this.title()))));
  }

  // ---------------------------------------------------------------- records

  records() {
    const s = this.save;
    const t = s.data.totals;
    const bestEndless = Math.max(0, ...LEVELS.map((l) => s.level(l.id).bestEndless || 0));
    const heroic = LEVELS.filter((l) => s.level(l.id).heroic).length;
    const lines = [
      ['Time played', fmtTime(s.data.playSeconds)],
      ['Battles fought', String(t.battles)],
      ['Battles won', String(t.wins)],
      ['Enemies slain', t.kills.toLocaleString()],
      ['Towers built', t.built.toLocaleString()],
      ['Stars', `${s.starsEarned()} / ${LEVELS.length * 3}`],
      ['Heroic victories', `${heroic} / ${LEVELS.length}`],
      ['Best endless wave', bestEndless ? String(bestEndless) : '—'],
    ];
    const feats = h('div.feat-list', FEATS.map((f) => {
      const got = s.hasFeat(f.id);
      return h(`div.feat-item${got ? '.got' : ''}`,
        icon('star', `icon star ${got ? 'on' : 'off'}`),
        h('div', h('div.feat-name', f.name), h('div.feat-blurb', f.blurb)),
      );
    }));
    const byTower = t.byTower || {};
    const towerRows = TOWER_ORDER.filter((id) => byTower[id]?.built).map((id) => {
      const v = byTower[id];
      return h('tr', h('td', icon(id, 'icon small'), ` ${TOWERS[id].name}`), h('td', v.built.toLocaleString()),
        h('td', v.kills.toLocaleString()), h('td', v.damage.toLocaleString()));
    });
    this.mount('records', h('div.panel.wide',
      h('div.panel-head', h('h2', 'Records'), h('div.pill', `${s.data.feats.length} / ${FEATS.length} feats`)),
      h('table.stats.records', lines.map(([k, v]) => h('tr', h('td', k), h('td', v)))),
      towerRows.length
        ? h('table.stats.records.tower-stats',
          h('tr', h('th', 'Tower'), h('th', 'Built'), h('th', 'Kills'), h('th', 'Damage')),
          towerRows)
        : null,
      feats,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  // ---------------------------------------------------------------- settings & help

  settings(back) {
    const s = this.save.settings;
    const apply = () => {
      this.save.persist();
      this.ctx.actions.applySettings();
    };
    const slider = (label, key) => h('label.setting', h('span', label),
      h('input', {
        type: 'range', min: 0, max: 1, step: 0.05, value: s[key],
        oninput: (e) => {
          s[key] = Number(e.target.value);
          apply();
        },
      }));
    const quality = h('div.seg');
    const renderQ = () => {
      clear(quality);
      for (const q of ['low', 'medium', 'high']) {
        quality.appendChild(h(`button.seg-btn${s.quality === q ? '.on' : ''}`, {
          onclick: () => {
            this.click();
            s.quality = q;
            apply();
            renderQ();
          },
        }, q[0].toUpperCase() + q.slice(1)));
      }
    };
    renderQ();
    const check = (label, key) => h('label.setting.check', h('span', label), h('input', {
      type: 'checkbox', checked: s[key],
      onchange: (e) => {
        s[key] = e.target.checked;
        apply();
      },
    }));
    this.mount('settings', h('div.panel.narrow',
      h('h2', 'Settings'),
      slider('Master volume', 'master'),
      slider('Music', 'music'),
      slider('Effects', 'sfx'),
      check('Mute all (M)', 'muted'),
      h('div.setting', h('span', 'Graphics'), quality),
      check('Reduce motion (no screen shake or flashes)', 'reduceMotion'),
      check('Colour-blind friendly signals (blue / orange)', 'colorblind'),
      check('Placement heatmap while building (H)', 'heatmap'),
      check('Hold between waves until I send the next one', 'planPause'),
      check('Show the minimap (N)', 'minimap'),
      check('Show frame rate', 'showFps'),
      h('div.row',
        this.btn('Transfer save', () => this.transfer(back)),
        this.btn('Reset progress', () => this.confirmReset(back), 'danger'),
        this.btn('Done', back, 'primary'),
      ),
    ));
  }

  transfer(back) {
    const box = h('textarea.save-box', { spellcheck: false, value: this.save.exportString() });
    const status = h('div.muted');
    this.mount('transfer', h('div.panel.narrow',
      h('h2', 'Transfer save'),
      h('p', 'Copy this text to keep a backup or to move your progress to another browser. Paste a save here and press Load to restore it.'),
      box,
      status,
      h('div.row',
        this.btn('Copy', () => {
          box.select();
          navigator.clipboard?.writeText(box.value).then(
            () => (status.textContent = 'Copied.'),
            () => (status.textContent = 'Select the text and copy it manually.'),
          );
        }),
        this.btn('Load', () => {
          if (this.save.importString(box.value)) {
            this.ctx.actions.applySettings();
            status.textContent = 'Save loaded.';
          } else {
            this.ctx.audio.play('error');
            status.textContent = 'That does not look like a Cinderhold save.';
          }
        }),
        this.btn('Done', () => this.settings(back), 'primary'),
      ),
    ));
  }

  confirmReset(back) {
    this.mount('reset', h('div.panel.narrow',
      h('h2', 'Reset progress?'),
      h('p', 'This erases every star, perk and record. Settings are kept.'),
      h('div.row',
        this.btn('Cancel', () => this.settings(back)),
        this.btn('Erase everything', () => {
          this.save.reset();
          this.title();
        }, 'danger'),
      ),
    ));
  }

  help(back) {
    const row = (k, v) => h('tr', h('td.key', k), h('td', v));
    this.mount('help', h('div.panel.narrow',
      h('h2', 'How to Play'),
      h('p', 'Enemies march along the road from the burning portals to your Hold. Every one that gets through costs lives; lose them all and the Hold falls. Build towers on open ground beside the road, earn gold from kills and spend it on more towers and upgrades.'),
      h('table.keys',
        row('Left click', 'Build / select a tower'),
        row('1 – 6', 'Choose a tower to build'),
        row('Shift + click', 'Keep building the same tower'),
        row('Right drag', 'Rotate the camera'),
        row('Wheel / pinch', 'Zoom'),
        row('Middle drag, WASD, arrows', 'Pan'),
        row('Q / E / Z', 'Meteor (then click a spot) / Frost Nova / War Chest'),
        row('C or Home', 'Reset the camera'),
        row('R', 'Show every tower\'s range'),
        row('H', 'Placement heatmap while building'),
        row('G', 'Toggle fullscreen'),
        row('N', 'Show or hide the minimap'),
        row('K', 'Damage meter'),
        row('O', 'Photo mode (Enter saves a picture)'),
        row('Space', 'Send the next wave (early waves pay a bonus)'),
        row('U / X / T', 'Upgrade / sell / change targeting of the selected tower'),
        row('F', 'Cycle game speed'),
        row('Esc or P', 'Cancel / pause'),
      ),
      h('h3.help-sub', 'Gamepad'),
      h('table.keys',
        row('Left stick / D-pad', 'Move the cursor (menus: move focus)'),
        row('A · B', 'Build or select · cancel or back'),
        row('LB · RB', 'Previous · next tower'),
        row('X · LT', 'Upgrade · sell'),
        row('Y · RT', 'Send the wave · game speed'),
        row('Right stick', 'Orbit and zoom the camera'),
        row('Start · Back', 'Pause · show ranges'),
        row('L3 · R3', 'Meteor at the cursor · Frost Nova'),
      ),
      h('p.muted', 'Tips: cannons and mortars cannot hit fliers. Armor blunts darts and shells, but fire and lightning ignore it. Kill Menders first. Rime Spires make everything else better.'),
      h('div.row', this.btn('Back', back, 'primary')),
    ));
  }

  // ---------------------------------------------------------------- in-battle

  pause(game) {
    const a = this.ctx.actions;
    this.mount('pause', h('div.panel.narrow',
      h('h2', 'Paused'),
      h('p.muted', `${game.level.name} · ${game.endless ? 'Endless' : DIFFICULTY[game.difficulty].label} · wave ${game.waveIndex}${game.endless ? '' : ` of ${game.totalWaves}`}`),
      h('div.menu',
        this.btn('Resume', () => a.resume(), 'primary'),
        this.btn('Restart battle', () => a.restart()),
        this.btn('Settings', () => this.settings(() => this.pause(game))),
        document.fullscreenEnabled ? this.btn('Toggle fullscreen (G)', () => toggleFullscreen()) : null,
        this.btn('How to Play', () => this.help(() => this.pause(game))),
        this.btn('Abandon battle', () => a.quitToMenu(this.backTarget(game))),
      ),
    ));
  }

  // ---------------------------------------------------------------- replays

  replays() {
    const s = this.save;
    const list = h('div.replay-list');
    const items = s.listReplays();
    if (!items.length) list.appendChild(h('p.muted', 'Finished battles are saved here so you can watch them again.'));
    for (const r of items) {
      const res = r.result || {};
      const when = new Date(r.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      const outcome = res.status === 'won' ? `Won · ${res.lives}/${res.maxLives} lives` : `Fell at wave ${res.waves}`;
      list.appendChild(h(`div.replay-item.${res.status === 'won' ? 'won' : 'lost'}`,
        h('div.replay-info',
          h('div.level-name', r.name),
          h('div.level-meta', `${when} · ${DIFFICULTY[r.difficulty]?.label || ''}${r.endless ? ' · Endless' : ''} · ${outcome} · ${fmtTime(res.time || 0)}`),
        ),
        this.btn('Watch', () => this.ctx.actions.watchReplay(r.id), 'small.primary'),
        this.btn('Delete', () => {
          s.deleteReplay(r.id);
          this.replays();
        }, 'small.danger'),
      ));
    }
    this.mount('replays', h('div.panel.wide',
      h('div.panel-head', h('h2', 'Replays')),
      h('p.muted', 'The last twelve finished battles. Replays are rebuilt from your commands, so they play out exactly as the battle did. Speed (F) and the camera work while watching; click a tower to inspect it.'),
      list,
      h('div.row', this.btn('Back', () => this.title())),
    ));
  }

  backTarget(game) {
    if (game.level.id.startsWith('custom:')) return 'workshop';
    if (game.level.id.startsWith('daily:')) return 'daily';
    return game.endless ? 'endless' : 'levels';
  }

  result(game, outcome, { replay = false, replayId = null } = {}) {
    const a = this.ctx.actions;
    // Only campaign battles have a next level or a finale.
    const campaign = LEVELS[game.levelIdx] === game.level;
    const idx = game.levelIdx;
    const won = game.status === 'won';
    const st = game.stats;
    const stars = h('div.result-stars');
    if (won) {
      for (let i = 0; i < 3; i++) {
        const img = icon('star', `icon star big ${i < game.stars() ? 'on' : 'off'}`);
        img.style.animationDelay = `${0.25 + i * 0.25}s`;
        stars.appendChild(img);
      }
    }
    const next = campaign && idx + 1 < LEVELS.length && this.save.isUnlocked(idx + 1) && !game.endless;
    const lines = [
      ['Waves cleared', game.endless ? String(st.wavesCleared) : `${st.wavesCleared} / ${game.totalWaves}`],
      ['Enemies slain', String(st.kills)],
      ['Leaks', String(st.leaks)],
      ['Gold earned', String(st.goldEarned)],
      ['Towers built', String(st.built)],
      ['Battle time', fmtTime(game.time)],
    ];
    let title;
    if (game.endless) title = 'The Hold has fallen';
    else title = won ? (campaign && game.levelIdx === LEVELS.length - 1 ? 'The ash tide is broken' : 'Victory') : 'The Hold has fallen';
    const notes = [];
    if (outcome?.newStars > 0) notes.push(`+${outcome.newStars} star${outcome.newStars > 1 ? 's' : ''} for the War Council`);
    if (outcome?.firstWin && next) notes.push(`${LEVELS[idx + 1].name} unlocked`);
    if (outcome?.firstWin && idx === 2) notes.push('Endless Siege unlocked');
    if (outcome?.heroic) notes.push('Heroic victory recorded');
    if (outcome?.newBest) notes.push('New endless record!');
    if (outcome?.dailyStreak) notes.push(`Daily Trial won · streak ${outcome.dailyStreak}`);
    // The tower that did the most damage this battle.
    const mvp = game.towers.reduce((best, t) => (!best || t.damage > best.damage ? t : best), null);
    this.mount('result', h(`div.panel.narrow.result.${won ? 'won' : 'lost'}`,
      h('h2', title),
      stars,
      won && campaign && game.levelIdx === LEVELS.length - 1 && !game.endless
        ? h('p.intro', 'The furnace at the heart of the ash has gone cold. The valley will remember who held the line.')
        : null,
      notes.length ? h('div.notes', notes.map((n) => h('div', n))) : null,
      h('table.stats', lines.map(([k, v]) => h('tr', h('td', k), h('td', v)))),
      battleChart(game.timeline),
      mvp && mvp.damage > 0
        ? h('div.mvp', icon(mvp.type, 'icon'), h('span', 'Best tower: ', h('b', `${TOWERS[mvp.type].name} ${'I'.repeat(mvp.tier + 1)}`),
          ` · ${mvp.kills} kills · ${Math.round(mvp.damage).toLocaleString()} damage`))
        : null,
      replay
        ? h('div.row',
          this.btn('Replays', () => a.quitToMenu('replays')),
          this.btn('Watch again', () => a.watchReplay(replayId), 'primary'),
        )
        : h('div.row',
          replayId ? this.btn('Watch replay', () => a.watchReplay(replayId)) : null,
          this.btn(game.endless ? 'Back' : 'Map', () => a.quitToMenu(this.backTarget(game))),
        this.btn(won ? 'Replay' : 'Try again', () => a.restart(), won && next ? '' : 'primary'),
        won && next ? this.btn('Next battle', () => this.briefing(idx + 1), 'primary') : null,
      ),
    ));
  }
}
