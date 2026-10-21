process.env.PORT = String(3000 + Math.floor(Math.random() * 20000) * 2 + 2);
const { createGameServer } = require('../server');
const { io } = require('socket.io-client');
const https = require('https');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = require('http').get(url, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); } catch (e) { resolve({ status: res.statusCode, body: buf }); } });
    });
    req.on('error', reject);
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const opts = url.startsWith('https') ? { rejectUnauthorized: false, agent: new (require('https').Agent)({ rejectUnauthorized: false }) } : {};
    const req = mod.get(url, opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => reject(new Error('GET timeout')));
  });
}

async function main() {
  const httpServer = createGameServer();
  const basePort = Number(process.env.PORT);
  await new Promise((res, rej) => { httpServer.listen(basePort, res); httpServer.on('error', rej); });
  const httpsPort = basePort + 1;

  const meta = await getJson(`http://127.0.0.1:${basePort}/api/meta`);
  if (meta.status !== 200 || !meta.body || meta.body.httpsPort !== httpsPort) {
    console.error('FAIL: meta -> ' + JSON.stringify(meta));
    process.exit(1);
  }
  console.log('ok: /api/meta (httpsPort ' + meta.body.httpsPort + ' on lanIp ' + meta.body.lanIp + ')');

  const ice = await getJson(`http://127.0.0.1:${basePort}/api/ice`);
  if (ice.status !== 200 || !Array.isArray(ice.body) || !ice.body.length || !JSON.stringify(ice.body).includes('turn:')) {
    console.error('FAIL: /api/ice -> ' + JSON.stringify(ice));
    process.exit(1);
  }
  console.log('ok: /api/ice (stun + turn fallback, ' + ice.body.length + ' servers)');

  let ca = null;
  const certWait = Date.now() + 25000;
  while (Date.now() < certWait && !(ca && ca.status === 200 && String(ca.body).includes('BEGIN CERTIFICATE'))) {
    try { ca = await getText(`http://127.0.0.1:${basePort}/ca.crt`); } catch (e) { ca = null; }
    await sleep(300);
  }
  if (!ca || ca.status !== 200 || !String(ca.body).includes('BEGIN CERTIFICATE')) {
    console.error('FAIL: ca.crt -> ' + (ca ? ca.status : 'refused'));
    process.exit(1);
  }
  console.log('ok: /ca.crt serves the installable root certificate');

  let page = null;
  const waitUntil = Date.now() + 20000;
  while (Date.now() < waitUntil && !(page && page.status === 200)) {
    try { page = await getText(`https://127.0.0.1:${httpsPort}/`); } catch (e) { page = null; }
    await sleep(300);
  }
  if (!page || page.status !== 200 || !page.body.includes('IMPOSTER')) {
    console.error('FAIL: https page -> ' + (page ? page.status : 'refused'));
    process.exit(1);
  }
  console.log('ok: https serves the game (self-signed cert)');

  const url = `https://127.0.0.1:${httpsPort}`;
  const s = io(url, {
    transports: ['websocket'],
    transportOptions: { websocket: { rejectUnauthorized: false } }
  });
  let roomCode = null;
  s.on('updateState', st => { if (st && st.code) roomCode = st.code; });
  s.on('connect_error', e => { console.error('FAIL: wss connect: ' + e.message); process.exit(1); });
  s.on('connect', () => { s.emit('createRoom', { name: 'VoiceHost' }); s.emit('voiceOn'); });

  let voiceIds = null;
  s.on('voiceState', st => { voiceIds = st.ids; });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await sleep(100);
    if (voiceIds && voiceIds.length === 1) break;
  }
  if (!roomCode || !voiceIds || voiceIds.length !== 1) {
    console.error('FAIL: voice over https — room=' + roomCode + ' voiceIds=' + JSON.stringify(voiceIds));
    process.exit(1);
  }
  console.log('ok: voice signaling works over https (' + voiceIds.length + ' voice user)');

  s.close();
  process.exit(0);
}

main().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
