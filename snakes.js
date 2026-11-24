'use strict';
// Snakes and Ladders engine: classic 100-square board, 2+ players, single die.
// Landing exactly on 100 wins; overshoot bounces back from 100.
// Board layout: the common standard arrangement (variant note: many layouts exist).
const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
const FINAL = 100;

class SnakesGame {
  constructor(playerNames, opts = {}) {
    if (!Array.isArray(playerNames) || playerNames.length < 2) throw new Error('need 2+ players');
    this.players = playerNames.slice();
    this.positions = this.players.map(() => 0); // 0 = off the board, before square 1
    this.turn = 0;
    this.winner = null;
    this.rng = opts.rng || Math.random;
    this.lastRoll = null;
  }
  state() {
    return {
      players: this.players, positions: this.positions.slice(), turn: this.turn,
      currentPlayer: this.players[this.turn], lastRoll: this.lastRoll, winner: this.winner,
    };
  }
  _die() { return 1 + Math.floor(this.rng() * 6); }
  addPlayer(name) {
    if (this.winner) throw new Error('game_over');
    this.players.push(name);
    this.positions.push(0);
  }
  roll(playerIdx) {
    if (this.winner) throw new Error('game_over');
    if (playerIdx !== this.turn) throw new Error('not_your_turn');
    const die = this._die();
    this.lastRoll = die;
    const from = this.positions[playerIdx];
    let to = from + die;
    let bounced = false;
    if (to > FINAL) { to = FINAL - (to - FINAL); bounced = true; }
    let event = null;
    if (to === FINAL) {
      this.positions[playerIdx] = to;
      event = 'win';
    } else if (LADDERS[to]) {
      this.positions[playerIdx] = LADDERS[to];
      event = 'ladder';
    } else if (SNAKES[to]) {
      this.positions[playerIdx] = SNAKES[to];
      event = 'snake';
    } else {
      this.positions[playerIdx] = to;
    }
    if (this.positions[playerIdx] === FINAL) this.winner = this.players[playerIdx];
    const result = {
      die, from, landed: to, at: this.positions[playerIdx],
      event, bounced, winner: this.winner,
    };
    if (!this.winner) this.turn = (this.turn + 1) % this.players.length;
    return result;
  }
}

module.exports = { SnakesGame, LADDERS, SNAKES, FINAL };
