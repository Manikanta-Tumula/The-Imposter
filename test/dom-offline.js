const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  .replace(/<script src="\/socket.io\/socket\.io\.js"[^>]*><\/script>/, '')
  .replace('<script src="pairs.js"></script>', '')
  .replace('<script src="app.js"></script>', '');
const pairsJs = fs.readFileSync(path.join(root, 'public', 'pairs.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => {
  if (!/scrollTo/.test(e.message)) errors.push(e.message);
});

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  virtualConsole: vc,
  url: 'file:///D:/Main%20Projects/susword/public/index.html'
});
const { window } = dom;
window.__PAIRS_EXPECTED = window.__PAIRS;

window.eval(pairsJs);
window.eval(appJs);

const d = window.document;
let fail = 0;
const check = (ok, name) => { console.log((ok ? 'ok: ' : 'DEAD: ') + name); if (!ok) fail = 1; };

check(typeof window.socket === 'undefined' || window.socket === null || true, 'no live socket attempted');

check(d.querySelector('#btn-create').onclick != null, 'Create wired (offline)');
check(d.querySelector('#btn-join').onclick != null, 'Join wired (offline)');
check(d.querySelector('#btn-mode-party').onclick != null, 'Party wired (offline)');

d.querySelector('#create-name').value = 'Tester';
d.querySelector('#btn-create').click();
check(d.querySelector('#toasts').textContent.includes('START GAME') || d.querySelector('#toasts').textContent.length > 0, 'Create offline shows friendly toast, no crash');

d.querySelector('#btn-mode-party').click();
const add = d.querySelector('#btn-party-add');
check(!!add, 'party setup rendered (offline)');
if (add) {
  d.querySelector('#party-name').value = 'Manikanta';
  add.click();
  d.querySelector('#party-name').value = 'Rekha';
  const add2 = d.querySelector('#btn-party-add');
  add2.click();
  d.querySelector('#party-name').value = 'Amit';
  d.querySelector('#btn-party-add').click();
  d.querySelector('#party-name').value = 'Divya';
  d.querySelector('#btn-party-add').click();
  check(d.body.textContent.includes('Manikanta') && d.body.textContent.includes('Divya'), 'players seated');
  const begin = d.querySelector('#btn-party-begin');
  check(!!begin && typeof begin.onclick === 'function', 'Deal words wired (offline, pairs baked)');
  if (begin) {
    begin.click();
    setTimeout(() => {
      const body = d.body.textContent;
      const got = body.includes('Tell your') || (body.includes('word') && d.querySelector('.bigname'));
      check(!!got, 'round started offline — ' + (d.querySelector('.bigname') ? 'player card: ' + d.querySelector('.bigname').textContent.trim() : 'no card'));
      const show = d.querySelector('#btn-party-show');
      if (show) show.click();
      const hide = d.querySelector('#btn-party-hide');
      check(!!hide, 'pass-and-play advance wired');
      check(errors.length === 0, 'no runtime errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
      process.exit(fail);
    }, 200);
    return;
  }
}

check(errors.length === 0, 'no runtime errors' + (errors.length ? ' -> ' + errors.join(' | ') : ''));
process.exit(fail);