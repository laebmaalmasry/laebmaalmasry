'use strict';
// روح المغامرة (Spirit of Adventure) - shared world engine, phase 1.
// Server-authoritative: clients send intents, the engine returns events.
// Map: 2D side-scroller grid. x = tile; ground everywhere except water gaps.
// A jump of power p clears exactly p tiles (lands p+1 tiles away), so a
// w-wide water gap needs power >= w; less lands in the water.

const AREAS = {
  town: {
    nameKey: 'areaTown',
    width: 200,
    spawn: 5,
    gaps: [
      { from: 20, to: 22 },   // 3 wide
      { from: 45, to: 49 },   // 5
      { from: 80, to: 80 },   // 1
      { from: 100, to: 103 }, // 4
      { from: 120, to: 121 }, // 2
      { from: 150, to: 155 }, // 6
      { from: 170, to: 177 }, // 8
    ],
    places: [
      { x: 10, key: 'placeStore', enter: null },
      { x: 60, key: 'placeSquare', enter: 'square' },
      { x: 140, key: 'placeCafe', enter: null },
    ],
  },
  square: {
    nameKey: 'areaSquare',
    width: 20,
    spawn: 2,
    gaps: [],
    places: [
      { x: 0, key: 'placeExit', enter: 'town', exitTo: 60 },
    ],
  },
};

const VALID_POWERS = [1, 2, 3, 4, 5, 6, 8];

function groundAt(area, x) {
  const a = AREAS[area];
  if (!a || x < 0 || x >= a.width) return null; // out of bounds
  for (const g of a.gaps) if (x >= g.from && x <= g.to) return false;
  return true;
}
function placeAt(area, x) {
  const a = AREAS[area];
  return (a && a.places.find(p => p.x === x)) || null;
}

class WorldEngine {
  constructor() {
    this.players = new Map(); // id -> { id, name, lang, area, x, facing, power }
  }

  enter(id, name, lang) {
    const p = { id, name, lang: lang === 'en' ? 'en' : 'ar', area: 'town', x: AREAS.town.spawn, facing: 'right', power: 1 };
    this.players.set(id, p);
    return [
      { to: id, kind: 'entered', area: AREAS.town.nameKey, x: p.x },
      { to: 'area', area: p.area, except: id, kind: 'player_entered', name: p.name },
    ];
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return [];
    this.players.delete(id);
    return [{ to: 'area', area: p.area, kind: 'player_left', name: p.name }];
  }

  get(id) { return this.players.get(id) || null; }

  onlineByLang() {
    const c = { ar: 0, en: 0 };
    for (const p of this.players.values()) c[p.lang]++;
    return c;
  }

  _arriveEvents(p, events) {
    const pl = placeAt(p.area, p.x);
    if (pl) events.push({ to: p.id, kind: 'at_place', place: pl.key, canEnter: !!pl.enter });
  }

  move(id, dir) {
    const p = this.players.get(id);
    if (!p || (dir !== 'left' && dir !== 'right')) return [];
    p.facing = dir;
    const nx = p.x + (dir === 'right' ? 1 : -1);
    const g = groundAt(p.area, nx);
    if (g === null) return [{ to: id, kind: 'blocked_edge' }];
    if (g === false) {
      // walked into water: splash, stay on the bank you came from
      return [
        { to: id, kind: 'splash', x: p.x },
        { to: 'area', area: p.area, except: id, kind: 'player_move', name: p.name, x: p.x, moveKind: 'splash' },
      ];
    }
    p.x = nx;
    const events = [
      { to: id, kind: 'moved', x: p.x, dir },
      { to: 'area', area: p.area, except: id, kind: 'player_move', name: p.name, x: p.x, moveKind: 'walk' },
    ];
    this._arriveEvents(p, events);
    return events;
  }

  setPower(id, n) {
    const p = this.players.get(id);
    if (!p || !VALID_POWERS.includes(n)) return [];
    p.power = n;
    return [{ to: id, kind: 'power', power: n }];
  }

  jump(id) {
    const p = this.players.get(id);
    if (!p) return [];
    const from = p.x;
    const target = from + (p.facing === 'right' ? p.power + 1 : -(p.power + 1));
    const g = groundAt(p.area, target);
    if (g === null || g === false) {
      // landed in water or off the map: splash, back to where you jumped from
      return [
        { to: id, kind: 'jump_splash', x: from },
        { to: 'area', area: p.area, except: id, kind: 'player_move', name: p.name, x: from, moveKind: 'splash' },
      ];
    }
    p.x = target;
    const events = [
      { to: id, kind: 'jumped', from, x: p.x, power: p.power },
      { to: 'area', area: p.area, except: id, kind: 'player_move', name: p.name, x: p.x, moveKind: 'jump' },
    ];
    this._arriveEvents(p, events);
    return events;
  }

  explore(id, dir) {
    const p = this.players.get(id);
    if (!p || (dir !== 'left' && dir !== 'right')) return [];
    const step = dir === 'right' ? 1 : -1;
    const next = groundAt(p.area, p.x + step);
    if (next === null) return [{ to: id, kind: 'explore_edge' }];
    let n = 0;
    if (next === false) {
      let x = p.x + step;
      while (groundAt(p.area, x) === false) { n++; x += step; }
      return [{ to: id, kind: 'explore_gap', steps: n }];
    }
    let x = p.x + step;
    while (groundAt(p.area, x) === true) { n++; x += step; }
    return [{ to: id, kind: 'explore_ground', steps: n }];
  }

  where(id) {
    const p = this.players.get(id);
    if (!p) return [];
    const pl = placeAt(p.area, p.x);
    return [{ to: id, kind: 'where', area: AREAS[p.area].nameKey, place: pl ? pl.key : null, x: p.x }];
  }

  enterPlace(id) {
    const p = this.players.get(id);
    if (!p) return [];
    const pl = placeAt(p.area, p.x);
    if (!pl || !pl.enter) return [{ to: id, kind: 'nothing_to_enter' }];
    const target = pl.enter;
    const events = [{ to: 'area', area: p.area, except: id, kind: 'player_left', name: p.name }];
    p.area = target;
    p.x = pl.exitTo != null ? pl.exitTo : AREAS[target].spawn;
    p.facing = 'right';
    events.push({ to: id, kind: 'entered_place', area: AREAS[target].nameKey, place: pl.key, x: p.x });
    events.push({ to: 'area', area: target, except: id, kind: 'player_entered', name: p.name });
    return events;
  }
}

module.exports = { WorldEngine, AREAS, VALID_POWERS, groundAt, placeAt };
