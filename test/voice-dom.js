const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script src="\/socket.io\/socket\.io\.js"[^>]*><\/script>/, '')
  .replace('<script src="pairs.js"></script>', '')
  .replace('<script src="app.js"></script>', '');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => {
  if (!/scrollTo/.test(e.message)) errors.push(e.message);
});

const dom = new JSDOM(html, { runScripts: 'outside-only', virtualConsole: vc, url: 'http://localhost:3000/' });
const { window } = dom;

const handlers = {};
const emitted = [];
window.io = () => ({
  connected: true,
  emit(ev, data) { emitted.push([ev, data]); },
  on(ev, fn) { handlers[ev] = fn; }
});
window.__fire = (ev, data) => { if (handlers[ev]) handlers[ev](data); };

window.RTCPeerConnection = function () {
  this.iceServers = [];
  this.signalingState = 'stable';
  this.remoteDescription = null;
  this.localDescription = null;
  this.onicecandidate = null;
  this.ontrack = null;
  this.iceQueue = [];
};
window.RTCPeerConnection.prototype.createOffer = async () => ({ type: 'offer', sdp: 'o' });
window.RTCPeerConnection.prototype.createAnswer = async () => ({ type: 'answer', sdp: 'a' });
window.RTCPeerConnection.prototype.setLocalDescription = async function (d) { this.localDescription = d; };
window.RTCPeerConnection.prototype.setRemoteDescription = async function (d) { this.remoteDescription = d; };
window.RTCPeerConnection.prototype.addIceCandidate = async c => { ICE_SETS.push(c); };
window.RTCPeerConnection.prototype.close = () => {};
window.RTCPeerConnection.prototype.addTrack = () => {};
const ICE_SETS = [];

const fakeTrack = { enabled: true, stop: () => {} };
window.navigator.mediaDevices = {
  getUserMedia: async () => ({ getTracks: () => [fakeTrack] })
};
window.AudioContext = function () {
  this.state = 'running';
  this.resume = async () => {};
  this.createMediaStreamSource = () => ({ connect: () => {} });
  this.createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: () => {} });
};
window.requestAnimationFrame = () => 0;
Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', { set() {}, get() { return null; } });

try { window.eval(appJs); } catch (e) { console.error('LOAD FAILED: ' + e.stack); process.exit(1); }

const d = window.document;
let fail = 0;
const check = (ok, name) => { console.log((ok ? 'ok: ' : 'DEAD: ') + name); if (!ok) fail = 1; };

check(d.querySelector('#btn-voice') != null, 'Voice button exists in header');
check(typeof d.querySelector('#btn-voice').onclick === 'function', 'Voice button wired');

d.querySelector('#btn-create').value;
d.querySelector('#create-name').value = 'Tester';
d.querySelector('#btn-create').click();
setTimeout(() => {
  check(d.querySelector('#btn-voice').textContent === 'Voice: off', 'voice label initial: ' + d.querySelector('#btn-voice').textContent);

  d.querySelector('#btn-voice').click();

  setTimeout(async () => {
    check(d.querySelector('#btn-voice').textContent === 'Voice: on', 'voice label after enable: ' + d.querySelector('#btn-voice').textContent);
    check(emitted.some(([ev]) => ev === 'voiceOn'), 'voiceOn emitted');

    window.__fire('voiceState', { ids: ['p1', 'p999'] });
    window.__fire('voiceSignal', { from: 'p999', payload: { sdp: { type: 'offer', sdp: 'o' } } });
    window.__fire('voiceState', { ids: ['p1', 'p999'] });

    setTimeout(async () => {
      check(emitted.some(([ev, dd]) => ev === 'voiceSignal' && dd.to === 'p999' && dd.payload && dd.payload.sdp && dd.payload.sdp.type === 'answer'), 'answered offer to p999');
      window.__fire('voiceSignal', { from: 'p999', payload: { ice: { candidate: 'x' } } });
      window.__fire('voiceSignal', { from: 'p999', payload: { sdp: { type: 'answer', sdp: 'a' } } });

      d.querySelector('#btn-voice').click();
      check(d.querySelector('#btn-voice').textContent === 'Voice: muted', 'mute label: ' + d.querySelector('#btn-voice').textContent);
      check(fakeTrack.enabled === false, 'mute actually disables track');
      d.querySelector('#btn-voice').click();
      check(d.querySelector('#btn-voice').textContent === 'Voice: on', 'unmute label: ' + d.querySelector('#btn-voice').textContent);

      window.__fire('voiceState', { ids: ['p1'] });
      setTimeout(() => {
        check(true, 'reconcile after peer-gone completed');
        d.querySelector('#btn-leave').click();
        setTimeout(() => {
          check(emitted.some(([ev]) => ev === 'voiceOff'), 'voiceOff emitted on leave');
          check(d.querySelector('#btn-voice').textContent === 'Voice: off', 'label back to off: ' + d.querySelector('#btn-voice').textContent);
          check(errors.length === 0, 'no runtime errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
          process.exit(fail);
        }, 60);
      }, 60);
    }, 60);
  }, 60);
}, 60);
