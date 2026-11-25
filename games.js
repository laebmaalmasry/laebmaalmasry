'use strict';
/* Game UI renderers + event announcements for العب مع المصري.
   Expects globals from app.js: state, t(), announce(), send(), and i18n STRINGS. */
(() => {
  const $ = id => document.getElementById(id);
  const GAME_NAMES = { farkle: 'gameFarkle', dominoes: 'gameDominoes', snakes: 'gameSnakes' };
  const tileText = tile => t('tileFmt')(tile[0], tile[1]);
  // dice sounds synthesized with WebAudio: no audio files to ship
  let actx = null;
  function beep(freq, dur, type, gain) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.25, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch {}
  }
  function rattle(dur) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const n = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, n, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.12 ? 1 : 0.15);
      const src = actx.createBufferSource(); src.buffer = buf;
      const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.8;
      const g = actx.createGain();
      g.gain.setValueAtTime(0.6, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      src.connect(f).connect(g).connect(actx.destination);
      src.start();
    } catch {}
  }
  const rollAudio = { play: () => { rattle(0.7); return { catch() {} }; }, currentTime: 0 };
  const keepAudio = { play: () => { beep(740, 0.12, 'sine', 0.3); return { catch() {} }; }, currentTime: 0 };
  const sfx = a => { try { a.play(); } catch {} };

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
        sfx(rollAudio);
        if (state.game) state.game._lastRoll = r.dice || [];
        text = r.farkled ? t('farkled')(by) : t('rolledDice')(by, (r.dice || []).join(' '));
      } else if (msg.action === 'setAside') { sfx(keepAudio); text = t('setAsidePts')(by, r.points); }
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
    if (g === 'farkle' && text) farkleLog(text);
    if (state.notif && by !== state.name) notifPlay();
  }

  // ---------- rendering ----------
  function renderGame() {
    const menu = $('game-menu');
    const view = $('game-view');
    const g = state.game;
    if (!g) {
      menu.hidden = false;
      view.hidden = true;
      view.innerHTML = '';
      // options menu: add a bot, then start a game (chosen game first)
      const box = $('game-menu-buttons');
      if (box) {
        box.innerHTML = '';
        const bot = el('button', t('addBotMenu'), { id: 'menu-add-bot' });
        bot.addEventListener('click', () => { send({ type: 'add_bot' }); });
        box.appendChild(bot);
        const order = ['farkle', 'dominoes', 'snakes'];
        const pend = state.pendingGame;
        if (pend && order.includes(pend)) { order.splice(order.indexOf(pend), 1); order.unshift(pend); }
        for (const id of order) {
          const b = el('button', t('startGameBtn')(t(GAME_NAMES[id])), { 'data-start-game': id });
          b.addEventListener('click', () => send({ type: 'start_game', game: id }));
          box.appendChild(b);
        }
      }
      return;
    }
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

  // ---------- Farkle v5: Ahmed's vertical-menu model ----------
  // Everything is a plain vertical button: dice toggle with Enter/Space (native),
  // one PRIMARY button whose label is the next instruction, focus jumps to it
  // after every server state change so NVDA speaks what to do next.
  // Model studied live from the RS Games web client (status history + vertical
  // choice buttons) and QuentinC Playroom docs; no listbox, no Enter interception.
  const FARKLE_VERSION = 'farkle-v5-2026-11-25';
  window.FARKLE_VERSION = FARKLE_VERSION;

  function farkleSelPoints(g, dice) {
    const vals = [...g.sel].map(i => dice[i]);
    if (!vals.length || !window.FarkleRules) return 0;
    return window.FarkleRules.scoreSelection(vals).points;
  }
  function farkleCanBank(s, myIdx) {
    if (myIdx < 0 || s.phase === 'over') return false;
    const D = (window.FarkleRules && window.FarkleRules.FARKLE_DEFAULTS) || { minBank: 30, firstBankMin: 50 };
    return s.turnPoints >= D.minBank && (s.scores[myIdx] > 0 || s.turnPoints >= D.firstBankMin);
  }
  function farkleLog(text) {
    const g = state.game;
    if (!g || g.id !== 'farkle' || !text) return;
    g.log = g.log || [];
    g.log.push(text);
    if (g.log.length > 12) g.log.shift();
  }
  function farkleSend(action, args) {
    const msg = { type: 'game_action', action };
    if (args) msg.args = args;
    send(msg);
  }
  function farkleKeep(g) {
    farkleSend('setAside', [[...g.sel].sort((a, b) => a - b)]);
    g.sel = new Set();
  }
  function farklePrimaryLabel(g, s, dice) {
    const selPts = farkleSelPoints(g, dice);
    if (s.phase === 'must_roll') return s.turnPoints > 0 ? t('rollRest')(s.diceLeft) : t('rollDice');
    if (s.phase === 'deciding') return t('keepBtn')(selPts);
    return t('okBtn'); // over
  }
  function farklePrimary(g) {
    const s = g.state;
    if (!isMyTurn()) { announce(t('notYourTurn')); return; }
    if (s.phase === 'must_roll') farkleSend('roll');
    else if (s.phase === 'deciding') {
      const dice = s.lastRoll || [];
      if (farkleSelPoints(g, dice) > 0) farkleKeep(g);
      else announce(t('selectDiceFirst'));
    } else if (s.phase === 'over') farkleSend('endTurnAfterFarkle');
  }
  function farkleTryBank() {
    const g = state.game, s = g.state;
    if (!isMyTurn()) { announce(t('notYourTurn')); return; }
    if (farkleCanBank(s, myIndex())) farkleSend('bank');
    else announce(t('cannotBank'));
  }
  function farkleToggleDie(g, dice, i, btn) {
    if (!isMyTurn()) { announce(t('notYourTurn')); return; }
    if (g.state.phase !== 'deciding') { announce(t('rollFirstToPick')); return; }
    if (g.sel.has(i)) g.sel.delete(i); else g.sel.add(i);
    const on = g.sel.has(i);
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = t('dieBtn')(i + 1, dice[i]) + (on ? ' — ' + t('selectedMark') : '');
    sfx(keepAudio);
    const pts = farkleSelPoints(g, dice);
    let msg = on ? t('diePicked')(dice[i], pts) : t('dieUnpicked')(dice[i], pts);
    if (pts === 0 && g.sel.size) msg += '. ' + t('selInvalid');
    announce(msg);
    const p = $('farkle-primary');
    if (p) p.textContent = farklePrimaryLabel(g, g.state, dice);
  }

  function renderFarkle(view, g, s) {
    const mine = isMyTurn();
    const myIdx = myIndex();
    const dice = s.lastRoll || [];
    const rollKey = s.turn + ':' + s.turnPoints + ':' + dice.join(',');
    if (g.selKey !== rollKey) { g.sel = new Set(); g.selKey = rollKey; }
    const phaseKey = s.turn + ':' + s.phase + ':' + dice.length + ':' + (s.farkled ? 1 : 0);
    const becameMine = mine && g._prevMine !== true;
    const stateChanged = g._prevPhaseKey !== phaseKey;
    g._prevMine = mine;
    g._prevPhaseKey = phaseKey;
    const D = (window.FarkleRules && window.FarkleRules.FARKLE_DEFAULTS) || { target: 1000 };

    scoreList(view, s);
    view.appendChild(el('p', t('targetLine')(s.target || D.target)));

    const panel = el('section', null, { 'aria-label': t('gameRegion'), id: 'farkle-panel' });
    view.appendChild(panel);

    panel.appendChild(el('h5', t('stateHeading')));
    panel.appendChild(el('p', (mine ? t('yourTurn') + '. ' : '') + t('turnOf')(s.currentPlayer)));
    panel.appendChild(el('p', t('turnPoints')(s.turnPoints)));
    panel.appendChild(el('p', t('diceLeft')(s.diceLeft)));
    panel.appendChild(el('p', t('farkleKeysV5'), { class: 'farkle-keys-hint' }));

    // dice: vertical plain toggle buttons
    panel.appendChild(el('h5', t('diceHeading')));
    const diceBox = el('div', null, { class: 'menu-vertical', id: 'farkle-dice' });
    panel.appendChild(diceBox);
    if (!dice.length) diceBox.appendChild(el('p', t('noDiceYet')));
    dice.forEach((d, i) => {
      const on = g.sel.has(i);
      const b = el('button', t('dieBtn')(i + 1, d) + (on ? ' — ' + t('selectedMark') : ''), {
        id: 'farkle-die-' + i, class: 'die-btn', 'aria-pressed': on ? 'true' : 'false'
      });
      b.addEventListener('click', () => farkleToggleDie(g, dice, i, b));
      diceBox.appendChild(b);
    });

    // actions: one primary button + bank, always in the same order
    panel.appendChild(el('h5', t('actionsHeading')));
    const actions = el('div', null, { class: 'menu-vertical', id: 'farkle-actions' });
    panel.appendChild(actions);
    const primary = el('button', mine ? farklePrimaryLabel(g, s, dice) : t('turnOf')(s.currentPlayer), {
      id: 'farkle-primary', 'aria-disabled': mine ? 'false' : 'true'
    });
    primary.addEventListener('click', () => farklePrimary(g));
    actions.appendChild(primary);
    const canBank = mine && farkleCanBank(s, myIdx);
    const bank = el('button', t('bankNow')(s.turnPoints), { id: 'farkle-bank', 'aria-disabled': canBank ? 'false' : 'true' });
    bank.addEventListener('click', () => farkleTryBank());
    actions.appendChild(bank);

    // log: plain focusable list, readable with NVDA arrows in browse or focus mode
    view.appendChild(el('h5', t('logHeading')));
    const entries = g.log || [];
    const logEl = el('ul', null, { id: 'farkle-log', tabindex: '0', 'aria-label': t('logHeading') });
    if (!entries.length) logEl.appendChild(el('li', t('logEmpty')));
    entries.forEach(line => logEl.appendChild(el('li', line)));
    view.appendChild(logEl);
    view.appendChild(el('p', FARKLE_VERSION, { class: 'farkle-version' }));

    if (!g._versionSaid) {
      g._versionSaid = true;
      setTimeout(() => announce(t('farkleVersionSay')), 900);
    } else if (mine && stateChanged && s.phase === 'must_roll' && s.turnPoints > 0 && s.diceLeft === 6 && g._hotKey !== rollKey) {
      g._hotKey = rollKey;
      setTimeout(() => announce(t('hotDice')), 400);
    } else if (becameMine) announce(t('yourTurn'));
    // the heart of v5: on your turn, focus lives on the primary button, so
    // NVDA speaks the next instruction and Enter does it. Re-renders destroy
    // the focused node (view.innerHTML is rebuilt), so restore on EVERY
    // render during your turn, not only on phase changes.
    const a = document.activeElement;
    const focusInGame = !a || a === document.body || view.contains(a) || a.id === 'chat-input';
    if (mine && focusInGame) setTimeout(() => { const p = $('farkle-primary'); if (p) p.focus(); }, 60);
  }

  if (!window.__farkleKeysBound) {
    window.__farkleKeysBound = true;
    document.addEventListener('keydown', e => {
      const g = state.game;
      if (!g || g.id !== 'farkle') return;
      const tgt = e.target;
      const tag = (tgt.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) return;
      const k = (e.key || '').toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = g.state;
      if (k === 'c') { e.preventDefault(); announce(t('sayTurnPts')(s.turnPoints, s.diceLeft)); }
      else if (k === 'd') {
        e.preventDefault();
        const heard = g._lastRoll || [];
        announce(heard.length ? t('lastRollSay')(heard.join(' ')) : t('noLastRoll'));
      }
      else if (k === 's') { e.preventDefault(); announce(s.players.map((p, i) => t('scoreLine')(p, s.scores[i])).join('. ')); }
      else if (k === 't') { e.preventDefault(); announce(t('turnOf')(s.currentPlayer)); }
      else if (k === 'b') { e.preventDefault(); farkleTryBank(); }
    });
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

  window.GP = { renderGame, announceGameEvent };
})();
