'use strict';
// Game platform server: static client hosting + WebSocket protocol.
// Phase 1: accounts (name + token), lobby, tables 2-10 players, table chat, friends.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { FarkleGame } = require('./farkle.js');
const { DominoesGame } = require('./dominoes.js');
const { SnakesGame } = require('./snakes.js');
const { WorldEngine } = require('./engine.js');

// روح المغامرة shared world (phase 1): one persistent world for all players
const world = new WorldEngine();
function routeWorldEvents(events) {
  for (const ev of events) {
    const { to, ...body } = ev;
    if (to === 'area') {
      const { area, except, ...rest } = body;
      for (const p of world.players.values()) {
        if (p.area === area && p.id !== except) sendToUser(p.id, { type: 'adv_event', ...rest });
      }
    } else {
      sendToUser(to, { type: 'adv_event', ...body });
    }
  }
}

const ENGINES = { farkle: FarkleGame, dominoes: DominoesGame, snakes: SnakesGame };
const { bestSelection } = require('./farkle.js');
const GAME_ACTIONS = {
  farkle: ['roll', 'setAside', 'bank', 'endTurnAfterFarkle'],
  dominoes: ['play', 'draw', 'pass', 'nextRound'],
  snakes: ['roll'],
};
function gamePublicState(t) {
  return { game: t.game.id, state: t.game.instance.state() };
}
function broadcastGameState(t) {
  broadcastTable(t, { type: 'game_state', ...gamePublicState(t) });
  if (t.game.id === 'dominoes') {
    t.playerIds.forEach((pid, idx) => sendToUser(pid, { type: 'game_hand', game: 'dominoes', hand: t.game.instance.handOf(idx) }));
  }
}

const CLIENT_DIR = __dirname;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_PLAYERS = 10;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

// ---------- persistence ----------
// data: { users, penalties, reports }
// users: name(lower) -> { id, name, token, friends: [], role: 'player'|'mod'|'owner',
//   sawRules: bool, blocked: [lowerName,...], muteUntil: ts|null, banUntil: ts|'perm'|null }
let users = {};
let penalties = [];
let reports = [];
// Persistent store: Upstash Redis over HTTPS when configured (production),
// otherwise a local JSON file (development and tests).
const Kv = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const call = async (method, path, body) => {
      const res = await fetch(url.replace(/\/$/, '') + path, {
        method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error('kv ' + res.status);
      return res.json();
    };
    return {
      kind: 'upstash',
      async load() {
        const r = await call('GET', '/get/gpdata');
        return r && r.result ? JSON.parse(r.result) : null;
      },
      async save(blob) { await call('POST', '/set/gpdata', blob); },
    };
  }
  return {
    kind: 'file',
    async load() {
      try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
    },
    async save(blob) {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(blob, null, 1));
      fs.renameSync(tmp, DATA_FILE);
    },
  };
})();
async function loadData() {
  try {
    const d = await Kv.load();
    users = (d && d.users) || {};
    penalties = (d && d.penalties) || [];
    reports = (d && d.reports) || [];
  } catch (e) {
    console.error('kv load failed, starting empty:', e.message);
    users = {}; penalties = []; reports = [];
  }
}
let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Kv.save({ users, penalties, reports }).catch(e => console.error('kv save failed:', e.message));
  }, 250);
}

// ---------- moderation ----------
// The owner (admin) is the player whose name matches OWNER_NAME (default: أحمد).
const OWNER_NAME = process.env.OWNER_NAME || 'أحمد';
function isOwnerName(name) { return lowerName(name) === lowerName(OWNER_NAME); }
function roleOf(user) { return isOwnerName(user.name) ? 'owner' : (user.role === 'mod' ? 'mod' : 'player'); }
function isMod(user) { const r = roleOf(user); return r === 'mod' || r === 'owner'; }
function logPenalty(by, target, type, reason, until) {
  penalties.push({ ts: Date.now(), by, target, type, reason: String(reason || '').slice(0, 200), until: until || null });
  saveData();
}

// ---------- live state ----------
const online = new Map(); // userId -> { ws, user }
let nextTableId = 1;
const tables = new Map(); // id -> { id, name, playerIds: [], }

function lowerName(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

function memberName(t, id) { return online.get(id)?.user.name || t.botNames[id] || usersName(id); }
function publicTable(t) {
  return {
    id: t.id, name: t.name,
    players: t.playerIds.map(id => memberName(t, id)),
    max: MAX_PLAYERS,
  };
}
function usersName(id) {
  for (const k in users) if (users[k].id === id) return users[k].name;
  return '?';
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function sendToUser(userId, msg) { const o = online.get(userId); if (o) send(o.ws, msg); }
function broadcastTable(t, msg, exceptId) {
  for (const pid of t.playerIds) if (pid !== exceptId) sendToUser(pid, msg);
}
function broadcastLobby(msg) {
  for (const [id, o] of online) if (!o.tableId) send(o.ws, msg);
}
function tablesPayload() { return { type: 'tables', tables: [...tables.values()].map(publicTable) }; }
function friendsPayload(user) {
  return {
    type: 'friends',
    friends: user.friends.map(k => {
      const f = users[k];
      return f ? { name: f.name, online: online.has(f.id) } : null;
    }).filter(Boolean),
  };
}
function err(ws, code) { send(ws, { type: 'error', code }); }

// ---------- voice (LiveKit) ----------
const LK_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LK_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LK_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function livekitToken(identity, name, room) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: LK_KEY, sub: identity, name, iat: now, nbf: now - 10, exp: now + 3600,
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
  }));
  const sig = crypto.createHmac('sha256', LK_SECRET).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const CLIENT_VERSION = 'v6-2026-11-25';

const handlers = {
  hello(o, msg) {
    const key = lowerName(msg.name);
    if (!key || key.length > 24) return err(o.ws, 'bad_name');
    let user = users[key];
    if (user) {
      if (user.token !== msg.token) return err(o.ws, 'name_taken');
      if (online.has(user.id)) return err(o.ws, 'already_online');
      if (user.banUntil === 'perm' || (user.banUntil && user.banUntil > Date.now())) return err(o.ws, 'banned');
    } else {
      user = { id: crypto.randomUUID(), name: String(msg.name).trim().replace(/\s+/g, ' '), token: crypto.randomUUID(), friends: [], role: 'player', sawRules: false, blocked: [], muteUntil: null, banUntil: null };
      users[key] = user;
      saveData();
    }
    o.user = user;
    online.set(user.id, o);
    send(o.ws, { type: 'welcome', id: user.id, name: user.name, token: user.token, role: roleOf(user) });
    console.log(`[version] ${user.name} client=${msg.version || 'unknown'} server=${CLIENT_VERSION}`);
    if (msg.version !== CLIENT_VERSION) send(o.ws, { type: 'client_old', server: CLIENT_VERSION });
    if (!user.sawRules) send(o.ws, { type: 'rules' });
    send(o.ws, tablesPayload());
    send(o.ws, friendsPayload(user));
    // tell friends who are online that this user came online
    for (const [id, other] of online) {
      if (id !== user.id && other.user.friends.includes(key)) send(other.ws, friendsPayload(other.user));
    }
  },
  create_table(o, msg) {
    if (!o.user) return;
    if (o.tableId) return err(o.ws, 'already_in_table');
    const name = String(msg.name || '').trim().slice(0, 40) || o.user.name;
    const t = { id: nextTableId++, name, playerIds: [o.user.id], botIds: new Set(), botNames: {}, botSeq: 0, botTimer: null };
    tables.set(t.id, t);
    o.tableId = t.id;
    send(o.ws, { type: 'joined', table: publicTable(t) });
    broadcastLobby(tablesPayload());
  },
  list_tables(o) { send(o.ws, tablesPayload()); },
  join_table(o, msg) {
    if (!o.user) return;
    if (o.tableId) return err(o.ws, 'already_in_table');
    const t = tables.get(Number(msg.id));
    if (!t) return err(o.ws, 'no_table');
    if (t.playerIds.length >= MAX_PLAYERS) return err(o.ws, 'table_full');
    t.playerIds.push(o.user.id);
    o.tableId = t.id;
    send(o.ws, { type: 'joined', table: publicTable(t) });
    if (t.game) send(o.ws, { type: 'game_started', ...gamePublicState(t), spectator: true });
    broadcastTable(t, { type: 'table_update', table: publicTable(t) }, o.user.id);
    broadcastLobby(tablesPayload());
  },
  leave_table(o) { leaveTable(o); },
  chat(o, msg) {
    if (!o.user || !o.tableId) return err(o.ws, 'not_in_table');
    if (o.user.muteUntil && o.user.muteUntil > Date.now()) return err(o.ws, 'muted');
    const t = tables.get(o.tableId);
    if (!t) return err(o.ws, 'not_in_table');
    const text = String(msg.text || '').slice(0, 500);
    if (!text.trim()) return;
    const out = { type: 'chat', from: o.user.name, text, ts: Date.now() };
    send(o.ws, out);
    broadcastTable(t, out, o.user.id);
  },
  add_friend(o, msg) {
    if (!o.user) return;
    const key = lowerName(msg.name);
    const f = users[key];
    if (!f) return err(o.ws, 'no_such_user');
    if (f.id === o.user.id) return err(o.ws, 'bad_name');
    if (!o.user.friends.includes(key)) { o.user.friends.push(key); saveData(); }
    send(o.ws, friendsPayload(o.user));
  },
  start_game(o, msg) {
    if (!o.user || !o.tableId) return err(o.ws, 'not_in_table');
    const t = tables.get(o.tableId);
    if (!t) return err(o.ws, 'not_in_table');
    if (t.playerIds.length < 2) return err(o.ws, 'need_players');
    const Engine = ENGINES[msg.game];
    if (!Engine) return err(o.ws, 'unknown_game');
    const names = t.playerIds.map(id => memberName(t, id));
    t.game = { id: msg.game, instance: new Engine(names) };
    broadcastTable(t, { type: 'game_started', ...gamePublicState(t) });
    if (t.game.id === 'dominoes') {
      t.playerIds.forEach((pid, idx) => sendToUser(pid, { type: 'game_hand', game: 'dominoes', hand: t.game.instance.handOf(idx) }));
    }
    maybeBotTurn(t);
  },
  game_action(o, msg) {
    if (!o.user || !o.tableId) return err(o.ws, 'not_in_table');
    const t = tables.get(o.tableId);
    if (!t || !t.game) return err(o.ws, 'no_game');
    const allowed = GAME_ACTIONS[t.game.id];
    if (!allowed.includes(msg.action)) return err(o.ws, 'bad_action');
    const playerIdx = t.playerIds.indexOf(o.user.id);
    if (playerIdx < 0 || playerIdx >= t.game.instance.players.length ||
        t.game.instance.players[playerIdx] !== o.user.name) return err(o.ws, 'not_in_game');
    let result;
    try {
      result = t.game.instance[msg.action](playerIdx, ...(Array.isArray(msg.args) ? msg.args : []));
    } catch (e) {
      return err(o.ws, 'game:' + (e.message || 'failed'));
    }
    // a dominoes draw is private: the drawn tile goes only to the drawer
    if (t.game.id === 'dominoes' && msg.action === 'draw') {
      broadcastTable(t, { type: 'game_event', game: t.game.id, action: 'draw', by: o.user.name, result: { boneyard: result.boneyard } }, o.user.id);
      send(o.ws, { type: 'game_event', game: t.game.id, action: 'draw', by: o.user.name, result });
    } else {
      broadcastTable(t, { type: 'game_event', game: t.game.id, action: msg.action, by: o.user.name, result });
    }
    broadcastGameState(t);
    maybeBotTurn(t);
  },
  end_game(o) {
    if (!o.user || !o.tableId) return;
    const t = tables.get(o.tableId);
    if (!t || !t.game) return;
    t.game = null;
    broadcastTable(t, { type: 'game_ended' });
  },
  add_bot(o) {
    if (!o.user || !o.tableId) return err(o.ws, 'not_in_table');
    const t = tables.get(o.tableId);
    if (!t) return err(o.ws, 'not_in_table');
    if (t.playerIds.length >= MAX_PLAYERS) return err(o.ws, 'table_full');
    const id = 'bot-' + crypto.randomUUID();
    let name;
    do { name = 'Bot ' + (++t.botSeq); } while (t.playerIds.some(pid => memberName(t, pid) === name));
    t.playerIds.push(id);
    t.botIds.add(id);
    t.botNames[id] = name;
    if (t.game) {
      try { t.game.instance.addPlayer(name); } catch (e) { return err(o.ws, 'game:' + (e.message || 'failed')); }
      broadcastGameState(t);
    }
    broadcastTable(t, { type: 'table_update', table: publicTable(t) });
    maybeBotTurn(t);
  },
  voice_join(o) {
    if (!o.user || !o.tableId) return err(o.ws, 'not_in_table');
    const t = tables.get(o.tableId);
    if (!t) return err(o.ws, 'not_in_table');
    send(o.ws, { type: 'voice_token', url: LK_URL, room: 'table-' + t.id, token: livekitToken(o.user.id, o.user.name, 'table-' + t.id) });
  },
  remove_friend(o, msg) {
    if (!o.user) return;
    const key = lowerName(msg.name);
    o.user.friends = o.user.friends.filter(k => k !== key);
    saveData();
    send(o.ws, friendsPayload(o.user));
  },
  // ---------- روح المغامرة world ----------
  enter_world(o, msg) {
    if (!o.user) return;
    if (o.tableId) return err(o.ws, 'already_in_table');
    if (o.inWorld) return;
    o.inWorld = true;
    routeWorldEvents(world.enter(o.user.id, o.user.name, msg.lang));
  },
  leave_world(o) {
    if (!o.user || !o.inWorld) return;
    o.inWorld = false;
    routeWorldEvents(world.leave(o.user.id));
    send(o.ws, { type: 'adv_left' });
  },
  world_action(o, msg) {
    if (!o.user || !o.inWorld) return err(o.ws, 'not_in_world');
    const a = msg.action;
    let events = [];
    if (a === 'move') events = world.move(o.user.id, msg.dir);
    else if (a === 'power') events = world.setPower(o.user.id, Number(msg.power));
    else if (a === 'jump') events = world.jump(o.user.id);
    else if (a === 'explore') events = world.explore(o.user.id, msg.dir);
    else if (a === 'where') events = world.where(o.user.id);
    else if (a === 'enter') events = world.enterPlace(o.user.id);
    else if (a === 'online') {
      const c = world.onlineByLang();
      events = [{ to: o.user.id, kind: 'online', ar: c.ar, en: c.en }];
    } else return err(o.ws, 'bad_action');
    routeWorldEvents(events);
  },
  pm(o, msg) {
    if (!o.user) return;
    if (o.user.muteUntil && o.user.muteUntil > Date.now()) return err(o.ws, 'muted');
    const target = users[lowerName(msg.to)];
    if (!target) return err(o.ws, 'no_such_user');
    if (target.id === o.user.id) return err(o.ws, 'bad_name');
    if ((target.blocked || []).includes(lowerName(o.user.name))) return err(o.ws, 'blocked');
    const text = String(msg.text || '').slice(0, 500);
    if (!text.trim()) return;
    const out = { type: 'pm', from: o.user.name, to: target.name, text, ts: Date.now() };
    send(o.ws, out); // sender gets a copy as confirmation
    const t = online.get(target.id);
    if (t) send(t.ws, out);
    else send(o.ws, { type: 'pm_offline', to: target.name });
  },
  // ---------- rules, reporting, personal mute ----------
  accept_rules(o) {
    if (!o.user) return;
    o.user.sawRules = true;
    saveData();
  },
  report(o, msg) {
    if (!o.user) return;
    const target = users[lowerName(msg.name)];
    if (!target) return err(o.ws, 'no_such_user');
    if (target.id === o.user.id) return err(o.ws, 'bad_name');
    const reason = String(msg.reason || '').slice(0, 300);
    if (!reason.trim()) return err(o.ws, 'bad_action');
    reports.push({ ts: Date.now(), by: o.user.name, target: target.name, reason });
    saveData();
    send(o.ws, { type: 'report_sent', name: target.name });
    const notice = { type: 'mod_notice', kind: 'report', by: o.user.name, name: target.name, reason };
    for (const [, other] of online) if (isMod(other.user)) send(other.ws, notice);
  },
  block(o, msg) {
    if (!o.user) return;
    const key = lowerName(msg.name);
    const target = users[key];
    if (!target) return err(o.ws, 'no_such_user');
    if (target.id === o.user.id) return err(o.ws, 'bad_name');
    o.user.blocked = o.user.blocked || [];
    if (!o.user.blocked.includes(key)) { o.user.blocked.push(key); saveData(); }
    send(o.ws, { type: 'blocked', name: target.name });
  },
  unblock(o, msg) {
    if (!o.user) return;
    const key = lowerName(msg.name);
    o.user.blocked = (o.user.blocked || []).filter(k => k !== key);
    saveData();
    send(o.ws, { type: 'unblocked', name: String(msg.name || '').trim() });
  },
  // ---------- moderator / owner actions ----------
  // mute1h, kick, tempban (hours), permaban, unban: mods + owner.
  // addmod, removemod, announce, clear_reports: owner only.
  // Nobody can punish the owner; mods cannot punish other mods.
  admin_action(o, msg) {
    if (!o.user || !isMod(o.user)) return err(o.ws, 'not_mod');
    const action = String(msg.action || '');
    const reason = String(msg.reason || '').slice(0, 200);
    if (action === 'announce') {
      if (roleOf(o.user) !== 'owner') return err(o.ws, 'not_owner');
      const text = String(msg.text || '').slice(0, 500);
      if (!text.trim()) return err(o.ws, 'bad_action');
      for (const [, other] of online) send(other.ws, { type: 'announcement', from: o.user.name, text });
      logPenalty(o.user.name, '*', 'announce', text, null);
      return;
    }
    if (action === 'clear_reports') {
      if (roleOf(o.user) !== 'owner') return err(o.ws, 'not_owner');
      reports = [];
      saveData();
      return;
    }
    const target = users[lowerName(msg.name)];
    if (!target) return err(o.ws, 'no_such_user');
    const tRole = roleOf(target);
    if (tRole === 'owner') return err(o.ws, 'bad_name');
    if (action === 'addmod' || action === 'removemod') {
      if (roleOf(o.user) !== 'owner') return err(o.ws, 'not_owner');
      target.role = action === 'addmod' ? 'mod' : 'player';
      saveData();
      logPenalty(o.user.name, target.name, action, reason, null);
      const tOnline = online.get(target.id);
      if (tOnline) send(tOnline.ws, { type: 'role_changed', role: roleOf(target) });
      send(o.ws, { type: 'admin_done', action, name: target.name });
      return;
    }
    // punitive actions: mods cannot punish mods
    if (tRole === 'mod' && roleOf(o.user) !== 'owner') return err(o.ws, 'bad_name');
    if (action === 'mute1h') {
      target.muteUntil = Date.now() + 3600e3;
      saveData();
      logPenalty(o.user.name, target.name, 'mute1h', reason, target.muteUntil);
    } else if (action === 'kick') {
      logPenalty(o.user.name, target.name, 'kick', reason, null);
    } else if (action === 'tempban') {
      const hours = Number(msg.hours) || 24;
      target.banUntil = Date.now() + hours * 3600e3;
      saveData();
      logPenalty(o.user.name, target.name, 'tempban', reason, target.banUntil);
    } else if (action === 'permaban') {
      if (roleOf(o.user) !== 'owner') return err(o.ws, 'not_owner');
      target.banUntil = 'perm';
      saveData();
      logPenalty(o.user.name, target.name, 'permaban', reason, 'perm');
    } else if (action === 'unban') {
      target.banUntil = null;
      target.muteUntil = null;
      saveData();
      logPenalty(o.user.name, target.name, 'unban', reason, null);
    } else return err(o.ws, 'bad_action');
    // live enforcement on the target
    const tOnline = online.get(target.id);
    if (tOnline) {
      if (action === 'kick' || action === 'tempban' || action === 'permaban') {
        leaveTable(tOnline);
        if (tOnline.inWorld) { tOnline.inWorld = false; routeWorldEvents(world.leave(target.id)); }
        send(tOnline.ws, { type: 'penalized', action, reason });
        tOnline.ws.close();
      } else if (action === 'mute1h' || action === 'unban') {
        send(tOnline.ws, { type: 'penalized', action, reason });
      }
    }
    send(o.ws, { type: 'admin_done', action, name: target.name });
  },
};

// ---------- bots ----------
function botAction(gameId, g, idx) {
  if (g.winner) return null;
  if (gameId === 'farkle') {
    if (g.farkled || g.phase === 'over') return { action: 'endTurnAfterFarkle' };
    if (g.phase === 'must_roll') {
      if (g.canBank(idx) && (g.turnPoints >= 50 || g.diceLeft <= 3)) return { action: 'bank' };
      return { action: 'roll' };
    }
    if (g.phase === 'deciding') {
      const sel = bestSelection(g.lastRoll);
      return sel ? { action: 'setAside', args: [sel.indices] } : null;
    }
    return null;
  }
  if (gameId === 'dominoes') {
    if (g.roundOver) return { action: 'nextRound' };
    const playable = g.playableIndices(idx);
    if (playable.length) {
      let bestIdx = playable[0], bestPips = -1;
      for (const i of playable) {
        const tile = g.hands[idx][i];
        const p = tile[0] + tile[1];
        if (p > bestPips) { bestPips = p; bestIdx = i; }
      }
      const sides = g.placementsFor(g.hands[idx][bestIdx]);
      const side = sides.includes('both') ? 'left' : sides[0];
      return { action: 'play', args: [bestIdx, side] };
    }
    if (g.variant === 'draw' && g.boneyard.length) return { action: 'draw' };
    return { action: 'pass' };
  }
  if (gameId === 'snakes') return { action: 'roll' };
  return null;
}

function maybeBotTurn(t) {
  if (!t.game) return;
  const g = t.game.instance;
  const idx = g.turn;
  if (idx == null || !t.botIds.has(t.playerIds[idx])) return;
  clearTimeout(t.botTimer);
  t.botTimer = setTimeout(() => {
    if (tables.get(t.id) !== t || !t.game) return;
    const gg = t.game.instance;
    if (gg.turn !== idx) return maybeBotTurn(t);
    const move = botAction(t.game.id, gg, idx);
    if (!move) return;
    let result;
    try { result = gg[move.action](idx, ...(move.args || [])); }
    catch (e) { console.error('bot move failed', t.game.id, move.action, e.message); return; }
    // draw is private for humans; bots have no client, but keep the same rule
    if (t.game.id === 'dominoes' && move.action === 'draw') {
      broadcastTable(t, { type: 'game_event', game: t.game.id, action: 'draw', by: gg.players[idx], result: { boneyard: result.boneyard } });
    } else {
      broadcastTable(t, { type: 'game_event', game: t.game.id, action: move.action, by: gg.players[idx], result });
    }
    broadcastGameState(t);
    maybeBotTurn(t);
  }, 900 + Math.floor(Math.random() * 700));
}

function leaveTable(o) {
  if (!o.user || !o.tableId) return;
  const t = tables.get(o.tableId);
  o.tableId = null;
  send(o.ws, { type: 'left' });
  send(o.ws, tablesPayload());
  if (!t) return;
  t.playerIds = t.playerIds.filter(id => id !== o.user.id);
  // a player leaving mid-game ends the game for the table
  if (t.game && t.game.instance.players.includes(o.user.name)) {
    t.game = null;
    clearTimeout(t.botTimer);
    broadcastTable(t, { type: 'game_ended', reason: 'player_left', player: o.user.name });
  }
  const humansLeft = t.playerIds.some(id => !t.botIds.has(id));
  if (!humansLeft) { clearTimeout(t.botTimer); tables.delete(t.id); }
  else broadcastTable(t, { type: 'table_update', table: publicTable(t) });
  broadcastLobby(tablesPayload());
}

async function createServer(port = 0) {
  if (process.env.NODE_ENV === 'production') {
    const missing = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'].filter(k => !process.env[k]);
    if (missing.length) throw new Error('production requires real LiveKit credentials; missing: ' + missing.join(', '));
  }
  await loadData();
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = path.normalize(urlPath).replace(/^([/\\])+/, '');
    const file = path.join(CLIENT_DIR, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('not found'); }
      // code files must revalidate every load (app shells cache them on disk);
      // media can be cached for a day. ETag makes revalidations cheap 304s.
      const ext = path.extname(file);
      const st = fs.statSync(file);
      const etag = '"' + st.size + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      const cc = ['.html', '.js', '.mjs', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc, ETag: etag });
      res.end(data);
    });
  });
  const wss = new WebSocketServer({ server });
  // heartbeat: proxies may drop quiet connections; ping every 25s and reap dead sockets
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 25000);
  wss.on('close', () => clearInterval(beat));
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const o = { ws, user: null, tableId: null };
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const h = handlers[msg && msg.type];
      if (h) { try { h(o, msg); } catch (e) { console.error(e); } }
    });
    const drop = () => {
      if (!o.user) return;
      leaveTable(o);
      if (o.inWorld) { o.inWorld = false; routeWorldEvents(world.leave(o.user.id)); }
      online.delete(o.user.id);
      const key = lowerName(o.user.name);
      for (const [id, other] of online) {
        if (other.user.friends.includes(key)) send(other.ws, friendsPayload(other.user));
      }
    };
    ws.on('close', drop);
    ws.on('error', drop);
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, wss, port: server.address().port })));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  Promise.resolve()
    .then(() => createServer(port))
    .then(({ port }) => console.log(`game platform listening on http://localhost:${port}`))
    .catch(e => { console.error('refusing to start:', e.message); process.exit(1); });
}
module.exports = { createServer, MAX_PLAYERS };
