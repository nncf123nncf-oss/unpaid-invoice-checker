// 投稿カード用の実画面を撮る(Chrome headless / CDP)。サンプルは架空の取引先・金額。
// 実行: node source/shoot.js <出力フォルダ> [YYYY-MM-DD]
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const OUT = path.resolve(process.argv[2]); const DATE = process.argv[3] || '2026-10-11';
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uic-shoot-'));
(async () => {
  const chrome = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=9372', '--user-data-dir=' + path.join(TMP, 'prof'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 50; i++) { try { t = await getJson('http://127.0.0.1:9372/json'); if (t.length) break; } catch (e) { } await sleep(200); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable');
  async function open(w, h, dpr, mobile) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: PAGE }); for (let i = 0; i < 60; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); } await sleep(300);
  }
  async function shot(file, y0, y1, w) {
    const r = JSON.parse(await ev(`JSON.stringify({y0:${y0},y1:${y1}})`));
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: r.y0, width: w, height: r.y1 - r.y0, scale: 1 } });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(s.result.data, 'base64')); console.log('wrote', file, r, 'h=' + Math.round(r.y1 - r.y0));
  }
  const bottom = sel => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().bottom+scrollY`;
  const top = sel => `document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().top+scrollY`;
  const setv = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const SENDER = 'デザイン工房 みなと';
  // Card1: デスクトップ1000px・2カラム・サンプルで照合した直後（連絡文はまだ開かない）
  await open(1000, 900, 2, false); await setv('#sender', SENDER); await ev('document.getElementById("sample").click()'); await ev('document.getElementById("invPaste").scrollTop=0;document.getElementById("depPaste").scrollTop=0'); await sleep(300);
  await shot('01-desktop-result-' + DATE + '.png', top('h1') + '-12', `Math.max(${bottom('#lOver')},${bottom('.col-in .card:nth-of-type(2)')})+4`, 1000);
  await shot('source-desktop-full.png', '0', 'document.documentElement.scrollHeight', 1000);
  // Card2: 375px・青空ベーカリー（12日超過）の行を開いて、LINEの連絡文を出した状態。「LINEの文面」の見出しから文面の枠の下まで（注意文は入れない。375px・DPR2の画像で占有率60%を満たす高さに収めるため）
  await open(375, 900, 2, true); await setv('#sender', SENDER); await ev('document.getElementById("sample").click()'); await sleep(300);
  await ev('[...document.querySelectorAll("#lOver .it:nth-child(2) button")].find(b=>b.textContent.trim()==="連絡文をつくる").click()'); await sleep(300);
  await shot('02-mobile375-message-' + DATE + '.png', top('#lOver .it:nth-child(2) .panel .lbl') + '-4', bottom('#lOver .it:nth-child(2) .panel pre.msg') + '+4', 375);
  await shot('source-mobile375-full.png', '0', 'document.documentElement.scrollHeight', 375);
  ws.close(); chrome.kill(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { } setTimeout(() => process.exit(0), 300);
})();
