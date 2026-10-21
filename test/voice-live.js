const { createGameServer } = require('../server');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const allSockets = [];

async function main() {
  const httpServer = createGameServer();
  await new Promise(res => httpServer.listen(0, res));
  const url = `http://127.0.0.1:${httpServer.address().port}`;

  const latest = new Map();
  const voiceMsgs = { a: [], b: [] };

  function connect(label) {
    return new Promise((resolve, reject) => {
      const s = io(url, { transports: ['websocket'] });
      allSockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      s.on('updateState', st => { if (st && st.you) latest.set(label, st); });
      s.on('voiceState', st => voiceMsgs[label].push(st));
      s.on('voiceSignal', st => voiceMsgs[label].push({ signal: true, msg: st }));
      s.on('errorMsg', e => console.error('errorMsg to ' + label + ': ' + e.msg));
    });
  }

  const a = await connect('a');
  a.emit('createRoom', { name: 'HostGuy' });
  await sleep(300);
  const stA = latest.get('a');
  if (!stA || !stA.code) { console.error('FAIL: host room missing'); process.exit(1); }

  const b = await connect('b');
  b.emit('joinRoom', { code: stA.code, name: 'GuestPal' });
  await sleep(300);

  a.emit('voiceOn');
  b.emit('voiceOn');
  await sleep(400);
  for (const k of ['a', 'b']) {
    const hits = voiceMsgs[k].filter(m => m.ids);
    if (!hits.length || hits[hits.length - 1].ids.length !== 2) {
      console.error('FAIL: voiceState for ' + k + ' -> ' + JSON.stringify(voiceMsgs[k]));
      process.exit(1);
    }
  }
  const guestId = latest.get('a').players.find(p => p.name === 'GuestPal').id;
  const hostId = latest.get('a').players.find(p => p.name === 'HostGuy').id;

  a.emit('voiceSignal', { to: 'nobody_zz', payload: { ice: {} } });
  a.emit('voiceSignal', { to: guestId, payload: { sdp: { type: 'offer', sdp: 'x' } } });
  await sleep(400);
  const gotSignal = voiceMsgs.b.find(m => m.signal && m.msg && m.msg.from === hostId);
  if (!gotSignal) {
    console.error('hostId=' + hostId + ' guestId=' + guestId);
    console.error('FAIL: signal routing -> ' + JSON.stringify(voiceMsgs.b));
    process.exit(1);
  }

  a.disconnect();
  await sleep(500);
  const last = voiceMsgs.b.filter(m => m.ids).pop();
  if (!last || last.ids.includes(hostId)) {
    console.error('FAIL: voice id survived disconnect -> ' + JSON.stringify(voiceMsgs.b));
    process.exit(1);
  }

  console.log('voice signaling: all ok (peer discovery, routing, disconnect cleanup)');
  alsoCleanupRound();

  function alsoCleanupRound() {
    for (const s of allSockets) s.close();
    process.exit(0);
  }
  setTimeout(() => { console.error('FAIL: test hang'); process.exit(1); }, 5000);
}

main().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
