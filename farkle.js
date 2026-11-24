'use strict';
// Farkle engine, Playroom (qcsalon.net) rule variant, server-authoritative.
// Source: https://www.qcsalon.net/en/farkle (official rules page).
// Scoring anchored on the published endpoints: 3-kind = face*10 (three 1s = 75),
// 4-kind = 100 + face*10 (110..160), 5-kind = 300 + face*20 (320..420),
// 6-kind = 600 + face*25 (625..750). Min bank 30; first bank (score 0) needs 50.
// Target 1000 (page lists 1000/1500/2000 as usual targets).

const COMBO_DEFS = [
  { id: 'two_triplets', points: 250, size: 6 },
  { id: 'full_house', points: 250, size: 6 },
  { id: 'three_pairs', points: 150, size: 6 },
  { id: 'large_straight', points: 200, size: 6 },
  { id: 'small_straight', points: 100, size: 5 },
  { id: 'six_kind', size: 6 },
  { id: 'five_kind', size: 5 },
  { id: 'four_kind', size: 4 },
  { id: 'three_kind', size: 3 },
  { id: 'single_1', points: 10, size: 1 },
  { id: 'single_5', points: 5, size: 1 },
];

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}
function ofAKindPoints(face, n) {
  if (n === 3) return face === 1 ? 75 : face * 10;
  if (n === 4) return 100 + face * 10;
  if (n === 5) return 300 + face * 20;
  if (n === 6) return 600 + face * 25;
  return 0;
}

// All valid single combos contained in `dice`, each as {id, points, dice:[values]}.
function combosIn(dice) {
  const c = counts(dice);
  const out = [];
  const take = (faces, id, points) => out.push({ id, points, dice: faces });
  // of-a-kind
  for (let f = 1; f <= 6; f++) {
    for (const n of [6, 5, 4, 3]) {
      if (c[f] >= n) take(Array(n).fill(f), n === 3 ? 'three_kind' : n === 4 ? 'four_kind' : n === 5 ? 'five_kind' : 'six_kind', ofAKindPoints(f, n));
    }
  }
  // large straight 1-6
  if ([1, 2, 3, 4, 5, 6].every(f => c[f] >= 1)) take([1, 2, 3, 4, 5, 6], 'large_straight', 200);
  // small straights
  for (const run of [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]]) {
    if (run.every(f => c[f] >= 1)) take(run.slice(), 'small_straight', 100);
  }
  // three pairs
  const pairs = [];
  for (let f = 1; f <= 6; f++) for (let k = 0; k < Math.floor(c[f] / 2); k++) pairs.push(f);
  if (pairs.length >= 3) take(pairs.slice(0, 3).flatMap(f => [f, f]), 'three_pairs', 150);
  // two triplets
  const trips = [];
  for (let f = 1; f <= 6; f++) if (c[f] >= 3) trips.push(f);
  if (trips.length >= 2) take(trips.slice(0, 2).flatMap(f => [f, f, f]), 'two_triplets', 250);
  // full house: four + pair (distinct faces)
  for (let f4 = 1; f4 <= 6; f4++) if (c[f4] >= 4) {
    for (let f2 = 1; f2 <= 6; f2++) if (f2 !== f4 && c[f2] >= 2) {
      take([f4, f4, f4, f4, f2, f2], 'full_house', 250);
    }
  }
  // singles
  if (c[1] >= 1) take([1], 'single_1', 10);
  if (c[5] >= 1) take([5], 'single_5', 5);
  return out;
}

// Score a player's selection (array of die values from ONE roll): every selected
// die must be used in at least one combo; returns {valid, points, comboIds}.
function scoreSelection(selected) {
  if (!selected.length) return { valid: false, points: 0, comboIds: [] };
  // recursive cover: find a set of combos whose dice multiset equals `selected` exactly.
  const target = counts(selected);
  const combos = combosIn(selected);
  let best = null;
  function search(idx, used, points, ids) {
    const remaining = selected.length - used.reduce((a, b) => a + b, 0);
    if (remaining === 0) {
      if (!best || points > best.points) best = { points, comboIds: ids.slice() };
      return;
    }
    if (idx >= combos.length) return;
    const combo = combos[idx];
    const cc = counts(combo.dice);
    let fits = true;
    for (let f = 1; f <= 6; f++) if (used[f] + cc[f] > target[f]) { fits = false; break; }
    if (fits) {
      const next = used.slice();
      for (let f = 1; f <= 6; f++) next[f] += cc[f];
      ids.push(combo.id);
      // same combo index: combos may repeat while dice remain (e.g. two single 1s)
      search(idx, next, points + combo.points, ids);
      ids.pop();
    }
    search(idx + 1, used, points, ids);
  }
  search(0, [0, 0, 0, 0, 0, 0, 0], 0, []);
  if (!best) return { valid: false, points: 0, comboIds: [] };
  return { valid: true, points: best.points, comboIds: best.comboIds };
}

function rollHasScore(dice) { return combosIn(dice).length > 0; }

class FarkleGame {
  constructor(playerNames, opts = {}) {
    if (!Array.isArray(playerNames) || playerNames.length < 2) throw new Error('need 2+ players');
    this.players = playerNames.slice();
    this.scores = this.players.map(() => 0);
    this.target = opts.target || 1000;
    this.minBank = opts.minBank == null ? 30 : opts.minBank;
    this.firstBankMin = opts.firstBankMin == null ? 50 : opts.firstBankMin;
    this.rng = opts.rng || Math.random;
    this.turn = 0;
    this.winner = null;
    this._startTurn();
  }
  _startTurn() {
    this.turnPoints = 0;
    this.diceLeft = 6;
    this.lastRoll = null;
    this.phase = 'must_roll'; // must_roll | deciding | over
    this.farkled = false;
  }
  _roll(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(1 + Math.floor(this.rng() * 6));
    return out;
  }
  currentPlayer() { return this.players[this.turn]; }
  state() {
    return {
      players: this.players, scores: this.scores.slice(), turn: this.turn,
      currentPlayer: this.currentPlayer(), turnPoints: this.turnPoints,
      diceLeft: this.diceLeft, lastRoll: this.lastRoll && this.lastRoll.slice(),
      phase: this.phase, farkled: this.farkled, winner: this.winner, target: this.target,
    };
  }
  roll(playerIdx) {
    this._expect(playerIdx, 'must_roll');
    const dice = this._roll(this.diceLeft);
    this.lastRoll = dice;
    if (!rollHasScore(dice)) {
      this.farkled = true;
      this.phase = 'over';
      return { farkled: true, dice };
    }
    this.phase = 'deciding';
    return { farkled: false, dice, combos: combosIn(dice) };
  }
  // selectedIndices: indexes into lastRoll to set aside as scoring dice.
  setAside(playerIdx, selectedIndices) {
    this._expect(playerIdx, 'deciding');
    const picked = selectedIndices.map(i => this.lastRoll[i]);
    if (picked.length !== selectedIndices.length || selectedIndices.some(i => i == null || i < 0 || i >= this.lastRoll.length)) {
      throw new Error('bad_selection');
    }
    if (new Set(selectedIndices).size !== selectedIndices.length) throw new Error('bad_selection');
    const r = scoreSelection(picked);
    if (!r.valid) throw new Error('not_scoring');
    this.turnPoints += r.points;
    this.diceLeft -= picked.length;
    this.lastRoll = null;
    if (this.diceLeft === 0) this.diceLeft = 6; // hot dice
    this.phase = 'must_roll';
    return { points: r.points, comboIds: r.comboIds, turnPoints: this.turnPoints, diceLeft: this.diceLeft };
  }
  canBank(playerIdx) {
    if (playerIdx !== this.turn || this.phase === 'over') return false;
    if (this.turnPoints < this.minBank) return false;
    if (this.scores[this.turn] === 0 && this.turnPoints < this.firstBankMin) return false;
    return true;
  }
  bank(playerIdx) {
    if (!this.canBank(playerIdx)) throw new Error('cannot_bank');
    this.scores[this.turn] += this.turnPoints;
    const banked = this.turnPoints;
    if (this.scores[this.turn] >= this.target) {
      this.winner = this.players[this.turn];
      this.phase = 'over';
      return { banked, winner: this.winner };
    }
    this._next();
    return { banked, winner: null };
  }
  endTurnAfterFarkle(playerIdx) {
    this._expect(playerIdx, 'over');
    if (!this.farkled) throw new Error('not_farkled');
    this._next();
  }
  addPlayer(name) {
    if (this.winner) throw new Error('game_over');
    this.players.push(name);
    this.scores.push(0);
  }
  _next() {
    this.turn = (this.turn + 1) % this.players.length;
    this._startTurn();
  }
  _expect(playerIdx, phase) {
    if (this.winner) throw new Error('game_over');
    if (playerIdx !== this.turn) throw new Error('not_your_turn');
    if (this.phase !== phase) throw new Error('bad_phase');
  }
}

// Best scoring subset of a roll: {indices, points}. Used by the server bot.
function bestSelection(dice) {
  let best = null;
  const n = dice.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const idx = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
    const r = scoreSelection(idx.map(i => dice[i]));
    if (r.valid && (!best || r.points > best.points)) best = { indices: idx, points: r.points };
  }
  return best;
}

module.exports = { FarkleGame, combosIn, scoreSelection, rollHasScore, ofAKindPoints, bestSelection };
