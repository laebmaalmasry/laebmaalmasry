'use strict';
/* روح المغامرة standalone shell: minimal glue so adventure.js (the phase-1 world
   client) runs on its own static page, talking to the live platform server.
   Provides the window.* contract adventure.js expects: state/t/announce/send/showView. */
(() => {
  const $ = id => document.getElementById(id);
  const SERVER = 'wss://ruby-ranger-5880.de.deplexo.com';
  const ROOH_VERSION = 'rooh-v1-2026-11-26';

  const state = {
    lang: localStorage.getItem('rooh.lang') || 'ar',
    name: localStorage.getItem('rooh.name') || '',
    token: localStorage.getItem('rooh.token') || '',
    ws: null,
  };
  window.state = state;
  window.CLIENT_VERSION = ROOH_VERSION;

  const t = key => STRINGS[state.lang][key];
  const terr = code => (STRINGS[state.lang].errors[code]) || code;
  window.t = key => t(key);

  function announce(msg) {
    const live = $('live');
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 30);
  }
  window.announce = m => announce(m);

  function send(obj) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj)); }
  window.send = o => send(o);

  function show(view) {
    for (const v of ['login', 'lobby', 'world']) $('view-' + v).hidden = v !== view;
    const el = { login: 'login-name', lobby: 'adv-enter-button', world: 'adv-focus' }[view];
    const target = $(el);
    if (target) target.focus();
  }
  window.showView = show;

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = t(el.dataset.i18n);
      el.textContent = typeof v === 'string' ? v : '';
    });
    document.querySelectorAll('input[name="lang"]').forEach(r => { r.checked = r.value === state.lang; });
  }

  function renderRules() { $('rules-body').innerHTML = t('rulesHtml'); }

  // ---------- websocket ----------
  function connect() {
    const ws = new WebSocket(SERVER);
    state.ws = ws;
    ws.onopen = () => {
      const code = ($('login-code').value || '').trim();
      send({ type: 'hello', name: state.name, token: state.token, code, version: ROOH_VERSION });
    };
    ws.onclose = () => {
      if (!state.name) return;
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
        localStorage.setItem('rooh.token', msg.token);
        localStorage.setItem('rooh.name', state.name);
        $('login-code').value = '';
        $('login-status').textContent = '';
        announce(t('connected'));
        show('lobby');
        break;
      case 'rules':
        renderRules();
        $('rules-dialog').showModal();
        $('rules-body').focus();
        break;
      case 'friends':
        window.lastFriendsList = msg.friends || [];
        break;
      case 'pm': {
        const mine = msg.from === state.name;
        const text = mine ? t('advPmTo')(msg.to, msg.text) : t('advPmFrom')(msg.from, msg.text);
        announce(text);
        if (window.ADV) { window.ADV.play('pm'); if (!$('view-world').hidden) window.ADV.log(text); }
        break;
      }
      case 'adv_event': if (window.ADV) window.ADV.onEvent(msg); break;
      case 'adv_left': if (window.ADV) window.ADV.onLeft(); break;
      case 'announcement': announce(t('announcementFrom')(msg.from, msg.text)); break;
      case 'penalized': announce(t('penalized')(msg.action)); break;
      case 'error':
        if (!$('view-login').hidden) $('login-status').textContent = terr(msg.code);
        announce(terr(msg.code));
        break;
      // platform traffic the standalone app does not use (tables, games, voice, admin)
      default: break;
    }
  }

  // ---------- forms ----------
  $('login-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const name = $('login-name').value.trim();
    if (!name) return;
    state.name = name;
    connect();
  });
  $('rules-form').addEventListener('submit', () => send({ type: 'accept_rules' }));
  document.querySelectorAll('input[name="lang"]').forEach(r => {
    r.addEventListener('change', () => {
      state.lang = r.value;
      localStorage.setItem('rooh.lang', r.value);
      applyLang();
    });
  });

  // ---------- boot ----------
  $('login-name').value = state.name;
  applyLang();
  show('login');
})();
