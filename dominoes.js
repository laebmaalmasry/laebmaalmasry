'use strict';
// Dominoes engine: double-6 set, draw and block variants, 2-4 players.
// Variant note: the exact GameBoard dominoes rules are not published; this is the
// classic draw/block game. Draw = pick from the boneyard until you can play or it
// is empty; block = pass when stuck. Round winner scores opponents' remaining pips
// (on a blocked round, minus their own). Game target default 100.

function buildSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles; // 28 tiles, [low, high]
}
function pips(tile) { return tile[0] + tile[1]; }

class DominoesGame {
  constructor(playerNames, opts = {}) {
    if (!Array.isArray(playerNames) || playerNames.length < 2 || playerNames.length > 4) {
      throw new Error('need 2-4 players');
    }
    this.players = playerNames.slice();
    this.variant = opts.variant === 'block' ? 'block' : 'draw';
    this.target = opts.target || 100;
    this.rng = opts.rng || Math.random;
    this.scores = this.players.map(() => 0);
    this.winner = null;
    this.roundNumber = 0;
    this._deal();
  }
  _shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  _deal() {
    this.roundNumber++;
    const tiles = this._shuffle(buildSet());
    const handSize = this.players.length === 2 ? 7 : 5;
    this.handSize = handSize;
    this.hands = this.players.map(() => tiles.splice(0, handSize));
    this.boneyard = tiles;
    this.board = []; // sequence of placed tiles; each placed as [left, right] oriented
    this.turn = this._firstPlayer();
    this.roundOver = false;
    this.roundResult = null;
    this.consecutivePasses = 0;
  }
  _firstPlayer() {
    // highest double, else highest pip tile
    let best = -1, bestKey = [-1, -1];
    this.hands.forEach((hand, idx) => {
      hand.forEach(t => {
        const key = t[0] === t[1] ? [2, t[0]] : [1, pips(t)];
        if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
          bestKey = key; best = idx;
        }
      });
    });
    return best;
  }
  ends() {
    if (this.board.length === 0) return null;
    return { left: this.board[0][0], right: this.board[this.board.length - 1][1] };
  }
  // which placements are legal for a hand tile: 'first' | 'left' | 'right' | 'both'
  placementsFor(tile) {
    if (this.board.length === 0) return ['first'];
    const { left, right } = this.ends();
    const sides = [];
    if (tile[0] === left || tile[1] === left) sides.push('left');
    if (tile[0] === right || tile[1] === right) sides.push('right');
    return sides.length === 2 && left === right ? ['both'] : sides;
  }
  playableIndices(playerIdx) {
    return this.hands[playerIdx]
      .map((t, i) => (this.placementsFor(t).length ? i : -1))
      .filter(i => i >= 0);
  }
  state() {
    return {
      players: this.players, scores: this.scores.slice(), turn: this.turn,
      currentPlayer: this.players[this.turn], variant: this.variant,
      board: this.board.map(t => t.slice()), ends: this.ends(),
      handCounts: this.hands.map(h => h.length), boneyard: this.boneyard.length,
      roundOver: this.roundOver, roundResult: this.roundResult, winner: this.winner,
      roundNumber: this.roundNumber, target: this.target,
    };
  }
  handOf(playerIdx) { return this.hands[playerIdx].map(t => t.slice()); }
  play(playerIdx, tileIdx, side) {
    this._expectTurn(playerIdx);
    if (this.roundOver) throw new Error('round_over');
    const hand = this.hands[playerIdx];
    const tile = hand[tileIdx];
    if (!tile) throw new Error('bad_tile');
    const sides = this.placementsFor(tile);
    if (!sides.length) throw new Error('not_playable');
    let use = side;
    if (sides.includes('both')) {
      if (side !== 'left' && side !== 'right') throw new Error('choose_side');
    } else if (sides.includes('first')) {
      use = 'first';
    } else if (!sides.includes(side)) {
      use = sides[0]; // only one legal side
    }
    hand.splice(tileIdx, 1);
    if (use === 'first') this.board.push([tile[0], tile[1]]);
    else if (use === 'left') {
      const e = this.ends().left;
      this.board.unshift(tile[0] === e ? [tile[1], tile[0]] : [tile[0], tile[1]]);
    } else {
      const e = this.ends().right;
      this.board.push(tile[0] === e ? [tile[0], tile[1]] : [tile[1], tile[0]]);
    }
    this.consecutivePasses = 0;
    if (hand.length === 0) return this._endRound(playerIdx, 'domino');
    this._advance();
    return { played: tile, side: use, roundOver: false };
  }
  // Draw variant: draw one tile; caller may then play or draw again.
  draw(playerIdx) {
    this._expectTurn(playerIdx);
    if (this.variant !== 'draw') throw new Error('block_variant');
    if (this.playableIndices(playerIdx).length > 0) throw new Error('has_playable');
    if (this.boneyard.length === 0) throw new Error('boneyard_empty');
    const tile = this.boneyard.pop();
    this.hands[playerIdx].push(tile);
    return { drew: tile.slice(), boneyard: this.boneyard.length };
  }
  pass(playerIdx) {
    this._expectTurn(playerIdx);
    if (this.playableIndices(playerIdx).length > 0) throw new Error('has_playable');
    if (this.variant === 'draw' && this.boneyard.length > 0) throw new Error('must_draw');
    this.consecutivePasses++;
    if (this.consecutivePasses >= this.players.length) {
      // blocked: lowest pip count wins the round
      const sums = this.hands.map(h => h.reduce((a, t) => a + pips(t), 0));
      let winIdx = 0;
      for (let i = 1; i < sums.length; i++) if (sums[i] < sums[winIdx]) winIdx = i;
      return this._endRound(winIdx, 'blocked');
    }
    this._advance();
    return { passed: true, roundOver: false };
  }
  _endRound(winnerIdx, how) {
    const sums = this.hands.map(h => h.reduce((a, t) => a + pips(t), 0));
    let gained = 0;
    for (let i = 0; i < sums.length; i++) if (i !== winnerIdx) gained += sums[i];
    if (how === 'blocked') gained -= sums[winnerIdx];
    this.scores[winnerIdx] += gained;
    this.roundOver = true;
    this.roundResult = { winner: this.players[winnerIdx], winnerIdx, how, gained, handPips: sums };
    if (this.scores[winnerIdx] >= this.target) this.winner = this.players[winnerIdx];
    return { roundOver: true, ...this.roundResult, gameWinner: this.winner };
  }
  nextRound() {
    if (!this.roundOver) throw new Error('round_active');
    if (this.winner) throw new Error('game_over');
    this._deal();
    return this.state();
  }
  // Mid-game join: dealt from the boneyard (fewer tiles if it is short).
  addPlayer(name) {
    if (this.winner) throw new Error('game_over');
    this.players.push(name);
    this.scores.push(0);
    const n = Math.min(this.handSize || 7, this.boneyard.length);
    this.hands.push(this.boneyard.splice(0, n));
  }
  _advance() { this.turn = (this.turn + 1) % this.players.length; }
  _expectTurn(playerIdx) {
    if (this.winner) throw new Error('game_over');
    if (playerIdx !== this.turn) throw new Error('not_your_turn');
  }
}

module.exports = { DominoesGame, buildSet, pips };
