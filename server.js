const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const express = require('express');
const forge = require('node-forge');
const { Server } = require('socket.io');
const { WORD_PAIRS } = require('./data/wordpairs');
const { BOT_CLUES, GENERIC_CLUES } = require('./data/botclues');

const STATE = { LOBBY: 'lobby', CLUES: 'clues', VOTE: 'vote', CATCH: 'catch', REVEAL: 'reveal' };
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const PARTNER = {};
for (const [a, b] of WORD_PAIRS) {
  PARTNER[normSafe(a)] = b;
  PARTNER[normSafe(b)] = a;
}

function normSafe(w) {
  return String(w || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function norm(word) {
  return String(word || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rnd(min, range) {
  return min + Math.floor(Math.random() * range);
}

function createRoom() {
  const code = makeCode();
  const room = {
    code,
    hostId: null,
    players: new Map(),
    phase: STATE.LOBBY,
    round: 0,
    secretWord: null,
    impostorWord: null,
    impostorId: null,
    order: [],
    turnIndex: 0,
    totalTurns: 0,
    clues: [],
    votes: new Map(),
    lastResult: null,
    notice: null,
    pendingReveal: null,
    botSeq: 0,
    timers: { clue: null, vote: null, catch: null },
    history: []
  };
  rooms.set(code, room);
  return room;
}

function getRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function nameTaken(room, name) {
  return [...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
}

function addPlayer(socket, room, name) {
  const clean = String(name || '').trim().slice(0, 12);
  if (clean.length < 2) return 'Name must be at least 2 characters.';
  if (nameTaken(room, clean)) return 'That name is taken in this room.';
  if (room.players.size >= MAX_PLAYERS) return 'Room is full (8 players max).';
  room.players.set(socket.id, { id: socket.id, name: clean, score: 0, bot: false });
  socket.join(room.code);
  socket.data.roomCode = room.code;
  if (!room.hostId) room.hostId = socket.id;
  return null;
}

const BOT_NAMES = ['Rahul', 'Priya', 'Arjun', 'Sneha', 'Vikram', 'Ananya', 'Karthik', 'Divya', 'Amit', 'Neha'];

function addBotPlayer(room) {
  if (room.players.size >= MAX_PLAYERS) return 'Room is full (8 players max).';
  room.botSeq += 1;
  let name;
  const free = BOT_NAMES.filter(n => !nameTaken(room, n));
  if (free.length) {
    name = free[Math.floor(Math.random() * free.length)];
  } else {
    for (let i = 2; ; i++) {
      name = `${BOT_NAMES[0]} ${i}`;
      if (!nameTaken(room, name)) break;
    }
  }
  const id = `bot_${room.code}_${room.botSeq}`;
  room.players.set(id, { id, name, score: 0, bot: true });
  return null;
}

let ioRef = null;
let authorityPem = null;

function clearBotTimers(room) {
  for (const key of ['clue', 'vote', 'catch']) {
    if (room.timers[key]) {
      clearTimeout(room.timers[key]);
      room.timers[key] = null;
    }
  }
}

function removePlayer(socket, notify) {
  const room = getRoom(socket);
  if (!room) return;
  const player = room.players.get(socket.id);
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (room.voice && room.voice.has(socket.id)) {
    room.voice.delete(socket.id);
    if (room.voice.size > 0) ioRef.to(room.code).emit('voiceState', { ids: [...room.voice] });
  }
  if (room.players.size === 0) {
    clearBotTimers(room);
    rooms.delete(room.code);
    return;
  }
  if (room.phase !== STATE.LOBBY) {
    room.phase = STATE.LOBBY;
    clearBotTimers(room);
    room.notice = `Round aborted: ${player ? player.name : 'a player'} left.`;
  } else if (notify && room.players.size > 0) {
    room.notice = `${player ? player.name : 'Someone'} left the room.`;
  }
  if (ioRef && room.players.size > 0) broadcast(room, ioRef);
}

function currentTurn(room) {
  if (room.phase !== STATE.CLUES) return null;
  const rotation = Math.floor(room.turnIndex / room.order.length) + 1;
  const playerIndex = room.turnIndex % room.order.length;
  return {
    playerId: room.order[playerIndex],
    rotation,
    totalRotations: 3,
    turnNumber: room.turnIndex + 1,
    totalTurns: room.totalTurns
  };
}

function tallyVotes(room) {
  const counts = new Map();
  for (const targetId of room.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { counts, entries };
}

function applyWin(room, wonBy, reason, reveal) {
  if (wonBy === 'innocents') {
    for (const p of room.players.values()) {
      if (p.id !== room.impostorId) p.score += 1;
    }
  } else {
    const imp = room.players.get(room.impostorId);
    if (imp) imp.score += 2;
  }
  room.wonBy = wonBy;
  room.lastResult = { wonBy, reason, ...reveal };
  const imp = room.players.get(room.impostorId);
  room.history.unshift({
    round: room.round,
    wonBy,
    reason,
    secretWord: room.secretWord,
    impostor: imp ? imp.name : 'gone'
  });
  room.history = room.history.slice(0, 5);
  room.phase = STATE.REVEAL;
}

function resolveVotes(room) {
  const { entries } = tallyVotes(room);
  const voteDetail = {};
  for (const [voterId, targetId] of room.votes) {
    voteDetail[voterId] = {
      voter: room.players.get(voterId) ? room.players.get(voterId).name : 'gone',
      target: room.players.get(targetId) ? room.players.get(targetId).name : 'gone'
    };
  }
  const reveal = { secretWord: room.secretWord, impostorWord: room.impostorWord, impostorId: room.impostorId, votes: voteDetail };
  if (entries.length > 1 && entries[0][1] === entries[1][1]) {
    applyWin(room, 'impostor', 'Tie vote: the impostor slipped away.', reveal);
    return;
  }
  const topTarget = entries[0][0];
  if (topTarget === room.impostorId) {
    room.phase = STATE.CATCH;
    room.pendingReveal = reveal;
    return;
  }
  applyWin(room, 'impostor', 'The wrong player was caught.', reveal);
}

function stateFor(room, playerId) {
  const players = [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    host: p.id === room.hostId,
    bot: !!p.bot
  }));
  const me = room.players.get(playerId);
  const state = {
    code: room.code,
    round: room.round,
    phase: room.phase,
    notice: room.notice,
    players,
    clues: room.clues,
    you: me ? { id: me.id, name: me.name, score: me.score, host: me.id === room.hostId } : null
  };
  const inRound = room.phase === STATE.CLUES || room.phase === STATE.VOTE || room.phase === STATE.CATCH;
  if (inRound && room.impostorId) {
    state.isImpostor = playerId === room.impostorId;
    state.yourWord = state.isImpostor ? room.impostorWord : room.secretWord;
    state.impostorCaught = room.phase === STATE.CATCH;
    if (state.impostorCaught) {
      state.impostorName = room.players.get(room.impostorId) ? room.players.get(room.impostorId).name : 'gone';
    }
  }
  if (room.phase === STATE.CLUES) {
    state.currentTurn = currentTurn(room);
    state.clueCount = room.clues.length;
  }
  if (room.phase === STATE.VOTE) {
    state.hasVoted = room.votes.has(playerId);
    state.voteCount = room.votes.size;
    state.voteTotal = room.players.size;
  }
  if (room.phase === STATE.REVEAL) {
    state.lastResult = room.lastResult;
    state.scores = [...room.players.values()].map(p => ({ name: p.name, score: p.score, bot: !!p.bot })).sort((a, b) => b.score - a.score);
  }
  if (room.history && room.history.length && (room.phase === STATE.REVEAL || room.phase === STATE.LOBBY)) {
    state.history = room.history;
  }
  return state;
}

function broadcast(room, io) {
  scheduleBotActions(room);
  for (const [socketId, p] of room.players) {
    if (p.bot) continue;
    io.to(socketId).emit('updateState', stateFor(room, socketId));
  }
}

function submitClueCore(room, playerId, rawWord) {
  if (room.phase !== STATE.CLUES) return 'Round is not in clue phase.';
  const turn = currentTurn(room);
  if (!turn || turn.playerId !== playerId) return "It's not your turn.";
  const clean = String(rawWord || '').trim();
  const low = norm(clean);
  if (low.length < 2) return 'Clue must be at least 2 characters.';
  if (room.clues.some(c => norm(c.word) === low)) return 'That word was already used.';
  const blocked = [room.secretWord, room.impostorWord].some(w => {
    const wn = norm(w);
    return wn === low || wn.includes(low) || low.includes(wn);
  });
  if (blocked) return 'Too close to the secret word, pick another.';
  const player = room.players.get(playerId);
  room.clues.push({ playerId, name: player ? player.name : 'gone', word: clean });
  room.turnIndex += 1;
  if (room.turnIndex >= room.totalTurns) {
    room.phase = STATE.VOTE;
  }
  if (ioRef) broadcast(room, ioRef);
  return null;
}

function applyVoteCore(room, voterId, targetId) {
  if (room.phase !== STATE.VOTE) return 'Voting is not open.';
  if (!room.players.has(targetId)) return 'Invalid vote target.';
  if (targetId === voterId) return 'You cannot vote yourself.';
  room.votes.set(voterId, targetId);
  if (room.votes.size === room.players.size) {
    resolveVotes(room);
  }
  if (ioRef) broadcast(room, ioRef);
  return null;
}

function submitCatchCore(room, playerId, rawGuess) {
  if (room.phase !== STATE.CATCH || playerId !== room.impostorId) return 'Not the impostor turn to guess.';
  const pendingReveal = room.pendingReveal;
  room.pendingReveal = null;
  const guessed = norm(rawGuess) === norm(room.secretWord);
  const reveal = { ...pendingReveal, catchGuess: String(rawGuess || '').trim() };
  if (guessed) {
    applyWin(room, 'impostor', 'The impostor was caught but guessed the word and stole the win!', reveal);
  } else {
    applyWin(room, 'innocents', 'The impostor was caught.', reveal);
  }
  room.votes = new Map();
  if (ioRef) broadcast(room, ioRef);
  return null;
}

/* ---------- bots ---------- */

function botAlive(room) {
  return rooms.get(room.code) === room;
}

function botOwnWord(room, botId) {
  return room.impostorId === botId ? room.impostorWord : room.secretWord;
}

function botCandidates(room, botId) {
  const own = norm(botOwnWord(room, botId));
  const partner = PARTNER[own] || null;
  const ownList = BOT_CLUES[own] || [];
  const partnerList = partner ? BOT_CLUES[partner] || [] : [];
  const used = new Set(room.clues.map(c => norm(c.word)));
  const forbidden = [norm(room.secretWord), norm(room.impostorWord)];
  const ok = candidate => {
    const low = norm(candidate);
    return (
      low.length >= 2 &&
      !used.has(low) &&
      !forbidden.some(w => w === low || w.includes(low) || low.includes(w))
    );
  };
  let pool = shuffle([...ownList, ...ownList, ...ownList, ...partnerList]).filter(ok);
  if (!pool.length) pool = shuffle(GENERIC_CLUES).filter(ok);
  if (pool.length) return pool;
  return [`${own.slice(0, 3)}-ish ${room.clues.length + 1}`];
}

function botClueTurn(room, botId) {
  if (!botAlive(room) || room.phase !== STATE.CLUES) return;
  const turn = currentTurn(room);
  if (!turn || turn.playerId !== botId) return;
  for (const candidate of botCandidates(room, botId)) {
    if (submitClueCore(room, botId, candidate) === null) return;
  }
}

const VOTE_STOPS = new Set(['of', 'the', 'and', 'a', 'in', 'at', 'on', 'with']);

function pickBotVote(room, botId) {
  const others = [...room.players.keys()].filter(id => id !== botId);
  if (room.impostorId === botId) return others[Math.floor(Math.random() * others.length)];
  const own = norm(botOwnWord(room, botId));
  const vibe = new Set();
  for (const phrase of BOT_CLUES[own] || []) {
    for (const tok of norm(phrase).split(/\s+/)) {
      if (tok.length >= 3 && !VOTE_STOPS.has(tok)) vibe.add(tok);
    }
  }
  const vibeScore = id => room.clues
    .filter(c => c.playerId === id)
    .reduce((n, c) => n + (norm(c.word).split(/\s+/).some(w => vibe.has(w)) ? 1 : 0), 0);
  const scored = others.map(id => ({ id, score: vibeScore(id) }));
  const minScore = Math.min(...scored.map(s => s.score));
  const pool = minScore === 0
    ? scored.filter(s => s.score === 0).map(s => s.id)
    : others;
  return pool[Math.floor(Math.random() * pool.length)];
}

function botVoteTurn(room) {
  if (!botAlive(room) || room.phase !== STATE.VOTE) return;
  for (const p of room.players.values()) {
    if (!p.bot || room.votes.has(p.id)) continue;
    const err = applyVoteCore(room, p.id, pickBotVote(room, p.id));
    if (err) break;
  }
}

function botCatchTurn(room) {
  if (!botAlive(room) || room.phase !== STATE.CATCH) return;
  const own = norm(botOwnWord(room, room.impostorId));
  const chance = Math.random() < 0.25;
  const guess = chance && PARTNER[own] ? PARTNER[own] : botOwnWord(room, room.impostorId);
  submitCatchCore(room, room.impostorId, guess);
}

function scheduleBotActions(room) {
  clearBotTimers(room);
  if (room.phase === STATE.CLUES) {
    const turn = currentTurn(room);
    const p = turn && room.players.get(turn.playerId);
    if (p && p.bot) {
      room.timers.clue = setTimeout(() => botClueTurn(room, turn.playerId), rnd(900, 2200));
    }
  } else if (room.phase === STATE.VOTE) {
    const pendingBot = [...room.players.values()].find(p => p.bot && !room.votes.has(p.id));
    if (pendingBot) {
      room.timers.vote = setTimeout(() => botVoteTurn(room), rnd(1200, 2600));
    }
  } else if (room.phase === STATE.CATCH) {
    const imp = room.players.get(room.impostorId);
    if (imp && imp.bot) {
      room.timers.catch = setTimeout(() => botCatchTurn(room), rnd(1500, 2400));
    }
  }
}

function createGameServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  ioRef = io;
  const basePort = process.env.PORT || 3000;
  const httpsPort = Number(basePort) + 1;

  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: res => res.setHeader('Cache-Control', 'no-store')
  }));

  try {
    const snapshot = '// generated by server.js at startup — word pool for offline/party use\nwindow.__PAIRS = ' + JSON.stringify(WORD_PAIRS) + ';\n';
    const snapPath = path.join(__dirname, 'public', 'pairs.js');
    if (!fs.existsSync(snapPath) || fs.readFileSync(snapPath, 'utf8') !== snapshot) {
      fs.writeFileSync(snapPath, snapshot);
    }
  } catch (e) {}


  app.get('/api/pairs', (req, res) => {
    res.json(WORD_PAIRS);
  });

  app.get('/api/meta', (req, res) => {
    res.json({ lanIp: lanIpOf() || '', httpsPort, httpPort: Number(basePort), hasCert: !!authorityPem });
  });

  app.get('/api/ice', (req, res) => {
    const out = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrls = process.env.TURN_URLS || 'turn:openrelay.metered.ca:80?transport=udp,turn:openrelay.metered.ca:443?transport=udp';
    const turnUser = process.env.TURN_USERNAME || 'openrelayproject';
    const turnPass = process.env.TURN_CREDENTIAL || 'openrelayproject';
    out.push({ urls: turnUrls.split(','), username: turnUser, credential: turnPass });
    res.json(out);
  });

  app.get('/ca.crt', (req, res) => {
    if (!authorityPem) { res.status(404).send('Certificate not ready yet.'); return; }
    res.type('application/x-x509-ca-cert').set('Cache-Control', 'no-store').send(authorityPem);
  });

  buildHttpsServer(app, httpsPort, io, () => {
    console.log(`The Imposter ready:
  http   ${basePort}                     game + ca.crt download
  https  ${httpsPort}                    phone voice (accept the one-time warning, or install ca.crt)`);
  });

  io.on('connection', socket => {
    socket.on('createRoom', ({ name } = {}) => {
      removePlayer(socket, false);
      const room = createRoom();
      const err = addPlayer(socket, room, name);
      if (err) {
        rooms.delete(room.code);
        socket.emit('errorMsg', { msg: err });
        return;
      }
      broadcast(room, io);
    });

    socket.on('joinRoom', ({ code, name } = {}) => {
      removePlayer(socket, false);
      const cleanCode = String(code || '').trim().toUpperCase();
      const room = rooms.get(cleanCode);
      if (!room) {
        socket.emit('errorMsg', { msg: 'Room not found. Check the code.' });
        return;
      }
      if (room.phase !== STATE.LOBBY) {
        socket.emit('errorMsg', { msg: 'That room is mid-round. Try again in a moment.' });
        return;
      }
      const err = addPlayer(socket, room, name);
      if (err) {
        socket.emit('errorMsg', { msg: err });
        return;
      }
      room.notice = null;
      broadcast(room, io);
    });

    socket.on('addBot', () => {
      const room = getRoom(socket);
      if (!room || socket.id !== room.hostId || room.phase !== STATE.LOBBY) return;
      const err = addBotPlayer(room);
      if (err) {
        socket.emit('errorMsg', { msg: err });
        return;
      }
      broadcast(room, io);
    });

    socket.on('removeBot', ({ id } = {}) => {
      const room = getRoom(socket);
      if (!room || socket.id !== room.hostId || room.phase !== STATE.LOBBY) return;
      const bot = room.players.get(id);
      if (!bot || !bot.bot) return;
      room.players.delete(id);
      room.notice = `${bot.name} left the room.`;
      broadcast(room, io);
    });

    socket.on('startRound', () => {
      const room = getRoom(socket);
      if (!room || socket.id !== room.hostId) return;
      if (room.phase !== STATE.LOBBY && room.phase !== STATE.REVEAL) return;
      if (room.players.size < MIN_PLAYERS) {
        socket.emit('errorMsg', { msg: `Need at least ${MIN_PLAYERS} players to start.` });
        return;
      }
      const ids = [...room.players.keys()];
      const counts = room.imposterCounts || {};
      const tallies = ids.map(id => {
        const p = room.players.get(id);
        return { id, n: counts[p ? p.name : id] || 0 };
      });
      const minN = Math.min(...tallies.map(t => t.n));
      const pool = tallies.filter(t => t.n === minN);
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const [secretWord, impostorWord] = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
      room.round += 1;
      room.secretWord = secretWord;
      room.impostorWord = impostorWord;
      room.impostorId = chosen.id;
      room.imposterCounts = counts;
      if (room.players.get(chosen.id)) {
        counts[room.players.get(chosen.id).name] = (counts[room.players.get(chosen.id).name] || 0) + 1;
      }
      room.order = shuffle(ids);
      room.turnIndex = 0;
      room.totalTurns = room.order.length * 3;
      room.clues = [];
      room.votes = new Map();
      room.lastResult = null;
      room.pendingReveal = null;
      room.wonBy = null;
      room.notice = null;
      room.phase = STATE.CLUES;
      broadcast(room, io);
    });

    socket.on('submitClue', ({ word } = {}) => {
      const room = getRoom(socket);
      if (!room || room.phase !== STATE.CLUES) return;
      const err = submitClueCore(room, socket.id, word);
      if (err) socket.emit('errorMsg', { msg: err });
    });

    socket.on('castVote', ({ target } = {}) => {
      const room = getRoom(socket);
      if (!room || room.phase !== STATE.VOTE) return;
      const err = applyVoteCore(room, socket.id, target);
      if (err) socket.emit('errorMsg', { msg: err });
    });

    socket.on('submitCatchGuess', ({ guess } = {}) => {
      const room = getRoom(socket);
      if (!room || room.phase !== STATE.CATCH) return;
      const err = submitCatchCore(room, socket.id, guess);
      if (err) socket.emit('errorMsg', { msg: err });
    });

    socket.on('goLobby', () => {
      const room = getRoom(socket);
      if (!room || socket.id !== room.hostId) return;
      if (room.phase !== STATE.REVEAL) return;
      room.phase = STATE.LOBBY;
      room.notice = null;
      broadcast(room, io);
    });

    socket.on('voiceOn', () => {
      const room = getRoom(socket);
      if (!room || !room.players.get(socket.id)) return;
      room.voice = room.voice || new Set();
      room.voice.add(socket.id);
      io.to(room.code).emit('voiceState', { ids: [...room.voice] });
    });

    socket.on('voiceOff', () => {
      const room = getRoom(socket);
      if (!room || !room.voice) return;
      room.voice.delete(socket.id);
      io.to(room.code).emit('voiceState', { ids: [...room.voice] });
    });

    socket.on('voiceSignal', ({ to, payload } = {}) => {
      if (!to) return;
      const room = getRoom(socket);
      if (!room || !room.players.get(socket.id) || !room.players.get(to)) return;
      if (!room.voice || !room.voice.has(to) || !room.voice.has(socket.id)) return;
      io.to(to).emit('voiceSignal', { from: socket.id, payload });
    });

    socket.on('leaveRoom', () => removePlayer(socket, true));

    socket.on('disconnect', () => removePlayer(socket, false));
  });

  return httpServer;
}

function lanIpOf() {
  try {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const n of list) {
        if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.') && !n.address.startsWith('172.')) {
          return n.address;
        }
      }
    }
    for (const list of Object.values(nets)) {
      for (const n of list) {
        if (n.family === 'IPv4' && !n.internal) return n.address;
      }
    }
  } catch (e) {}
  return '';
}

function buildHttpsServer(app, httpsPort, io, done) {
  try {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (errL, kp) => {
      if (errL || !kp) { console.log('Skipping https (voice on phones) — key generation failed.'); return; }
        forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (errC, caKeys) => {
          if (errC || !caKeys) { console.log('Skipping https side-door — CA key generation failed.'); return; }
          try {
            const caPem = makeCert(caKeys.publicKey, caKeys.privateKey, 'The Imposter LAN Root', [], true, true);
            authorityPem = caPem;
            const lanIp = lanIpOf();
            const sans = [{ type: 2, value: 'imposter.lan' }];
            if (lanIp) sans.push({ type: 7, ip: lanIp });
            sans.push({ type: 7, ip: '127.0.0.1' });
            const leafPem = makeCert(kp.publicKey, caKeys.privateKey, 'imposter.lan', sans, false, false);
          const httpsServer = https.createServer({
            key: forge.pki.privateKeyToPem(kp.privateKey),
            cert: leafPem
          }, app);
          io.attach(httpsServer);
          httpsServer.listen(httpsPort, () => { if (done) done(); });
          httpsServer.on('error', () => console.log('https side-door unavailable on port ' + httpsPort + ' (http game still fine)'));
        } catch (e) {
          console.log('Skipping https side-door: ' + (e.message || e));
        }
      });
    });
  } catch (e) {
    console.log('Skipping https side-door: ' + (e.message || e));
  }
}

function makeCert(publicKey, issuerPrivate, cn, sans, isCa, issuerIsSelf) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = String(Date.now() >>> 0);
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60000);
  cert.validity.notAfter = new Date(now.getTime() + 825 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'The Imposter' }
  ];
  cert.setSubject(attrs);
  if (issuerIsSelf) {
    cert.setIssuer(attrs);
  } else {
    cert.setIssuer([
      { name: 'commonName', value: 'The Imposter LAN Root' },
      { name: 'organizationName', value: 'The Imposter' }
    ]);
  }
  const extensions = [
    { name: 'basicConstraints', cA: isCa, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyCertSign: isCa, cRLSign: isCa, critical: true }
  ];
  if (!isCa) extensions.push({ name: 'extKeyUsage', serverAuth: true });
  if (sans.length) extensions.push({ name: 'subjectAltName', altNames: sans });
  cert.setExtensions(extensions);
  cert.sign(issuerPrivate, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createGameServer().listen(port, () => {
    console.log(`The Imposter server running on http://localhost:${port}`);
  });
}

module.exports = { createGameServer, rooms, submitClueCore, addBotPlayer };
