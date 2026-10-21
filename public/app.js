const socket = (function () {
  if (location.protocol === 'file:') return null;
  try { return io(); } catch (e) { return null; }
})();
let offlineToastShown = false;
function needServer() {
  if (offlineToastShown) return;
  offlineToastShown = true;
  toast('Online rooms need the game server running. Double-click "START GAME" in the susword folder, or keep using Party mode here.');
}
let state = null;
let currentPhase = null;
let seenWordKey = "";

function wordKeyOf() {
  return state && state.yourWord ? `${state.code}:${state.round}:${state.yourWord}` : '';
}

let clueDraft = "";
let prevClueCount = 0;
let celebrated = null;

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hueFor = name => {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/* ---------- sound (tiny synth, no audio files) ---------- */

const Sound = {
  on: (() => { try { return localStorage.getItem('sus-sound') !== 'off'; } catch (e) { return true; } })(),
  ctx: null,
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('sus-sound', this.on ? 'on' : 'off'); } catch (e) {}
    return this.on;
  },
  play(type) {
    if (!this.on) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const seq = ({
        turn: [[660, 0, 0.09], [880, 0.09, 0.12]],
        send: [[440, 0, 0.08]],
        err: [[160, 0, 0.16]],
        vote: [[520, 0, 0.09]],
        catch: [[110, 0, 0.55]],
        reveal: [[392, 0, 0.18], [523, 0.18, 0.24]]
      })[type] || [];
      for (const [f, at, dur] of seq) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type === 'err' ? 'sawtooth' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.12, t + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t + at);
        o.stop(t + at + dur + 0.05);
      }
    } catch (e) {}
  }
};

function refreshSoundLabels() {
  const word = Sound.on ? 'Sound on' : 'Sound off';
  ['#btn-sound', '#btn-party-sound'].forEach(sel => {
    const b = document.querySelector(sel);
    if (b) b.textContent = word;
  });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 3000);
}

function show(screen) {
  $('#screen-home').classList.toggle('hidden', screen !== 'home');
  $('#screen-room').classList.toggle('hidden', screen !== 'room');
  $('#screen-party').classList.toggle('hidden', screen !== 'party');
}

/* ---------- confetti ---------- */

function burst(kind) {
  const canvas = document.createElement('canvas');
  canvas.id = 'fx';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width = innerWidth * dpr;
  const H = canvas.height = innerHeight * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const palette = kind === 'win'
    ? ['#d9b26a', '#ecd9b0', '#9db894', '#f3efe8']
    : ['#c7525c', '#e08890', '#d9b26a', '#f3efe8'];
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * W,
    y: -30 * dpr - Math.random() * H * 0.25,
    w: (5 + Math.random() * 7) * dpr,
    h: (9 + Math.random() * 10) * dpr,
    vy: (2.4 + Math.random() * 3.2) * dpr,
    vx: (Math.random() - 0.5) * 1.6 * dpr,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.24,
    color: palette[Math.floor(Math.random() * palette.length)],
    sway: Math.random() * Math.PI * 2
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    if (t > 2600) { canvas.remove(); return; }
    ctx.clearRect(0, 0, W, H);
    const fade = t > 2100 ? 1 - (t - 2100) / 500 : 1;
    ctx.globalAlpha = Math.max(0, fade);
    for (const p of parts) {
      p.sway += 0.05;
      p.x += p.vx + Math.sin(p.sway) * 1.1 * dpr;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  })(start);
}

/* ---------- renderers ---------- */

function renderHome() {
  show('home');
  if (!socket) {
    const home = $('#screen-home');
    let note = home.querySelector('#offline-note');
    if (!note && home) {
      note = document.createElement('div');
      note.id = 'offline-note';
      note.className = 'party-warn';
      note.style.maxWidth = '500px';
      note.style.margin = '-10px auto 20px';
      note.textContent = 'You opened the page without its game server. Online rooms need "START GAME" (double-click it in the project folder — it opens http://localhost:3000). Party mode works right here.';
      const menu = home.querySelector('.menu');
      if (menu) home.insertBefore(note, menu);
      else home.appendChild(note);
    }
  }
}

function renderRoom() {
  show('room');
  $('#room-code-display').textContent = state.code;
  const bar = $('#notice-bar');
  if (state.notice) {
    bar.textContent = state.notice;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
  const phase = state.phase;
  if (phase !== currentPhase) {
    clueDraft = "";
    prevClueCount = 0;
    if (celebrated && phase !== 'reveal') celebrated = null;
  }
  currentPhase = phase;
  document.title = phase === 'lobby' || !phase || phase === 'reveal'
    ? 'The Imposter'
    : `The Imposter · ${state.code || ''} ${phase}`;
  const panel = $('#phase-panel');
  if (phase === 'lobby') panel.innerHTML = renderLobby();
  else if (phase === 'clues') panel.innerHTML = renderClues();
  else if (phase === 'vote') panel.innerHTML = renderVote();
  else if (phase === 'catch') panel.innerHTML = renderCatch();
  else if (phase === 'reveal') {
    panel.innerHTML = renderReveal();
    const wonBy = state.lastResult && state.lastResult.wonBy;
    if (wonBy && celebrated !== wonBy) {
      celebrated = wonBy;
      burst(wonBy === 'innocents' ? 'win' : 'lose');
    }
  } else panel.innerHTML = '';
  wireEvents();
}

function playerPills(opts = {}) {
  return `<div class="pillrow">${state.players.map(p => {
    const botTag = p.bot ? '<span class="bot-chip">BOT</span>' : '';
    const kick = opts.kick && p.bot && state.you.host ? `<button class="kick" data-kick="${p.id}" title="Remove bot">×</button>` : '';
    return `<div class="pill ${p.id === state.you.id ? 'me' : ''} ${opts.extraClass || ''}" data-pid="${p.id}">${p.host ? '<span class="crown">★</span>' : ''}${botTag}${esc(p.name)}<span class="spk"></span>${kick}</div>`;
  }).join('')}</div>`;
}

function clueChips(spread) {
  if (!state.clues.length) return '<p class="hint" style="margin-top:4px">No clues yet. First rotation starts.</p>';
  return `<div class="cluelist">${state.clues.map((c, i) => {
    const animate = spread ? ' pop' : (i >= prevClueCount ? ' pop' : '');
    const delay = spread ? `style="animation-delay:${i * 45}ms"` : '';
    return `<div class="clue${animate}" ${delay}><b style="color:hsl(${hueFor(c.name)},28%,72%)">${esc(c.name)}</b><em>${esc(c.word)}</em></div>`;
  }).join('')}</div>`;
}

function turnDots(t) {
  const per = state.players.length;
  const done = t.turnNumber - 1;
  let html = '';
  for (let i = 0; i < t.totalTurns; i++) {
    if (i > 0 && i % per === 0) html += `<span class="dotsep">R${Math.floor(i / per) + 1}</span>`;
    html += `<i class="dot ${i < done ? 'done' : ''} ${i === done ? 'active' : ''}"></i>`;
  }
  return `<div class="dots">${html}</div>`;
}

function scoreTable(scores) {
  const list = scores || [];
  const top = list.length ? Math.max(...list.map(s => s.score)) : 0;
  return `<table class="score">
    <tr><th>Player</th><th>Scores</th></tr>
    ${list.map(s => `<tr class="${s.score === top && s.score > 0 ? 'top' : ''}"><td>${esc(s.name)}${s.bot ? ' <span class="bot-chip">BOT</span>' : ''}</td><td>${s.score}</td></tr>`).join('')}
  </table>`;
}

function renderLobby() {
  const isHost = state.you.host;
  const ready = state.players.length >= 3;
  const canAddBot = isHost && state.players.length < 8;
  return `
    <div class="panel">
      <h3>Lobby — ${state.players.length}/8 seated</h3>
      ${playerPills({ kick: true })}
      <p class="hint" style="margin-top:16px">One impostor hides among you. 4 players is the sweet spot.</p>
      <div class="actions" style="margin-top:18px">
        ${canAddBot ? '<button id="btn-addbot" class="btn ok">+ Add a bot</button>' : ''}
        ${isHost ? `<button id="btn-start" class="btn primary" ${ready ? '' : 'disabled'}>Start round</button>` : '<p class="hint" style="margin:0">Waiting for the host to start…</p>'}
      </div>
      ${howtoOnline()}
    </div>
    ${voiceNudge()}
    ${state.round > 0 ? `<div class="panel"><h3>Scores so far</h3>${scoreTable(state.scores)}</div>` : ''}
    ${historyStrip()}`;
}

function voiceNudge() {
  if (!voiceMeta || !voiceMeta.httpsPort) return '';
  const secureNow = location.protocol === 'https:';
  const onHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (secureNow || onHost) return '';
  const host = voiceMeta.lanIp || location.hostname;
  const link = `https://${host}:${voiceMeta.httpsPort}/?code=${state ? state.code : ''}`;
  const caUrl = `http://${location.hostname}:${voiceMeta.httpPort}/ca.crt`;
  return `<div class="panel">
    <h3>Phone voice</h3>
    <p class="hint" style="margin:0 0 12px; text-align:left">Mic only works on secure links. Phones should open the game from here:</p>
    <div class="row"><input id="voice-link" readonly value="${esc(link)}" spellcheck="false" style="font-family:var(--font-mono);font-size:13px" /><button id="btn-copy-voice" class="btn ghost">Copy</button></div>
    <p class="hint" style="margin:14px 0 0; text-align:left">Chrome will say "Not secure / unsafe" the first time — tap <b>Details / Advanced</b>, then <b>Proceed anyway</b>. After that, stop future warnings forever by installing your host's certificate:</p>
    <div class="actions" style="justify-content:flex-start; margin-top:10px">
      <a id="ca-crt" class="btn ghost" href="${esc(caUrl)}" download="imposter-ca.crt">Download trust certificate</a>
    </div>
    <p class="hint" style="margin:10px 0 0; text-align:left">Android: open the download, choose <b>Certificate Authority</b>, name it The Imposter. iOS: Settings — Profile Downloaded — Install, then trust it in General — About — Certificate Trust.</p>
  </div>`;
}

function howtoOnline() {
  return `<details class="howto"><summary>How to play</summary><ol>
    <li>Everyone <b>secretly gets a word</b> — the impostor got the rival word instead.</li>
    <li><b>3 rotations.</b> On your turn give exactly ONE word about your word.</li>
    <li>Then everyone <b>votes</b> for the suspect.</li>
    <li>Catch the impostor and they get <b>one guess of the real word to steal the win</b>. Wrong catch or tie → impostor wins.</li>
    <li>Innocents +1 each for a clean catch, impostor +2 whenever they win.</li>
  </ol></details>`;
}

function historyStrip() {
  const h = state.history || [];
  if (!h.length) return '';
  return `<div class="panel"><h3>Recent rounds</h3>${h.map(x => `
    <div class="histrow"><b>R${x.round}</b><span class="${x.wonBy === 'innocents' ? 'hw' : 'hl'}">${x.wonBy === 'innocents' ? 'innocents' : 'impostor'}</span><span>${esc(x.secretWord)}</span><span class="grow">impostor: <em>${esc(x.impostor)}</em></span></div>`).join('')}</div>`;
}

function renderClues() {
  const isImpostor = !!state.isImpostor;
  const t = state.currentTurn;
  const myTurn = t && t.playerId === state.you.id;
  const wordKey = wordKeyOf();
  if (seenWordKey !== wordKey) {
    return `<div class="reveal-full">
      <div class="word-card ${isImpostor ? 'susroles' : ''} big">
        <div class="label">${isImpostor ? 'You are the impostor — you saw the rival' : 'Your word'}</div>
        <div class="word">${esc(state.yourWord)}</div>
      </div>
      <p class="hint">${isImpostor ? 'Blend in — act like you belong to this world.' : 'Say one word about this each turn. Stay natural.'}</p>
      <div class="actions" style="justify-content:center;margin-top:20px">
        <button id="btn-word-ok" class="btn primary">I know my word</button>
      </div>
    </div>`;
  }
  const active = state.players.find(p => p.id === (t && t.playerId)) || { name: '…' };
  const activeHue = hueFor(active.name);
  const draftInput = myTurn ? `
    <div class="clue-row">
      <input id="clue-input" maxlength="24" placeholder="Your one clue…" value="${esc(clueDraft)}" autofocus />
      <button id="btn-clue" class="btn primary">Send</button>
    </div>` : '';
  return `
    <div class="word-card ${isImpostor ? 'susroles' : ''}">
      <div class="label">${isImpostor ? 'You are the impostor — blend in' : 'Secret word'}</div>
      <div class="word">${esc(state.yourWord)}</div>
    </div>
    ${turnDots(t)}
    <div class="turn-banner ${myTurn ? '' : 'stalled'}">
      ${myTurn
        ? 'Your turn — give a clue'
        : `Waiting on <b style="color:hsl(${activeHue},30%,76%)">${esc(active.name)}</b> · clue ${t.turnNumber}/${t.totalTurns} (rotation ${t.rotation}/3)`}
    </div>
    <div class="panel">
      <h3>Clues so far</h3>
      ${clueChips(false)}
      ${draftInput}
    </div>
    ${playerPills({ extraClass: '' })}
  ` ;
}

function renderVote() {
  const others = state.players.filter(p => p.id !== state.you.id);
  return `
    <div class="panel">
      <h3>All clues are in — vote the impostor out</h3>
      ${clueChips(true)}
      ${state.hasVoted
        ? `<div class="locked">Vote locked · ${state.voteCount}/${state.voteTotal} seated players voted<div class="bar"><i style="width:${(state.voteCount / state.voteTotal) * 100}%"></i></div></div>`
        : `<div class="vote-grid">
            ${others.map(p => `<button class="vote-btn" data-vote="${p.id}">Vote — ${esc(p.name)}</button>`).join('')}
          </div>`}
    </div>
    ${playerPills()}`;
}

function renderCatch() {
  if (state.isImpostor) {
    return `
      <div class="banner lose">
        <h2>CAUGHT</h2>
        <p>One last shot: name the real secret word and steal the win.</p>
      </div>
      <div class="panel">
        <h3>Your final guess</h3>
        <div class="clue-row">
          <input id="guess-input" maxlength="24" placeholder="The secret word was…" autofocus />
          <button id="btn-guess" class="btn primary">Guess</button>
        </div>
      </div>`;
  }
  return `
    <div class="banner win">
      <h2>IMPOSTOR CAUGHT</h2>
      <p>${esc(state.impostorName)} was voted out — if they guess the secret word, they steal the win.</p>
      <div class="turn-banner stalled" style="margin-top:16px">Waiting for the final guess…</div>
    </div>`;
}

function renderReveal() {
  const r = state.lastResult || {};
  const innocentsWin = r.wonBy === 'innocents';
  const outcome = innocentsWin
    ? { cls: 'win', title: 'Innocents win' }
    : { cls: 'lose', title: 'Impostor wins' };
  const imposterPlayer = state.players.find(p => p.id === r.impostorId) || { name: 'The impostor' };
  const imposterHue = hueFor(imposterPlayer.name);
  return `
    <div class="banner ${outcome.cls}">
      <h2>${outcome.title}</h2>
      <p>${esc(r.reason || '')}</p>
    </div>
    <div class="panel">
      <h3>The truth</h3>
      <div class="th-truth">
        <div class="clue"><b>Secret</b><em>${esc(r.secretWord || '—')}</em></div>
        <div class="clue"><b>Impostor saw</b><em>${esc(r.impostorWord || '—')}</em></div>
        <div class="clue impostor-pill"><b>Impostor</b><em style="color:hsl(${imposterHue},80%,75%)">${esc(imposterPlayer.name)}</em></div>
        ${r.catchGuess !== undefined ? `<div class="clue"><b>Their guess</b><em>${esc(r.catchGuess || 'nothing')}</em></div>` : ''}
      </div>
    </div>
    <div class="panel">
      <h3>Clue recap</h3>
      ${clueChips(true)}
    </div>
    ${r.votes && Object.keys(r.votes).length ? `<div class="panel"><h3>The votes</h3>${Object.values(r.votes).map(v => `<div class="histrow"><b>${esc(v.voter)}</b><span class="grow">voted for</span><em>${esc(v.target)}</em></div>`).join('')}</div>` : ''}
    <div class="panel"><h3>Scores</h3>${scoreTable(state.scores)}</div>
    ${historyStrip()}
    ${state.you.host ? `
      <div class="actions">
        <button id="btn-again" class="btn primary">Play again</button>
        <button id="btn-lobby" class="btn ghost">Back to lobby</button>
      </div>` : '<p class="hint" style="margin-top:6px">Waiting for the host…</p>'}`;
}

/* ---------- party mode (one phone, spoken clues) ---------- */

let party = null;
let partyPairs = null;

const partyNorm = w => String(w || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function loadPairs() {
  if (!partyPairs) {
    if (typeof window !== 'undefined' && window.__PAIRS) {
      partyPairs = window.__PAIRS;
    } else {
      const res = await fetch('/api/pairs');
      partyPairs = await res.json();
    }
  }
  return partyPairs;
}

function partyCards(scores) {
  const top = scores.length ? Math.max(...scores.map(s => s.score)) : 0;
  return `<table class="score">
    <tr><th>Player</th><th>Scores</th></tr>
    ${scores.map(s => `<tr class="${s.score === top && s.score > 0 ? 'top' : ''}"><td>${esc(s.name)}</td><td>${s.score}</td></tr>`).join('')}
  </table>`;
}

function dotsFor(total, done, sepLen) {
  let out = '';
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % sepLen === 0) out += `<span class="dotsep">R${Math.floor(i / sepLen) + 1}</span>`;
    out += `<i class="dot ${i < done ? 'done' : ''} ${i === done ? 'active' : ''}"></i>`;
  }
  return `<div class="dots">${out}</div>`;
}

function nameColored(name) {
  return `style="color:hsl(${hueFor(name)},30%,76%)"`;
}

/* ---------- voice chat (WebRTC, peer-to-peer, server only does signaling) ---------- */

let ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
if (typeof fetch === 'function') {
  fetch('/api/ice').then(r => r.json()).then(list => {
    if (Array.isArray(list) && list.length) ICE_SERVERS = list;
  }).catch(() => {});
}

const Voice = {
  on: false,
  muted: false,
  unsupported: false,
  stream: null,
  ctx: null,
  levels: {},
  pcs: {},
  pending: {},

  supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof RTCPeerConnection !== 'undefined';
  },

  async enable() {
    if (!this.supported()) {
      this.unsupported = true;
      refreshVoiceLabel('Voice needs a modern browser');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      this.unsupported = true;
      refreshVoiceLabel('Mic blocked');
      toast('Mic blocked. Allow microphone access for this site — then press Voice again. On this laptop, http://localhost:3000 works right away.');
      return;
    }
    this.on = true;
    this.muted = false;
    try {
      this.ctx = this.ctx || new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      for (const t of this.stream.getTracks()) t.enabled = true;
      this.analyze(this.stream, rawId());
    } catch (e) {}
    emitOnline('voiceOn');
    refreshVoiceLabel('Voice: on');
    voiceMonitorLoop();
  },

  disable() {
    this.on = false;
    this.muted = false;
    for (const id of Object.keys(this.pcs)) this.kill(id);
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.levels = {};
    this.pending = {};
    emitOnline('voiceOff');
    refreshVoiceLabel('Voice: off');
  },

  toggle() {
    if (!this.on) { this.enable(); return; }
    if (this.stream) {
      this.muted = !this.muted;
      for (const t of this.stream.getTracks()) t.enabled = !this.muted;
      refreshVoiceLabel(this.muted ? 'Voice: muted' : 'Voice: on');
      if (this.muted) setSpeaking(rawId(), false);
    }
  },

  analyze(stream, id) {
    if (!id || !stream) return;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch (e) { return; }
    }
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      this.levels[id] = an;
    } catch (e) {}
  },

  reconcile(ids) {
    if (!this.on) return;
    const mine = rawId();
    const alive = new Set(ids);
    for (const id of Object.keys(this.pcs)) {
      if (!alive.has(id)) {
        this.kill(id);
        setSpeaking(id, false);
      }
    }
    for (const raw of ids) {
      const id = String(raw);
      if (id === mine) continue;
      if (!this.pcs[id] && mine > id) this.offer(id);
    }
  },

  async offer(id) {
    try {
      const pc = this.createPeer(id);
      this.pcs[id] = pc;
      const off = await pc.createOffer();
      await pc.setLocalDescription(off);
      emitOnline('voiceSignal', { to: id, payload: { sdp: pc.localDescription } });
    } catch (e) {}
  },

  async answer(id, sdp) {
    try {
      const pc = this.pcs[id] || this.createPeer(id);
      this.pcs[id] = pc;
      await pc.setRemoteDescription(sdp);
      this.flush(id, pc);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      emitOnline('voiceSignal', { to: id, payload: { sdp: pc.localDescription } });
    } catch (e) {}
  },

  flush(id, pc) {
    const q = this.pending[id] || [];
    this.pending[id] = [];
    for (const c of q) {
      try { pc.addIceCandidate(c); } catch (e) {}
    }
  },

  onSignal({ from, payload } = {}) {
    if (!this.on || !from) return;
    from = String(from);
    try {
      if (payload && payload.sdp) {
        if (payload.sdp.type === 'offer') this.answer(from, payload.sdp);
        else if (payload.sdp.type === 'answer') {
          const pc = this.pcs[from];
          if (pc && pc.signalingState === 'have-local-offer') {
            pc.setRemoteDescription(payload.sdp);
            this.flush(from, pc);
          }
        }
      } else if (payload && payload.ice) {
        const pc = this.pcs[from];
        if (pc && pc.remoteDescription) pc.addIceCandidate(payload.ice);
        else {
          this.pending[from] = this.pending[from] || [];
          this.pending[from].push(payload.ice);
        }
      }
    } catch (e) {}
  },

  createPeer(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = e => {
      if (e.candidate) emitOnline('voiceSignal', { to: id, payload: { ice: e.candidate.toJSON() } });
    };
    pc.ontrack = e => {
      const stream = e.streams[0];
      let audio = document.getElementById('voice-a-' + id);
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'voice-a-' + id;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      audio.srcObject = stream;
      this.analyze(stream, id);
    };
    if (this.stream) {
      for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    }
    return pc;
  },

  kill(id) {
    const pc = this.pcs[id];
    if (pc) {
      try { pc.close(); } catch (e) {}
      delete this.pcs[id];
    }
    const audio = document.getElementById('voice-a-' + id);
    if (audio) audio.srcObject = null;
    delete this.levels[id];
  }
};

function rawId() {
  return state && state.you ? String(state.you.id) : '';
}

let speakingRaf = 0;

function setSpeaking(id, onFlag) {
  if (!id) return;
  document.querySelectorAll(`[data-pid="${id}"]`).forEach(el => {
    el.classList.toggle('speaking', !!onFlag);
  });
}

function voiceMonitorLoop() {
  if (typeof requestAnimationFrame === 'undefined') return;
  if (!Voice.on) {
    for (const id of Object.keys(Voice.levels)) setSpeaking(id, false);
    return;
  }
  const data = new Uint8Array(256);
  for (const [id, an] of Object.entries(Voice.levels)) {
    an.getByteTimeDomainData(data);
    let rms = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / data.length);
    const skip = (Voice.muted && id === rawId()) || !Voice.pcs[id] && id !== rawId();
    setSpeaking(id, !skip && rms > 0.045);
  }
  speakingRaf = requestAnimationFrame(voiceMonitorLoop);
}

function refreshVoiceLabel(label) {
  const btn = document.querySelector('#btn-voice');
  if (btn) {
    btn.textContent = label || 'Voice: off';
    btn.classList.toggle('v-on', Voice.on && !Voice.muted);
    btn.classList.toggle('v-muted', Voice.muted);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PARTY_KEY = 'sus-party-v1';

function loadPartyStore() {
  try { return JSON.parse(localStorage.getItem(PARTY_KEY) || 'null'); } catch (e) { return null; }
}

function savePartyStore() {
  try { localStorage.setItem(PARTY_KEY, JSON.stringify({ players: party.players, scores: party.scores, impCounts: party.impCounts })); } catch (e) {}
}

function clearPartyStore() {
  try { localStorage.removeItem(PARTY_KEY); } catch (e) {}
}

function openParty() {
  if (state) {
    emitOnline('leaveRoom');
    state = null;
    currentPhase = null;
    prevClueCount = 0;
  }
  document.title = 'The Imposter · Party';
  party = party || {
    stage: 'setup',
    players: [],
    timerMode: 'off',
    tid: null,
    tLeft: 0,
    round: 0,
    lastPairIdx: -1,
    secretWord: '',
    impostorWord: '',
    impostorName: null,
    order: [],
    revealIdx: 0,
    revealShown: false,
    turnNumber: 0,
    votes: {},
    voterIdx: 0,
    caughtName: null,
    lastResult: null,
    scores: {},
    restored: false
  };
  const stored = loadPartyStore();
  if (stored && Array.isArray(stored.players) && stored.players.length >= 3) {
    party.players = stored.players;
    party.scores = stored.scores || {};
    party.impCounts = stored.impCounts || {};
    party.restored = true;
  }
  $('#screen-home').classList.add('hidden');
  $('#screen-room').classList.add('hidden');
  $('#screen-party').classList.remove('hidden');
  $('#party-panel').classList.add('tiltdown');
  renderParty();
}

function leaveParty() {
  stopPartyTimer();
  party = null;
  document.title = 'The Imposter';
  $('#screen-party').classList.add('hidden');
  show('home');
}

function stopPartyTimer() {
  if (party && party.tid) { clearInterval(party.tid); party.tid = null; }
}

function renderParty() {
  const panel = $('#party-panel');
  const s = party.stage;
  if (s === 'setup') panel.innerHTML = partySetup();
  else if (s === 'reveal') panel.innerHTML = partyReveal();
  else if (s === 'turns') panel.innerHTML = partyTurns();
  else if (s === 'vote') panel.innerHTML = partyVote();
  else if (s === 'steal') panel.innerHTML = partySteal();
  else if (s === 'result') panel.innerHTML = partyResult();
  partyWire();
}

function partyScores() {
  return party.players
    .map(n => ({ name: n, score: party.scores[n] || 0 }))
    .sort((a, b) => b.score - a.score);
}

function howtoParty() {
  return `<details class="howto"><summary>How to play</summary><ol>
    <li>Add everyone's name, then <b>pass the phone</b> — each person secretly reads their word (the impostor got the rival).</li>
    <li>Phone in the middle: the screen names the speaker, they <b>say their one clue out loud</b>. 3 rotations.</li>
    <li>Phone passes again for a <b>secret vote</b> — tap your suspect.</li>
    <li>If caught, the impostor gets <b>one private guess of the real word</b> to steal the win. Wrong catch or tie → impostor wins.</li>
  </ol></details>`;
}

function partySetup() {
  return `
    ${party.players.length >= 3 ? '<div class="party-warn">Everyone sits in a circle. First we pass the phone — then clues are spoken out loud.</div>' : ''}
    ${party.restored ? `<div class="panel" style="padding:14px 18px"><div class="pillrow">
      <div class="pill"><span class="bot-chip">SAVED</span>last party restored — names &amp; session scores</div>
      <button id="btn-party-clear-save" class="kick" title="Clear saved party" style="font-size:13px;color:var(--crimson-2)">Clear</button>
    </div></div>` : ''}
    <div class="panel">
      <h3>Who's playing? (3–12)</h3>
      ${party.players.length
        ? `<div class="pillrow" style="margin-bottom:14px">${party.players.map(n =>
            `<div class="pill"><span ${nameColored(n)}>${esc(n)}</span><button class="kick" data-party-drop="${esc(n)}">×</button></div>`).join('')}</div>`
        : '<p class="hint" style="margin:6px 0 14px">No players yet — add names one by one.</p>'}
      <div class="row">
        <input id="party-name" maxlength="12" placeholder="Player name" autocomplete="off" spellcheck="false" />
        <button id="btn-party-add" class="btn ok">Add</button>
      </div>
      ${howtoParty()}
    </div>
    <div class="panel">
      <h3>Pressure timer per clue</h3>
      <div class="chipset">
        <button class="chipopt ${party.timerMode === 'off' ? 'sel' : ''}" data-timer="off">Off</button>
        <button class="chipopt ${party.timerMode === 10 ? 'sel' : ''}" data-timer="10">10 seconds</button>
        <button class="chipopt ${party.timerMode === 15 ? 'sel' : ''}" data-timer="15">15 seconds</button>
      </div>
      <p class="hint" style="margin-top:12px">Timer off = relaxed living-room rules. A timer makes people panic-funny.</p>
    </div>
    <div class="actions" style="margin-top:16px">
      <button id="btn-party-begin" class="btn primary" ${party.players.length >= 3 ? '' : 'disabled'}>Deal words</button>
    </div>`;
}

async function partyBeginRound() {
  stopPartyTimer();
  await loadPairs();
  let idx = Math.floor(Math.random() * partyPairs.length);
  while (partyPairs.length > 1 && idx === party.lastPairIdx) idx = Math.floor(Math.random() * partyPairs.length);
  party.lastPairIdx = idx;
  const [secretWord, impostorWord] = partyPairs[idx];
  party.round += 1;
  party.secretWord = secretWord;
  party.impostorWord = impostorWord;
  party.impCounts = party.impCounts || {};
  const minN = Math.min(...party.players.map(n => party.impCounts[n] || 0));
  const pool = party.players.filter(n => (party.impCounts[n] || 0) === minN);
  party.impostorName = pool[Math.floor(Math.random() * pool.length)];
  party.impCounts[party.impostorName] = (party.impCounts[party.impostorName] || 0) + 1;
  party.order = shuffle(party.players);
  party.revealIdx = 0;
  party.revealShown = false;
  party.turnNumber = 0;
  party.votes = {};
  party.voterIdx = 0;
  party.caughtName = null;
  party.lastResult = null;
  party.stage = 'reveal';
  renderParty();
}

function partyReveal() {
  const current = party.order[party.revealIdx];
  const done = party.revealIdx;
  if (party.revealShown) {
    const isImp = current === party.impostorName;
    return `
      <div class="party-warn">Only <b>${esc(current)}</b> looks now — everyone else, eyes away.</div>
      <div class="word-card ${isImp ? 'susroles' : ''}">
        <div class="label">${isImp ? 'You are the impostor — blend in' : 'Secret word'}</div>
        <div class="word">${esc(party.impostorName === current ? party.impostorWord : party.secretWord)}</div>
      </div>
      <div class="actions">
        <button id="btn-party-hide" class="btn primary">Hide &amp; pass to ${esc(party.order[party.revealIdx + 1] || 'the host')}</button>
      </div>`;
  }
  return `
    <div class="passtag">Round ${party.round} · word check ${done + 1}/${party.order.length} — pass the phone to</div>
    <div class="bigname" ${nameColored(current)}>${esc(current)}</div>
    <p class="says">read your word alone, keep it secret</p>
    <div class="actions">
      <button id="btn-party-show" class="btn primary">Show my word</button>
    </div>`;
}

function partyTurns() {
  const per = party.order.length;
  const totalTurns = per * 3;
  if (party.turnNumber >= totalTurns) {
    party.stage = 'vote';
    party.voterIdx = 0;
    renderParty();
    return;
  }
  const speaker = party.order[party.turnNumber % per];
  const rotation = Math.floor(party.turnNumber / per) + 1;
  const secs = typeof party.timerMode === 'number' ? party.timerMode : null;
  if (secs && !party.tid && party.tLeft !== secs) {
    party.tLeft = secs;
    party.tid = setInterval(partyTick, 250);
  }
  const isLastTurn = party.turnNumber === totalTurns - 1;
  return `
    <div class="word-card" style="min-height:0; padding:16px 20px; margin-bottom:8px">
      <div class="label">Say your clue out loud · rotation ${rotation}/3</div>
    </div>
    ${dotsFor(totalTurns, party.turnNumber, per)}
    <div class="bigname ${party.tid && party.tLeft <= 4 ? 'buzzing' : ''}" ${nameColored(speaker)}>${esc(speaker)}</div>
    <p class="says">${isLastTurn ? 'Last clue.' : 'One word only.'}</p>
    ${secs ? `
      <div class="tring ${party.tLeft <= 5 ? 'low' : ''}">
        <svg viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r="52" class="track"></circle>
          <circle cx="60" cy="60" r="52" class="fill" id="tring" stroke-dasharray="326.7" stroke-dashoffset="0" style="transform: rotate(-90deg); transform-origin: center;"></circle>
          <text x="60" y="66" text-anchor="middle" id="tsec">${Math.ceil(party.tLeft)}</text>
        </svg>
      </div>` : ''}
    <div class="actions">
      <button id="btn-party-next" class="btn primary">Next</button>
    </div>`;
}

function partyTick() {
  party.tLeft -= 0.25;
  const total = party.timerMode;
  const ring = $('#tring');
  const tsec = $('#tsec');
  const svg = document.querySelector('.tring');
  if (ring && total) {
    const frac = Math.max(0, Math.min(1, party.tLeft / total));
    ring.style.strokeDashoffset = String(326.7 * (1 - frac));
  }
  if (tsec) tsec.textContent = String(Math.max(0, Math.ceil(party.tLeft)));
  if (svg) svg.classList.toggle('low', party.tLeft <= 5);
  const big = document.querySelector('.bigname');
  if (big && party.tLeft <= 4) big.classList.add('buzzing');
  if (party.tLeft <= 0) stopPartyTimer(), partyAdvance();
}

function partyAdvance() {
  stopPartyTimer();
  Sound.play('turn');
  party.turnNumber += 1;
  party.tLeft = 0;
  if (party.turnNumber >= party.order.length * 3) {
    party.stage = 'vote';
    party.voterIdx = 0;
  } else {
    party.revealShown = false;
  }
  renderParty();
}

function partyVote() {
  const voters = party.order;
  if (party.voterIdx >= voters.length) return partyTally();
  const voter = voters[party.voterIdx];
  const targets = party.players.filter(n => n !== voter);
  return `
    <div class="party-warn">Secret vote ${party.voterIdx + 1}/${voters.length} · pass the phone to</div>
    <div class="bigname" ${nameColored(voter)}>${esc(voter)}</div>
    <p class="says">who is the impostor? tap secretly</p>
    <div class="vote-grid">
      ${targets.map(t => `<button class="vote-btn" data-party-vote="${esc(t)}"><small>catch</small>${esc(t)}</button>`).join('')}
    </div>`;
}

function partyCastVote(target) {
  const voter = party.order[party.voterIdx];
  party.votes[voter] = target;
  party.voterIdx += 1;
  Sound.play('vote');
  if (party.voterIdx >= party.order.length) partyTally();
  else renderParty();
}

function partyTally() {
  const counts = {};
  for (const t of Object.values(party.votes)) counts[t] = (counts[t] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length > 1 && entries[0][1] === entries[1][1]) {
    return partyFinish('impostor', 'Tied vote — the impostor slipped away.', null);
  }
  const caught = entries[0][0];
  if (caught === party.impostorName) {
    party.caughtName = caught;
    Sound.play('catch');
    party.stage = 'steal';
    renderParty();
    return;
  }
  partyFinish('impostor', `The wrong player was caught (${caught}).`, null);
}

function partySteal() {
  const isImp = true;
  return `
    <div class="banner lose">
      <h2>CAUGHT</h2>
      <p>${esc(party.caughtName)} — one last shot. Pass the phone to them alone.</p>
    </div>
    <div class="party-warn">Everyone else, look away. <b>${esc(party.caughtName)}</b>, guess the real secret word to steal the win.</div>
    <div class="panel">
      <h3>Your final guess</h3>
      <div class="row">
        <input id="party-guess" maxlength="24" placeholder="The secret word was…" autocomplete="off" />
        <button id="btn-party-steal" class="btn primary">Guess</button>
      </div>
    </div>`;
}

function partyFinish(wonBy, reason, catchGuess) {
  if (wonBy === 'innocents') {
    for (const n of party.players) if (n !== party.impostorName) party.scores[n] = (party.scores[n] || 0) + 1;
  } else {
    party.scores[party.impostorName] = (party.scores[party.impostorName] || 0) + 2;
  }
  party.lastResult = {
    wonBy,
    reason,
    secretWord: party.secretWord,
    impostorWord: party.impostorWord,
    impostorName: party.impostorName,
    votes: { ...party.votes },
    catchGuess
  };
  party.stage = 'result';
  Sound.play('reveal');
  savePartyStore();
  renderParty();
}

function partyResult() {
  const r = party.lastResult;
  const win = r.wonBy === 'innocents';
  return `
    <div class="banner ${win ? 'win' : 'lose'}">
      <h2>${win ? 'INNOCENTS WIN' : 'IMPOSTOR WINS'}</h2>
      <p>${esc(r.reason)}</p>
    </div>
    <div class="panel">
      <h3>The truth</h3>
      <div class="th-truth">
        <div class="clue"><b>SECRET</b><em>${esc(r.secretWord)}</em></div>
        <div class="clue"><b>IMPOSTOR SAW</b><em>${esc(r.impostorWord)}</em></div>
        <div class="clue impostor-pill"><b>IMPOSTOR</b><em ${nameColored(r.impostorName)}>${esc(r.impostorName)}</em></div>
        ${r.catchGuess !== undefined && r.catchGuess !== null ? `<div class="clue"><b>THEIR GUESS</b><em>${esc(r.catchGuess)}</em></div>` : ''}
      </div>
    </div>
    <div class="panel">
      <h3>Scores (session)</h3>
      ${partyCards(partyScores())}
    </div>
    <div class="actions">
      <button id="btn-party-again" class="btn primary">Deal again — same friends</button>
      <button id="btn-party-edit" class="btn ghost">Change players</button>
      <button id="btn-party-home" class="btn ghost">Home</button>
    </div>`;
}

function partyWire() {
  const add = $('#btn-party-add');
  if (add) add.onclick = () => {
    const input = $('#party-name');
    const name = input.value.trim().slice(0, 12);
    if (name.length < 2) return toast('Name needs at least 2 letters.');
    if (party.players.some(n => n.toLowerCase() === name.toLowerCase())) return toast('That name is already seated.');
    if (party.players.length >= 12) return toast('12 is the party limit.');
    party.players.push(name);
    renderParty();
    const nextInput = $('#party-name');
    if (nextInput) nextInput.focus();
  };

  document.querySelectorAll('[data-party-drop]').forEach(btn => {
    btn.onclick = () => {
      party.players = party.players.filter(n => n !== btn.dataset.partyDrop);
      renderParty();
    };
  });

  document.querySelectorAll('.chipopt[data-timer]').forEach(btn => {
    btn.onclick = () => {
      const v = btn.dataset.timer;
      party.timerMode = v === 'off' ? 'off' : Number(v);
      renderParty();
    };
  });

  const begin = $('#btn-party-begin');
  if (begin) begin.onclick = partyBeginRound;

  const showBtn = $('#btn-party-show');
  if (showBtn) showBtn.onclick = () => { party.revealShown = true; Sound.play('send'); renderParty(); };

  document.querySelectorAll('[data-party-clear-save]').forEach(btn => {
    btn.onclick = () => {
      clearPartyStore();
      party.players = [];
      party.scores = {};
      party.restored = false;
      renderParty();
    };
  });

  const hideBtn = $('#btn-party-hide');
  if (hideBtn) hideBtn.onclick = () => {
    party.revealShown = false;
    party.revealIdx += 1;
    if (party.revealIdx >= party.order.length) {
      party.stage = 'turns';
    }
    renderParty();
  };

  const next = $('#btn-party-next');
  if (next) next.onclick = () => partyAdvance();

  document.querySelectorAll('[data-party-vote]').forEach(btn => {
    btn.onclick = () => partyCastVote(btn.dataset.partyVote);
  });

  const stealBtn = $('#btn-party-steal');
  const stealInput = $('#party-guess');
  if (stealBtn && stealInput) {
    stealInput.onkeydown = e => { if (e.key === 'Enter') stealBtn.click(); };
    stealBtn.onclick = () => {
      const g = stealInput.value.trim();
      if (!g) return;
      const guessed = partyNorm(g) === partyNorm(party.secretWord);
      if (guessed) partyFinish('impostor', `${party.caughtName} was caught — but guessed the word and stole the win!`, g);
      else partyFinish('innocents', 'The impostor was caught.', g);
    };
  }

  const again = $('#btn-party-again');
  if (again) again.onclick = () => partyBeginRound();

  const edit = $('#btn-party-edit');
  if (edit) edit.onclick = () => {
    stopPartyTimer();
    party.stage = 'setup';
    renderParty();
  };

  const home = $('#btn-party-home');
  if (home) home.onclick = leaveParty;
}

/* ---------- wiring ---------- */

function wireEvents() {
  const wordOk = $('#btn-word-ok');
  if (wordOk) wordOk.onclick = () => { seenWordKey = wordKeyOf(); Sound.play('turn'); renderRoom(); };

  const start = $('#btn-start');
  if (start) start.onclick = () => emitOnline('startRound');

  const addBot = $('#btn-addbot');
  if (addBot) addBot.onclick = () => emitOnline('addBot');

  document.querySelectorAll('[data-kick]').forEach(btn => {
    btn.onclick = () => emitOnline('removeBot', { id: btn.dataset.kick });
  });

  const clueBtn = $('#btn-clue');
  const clueInput = $('#clue-input');
  if (clueBtn && clueInput) {
    clueInput.oninput = e => clueDraft = e.target.value;
    clueInput.onkeydown = e => { if (e.key === 'Enter') clueBtn.click(); };
    clueBtn.onclick = () => {
      const word = clueInput.value.trim();
      if (!word) return;
      emitOnline('submitClue', { word });
      clueDraft = "";
      Sound.play('send');
    };
  }

  document.querySelectorAll('[data-vote]').forEach(btn => {
    btn.onclick = () => emitOnline('castVote', { target: btn.dataset.vote });
  });

  const guessBtn = $('#btn-guess');
  const guessInput = $('#guess-input');
  if (guessBtn && guessInput) {
    guessInput.onkeydown = e => { if (e.key === 'Enter') guessBtn.click(); };
    guessBtn.onclick = () => {
      const guess = guessInput.value.trim();
      if (!guess) return;
      emitOnline('submitCatchGuess', { guess });
    };
  }

  const again = $('#btn-again');
  if (again) again.onclick = () => emitOnline('startRound');
  const lobbyBtn = $('#btn-lobby');
  if (lobbyBtn) lobbyBtn.onclick = () => emitOnline('goLobby');

  const copyVoice = $('#btn-copy-voice');
  if (copyVoice) copyVoice.onclick = async () => {
    const link = $('#voice-link') && $('#voice-link').value;
    if (!link) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch (e) {
      const i = document.createElement('input');
      i.value = link;
      document.body.appendChild(i);
      i.select();
      try { ok = document.execCommand('copy'); } catch (e2) {}
      i.remove();
    }
    toast(ok ? 'Secure voice link copied.' : 'Copy this URL manually: ' + link);
  };
}

function emitOnline(ev, data) {
  if (socket) socket["emit"](ev, data);
  else needServer();
}
function liveOn(ev, fn) {
  if (socket) socket["on"](ev, fn);
}

function readHomeForm(which) {
  const name = which === 'create' ? $('#create-name').value : $('#join-name').value;
  const code = which === 'create' ? null : $('#join-code').value;
  return { name: name.trim(), code: code ? code.trim().toUpperCase() : null };
}

$('#btn-create').onclick = () => {
  const { name } = readHomeForm('create');
  if (!name) return toast('Enter your name first.');
  emitOnline('createRoom', { name });
};

$('#btn-mode-online').onclick = () => {
  $('#create-name').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$('#btn-mode-party').onclick = () => openParty();

$('#btn-voice').onclick = () => Voice.toggle();
liveOn('voiceState', ({ ids } = {}) => Voice.reconcile(ids));
liveOn('voiceSignal', p => Voice.onSignal(p));

const voiceBtnEl = document.querySelector('#btn-voice');
if (voiceBtnEl && !Voice.supported()) {
  voiceBtnEl.classList.add('hidden');
}

let voiceMeta = null;
if (typeof fetch === 'function') {
  fetch('/api/meta').then(r => r.json()).then(m => {
    voiceMeta = m;
    if (state && state.phase === 'lobby') { try { renderRoom(); } catch (e) {} }
  }).catch(() => {});
}

$('#btn-party-leave').onclick = () => leaveParty();

$('#btn-copy').onclick = async () => {
  if (!state) return;
  const url = location.origin + '/?code=' + state.code;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch (e) {
    const i = document.createElement('input');
    i.value = url;
    document.body.appendChild(i);
    i.select();
    try { ok = document.execCommand('copy'); } catch (e2) {}
    i.remove();
  }
  toast(ok ? 'Invite link copied — send it to your friends.' : 'Copy this URL manually: ' + url);
};

function toggleSoundBtns() {
  Sound.toggle();
  refreshSoundLabels();
}
$('#btn-sound').onclick = () => toggleSoundBtns();
$('#btn-party-sound').onclick = () => toggleSoundBtns();

const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode && /^[A-Z0-9]{4}$/i.test(urlCode)) {
  $('#join-code').value = urlCode.toUpperCase();
  $('#join-name').focus();
}

refreshSoundLabels();

$('#btn-join').onclick = () => {
  const { name, code } = readHomeForm('join');
  if (!name) return toast('Enter your name first.');
  if (!code || code.length !== 4) return toast('Enter the 4-character room code.');
  emitOnline('joinRoom', { name, code });
};

$('#join-code').oninput = e => { e.target.value = e.target.value.toUpperCase(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !$('#screen-home').classList.contains('hidden')) {
    if (document.activeElement === $('#join-name') || document.activeElement === $('#join-code')) $('#btn-join').click();
    else if (document.activeElement === $('#create-name')) $('#btn-create').click();
  }
});

$('#btn-leave').onclick = () => {
  emitOnline('leaveRoom');
  Voice.disable();
  state = null;
  currentPhase = null;
  prevClueCount = 0;
  celebrated = null;
  document.title = 'The Imposter';
  renderHome();
};

liveOn('updateState', next => {
  if (!next || !next.code) { Voice.disable(); state = null; renderHome(); return; }
  const wasMyTurn = !!(state && state.phase === 'clues' && state.currentTurn && state.currentTurn.playerId === state.you.id);
  const wasPhase = state ? state.phase : null;
  if (next.phase === 'lobby') seenWordKey = '';
  let newCount = null;
  if (next.phase === 'clues' || next.phase === 'vote') {
    newCount = next.clueCount != null ? next.clueCount : (next.clues || []).length;
  }
  state = next;
  renderRoom();
  if (newCount != null) prevClueCount = newCount;
  const isMyTurn = next.phase === 'clues' && next.currentTurn && next.currentTurn.playerId === next.you.id;
  if (isMyTurn && !wasMyTurn) Sound.play('turn');
  if (wasPhase && wasPhase !== next.phase) {
    if (next.phase === 'vote') Sound.play('vote');
    else if (next.phase === 'catch') Sound.play('catch');
    else if (next.phase === 'reveal') Sound.play('reveal');
  }
});

liveOn('errorMsg', ({ msg } = {}) => {
  Sound.play('err');
  toast(msg || 'Something went wrong.');
});

liveOn('connect', () => { if (state) renderRoom(); });

renderHome();
