'use strict';
/* العب مع المصري (LaebMaAlMasry) client. Keyboard-first, screen-reader friendly. */
(() => {
  const $ = id => document.getElementById(id);
  const state = {
    lang: localStorage.getItem('gp.lang') || 'ar',
    notif: localStorage.getItem('gp.notif') !== 'off',
    music: Number(localStorage.getItem('gp.music') || '0'),
    confirmDanger: localStorage.getItem('gp.confirmDanger') !== 'off',
    botThink: Number(localStorage.getItem('gp.botThink') || '1000'),
    clearKept: localStorage.getItem('gp.clearKept') === 'on',
    keepMode: localStorage.getItem('gp.keepMode') || 'markers',
    autoMic: localStorage.getItem('gp.autoMic') === 'on',
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
  const CLIENT_VERSION = 'vE-2026-11-26';
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
    $('opt-confirm-danger').checked = state.confirmDanger;
    $('opt-bot-think').value = String(state.botThink);
    $('opt-clear-kept').checked = state.clearKept;
    $('opt-keep-mode').value = state.keepMode;
    $('auto-mic').checked = state.autoMic;
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

  // ---------- room log (full table history, incl. voice lines) ----------
  function roomLogLine(ev) {
    switch (ev.k) {
      case 'created': return t('logCreated')(ev.name, t(KIND_KEYS[ev.kind] || 'gameFarkle'), ev.min, ev.max);
      case 'joined': return t('logJoined')(ev.name);
      case 'left': return t('logLeft')(ev.name);
      case 'kick': return t('logKicked')(ev.name);
      case 'kickban': return t('logKickBanned')(ev.name);
      case 'host': return t('logHost')(ev.name);
      case 'voice': return t('logVoice')(ev.name);
      case 'restored': return t('logRestored')(ev.name);
      default: return '';
    }
  }
  function addRoomLine(text) {
    if (!text) return;
    const box = $('room-log');
    if (!box) return;
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
  }
  function renderRoomLog(log) {
    const box = $('room-log');
    if (!box) return;
    box.innerHTML = '';
    for (const ev of log) addRoomLine(roomLogLine(ev));
  }
  function appendRoomLog(ev) { addRoomLine(roomLogLine(ev)); }

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
    if (window.renderLobbyMenu) window.renderLobbyMenu(false);
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
      lkRoom.on('participantConnected', p => { addRoomLine(t('logVoice')(p.name || p.identity)); });
      await lkRoom.connect(msg.url, msg.token);
      window.__voiceRoom = lkRoom; // test hook
      // never auto-publish: the mic only goes live from an explicit F2 / button press
      if (voiceWanted) { announce(t('voiceOn')); addRoomLine(t('logVoiceSelf')); }
      if (voiceWanted && state.autoMic && !state.mic) setMic(true);
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
    if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return; // one socket only: a connecting/open socket's onopen sends hello with the current name
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    state.ws = ws;
    ws.onopen = () => {
      send({ type: 'hello', name: state.name, token: state.token, code: state.pendingCode || undefined, version: CLIENT_VERSION });
    };
    ws.onclose = () => {
      if (state.replacing) { state.replacing = false; return; } // login form replaced this socket on purpose
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
      case 'error': {
        const text = msg.code === 'need_players' ? t('needPlayersCount')(msg.active, msg.min) : terr(msg.code);
        if (!state.table && $('view-table').hidden) $('login-status').textContent = text;
        announce(text);
        break;
      }
      case 'client_old':
        announce(t('clientOld'));
        break;
      case 'online_list': {
        $('online-h').textContent = t('onlineTitle')(msg.names.length);
        const body = $('online-body');
        body.innerHTML = '';
        if (!msg.names.length) body.textContent = t('onlineEmpty');
        else for (const n of msg.names) { const p = document.createElement('p'); p.textContent = n; body.appendChild(p); }
        $('online-dialog').showModal();
        body.focus();
        break;
      }
      case 'table_saved': announce(t('roomSaved')); break;
      case 'saved_list':
        lastSaved = msg.saved || [];
        if (state.lobbyView === 'savedItem' && !lastSaved.some(x => x.id === state.savedId)) { state.lobbyView = 'main'; state.savedId = null; }
        if (!$('view-lobby').hidden && (state.lobbyFilter === 'saved' || state.lobbyView === 'savedItem')) renderLobbyMenu(true);
        break;
      case 'tables': renderTables(msg.tables); break;
      case 'friends': renderFriends(msg.friends); break;
      case 'joined':
        state.table = msg.table;
        if ($('room-log')) $('room-log').innerHTML = '';
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
      case 'table_log': renderRoomLog(msg.log || []); break;
      case 'table_log_event': appendRoomLog(msg.ev); break;
      case 'kicked':
        state.table = null;
        state.game = null;
        state.lobbyView = 'main'; state.lobbyKind = null; state.savedId = null;
        leaveVoice();
        show('lobby');
        announce(msg.banned ? t('youWereKickBanned')(msg.table || '') : t('youWereKicked')(msg.table || ''));
        break;
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
        state.lobbyView = 'main'; state.lobbyKind = null; state.savedId = null;
        leaveVoice();
        show('lobby');
        break;
    }
  }

  // ---------- lobby games menu (Cycle A): filter button on top, then per-kind rows ----------
  // views: 'main' (filter row + kind rows or filtered table rows), 'filter' (the filter choices),
  // 'kind' (create on top, that kind's tables, back last)
  state.lobbyView = 'main';
  state.lobbyFilter = 'all';
  state.lobbyKind = null;
  state.savedId = null;
  let lastSaved = [];
  const fmtSavedDate = ts => {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const KIND_KEYS = { farkle: 'gameFarkle', dominoes: 'gameDominoes', snakes: 'gameSnakes', chat: 'gameChatRoom' };
  const KIND_ORDER = ['farkle', 'dominoes', 'snakes', 'chat'];
  function kindTables(kind) { return lastTables.filter(tb => (tb.kind || 'farkle') === kind); }
  function tableRowText(tb) {
    const gname = t(KIND_KEYS[tb.kind || 'farkle']);
    const status = tb.playing ? t('statusPlaying') : t('statusWaiting');
    const friend = (lastFriends || []).find(f => f.online && tb.players.includes(f.name));
    return t('tableRow')(gname, status, tb.name, tb.players.length, friend ? friend.name : null);
  }
  function mkMenuBtn(text, onClick, disabled) {
    const b = document.createElement('button');
    b.textContent = text;
    b.tabIndex = -1;
    if (disabled) { b.setAttribute('aria-disabled', 'true'); b.addEventListener('click', () => announce(t('comingSoon'))); }
    else b.addEventListener('click', onClick);
    return b;
  }
  function renderLobbyMenu(refocus) {
    const box = $('lobby-games-menu');
    if (!box) return;
    const hadFocus = box.contains(document.activeElement);
    box.innerHTML = '';
    const add = b => box.appendChild(b);
    if (state.lobbyView === 'filter') {
      for (const f of ['all', 'waiting', 'playing', 'saved']) {
        add(mkMenuBtn(t('filterName_' + f), () => {
          state.lobbyFilter = f;
          state.lobbyView = 'main';
          if (f === 'saved') send({ type: 'saved_list' });
          announce(t('filterNow')(t('filterName_' + f)));
          renderLobbyMenu(true);
        }));
      }
      add(mkMenuBtn(t('back'), () => { state.lobbyView = 'main'; renderLobbyMenu(true); }));
    } else if (state.lobbyView === 'savedItem' && state.savedId != null) {
      const s = (lastSaved || []).find(x => x.id === state.savedId);
      if (s) {
        add(mkMenuBtn(t('miRestore'), () => send({ type: 'restore_saved', id: s.id })));
        add(mkMenuBtn(t('miDelete'), () => {
          const doIt = () => send({ type: 'delete_saved', id: s.id });
          if (state.confirmDanger) confirmDlg(t('confirmDeleteSaved'), t('confirmYes'), doIt);
          else doIt();
        }));
      }
      add(mkMenuBtn(t('back'), () => { state.lobbyView = 'main'; state.savedId = null; renderLobbyMenu(true); }));
    } else if (state.lobbyView === 'kind' && state.lobbyKind) {
      const kind = state.lobbyKind;
      add(mkMenuBtn(t('createTableBtn'), () => {
        send({ type: 'create_table', name: t(KIND_KEYS[kind]), game: kind, botDelay: state.botThink });
      }));
      for (const tb of kindTables(kind)) {
        add(mkMenuBtn(tableRowText(tb), () => send({ type: 'join_table', id: tb.id })));
      }
      add(mkMenuBtn(t('back'), () => { state.lobbyView = 'main'; state.lobbyKind = null; renderLobbyMenu(true); }));
    } else {
      add(mkMenuBtn(t('filterButton')(t('filterName_' + state.lobbyFilter)), () => {
        state.lobbyView = 'filter';
        renderLobbyMenu(true);
      }));
      if (state.lobbyFilter === 'all') {
        for (const kind of KIND_ORDER) {
          add(mkMenuBtn(t('kindRow')(t(KIND_KEYS[kind]), kindTables(kind).length), () => {
            state.lobbyView = 'kind';
            state.lobbyKind = kind;
            renderLobbyMenu(true);
          }));
        }
      } else if (state.lobbyFilter === 'saved') {
        if (!lastSaved.length) add(mkMenuBtn(t('noSavedTables'), null, true));
        for (const s of lastSaved) {
          add(mkMenuBtn(t('savedRow')(t(KIND_KEYS[s.kind] || 'gameFarkle'), fmtSavedDate(s.savedAt)), () => {
            state.lobbyView = 'savedItem';
            state.savedId = s.id;
            renderLobbyMenu(true);
          }));
        }
      } else {
        const wantPlaying = state.lobbyFilter === 'playing';
        const rows = lastTables.filter(tb => !!tb.playing === wantPlaying);
        if (!rows.length) add(mkMenuBtn(t('noTablesFilter'), null, true));
        for (const tb of rows) add(mkMenuBtn(tableRowText(tb), () => send({ type: 'join_table', id: tb.id })));
      }
    }
    if (refocus || hadFocus) { const b = box.querySelector('button'); if (b) setTimeout(() => b.focus(), 0); }
  }
  window.renderLobbyMenu = renderLobbyMenu;

  // ---------- vertical-menu model: Tab lands on a menu container, Up/Down + Enter inside ----------
  const menuScopeOf = a => a && a.closest ? a.closest('#game-view, #game-menu-buttons, #lobby-games-menu, #table-menu-buttons, #f1-menu-buttons, #confirm-buttons') : null;
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

  // ---------- Escape context menu (owner gets the full version, order per Ahmed's spec) ----------
  function openTableMenu() {
    const dlg = $('table-menu-dialog');
    const box = $('table-menu-buttons');
    const tb = state.table;
    if (!dlg || !box || !tb) return;
    const isHost = tb.host === state.name || state.role === 'owner' || state.role === 'mod';
    $('table-menu-h').textContent = t('roomMenuTitle');
    box.innerHTML = '';
    const item = (key, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = t(key);
      b.tabIndex = -1;
      if (disabled) { b.setAttribute('aria-disabled', 'true'); b.addEventListener('click', () => announce(t('comingSoon'))); }
      else b.addEventListener('click', () => { dlg.close(); fn(); });
      box.appendChild(b);
    };
    const noGame = (tb.kind || 'farkle') === 'chat';
    if (isHost) {
      if (!noGame) item('miStart', () => send({ type: 'start_game' }));
      item('miWhoIsOn', () => announce(t('playersList')(tb.players.join('، '))));
      if (!noGame) item('miGameOptions', () => openOptionsMenu(), (tb.kind || 'farkle') !== 'farkle');
      if (!noGame) item('miAddBot', () => send({ type: 'add_bot' }));
      if (!noGame) item('miRemoveBot', () => send({ type: 'remove_bot' }));
      if (!noGame) item('miReplacePlayer', null, true);
      item('miMakePrivate', null, true);
      item('miSaveRoom', () => send({ type: 'save_table' }));
      item('miInviteFriend', null, true);
      item('miHostMgmt', () => openHostMenu());
      item('miShareDeviceAudio', null, true);
      item('miShareClip', null, true);
      if (!noGame) item('miGameInfo', () => announce(t('gameInfoLine')(t(KIND_KEYS[tb.kind || 'farkle']), tb.min, tb.max)));
      if (!noGame) item('miHowToPlay', null, true);
      item('miLeaveRoom', () => send({ type: 'leave_table' }));
    } else {
      if (!noGame) item('miStart', () => send({ type: 'start_game' }));
      item('miWhoIsOn', () => announce(t('playersList')(tb.players.join('، '))));
      if (!noGame) item('miGameInfo', () => announce(t('gameInfoLine')(t(KIND_KEYS[tb.kind || 'farkle']), tb.min, tb.max)));
      if (!noGame) item('miHowToPlay', null, true);
      item('miLeaveRoom', () => send({ type: 'leave_table' }));
    }
    dlg.showModal();
    const b = box.querySelector('button');
    if (b) setTimeout(() => b.focus(), 0);
  }
  function openOptionsMenu() {
    const tb = state.table;
    if (!tb) return;
    const dlg = $('table-menu-dialog');
    const box = $('table-menu-buttons');
    const VALUES = { firstBankMin: [50, 100, 200], minBank: [30, 40, 50, 100], target: [1000, 2000, 3000, 5000] };
    const stage = Object.assign({ firstBankMin: 50, minBank: 30, target: 1000 }, tb.options || {});
    if (!dlg.open) dlg.showModal();
    const focusFirst = () => { const f = box.querySelector('button'); if (f) setTimeout(() => f.focus(), 0); };
    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.tabIndex = -1;
      b.addEventListener('click', fn);
      box.appendChild(b);
    };
    const renderList = () => {
      $('table-menu-h').textContent = t('miGameOptions');
      box.innerHTML = '';
      mkBtn(t('optRow')(t('optFirstBank'), stage.firstBankMin), () => renderValues('firstBankMin', 'optFirstBank'));
      mkBtn(t('optRow')(t('optLaterBank'), stage.minBank), () => renderValues('minBank', 'optLaterBank'));
      mkBtn(t('optRow')(t('optTarget'), stage.target), () => renderValues('target', 'optTarget'));
      mkBtn(t('saveChanges'), () => { send({ type: 'set_options', firstBankMin: stage.firstBankMin, minBank: stage.minBank, target: stage.target }); dlg.close(); announce(t('optionsSaved')); });
      mkBtn(t('back'), () => dlg.close());
      focusFirst();
    };
    const renderValues = (field, labelKey) => {
      $('table-menu-h').textContent = t(labelKey);
      box.innerHTML = '';
      for (const v of VALUES[field]) {
        mkBtn(String(v) + (v === stage[field] ? ' ✓' : ''), () => { stage[field] = v; announce(t('optRow')(t(labelKey), v)); renderList(); });
      }
      mkBtn(t('back'), () => renderList());
      focusFirst();
    };
    renderList();
  }
  function openHostMenu() {
    // إدارة المضيف submenu: make private, invite, replace, transfer host, kick, kick+ban, back
    const dlg = $('table-menu-dialog');
    const box = $('table-menu-buttons');
    if (!dlg.open) dlg.showModal();
    $('table-menu-h').textContent = t('miHostMgmt');
    box.innerHTML = '';
    const item = (key, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = t(key);
      b.tabIndex = -1;
      if (disabled) { b.setAttribute('aria-disabled', 'true'); b.addEventListener('click', () => announce(t('comingSoon'))); }
      else b.addEventListener('click', fn);
      box.appendChild(b);
    };
    item('miMakePrivate', null, true);
    item('miInviteFriend', null, true);
    item('miReplacePlayer', null, true);
    item('miTransferHost', () => openPlayerPicker('transfer_host'));
    item('miKick', () => openPlayerPicker('kick_player'));
    item('miKickBan', () => openPlayerPicker('kick_ban_player'));
    item('back', () => { dlg.close(); openTableMenu(); });
    const b = box.querySelector('button');
    if (b) setTimeout(() => b.focus(), 0);
  }
  function openPlayerPicker(action) {
    const dlg = $('table-menu-dialog');
    const box = $('table-menu-buttons');
    if (!dlg.open) dlg.showModal();
    const tb = state.table;
    $('table-menu-h').textContent = t('pickPlayer');
    box.innerHTML = '';
    for (const p of (tb ? tb.players : [])) {
      if (p === state.name) continue;
      const b = document.createElement('button');
      b.textContent = p;
      b.tabIndex = -1;
      b.addEventListener('click', () => {
        dlg.close();
        const doIt = () => send({ type: action, name: p });
        if (state.confirmDanger && action !== 'transfer_host') confirmDlg(t('confirmDangerAction')(p), t('confirmYes'), doIt);
        else doIt();
      });
      box.appendChild(b);
    }
    const back = document.createElement('button');
    back.textContent = t('back');
    back.tabIndex = -1;
    back.addEventListener('click', () => { dlg.close(); openTableMenu(); });
    box.appendChild(back);
    const b = box.querySelector('button');
    if (b) setTimeout(() => b.focus(), 0);
  }

  // ---------- one screen per area (Playroom model): Tab switches screens ----------
  // Only the active screen is in the DOM buffer, so NVDA browse mode reads
  // exactly one area top to bottom, never the whole page.
  const SCREENS = ['screen-game', 'screen-chat', 'screen-log', 'screen-table'];
  function screenMainEl(id) {
    if (id === 'screen-game') return $('farkle-primary') || $('game-view').querySelector('button:not([hidden])') || $('game-menu-buttons').querySelector('button') || $('game-view');
    if (id === 'screen-log') return $('room-log') || $('farkle-log') || $('game-log-holder');
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
  const LOBBY_SCREENS = ['screen-lobby-games', 'screen-lobby-tables', 'screen-lobby-friends', 'screen-lobby-report', 'screen-lobby-block', 'screen-lobby-admin'];
  function lobbyScreensAvailable() {
    const mod = state.role === 'mod' || state.role === 'owner';
    return LOBBY_SCREENS.filter(id => id !== 'screen-lobby-admin' || mod);
  }
  function lobbyScreenMainEl(id) {
    switch (id) {
      case 'screen-lobby-games': return $('lobby-games-menu').querySelector('button');
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
    if (state.ws) { state.replacing = true; try { state.ws.close(); } catch {} state.ws = null; }
    connect();
  });
  $('create-form').addEventListener('submit', ev => {
    ev.preventDefault();
    send({ type: 'create_table', name: $('table-name-input').value, botDelay: state.botThink });
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
  $('settings-button').addEventListener('click', () => openSettings());
  $('login-code-button').addEventListener('click', () => { $('login-code-text').textContent = ''; send({ type: 'login_code' }); });

  // ---------- F1 main menu + tabbed settings (Cycle A2) ----------
  function confirmDlg(text, yesLabel, yesFn) {
    const d = $('confirm-dialog');
    $('confirm-h').textContent = text;
    const box = $('confirm-buttons');
    box.innerHTML = '';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.tabIndex = -1;
      b.addEventListener('click', () => { d.close(); if (fn) fn(); });
      box.appendChild(b);
    };
    mk(yesLabel, yesFn);
    mk(t('back'), null);
    d.showModal();
    const b = box.querySelector('button');
    if (b) setTimeout(() => b.focus(), 0);
  }
  function doLogout() {
    const run = () => {
      localStorage.removeItem('gp.token');
      localStorage.removeItem('gp.name');
      const ws = state.ws;
      state.name = ''; state.token = ''; state.table = null; state.game = null; state.resumeTableId = null;
      leaveVoice();
      if (ws) { try { ws.close(); } catch {} }
      state.ws = null;
      show('login');
      announce(t('loggedOut'));
    };
    if (state.confirmDanger) confirmDlg(t('logoutConfirm'), t('confirmLogoutYes'), run);
    else run();
  }
  function openSettings() {
    const d = $('settings-dialog');
    selectTab(0, false);
    d.showModal();
    const tab = $('stab-general');
    if (tab) setTimeout(() => tab.focus(), 0);
  }
  function showOnline() { send({ type: 'online_list' }); }
  function openF1Menu() {
    const dlg = $('f1-menu-dialog');
    const box = $('f1-menu-buttons');
    box.innerHTML = '';
    const lobbyOnly = $('view-lobby').hidden;
    const item = (key, fn) => {
      const b = document.createElement('button');
      b.textContent = t(key);
      b.tabIndex = -1;
      if (!fn) { b.setAttribute('aria-disabled', 'true'); b.addEventListener('click', () => announce(t('comingSoon'))); }
      else b.addEventListener('click', () => { dlg.close(); fn(); });
      box.appendChild(b);
    };
    item('f1Logout', doLogout);
    item('f1Profile', null);
    item('f1Friends', () => { if (lobbyOnly) announce(t('f1LobbyOnly')); else showLobbyScreen('screen-lobby-friends'); });
    item('f1Messages', null);
    item('f1Stats', null);
    item('f1Boards', null);
    item('f1Tournaments', null);
    item('f1Online', showOnline);
    item('f1Settings', openSettings);
    item('f1Shortcuts', null);
    item('f1Support', null);
    item('f1Privacy', null);
    item('f1Terms', () => { renderRules(); $('rules-dialog').showModal(); $('rules-body').focus(); });
    dlg.showModal();
    const b = box.querySelector('button');
    if (b) setTimeout(() => b.focus(), 0);
  }
  const STABS = ['general', 'access', 'volume', 'voice', 'translate', 'privacy', 'game'];
  function selectTab(i, focusIt) {
    STABS.forEach((id, j) => {
      const on = i === j;
      const tb = $('stab-' + id);
      tb.setAttribute('aria-selected', on ? 'true' : 'false');
      tb.tabIndex = on ? 0 : -1;
      $('spanel-' + id).hidden = !on;
    });
    if (focusIt !== false) $('stab-' + STABS[i]).focus();
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const a = document.activeElement;
    if (!a || a.getAttribute('role') !== 'tab' || !a.closest('#settings-tabs')) return;
    ev.preventDefault();
    let i = STABS.indexOf(a.id.slice(5));
    i = ev.key === 'ArrowRight' ? (i + 1) % STABS.length : (i - 1 + STABS.length) % STABS.length;
    selectTab(i);
  });
  STABS.forEach(id => { $('stab-' + id).addEventListener('click', () => selectTab(STABS.indexOf(id))); });
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('opt-confirm-danger').addEventListener('change', () => { state.confirmDanger = $('opt-confirm-danger').checked; localStorage.setItem('gp.confirmDanger', state.confirmDanger ? 'on' : 'off'); });
  $('opt-bot-think').addEventListener('change', () => { state.botThink = Number($('opt-bot-think').value); localStorage.setItem('gp.botThink', String(state.botThink)); });
  $('opt-clear-kept').addEventListener('change', () => { state.clearKept = $('opt-clear-kept').checked; localStorage.setItem('gp.clearKept', state.clearKept ? 'on' : 'off'); });
  $('opt-keep-mode').addEventListener('change', () => { state.keepMode = $('opt-keep-mode').value; localStorage.setItem('gp.keepMode', state.keepMode); });
  $('auto-mic').addEventListener('change', () => { state.autoMic = $('auto-mic').checked; localStorage.setItem('gp.autoMic', state.autoMic ? 'on' : 'off'); });
  $('privacy-blocked').addEventListener('click', () => {
    $('settings-dialog').close();
    if (!$('view-lobby').hidden) showLobbyScreen('screen-lobby-block');
    else announce(t('f1LobbyOnly'));
  });
  $('online-close').addEventListener('click', () => $('online-dialog').close());

  // ---------- moderation UI ----------
  function applyRole() {
    const mod = state.role === 'mod' || state.role === 'owner';
    const ga = $('goto-admin');
    if ($('owner-form')) $('owner-form').hidden = state.role !== 'owner';
    if ($('announce-form')) $('announce-form').hidden = state.role !== 'owner';
    if (ga) ga.hidden = !mod;
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
      if (!$('view-world').hidden) return;
      ev.preventDefault();
      const d = $('f1-menu-dialog');
      if (d.open) d.close(); else openF1Menu();
    } else if (ev.key === 'F10') {
      ev.preventDefault();
      const d = $('settings-dialog');
      if (d.open) d.close(); else openSettings();
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
        ev.preventDefault();
        openTableMenu();
      } else if (!$('view-lobby').hidden) {
        ev.preventDefault();
        showLobbyScreen('screen-lobby-games');
      }
    } else if (ev.key === 'F2') {
      ev.preventDefault();
      setMic(!state.mic);
    } else if (ev.code === 'KeyH') {
      const htag = ev.target && ev.target.tagName;
      if (htag === 'INPUT' || htag === 'TEXTAREA' || (ev.target && ev.target.isContentEditable)) return;
      if ($('view-lobby').hidden) return;
      if (document.querySelector('dialog[open]')) return;
      ev.preventDefault();
      const hd = $('help-dialog');
      if (hd.open) hd.close(); else { renderHelp(); hd.showModal(); $('help-body').focus(); }
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
