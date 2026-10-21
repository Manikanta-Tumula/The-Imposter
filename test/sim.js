const assert = require('assert');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const allSockets = [];

async function main() {
  const httpServer = createGameServer();
  await new Promise(res => httpServer.listen(0, res));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  console.log(`test server on ${url}`);

  const latest = new Map();

  function connect(name) {
    return new Promise((resolve, reject) => {
      const s = io(url, { transports: ['websocket'] });
      allSockets.push(s);
      s.errors = [];
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      s.on('updateState', st => { if (st && st.you) latest.set(st.you.name, st); });
      s.on('errorMsg', e => s.errors.push(e.msg));
    });
  }

  async function wait(name, pred, label, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const st = latest.get(name);
      if (st && pred(st)) return st;
      await sleep(30);
    }
    throw new Error(`Timeout waiting for ${label} [${name}]`);
  }

  function idOf(name) {
    const st = latest.get(name);
    return st.players.find(p => p.name === name).id;
  }

  async function newRoom(names) {
    const sockets = {};
    const first = await connect(names[0]);
    sockets[names[0]] = first;
    first.emit('createRoom', { name: names[0] });
    await wait(names[0], s => s.code, 'room created');
    const code = latest.get(names[0]).code;
    let joined = 1;
    for (const n of names.slice(1)) {
      joined++;
      const s = await connect(n);
      sockets[n] = s;
      s.emit('joinRoom', { name: n, code });
      await wait(n, x => x.code === code && x.players.length === joined, `${n} joined`);
      await wait(names[0], x => x.players.length === joined, `host sees ${n}`);
    }
    return { code, sockets, names };
  }

  async function playAllClues(g) {
    let seq = 0;
    let dupDone = false;
    for (let guard = 0; guard < 300; guard++) {
      const st = latest.get(g.names[0]);
      if (st.phase !== 'clues') return;
      const turn = st.players.find(p => p.id === st.currentTurn.playerId);
      const sock = g.sockets[turn.name];
      const turnNumber = st.currentTurn.turnNumber;
      if (sock) {
        if (!dupDone && (st.clues || []).length > 0) {
          dupDone = true;
          const prev = st.clues[0].word;
          sock.emit('submitClue', { word: prev });
          await sleep(250);
          if (!sock.errors.some(m => m.includes('already used'))) {
            throw new Error('duplicate clue was accepted');
          }
        }
        sock.emit('submitClue', { word: `clue-${seq++}` });
      }
      await wait(g.names[0], x => x.phase !== 'clues' || (x.clues || []).length >= turnNumber, `turn ${turnNumber} advance`, 10000);
    }
    throw new Error('clue phase never ended');
  }

  console.log('Scenario A: innocents catch the impostor, impostor fails the steal');
  const A = await newRoom(['Host', 'Ada', 'Bo', 'Cy']);
  A.sockets.Host.emit('startRound');
  for (const n of A.names) await wait(n, x => x.phase === 'clues', 'clues started');
  const impName = A.names.find(n => latest.get(n).isImpostor);
  assert.ok(impName, 'exactly one impostor expected');
  const innocents = A.names.filter(n => n !== impName);
  const secret = latest.get(innocents[0]).yourWord;
  const impWord = latest.get(impName).yourWord;
  for (const n of innocents) {
    assert.strictEqual(latest.get(n).yourWord, secret, 'innocents share the secret word');
    assert.strictEqual(latest.get(n).isImpostor, false);
  }
  assert.notStrictEqual(impWord, secret, 'impostor must see a different word');
  console.log(`  secret="${secret}" impostorSaw="${impWord}" impostor=${impName}`);

  await playAllClues(A);
  for (const n of A.names) await wait(n, x => x.phase === 'vote', 'vote phase');
  assert.strictEqual(latest.get(A.names[0]).clues.length, A.names.length * 3, 'exactly 12 clues (3 rotations)');

  const impId = idOf(impName);
  for (const n of A.names) {
    A.sockets[n].emit('castVote', { target: n === impName ? idOf(n === 'Host' ? 'Ada' : 'Host') : impId });
  }
  for (const n of A.names) await wait(n, x => x.phase === 'catch', 'catch phase');
  assert.strictEqual(latest.get(impName).isImpostor, true);
  A.sockets[impName].emit('submitCatchGuess', { guess: 'zebra' });
  for (const n of A.names) await wait(n, x => x.phase === 'reveal', 'reveal');
  const r = latest.get(A.names[0]).lastResult;
  assert.strictEqual(r.wonBy, 'innocents');
  assert.ok(r.reason.includes('caught'));
  assert.strictEqual(r.secretWord, secret);
  assert.strictEqual(r.impostorWord, impWord);
  assert.strictEqual(Object.keys(r.votes).length, 4, 'vote detail revealed');
  const scores = Object.fromEntries(latest.get(A.names[0]).scores.map(s => [s.name, s.score]));
  for (const n of innocents) assert.strictEqual(scores[n], 1, `${n} scored 1`);
  assert.strictEqual(scores[impName], 0, 'impostor scored 0');
  console.log('  scenario A passed');

  A.sockets.Host.emit('goLobby');
  await wait('Host', x => x.phase === 'lobby', 'back to lobby');
  A.sockets.Host.emit('startRound');
  await wait('Host', x => x.phase === 'clues' && x.round === 2, 'round 2 started');
  console.log('  round cycling passed');

  console.log('Scenario B: wrong player caught, impostor wins + join errors');
  const badIo = await connect('Wanderer');
  badIo.emit('joinRoom', { name: 'Wanderer', code: 'ZZZZ' });
  await sleep(200);
  if (!badIo.errors.some(m => m.includes('Room not found'))) throw new Error('bad join accepted');
  badIo.disconnect();

  const B = await newRoom(['Host2', 'Di', 'Ed']);
  B.sockets.Host2.emit('startRound');
  for (const n of B.names) await wait(n, x => x.phase === 'clues', 'clues started (3 players)');
  const impB = B.names.find(n => latest.get(n).isImpostor);
  await playAllClues(B);
  for (const n of B.names) await wait(n, x => x.phase === 'vote', 'vote phase B');
  const innocentTarget = B.names.find(n => !latest.get(n).isImpostor);
  const secondInnocent = B.names.find(n => n !== innocentTarget && n !== impB);
  for (const n of B.names) {
    B.sockets[n].emit('castVote', { target: n === innocentTarget ? idOf(secondInnocent) : idOf(innocentTarget) });
  }
  for (const n of B.names) await wait(n, x => x.phase === 'reveal', 'reveal B');
  const rB = latest.get(B.names[0]).lastResult;
  assert.strictEqual(rB.wonBy, 'impostor');
  assert.ok(rB.reason.includes('wrong player'), 'reason mentions wrong catch');
  const scoresB = Object.fromEntries(latest.get(B.names[0]).scores.map(s => [s.name, s.score]));
  for (const n of B.names) {
    assert.strictEqual(scoresB[n], n === impB ? 2 : 0, `${n} score`);
  }
  console.log('  scenario B passed');

  console.log('Scenario C: solo play with 2 bots (fully automated round)');
  const C = await newRoom(['Host3']);
  C.sockets.Host3.emit('addBot');
  await wait('Host3', x => x.players.length === 2, 'bot 1 joined');
  C.sockets.Host3.emit('addBot');
  await wait('Host3', x => x.players.length === 3, 'bot 2 joined');
  assert.strictEqual(latest.get('Host3').players.filter(p => p.bot).length, 2, 'two bots flagged');
  C.sockets.Host3.emit('startRound');
  await wait('Host3', x => x.phase === 'clues', 'solo clues started');
  await playAllClues(C);
  await wait('Host3', x => x.phase === 'vote', 'solo vote phase');
  assert.strictEqual(latest.get('Host3').clues.length, 9, 'bots + human produced 9 clues');
  const others = latest.get('Host3').players.filter(p => p.id !== latest.get('Host3').you.id);
  C.sockets.Host3.emit('castVote', { target: others[0].id });
  let solo = null;
  for (let i = 0; i < 200; i++) {
    solo = latest.get('Host3');
    if (solo.phase === 'reveal') break;
    if (solo.phase === 'catch' && solo.isImpostor) {
      C.sockets.Host3.emit('submitCatchGuess', { guess: 'zebra' });
    }
    await sleep(200);
  }
  if (!solo || solo.phase !== 'reveal') throw new Error('solo round never reached reveal');
  assert.strictEqual(solo.clues.length, 9, 'clue recap intact at reveal');
  const rC = solo.lastResult;
  assert.ok(rC && rC.reason, 'solo round has a result');
  const impNameC = solo.players.find(p => p.id === rC.impostorId).name;
  for (const s of solo.scores) {
    if (rC.wonBy === 'innocents') {
      assert.strictEqual(s.score, s.name === impNameC ? 0 : 1, `${s.name} score in solo innocents win`);
    } else {
      assert.strictEqual(s.score, s.name === impNameC ? 2 : 0, `${s.name} score in solo impostor win`);
    }
  }
  assert.strictEqual(solo.scores.reduce((t, s) => t + s.score, 0), 2, 'total solo points awarded');
  console.log(`  scenario C passed (${rC.wonBy} win, impostor was ${impNameC})`);

  httpServer.close();
  allSockets.forEach(s => s.disconnect());
  console.log('\nALL TESTS PASSED');
  process.exit(0);
}

main().then(
  ok => {},
  e => { console.error(e.message || e); allSockets.forEach(s => s.connected && s.disconnect()); process.exit(1); }
);
