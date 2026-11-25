'use strict';
/* روح المغامرة (Spirit of Adventure) client module, phase 1.
   Keyboard-first audio game: arrows walk, 1-6/8 jump power, Up jumps,
   G+arrow explores with wind, Enter enters places, W/O/F info keys, T private message.
   Loaded before app.js; talks to it through window.state/t/announce/send/showView. */
(() => {
  const $ = id => document.getElementById(id);
  const t = key => window.t(key);
  const announce = m => window.announce(m);
  const send = o => window.send(o);

  const sounds = {};
  for (const n of ['step', 'jump', 'splash', 'wind', 'pm', 'place', 'power', 'enter', 'edge', 'online', 'land_ground', 'land_bridge', 'land_grass', 'land_tree']) {
    sounds[n] = new Audio(n + '.ogg');
  }
  function play(name) {
    const a = sounds[name];
    if (!a) return;
    a.currentTime = 0;
    a.play().catch(() => {});
  }
  function playTimes(name, n) {
    // wind per measured step, capped so long distances stay usable
    const count = Math.min(n, 12);
    for (let i = 0; i < count; i++) setTimeout(() => play(name), i * 280);
    return count * 280;
  }

  const inWorld = () => !$('view-world').hidden;
  function addLog(text) {
    const p = document.createElement('p');
    p.textContent = text;
    const log = $('adv-log');
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }
  function say(text) { announce(text); addLog(text); }
  // PMs arriving while in the world are logged for history
  // (announced by app.js, which owns the 'pm' message).

  // ---------- event rendering ----------
  function onEvent(ev) {
    switch (ev.kind) {
      case 'entered':
        window.showView('world');
        $('adv-focus').focus();
        play('enter');
        say(t('advEntered')(t(ev.area), ev.x));
        break;
      case 'moved': play('step'); announce(t('advMoved')(ev.x)); break;
      case 'blocked_edge': play('edge'); announce(t('advBlockedEdge')); break;
      case 'splash': play('splash'); announce(t('advSplash')); break;
      case 'jump_splash': play('splash'); announce(t('advJumpSplash')); break;
      case 'jumped': {
        play('jump');
        const land = { ground: 'land_ground', bridge: 'land_bridge', grass: 'land_grass', tree: 'land_tree' }[ev.surface] || 'land_ground';
        setTimeout(() => play(land), 450);
        break;
      }
      case 'power': play('power'); announce(t('advPower')(ev.power)); break;
      case 'explore_ground': {
        const ms = playTimes('wind', ev.steps);
        setTimeout(() => announce(t('advExploreGround')(ev.steps)), ms + 50);
        break;
      }
      case 'explore_gap': {
        const ms = playTimes('wind', ev.steps);
        setTimeout(() => announce(t('advExploreGap')(ev.steps)), ms + 50);
        break;
      }
      case 'explore_edge': play('edge'); announce(t('advExploreEdge')); break;
      case 'at_place': play('place'); announce(t('advAtPlace')(t(ev.place), ev.canEnter)); break;
      case 'nothing_to_enter': play('edge'); announce(t('advNothingToEnter')); break;
      case 'entered_place': play('enter'); say(t('advEnteredPlace')(t(ev.area))); break;
      case 'where': announce(t('advWhere')(t(ev.area), ev.place ? t(ev.place) : null, ev.x)); break;
      case 'online': play('online'); announce(t('advOnline')(ev.ar, ev.en)); break;
      case 'player_entered': say(t('advPlayerEntered')(ev.name)); break;
      case 'player_left': say(t('advPlayerLeft')(ev.name)); break;
      case 'player_move': play(ev.moveKind === 'splash' ? 'splash' : ev.moveKind === 'jump' ? 'jump' : 'step'); break;
    }
  }

  function onLeft() {
    announce(t('advYouLeft'));
    window.showView('lobby');
  }

  // ---------- keyboard ----------
  let gHeld = false;
  function typingTarget(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
  document.addEventListener('keydown', ev => {
    if (!inWorld()) return;
    const d = $('settings-dialog');
    if (d && d.open) return;
    if (typingTarget(ev.target)) {
      if (ev.key === 'Escape') { ev.preventDefault(); $('adv-focus').focus(); }
      return;
    }
    const k = ev.key;
    if (k === 'g' || k === 'G') { gHeld = true; ev.preventDefault(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      ev.preventDefault();
      const dir = k === 'ArrowRight' ? 'right' : 'left';
      send({ type: 'world_action', action: gHeld ? 'explore' : 'move', dir });
      return;
    }
    if (k === 'ArrowUp') { ev.preventDefault(); send({ type: 'world_action', action: 'jump' }); return; }
    if (k === 'Enter') {
      if (ev.target.tagName === 'BUTTON') return; // let focused buttons work normally
      ev.preventDefault();
      send({ type: 'world_action', action: 'enter' });
      return;
    }
    if (k === 'Escape') { ev.preventDefault(); send({ type: 'leave_world' }); return; }
    if (/^[1-68]$/.test(k) && k !== '7') { ev.preventDefault(); send({ type: 'world_action', action: 'power', power: Number(k) }); return; }
    const code = ev.code;
    if (code === 'KeyW') { ev.preventDefault(); send({ type: 'world_action', action: 'where' }); return; }
    if (code === 'KeyO') { ev.preventDefault(); send({ type: 'world_action', action: 'online' }); return; }
    if (code === 'KeyF') {
      ev.preventDefault();
      const online = (window.lastFriendsList || []).filter(f => f.online).map(f => f.name);
      announce(t('advFriendsOnline')(online));
      return;
    }
    if (code === 'KeyT') { ev.preventDefault(); $('pm-input').focus(); return; }
  });
  document.addEventListener('keyup', ev => {
    if (ev.key === 'g' || ev.key === 'G') gHeld = false;
  });

  // ---------- PM form ----------
  $('pm-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const raw = $('pm-input').value.trim();
    const m = raw.split('/');
    if (m.length < 2 || !m[0].trim() || !m.slice(1).join('/').trim()) {
      announce(t('advPmBadFormat'));
      return;
    }
    send({ type: 'pm', to: m[0].trim(), text: m.slice(1).join('/').trim() });
    $('pm-input').value = '';
    $('adv-focus').focus();
  });

  $('adv-enter-button').addEventListener('click', () => {
    send({ type: 'enter_world', lang: window.state.lang });
  });
  $('adv-leave-button').addEventListener('click', () => send({ type: 'leave_world' }));

  window.ADV = { onEvent, onLeft, play, log: addLog };
})();
