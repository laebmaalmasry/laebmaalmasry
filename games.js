'use strict';
/* Game UI renderers + event announcements for العب مع المصري.
   Expects globals from app.js: state, t(), announce(), send(), and i18n STRINGS. */
(() => {
  const $ = id => document.getElementById(id);
  const GAME_NAMES = { farkle: 'gameFarkle', dominoes: 'gameDominoes', snakes: 'gameSnakes' };
  const tileText = tile => t('tileFmt')(tile[0], tile[1]);

  function el(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function myIndex() {
    if (!state.game) return -1;
    return state.game.state.players.indexOf(state.name);
  }
  function isMyTurn() {
    const g = state.game;
    return g && myIndex() === g.state.turn && !g.state.winner;
  }

  // ---------- announcements ----------
  function announceGameEvent(msg) {
    const by = msg.by;
    const r = msg.result || {};
    const g = msg.game;
    let text = null;
    if (g === 'farkle') {
      if (msg.action === 'roll') {
        text = r.farkled ? t('farkled')(by) : t('rolledDice')(by, (r.dice || []).join(' '));
      } else if (msg.action === 'setAside') text = t('setAsidePts')(by, r.points);
      else if (msg.action === 'bank') text = r.winner ? t('wins')(by) : t('bankedPts')(by, r.banked);
      else if (msg.action === 'endTurnAfterFarkle') text = null; // covered by the farkle roll
    } else if (g === 'dominoes') {
      if (msg.action === 'play') {
        if (r.roundOver) text = r.gameWinner ? t('wins')(by) : t('roundWin')(by, r.gained);
        else text = t('playedTile')(by, tileText(r.played));
      } else if (msg.action === 'draw') {
        text = (by === state.name && r.drew) ? t('youDrew')(tileText(r.drew)) : t('drewTile')(by);
      } else if (msg.action === 'pass') {
        if (r.roundOver) text = r.gameWinner ? t('wins')(r.winner) : t('roundBlocked')(r.winner, r.gained);
        else text = t('passedTurn')(by);
      } else if (msg.action === 'nextRound') text = t('roundLine')(r.roundNumber);
    } else if (g === 'snakes') {
      if (msg.action === 'roll') {
        if (r.winner) text = t('wins')(by);
        else if (r.event === 'ladder') text = t('onLadder')(by, r.at);
        else if (r.event === 'snake') text = t('onSnake')(by, r.at);
        else if (r.bounced) text = t('bounced')(by, r.at);
        else text = t('rolledDie')(by, r.die);
      }
    }
    if (text) announce(text);
    if (state.notif && by !== state.name) notifPlay();
  }

  // ---------- rendering ----------
  function renderGame() {
    const menu = $('game-menu');
    const view = $('game-view');
    for (const b of document.querySelectorAll('[data-start-game]')) {
      b.textContent = t(GAME_NAMES[b.dataset.startGame]);
    }
    const g = state.game;
    if (!g) { menu.hidden = false; view.hidden = true; view.innerHTML = ''; return; }
    menu.hidden = true;
    view.hidden = false;
    view.innerHTML = '';
    const s = g.state;
    view.appendChild(el('h4', t(GAME_NAMES[g.id])));
    if (g.spectator || myIndex() < 0) view.appendChild(el('p', t('gameInProgress')));
    if (g.id === 'farkle') renderFarkle(view, g, s);
    else if (g.id === 'dominoes') renderDominoes(view, g, s);
    else if (g.id === 'snakes') renderSnakes(view, g, s);
    const endBtn = el('button', t('endGame'), { id: 'end-game-button' });
    endBtn.addEventListener('click', () => send({ type: 'end_game' }));
    view.appendChild(endBtn);
  }

  function scoreList(view, s) {
    const h = el('h5', t('scoresHeading'));
    const ul = el('ul');
    s.players.forEach((p, i) => ul.appendChild(el('li', t('scoreLine')(p, s.scores[i]))));
    view.appendChild(h);
    view.appendChild(ul);
  }
  function turnLine(view, s) {
    const mine = isMyTurn();
    view.appendChild(el('p', (mine ? t('yourTurn') + ' — ' : '') + t('turnOf')(s.currentPlayer)));
  }

  function renderFarkle(view, g, s) {
    scoreList(view, s);
    turnLine(view, s);
    view.appendChild(el('p', `${t('turnPoints')(s.turnPoints)}. ${t('diceLeft')(s.diceLeft)}.`));
    if (s.lastRoll && s.lastRoll.length) {
      const group = el('div', null, { role: 'group', 'aria-label': 'dice' });
      g.selected = g.selected && g.selectedTurn === s.turnPoints + ':' + s.lastRoll.join() ? g.selected : new Set();
      g.selectedTurn = s.turnPoints + ':' + s.lastRoll.join();
      s.lastRoll.forEach((d, i) => {
        const b = el('button', String(d), { 'aria-pressed': g.selected.has(i) ? 'true' : 'false', class: 'die' });
        b.addEventListener('click', () => {
          if (g.selected.has(i)) g.selected.delete(i); else g.selected.add(i);
          b.setAttribute('aria-pressed', String(g.selected.has(i)));
        });
        group.appendChild(b);
      });
      view.appendChild(group);
    }
    if (isMyTurn()) {
      const actions = el('div', null, { class: 'table-actions' });
      if (s.phase === 'must_roll') {
        const rb = el('button', t('rollDice'), { id: 'roll-button' });
        rb.addEventListener('click', () => send({ type: 'game_action', action: 'roll' }));
        actions.appendChild(rb);
      } else if (s.phase === 'deciding') {
        const sb = el('button', t('setAside'), { id: 'setaside-button' });
        sb.addEventListener('click', () => {
          send({ type: 'game_action', action: 'setAside', args: [[...g.selected].sort((a, b) => a - b)] });
          g.selected = new Set();
        });
        actions.appendChild(sb);
      }
      const myScore = s.scores[myIndex()];
      const canBank = s.phase !== 'over' && s.turnPoints >= 30 && (myScore > 0 || s.turnPoints >= 50);
      if (s.phase !== 'over') {
        const bb = el('button', t('bankPoints'), { id: 'bank-button' });
        if (!canBank) bb.disabled = true;
        bb.addEventListener('click', () => send({ type: 'game_action', action: 'bank' }));
        actions.appendChild(bb);
      }
      if (s.farkled) {
        const nb = el('button', 'OK', { id: 'farkle-ok' });
        nb.addEventListener('click', () => send({ type: 'game_action', action: 'endTurnAfterFarkle' }));
        actions.appendChild(nb);
      }
      view.appendChild(actions);
    }
  }

  function renderDominoes(view, g, s) {
    scoreList(view, s);
    view.appendChild(el('p', `${t('roundLine')(s.roundNumber)}. ${t('boneyard')(s.boneyard)}.`));
    turnLine(view, s);
    if (s.ends) {
      view.appendChild(el('p', t('endsAre')(s.ends.left, s.ends.right)));
      view.appendChild(el('p', t('boardLine')(s.board.map(tileText).join(' ')), { id: 'domino-board' }));
    } else {
      view.appendChild(el('p', t('boardEmpty'), { id: 'domino-board' }));
    }
    const hand = g.hand || [];
    view.appendChild(el('h5', t('yourTiles')));
    const handDiv = el('div', null, { role: 'group', 'aria-label': 'hand', id: 'domino-hand' });
    hand.forEach((tile, i) => {
      const b = el('button', tileText(tile), { 'aria-pressed': g.selectedTile === i ? 'true' : 'false', class: 'tile' });
      b.addEventListener('click', () => { g.selectedTile = g.selectedTile === i ? -1 : i; renderGame(); });
      handDiv.appendChild(b);
    });
    view.appendChild(handDiv);
    if (isMyTurn() && !s.roundOver) {
      const actions = el('div', null, { class: 'table-actions' });
      const sel = g.selectedTile;
      if (sel != null && sel >= 0 && hand[sel]) {
        const tile = hand[sel];
        if (!s.ends) {
          const pb = el('button', t('playFirst')(tileText(tile)), { id: 'play-first' });
          pb.addEventListener('click', () => { send({ type: 'game_action', action: 'play', args: [sel, 'first'] }); g.selectedTile = -1; });
          actions.appendChild(pb);
        } else {
          if (tile[0] === s.ends.left || tile[1] === s.ends.left) {
            const lb = el('button', t('playLeft')(s.ends.left), { id: 'play-left' });
            lb.addEventListener('click', () => { send({ type: 'game_action', action: 'play', args: [sel, 'left'] }); g.selectedTile = -1; });
            actions.appendChild(lb);
          }
          if (tile[0] === s.ends.right || tile[1] === s.ends.right) {
            const rb = el('button', t('playRight')(s.ends.right), { id: 'play-right' });
            rb.addEventListener('click', () => { send({ type: 'game_action', action: 'play', args: [sel, 'right'] }); g.selectedTile = -1; });
            actions.appendChild(rb);
          }
        }
      }
      const db = el('button', t('drawTile'), { id: 'draw-button' });
      db.addEventListener('click', () => send({ type: 'game_action', action: 'draw' }));
      actions.appendChild(db);
      const pb2 = el('button', t('passTurn'), { id: 'pass-button' });
      pb2.addEventListener('click', () => send({ type: 'game_action', action: 'pass' }));
      actions.appendChild(pb2);
      view.appendChild(actions);
    }
    if (s.roundOver && !s.winner && isMyTurn()) {
      const nr = el('button', t('roundLine')(s.roundNumber + 1), { id: 'next-round' });
      nr.addEventListener('click', () => send({ type: 'game_action', action: 'nextRound' }));
      view.appendChild(nr);
    }
  }

  function renderSnakes(view, g, s) {
    const ul = el('ul');
    s.players.forEach((p, i) => ul.appendChild(el('li', t('positionLine')(p, s.positions[i]))));
    view.appendChild(ul);
    turnLine(view, s);
    if (isMyTurn()) {
      const rb = el('button', t('rollDice'), { id: 'roll-button' });
      rb.addEventListener('click', () => send({ type: 'game_action', action: 'roll' }));
      view.appendChild(rb);
    }
  }

  // start-game buttons
  document.querySelectorAll('[data-start-game]').forEach(b => {
    b.addEventListener('click', () => send({ type: 'start_game', game: b.dataset.startGame }));
  });

  window.GP = { renderGame, announceGameEvent };
})();
