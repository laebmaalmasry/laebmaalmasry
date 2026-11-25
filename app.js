'use strict';
/* العب مع المصري (LaebMaAlMasry) client. Keyboard-first, screen-reader friendly. */
(() => {
  const $ = id => document.getElementById(id);
  const state = {
    lang: localStorage.getItem('gp.lang') || 'ar',
    notif: localStorage.getItem('gp.notif') !== 'off',
    music: Number(localStorage.getItem('gp.music') || '0'),
    name: localStorage.getItem('gp.name') || '',
    token: localStorage.getItem('gp.token') || '',
    table: null,
    game: null,
    mic: false,
    role: 'player',
    ws: null,
  };
  // shared with games.js (separate IIFE)
  window.state = state;
  window.t = key => t(key);
  window.announce = m => announce(m);
  window.send = obj => send(obj);
  window.notifPlay = () => notifAudio.play().catch(() => {});
  const CLIENT_VERSION = 'v9-2026-11-26';
  window.CLIENT_VERSION = CLIENT_VERSION;
  const t = key => STRINGS[state.lang][key];
  const terr = code => (STRINGS[state.lang].errors[code]) || code;

  // ---------- audio ----------
  const notifAudio = new Audio('notification.ogg');
  const musicAudio = new Audio('music.ogg');
  musicAudio.loop = true;
  function applyMusic() {
    musicAudio.volume = state.music / 100 * 0.5;
    if (state.music > 0) musicAudio.play().catch(() => {});
    else musicAudio.pause();
  }

  // ---------- i18n ----------
  function applyLang() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $('mic-button').textContent = state.mic ? t('micOn') : t('micOff');
    document.querySelectorAll(`input[name="lang"]`).forEach(r => { r.checked = r.value === state.lang; });
    document.querySelectorAll(`input[name="music"]`).forEach(r => { r.checked = Number(r.value) === state.music; });
    $('notif-toggle').checked = state.notif;
    if (state.table) renderTable();
    renderFriends(lastFriends);
    renderTables(lastTables);
    if (window.GP) window.GP.renderGame();
  }

  function announce(msg) {
    const live = $('live');
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 30);
  }

  // ---------- views ----------
  function show(view) {
    for (const v of ['login', 'lobby', 'table', 'world']) $('view-' + v).hidden = v !== view;
    if (view === 'table' && window.showScreen) window.showScreen('screen-game', true);
    if (view === 'lobby') showLobbyScreen('screen-lobby-games', true);
    const focusTarget = { login: 'login-name', lobby: 'lobby-games-menu', table: 'game-menu-buttons', world: 'adv-focus' }[view];
    const el = $(focusTarget);
    if (el) { const b = el.tagName === 'BUTTON' ? el : el.querySelector('button'); if (b) { b.focus(); return; } if (el.tabIndex >= 0) { el.focus(); return; } }
  }
  window.showView = show;

  // ---------- rendering ----------
  let lastTables = [];
  let lastFriends = [];
  function renderTables(tables) {
    lastTables = tables;
    const ul = $('tables');
    ul.innerHTML = '';
    $('no-tables').hidden = tables.length > 0;
    for (const tb of tables) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.textContent = `${t('joinTable')(tb.name)} — ${t('playersCount')(tb.players.length, tb.max)}`;
      b.addEventListener('click', () => send({ type: 'join_table', id: tb.id }));
      li.appendChild(b);
      ul.appendChild(li);
    }
  }
  function renderFriends(friends) {
    lastFriends = friends;
    window.lastFriendsList = friends;
    const ul = $('friends');
    ul.innerHTML = '';
    for (const f of friends) {
      const li = document.createElement('li');
      li.textContent = f.online ? t('friendOnline')(f.name) : t('friendOffline')(f.name);
      ul.appendChild(li);
    }
  }
  function renderTable() {
    const tb = state.table;
    if (!tb) return;
    $('table-h').textContent = t('tableOf')(tb.name);
    const ul = $('players');
    ul.innerHTML = '';
    for (const p of tb.players) {
      const li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    }
  }
  function addChatLine(from, text) {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = from + ': ';
    p.appendChild(strong);
    p.appendChild(document.createTextNode(text));
    const log = $('chat-log');
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    if (state.notif && from !== state.name) notifAudio.play().catch(() => {});
  }

  // ---------- voice (LiveKit) ----------
  let lkRoom = null;
  let micTrack = null;
  let voiceWanted = false;
  async function joinVoice() {
    voiceWanted = true;
    send({ type: 'voice_join' });
  }
  async function connectVoice(msg, attempt) {
    attempt = attempt || 1;
    if (!voiceWanted) return;
    if (!window.LivekitClient) {
      // the LiveKit module may still be loading; wait and retry
      if (attempt < 10) setTimeout(() => connectVoice(msg, attempt + 1), 1000);
      else announce(t('voiceFailed'));
      return;
    }
    try {
      lkRoom = new window.LivekitClient.Room();
      lkRoom.on('trackSubscribed', track => {
        if (track.kind === 'audio') {
          const el = track.attach();
          el.style.display = 'none';
          document.body.appendChild(el);
        }
      });
      lkRoom.on('disconnected', () => {
        lkRoom = null;
        if (micTrack) { micTrack.stop(); micTrack = null; }
        if (voiceWanted) { announce(t('voiceRetry')); send({ type: 'voice_join' }); }
      });
      await lkRoom.connect(msg.url, msg.token);
      window.__voiceRoom = lkRoom; // test hook
      // never auto-publish: the mic only goes live from an explicit F2 / button press
      if (voiceWanted) announce(t('voiceOn'));
    } catch (e) {
      lkRoom = null;
      if (!voiceWanted) return;
      if (attempt < 4) setTimeout(() => connectVoice(msg, attempt + 1), 3000);
      else announce(t('voiceFailed'));
    }
  }
  async function publishMic(on) {
    if (!lkRoom) return;
    if (on && !micTrack) {
      micTrack = await window.LivekitClient.createLocalAudioTrack();
      await lkRoom.localParticipant.publishTrack(micTrack);
    } else if (!on && micTrack) {
      lkRoom.localParticipant.unpublishTrack(micTrack);
      micTrack.stop();
      micTrack = null;
    }
  }
  function leaveVoice() {
    voiceWanted = false;
    if (micTrack) { micTrack.stop(); micTrack = null; }
    if (lkRoom) { lkRoom.disconnect(); lkRoom = null; }
  }

  // ---------- mic ----------
  function setMic(on) {
    state.mic = on;
    $('mic-button').setAttribute('aria-pressed', String(on));
    $('mic-button').textContent = on ? t('micOn') : t('micOff');
    if (on && !lkRoom) {
      // never claim the mic is open when there is no voice room behind it
      state.mic = false;
      $('mic-button').setAttribute('aria-pressed', 'false');
      $('mic-button').textContent = t('micOff');
      announce(t('voiceNotReady'));
      return;
    }
    announce(on ? t('micOnAnnounce') : t('micOffAnnounce'));
    publishMic(on).catch(() => {
      state.mic = false;
      $('mic-button').setAttribute('aria-pressed', 'false');
      $('mic-button').textContent = t('micOff');
      announce(t('micFailed'));
    });
  }

  // ---------- websocket ----------
  function send(obj) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj)); }
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    state.ws = ws;
    ws.onopen = () => {
      send({ type: 'hello', name: state.name, token: state.token, code: state.pendingCode || undefined, version: CLIENT_VERSION });
    };
    ws.onclose = () => {
      if (!state.name) return; // never logged in; nothing to retry
      // remember the table so the reconnect can put the player back on it
      state.resumeTableId = state.table ? state.table.id : null;
      state.table = null;
      state.game = null;
      announce(t('disconnected'));
      setTimeout(connect, 2000);
    };
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handle(msg);
    };
  }
  function handle(msg) {
    switch (msg.type) {
      case 'welcome':
        state.token = msg.token;
        state.role = msg.role || 'player';
        localStorage.setItem('gp.token', msg.token);
        localStorage.setItem('gp.name', state.name);
        state.pendingCode = '';
        $('login-code').value = '';
        $('login-status').textContent = '';
        announce(t('connected'));
        applyMusic();
        applyRole();
        show('lobby');
        if (state.resumeTableId != null) {
          const rid = state.resumeTableId;
          state.resumeTableId = null;
          send({ type: 'join_table', id: rid });
        }
        break;
      case 'login_code': {
        const text = t('loginCodeIs')(msg.code, msg.minutes);
        $('login-code-text').textContent = text;
        announce(text);
        break;
      }
      case 'rules':
        renderRules();
        $('rules-dialog').showModal();
        $('rules-body').focus();
        break;
      case 'role_changed':
        state.role = msg.role;
        applyRole();
        announce(t('roleChanged'));
        break;
      case 'report_sent': announce(t('reportSent')(msg.name)); break;
      case 'blocked': announce(t('blockedMsg')(msg.name)); break;
      case 'unblocked': announce(t('unblockedMsg')(msg.name)); break;
      case 'admin_done': announce(t('adminDone')(msg.action, msg.name)); break;
      case 'penalized': announce(t('penalized')(msg.action)); break;
      case 'announcement': announce(t('announcementFrom')(msg.from, msg.text)); break;
      case 'mod_notice': announce(t('modReport')(msg.by, msg.name)); break;
      case 'error':
        if (!state.table && $('view-table').hidden) $('login-status').textContent = terr(msg.code);
        announce(terr(msg.code));
        break;
      case 'client_old':
        announce(t('clientOld'));
        break;
      case 'tables': renderTables(msg.tables); break;
      case 'friends': renderFriends(msg.friends); break;
      case 'joined':
        state.table = msg.table;
        // every table join starts muted; only an explicit press enables the mic
        state.mic = false;
        $('mic-button').setAttribute('aria-pressed', 'false');
        $('mic-button').textContent = t('micOff');
        $('chat-log').innerHTML = '';
        renderTable();
        if (window.GP) window.GP.renderGame();
        show('table');
        joinVoice();
        break;
      case 'voice_token':
        connectVoice(msg);
        break;
      case 'table_update': {
        const before = new Set(state.table ? state.table.players : []);
        state.table = msg.table;
        renderTable();
        for (const p of msg.table.players) if (!before.has(p)) announce(t('joined')(p));
        for (const p of before) if (!msg.table.players.includes(p)) announce(t('left')(p));
        break;
      }
      case 'chat': addChatLine(msg.from, msg.text); break;
      case 'adv_event': window.ADV.onEvent(msg); break;
      case 'adv_left': window.ADV.onLeft(); break;
      case 'pm': {
        const mine = msg.from === state.name;
        const text = mine ? t('advPmTo')(msg.to, msg.text) : t('advPmFrom')(msg.from, msg.text);
        announce(text);
        if (window.ADV) window.ADV.play('pm');
        if (!$('view-world').hidden && window.ADV) window.ADV.log(text);
        break;
      }
      case 'pm_offline': announce(t('advPmOffline')(msg.to)); break;
      case 'game_started':
        state.game = { id: msg.game, state: msg.state, hand: null, spectator: !!msg.spectator };
        window.GP.renderGame();
        announce(t('gameStarted')(t({ farkle: 'gameFarkle', dominoes: 'gameDominoes', snakes: 'gameSnakes' }[msg.game] || 'gameFarkle')));
        break;
      case 'game_state':
        if (state.game) { state.game.state = msg.state; window.GP.renderGame(); }
        break;
      case 'game_hand':
        if (state.game) { state.game.hand = msg.hand; window.GP.renderGame(); }
        break;
      case 'game_event':
        window.GP.announceGameEvent(msg);
        break;
      case 'game_ended':
        announce(msg.reason === 'player_left' ? t('playerLeftGame')(msg.player) : t('gameEnded'));
        state.game = null;
        window.GP.renderGame();
        break;
      case 'left':
        state.table = null;
        state.game = null;
        leaveVoice();
        show('lobby');
        break;
    }
  }

  // ---------- lobby games menu: pick a game, it opens a table for it ----------
  document.querySelectorAll('[data-lobby-game]').forEach(b => {
    b.addEventListener('click', () => {
      state.pendingGame = b.dataset.lobbyGame;
      send({ type: 'create_table', name: t(GAME_KEY[b.dataset.lobbyGame] || 'gameFarkle') });
    });
  });
  const GAME_KEY = { farkle: 'gameFarkle', dominoes: 'gameDominoes', snakes: 'gameSnakes' };

  // ---------- vertical-menu model: Tab lands on a menu container, Up/Down + Enter inside ----------
  const menuScopeOf = a => a && a.closest ? a.closest('#game-view, #game-menu-buttons, #lobby-games-menu') : null;
  const menuButtons = scope => [...scope.querySelectorAll('button:not([hidden])')].filter(b => b.getAttribute('aria-disabled') !== 'true' && !b.disabled && b.id !== 'end-game-button');
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    const a = document.activeElement;
    if (!a) return;
    // lobby screens: Up/Down is one vertical menu of every control on the screen
    const lobbyScreen = $('view-lobby').hidden ? null : (a.closest && a.closest('.lobby-screen'));
    if (lobbyScreen) {
      const ctrls = [...lobbyScreen.querySelectorAll('button, input, select')].filter(el => !el.disabled && !el.closest('[hidden]'));
      if (ctrls.length < 2) return;
      ev.preventDefault();
      let i = ctrls.indexOf(a);
      if (i < 0) i = ev.key === 'ArrowDown' ? -1 : 0;
      const next = ev.key === 'ArrowDown' ? (i + 1) % ctrls.length : (i - 1 + ctrls.length) % ctrls.length;
      ctrls[next].focus();
      return;
    }
    if (a.tagName === 'BUTTON') {
      const scope = menuScopeOf(a);
      if (!scope) return;
      const btns = menuButtons(scope);
      if (btns.length < 2) return;
      const i = btns.indexOf(a);
      if (i < 0) return;
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
    } else if (a.matches && a.matches('#game-view, #game-menu-buttons, #lobby-games-menu')) {
      const btns = menuButtons(a);
      if (!btns.length) return;
      ev.preventDefault();
      (ev.key === 'ArrowDown' ? btns[0] : btns[btns.length - 1]).focus();
    }
  });

  // ---------- one screen per area (Playroom model): Tab switches screens ----------
  // Only the active screen is in the DOM buffer, so NVDA browse mode reads
  // exactly one area top to bottom, never the whole page.
  const SCREENS = ['screen-game', 'screen-log', 'screen-chat', 'screen-table'];
  function screenMainEl(id) {
    if (id === 'screen-game') return $('farkle-primary') || $('game-view').querySelector('button:not([hidden])') || $('game-menu-buttons').querySelector('button') || $('game-view');
    if (id === 'screen-log') return $('farkle-log') || $('game-log-holder');
    if (id === 'screen-chat') return $('chat-input');
    if (id === 'screen-table') return $('leave-button');
    return null;
  }
  function showScreen(id, silent) {
    SCREENS.forEach(x => { $(x).hidden = x !== id; });
    if (!silent) announce(t('screenName_' + id.replace('screen-', '')));
    const target = screenMainEl(id);
    if (target) setTimeout(() => target.focus(), 0);
  }
  window.showScreen = showScreen;
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab') return;
    if (document.querySelector('dialog[open]')) return;
    if (!$('view-table').hidden) {
      ev.preventDefault();
      const cur = SCREENS.find(id => !$(id).hidden) || 'screen-game';
      let i = SCREENS.indexOf(cur);
      i = ev.shiftKey ? (i - 1 + SCREENS.length) % SCREENS.length : (i + 1) % SCREENS.length;
      showScreen(SCREENS[i]);
    } else if (!$('view-lobby').hidden) {
      ev.preventDefault();
      const avail = lobbyScreensAvailable();
      const cur = avail.find(id => !$(id).hidden) || 'screen-lobby-games';
      let i = avail.indexOf(cur);
      i = ev.shiftKey ? (i - 1 + avail.length) % avail.length : (i + 1) % avail.length;
      showLobbyScreen(avail[i]);
    }
  });

  // Left/Right changes the value of a select inside a lobby screen (Up/Down keep the menu rules)
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const a = document.activeElement;
    if (!a || a.tagName !== 'SELECT') return;
    if ($('view-lobby').hidden || !a.closest('.lobby-screen')) return;
    ev.preventDefault();
    const d = ev.key === 'ArrowRight' ? 1 : -1;
    a.selectedIndex = (a.selectedIndex + d + a.options.length) % a.options.length;
  });

  // ---------- lobby screens: same one-screen-per-area model ----------
  const LOBBY_SCREENS = ['screen-lobby-games', 'screen-lobby-adventure', 'screen-lobby-tables', 'screen-lobby-friends', 'screen-lobby-report', 'screen-lobby-block', 'screen-lobby-admin'];
  function lobbyScreensAvailable() {
    const mod = state.role === 'mod' || state.role === 'owner';
    return LOBBY_SCREENS.filter(id => id !== 'screen-lobby-admin' || mod);
  }
  function lobbyScreenMainEl(id) {
    switch (id) {
      case 'screen-lobby-games': return $('lobby-games-menu').querySelector('button');
      case 'screen-lobby-adventure': return $('adv-enter-button');
      case 'screen-lobby-tables': return $('table-name-input');
      case 'screen-lobby-friends': return $('friend-name');
      case 'screen-lobby-report': return $('report-name');
      case 'screen-lobby-block': return $('block-name');
      case 'screen-lobby-admin': return $('admin-name');
    }
    return null;
  }
  function showLobbyScreen(id, silent) {
    if (!lobbyScreensAvailable().includes(id)) id = 'screen-lobby-games';
    LOBBY_SCREENS.forEach(x => { $(x).hidden = x !== id; });
    if (!silent) announce(t('screenName_' + id.slice('screen-lobby-'.length)));
    const target = lobbyScreenMainEl(id);
    if (target) setTimeout(() => target.focus(), 0);
  }
  window.showLobbyScreen = showLobbyScreen;

  // when Tab lands on a menu container, go straight to the useful button
  ['game-view', 'game-menu-buttons', 'lobby-games-menu'].forEach(id => {
    const box = $(id);
    if (!box) return;
    box.addEventListener('focus', () => setTimeout(() => {
      if (document.activeElement !== box) return;
      const p = $('farkle-primary') || box.querySelector('button:not([hidden])');
      if (p) p.focus();
    }, 0));
  });

  // ---------- forms ----------
  $('login-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('login-name').value.trim();
    if (!name) return;
    state.name = name;
    state.pendingCode = $('login-code').value.trim();
    if (state.ws && state.ws.readyState === 1) send({ type: 'hello', name, token: state.token, code: state.pendingCode || undefined, version: CLIENT_VERSION });
    else connect();
  });
  $('create-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'create_table', name: $('table-name-input').value });
    $('table-name-input').value = '';
  });
  $('friend-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'add_friend', name: $('friend-name').value });
    $('friend-name').value = '';
  });
  $('chat-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) send({ type: 'chat', text });
    $('chat-input').value = '';
  });
  $('leave-button').addEventListener('click', () => send({ type: 'leave_table' }));
  $('mic-button').addEventListener('click', () => setMic(!state.mic));
  $('bot-button').addEventListener('click', () => send({ type: 'add_bot' }));
  $('settings-button').addEventListener('click', () => { $('screens-fieldset').hidden = true; $('settings-dialog').showModal(); });
  $('login-code-button').addEventListener('click', () => { $('login-code-text').textContent = ''; send({ type: 'login_code' }); });

  // ---------- settings: jump to a lobby screen ----------
  const GOTO_SCREEN = { 'goto-games': 'screen-lobby-games', 'goto-adventure': 'screen-lobby-adventure', 'goto-tables': 'screen-lobby-tables', 'goto-friends': 'screen-lobby-friends', 'goto-report': 'screen-lobby-report', 'goto-block': 'screen-lobby-block', 'goto-admin': 'screen-lobby-admin' };
  for (const [btn, screen] of Object.entries(GOTO_SCREEN)) {
    $(btn).addEventListener('click', () => {
      $('settings-dialog').close();
      if (!$('view-lobby').hidden) showLobbyScreen(screen);
    });
  }
  $('goto-rules').addEventListener('click', () => {
    $('settings-dialog').close();
    renderRules();
    $('rules-dialog').showModal();
    $('rules-body').focus();
  });

  // ---------- moderation UI ----------
  function applyRole() {
    const mod = state.role === 'mod' || state.role === 'owner';
    $('owner-form').hidden = state.role !== 'owner';
    $('announce-form').hidden = state.role !== 'owner';
    $('goto-admin').hidden = !mod;
    if (!mod && !$('screen-lobby-admin').hidden) showLobbyScreen('screen-lobby-games', true);
  }
  function renderRules() { $('rules-body').innerHTML = t('rulesHtml'); }
  $('rules-form').addEventListener('submit', () => send({ type: 'accept_rules' }));
  $('report-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'report', name: $('report-name').value, reason: $('report-reason').value });
    $('report-name').value = '';
    $('report-reason').value = '';
  });
  $('block-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'block', name: $('block-name').value });
    $('block-name').value = '';
  });
  $('admin-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'admin_action', action: $('admin-action').value, name: $('admin-name').value, hours: Number($('admin-hours').value), reason: $('admin-reason').value });
  });
  $('owner-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'admin_action', action: $('owner-action').value, name: $('owner-name').value });
  });
  $('announce-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'admin_action', action: 'announce', text: $('announce-text').value });
    $('announce-text').value = '';
  });

  // ---------- settings ----------
  document.querySelectorAll('input[name="lang"]').forEach(r => r.addEventListener('change', () => {
    state.lang = r.value;
    localStorage.setItem('gp.lang', state.lang);
    applyLang();
  }));
  $('notif-toggle').addEventListener('change', () => {
    state.notif = $('notif-toggle').checked;
    localStorage.setItem('gp.notif', state.notif ? 'on' : 'off');
    if (state.notif) notifAudio.play().catch(() => {});
  });
  document.querySelectorAll('input[name="music"]').forEach(r => r.addEventListener('change', () => {
    state.music = Number(r.value);
    localStorage.setItem('gp.music', String(state.music));
    applyMusic();
  }));

  // ---------- global shortcuts: F1 settings, F2 mic ----------
  function renderHelp() {
    const g = state.game;
    const advOpen = !$('view-world').hidden;
    $('help-body').innerHTML = t(g && g.id === 'farkle' ? 'helpFarkle' : advOpen ? 'helpAdv' : 'helpPlatform');
  }
  document.addEventListener('keydown', ev => {
    if (ev.key === 'F1') {
      ev.preventDefault();
      const d = $('help-dialog');
      if (d.open) d.close(); else { renderHelp(); d.showModal(); $('help-body').focus(); }
    } else if (ev.key === 'F10') {
      ev.preventDefault();
      const d = $('settings-dialog');
      if (d.open) d.close(); else { $('screens-fieldset').hidden = $('view-lobby').hidden; d.showModal(); }
    } else if (ev.key === 'F9') {
      if (state.role !== 'mod' && state.role !== 'owner') return;
      if ($('view-lobby').hidden) return;
      ev.preventDefault();
      showLobbyScreen('screen-lobby-admin');
    } else if (ev.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return;
      const etag = ev.target && ev.target.tagName;
      if (!$('view-table').hidden) {
        if (etag === 'INPUT' || etag === 'TEXTAREA') return;
        send({ type: 'leave_table' });
      } else if (!$('view-lobby').hidden) {
        ev.preventDefault();
        showLobbyScreen('screen-lobby-games');
      }
    } else if (ev.key === 'F2') {
      ev.preventDefault();
      setMic(!state.mic);
    } else if (ev.code === 'KeyR') {
      const tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
      if ($('view-lobby').hidden && $('view-world').hidden) return;
      if ($('settings-dialog').open) return;
      ev.preventDefault();
      renderRules();
      $('rules-dialog').showModal();
      $('rules-body').focus();
    } else if (ev.code === 'KeyB') {
      const tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
      if ($('view-table').hidden || $('settings-dialog').open) return;
      ev.preventDefault();
      send({ type: 'add_bot' });
    }
  });

  // ---------- boot ----------
  applyLang();
  if (state.name) { $('login-name').value = state.name; connect(); }
  else show('login');
})();
