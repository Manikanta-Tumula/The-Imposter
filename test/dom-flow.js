const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace('<script src="/socket.io/socket.io.js"></script>', '')
  .replace('<script src="app.js"></script>', '');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => {
  if (!/scrollTo/.test(e.message)) errors.push('jsdomError: ' + e.message);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost:3000/' });
const { window } = dom;

const handlers = {};
const emitted = [];
window.io = () => ({
  connected: true,
  emit(ev, data) {
    emitted.push([ev, data]);
    if (ev === 'createRoom') {
      setTimeout(() => fire('updateState', fakeLobby('AB12', data.name)), 0);
    }
    if (ev === 'startRound') setTimeout(() => fire('updateState', fakeClues('AB12')), 0);
  },
  on(ev, fn) { handlers[ev] = fn; }
});

function fire(ev, data) {
  if (handlers[ev]) {
    try { handlers[ev](data); } catch (e) { errors.push('handler ' + ev + ' threw: ' + e.stack); }
  }
}
window.__fire = fire;

function fakeLobby(code, name) {
  return {
    code,
    notice: null,
    phase: 'lobby',
    round: 0,
    players: [
      { id: 'p1', name, host: true, bot: false },
      { id: 'y1', name: 'Priya', host: false, bot: true },
      { id: 'y2', name: 'Arjun', host: false, bot: true }
    ],
    scores: [],
    history: [],
    you: { id: 'p1', host: true },
    isImpostor: false,
    yourWord: null,
    clues: [],
    currentTurn: null
  };
}

function fakeClues(code) {
  return Object.assign(fakeLobby(code, 'Tester'), {
    phase: 'clues',
    round: 1,
    yourWord: 'Chai',
    isImpostor: false,
    currentTurn: { playerId: 'p1', seat: 0 },
    turnNumber: 1,
    totalTurns: 12,
    clues: [],
    clueCount: 0
  });
}

try { window.eval(appJs); } catch (e) { console.error('LOAD FAILED: ' + e.stack); process.exit(1); }

const d = window.document;

d.querySelector('#create-name').value = 'Tester';
d.querySelector('#btn-create').click();

setTimeout(() => {
  const lobby = d.querySelector('#phase-panel').textContent;
  console.log('after create -> screen-room visible: ' + !d.querySelector('#screen-room').classList.contains('hidden'));
  console.log('after create -> code shown: ' + d.querySelector('#room-code-display').textContent);
  console.log('after create -> lobby shows: ' + (lobby.includes('Lobby') && lobby.includes('[ok]Priya'.replace('[ok]', '')) ? 'players seated' : lobby));
  const startBtn = d.querySelector('#btn-start');
  console.log('btn-start wired: ' + (startBtn && typeof startBtn.onclick === 'function' ? 'yes' : 'NO DEAD'));
  if (startBtn) startBtn.click();

  setTimeout(() => {
    const wordOkBtn = d.querySelector('#btn-word-ok');
    console.log('after start -> word reveal shown: ' + !!wordOkBtn);
    if (wordOkBtn) {
      wordOkBtn.click();
      const clueInput = d.querySelector('#clue-input');
      const clueBtn = d.querySelector('#btn-clue');
      console.log('after word ok -> clue input + send wired: ' + (clueInput && typeof clueBtn.onclick === 'function' ? 'yes' : 'NO DEAD'));
      clueInput.value = 'masala';
      clueBtn.click();
      console.log('emitted: ' + JSON.stringify(emitted));
    }
    console.log('errors: ' + (errors.length ? JSON.stringify(errors, null, 1) : 'none'));
    process.exit(errors.length ? 1 : 0);
  }, 50);
}, 50);
