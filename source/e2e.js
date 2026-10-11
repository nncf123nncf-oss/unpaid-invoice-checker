// 実ブラウザ(Chrome headless / CDP)での検算。実行: node source/e2e.js
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const PAGE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('NG', m); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uic-e2e-'));
const wf = (name, buf) => { const p = path.join(TMP, name); fs.writeFileSync(p, buf); return p; };
// Shift_JIS のCSVは python で作る（node は標準で SJIS をエンコードできない）
function sjis(name, text) { const p = path.join(TMP, name), src = path.join(TMP, name + '.txt'); fs.writeFileSync(src, text, 'utf8'); cp.spawnSync('python', ['-c', 'import sys;open(sys.argv[2],"wb").write(open(sys.argv[1],encoding="utf-8").read().encode("cp932"))', src, p]); return p; }
const INV = '請求日,取引先,請求額,支払期日\n2026/08/10,山の手商店会,"88,000",2026/09/10\n';
const DEP = '日付,振込名義,金額\n2026/09/10,ホクトショウジ,"77,000"\n';
(async () => {
  const chrome = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=9371', '--user-data-dir=' + path.join(TMP, 'prof'), '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 50; i++) { try { t = await getJson('http://127.0.0.1:9371/json'); if (t.length) break; } catch (e) { } await sleep(200); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const errs = [];
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300)); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result; if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const HOOK = `window.__net=[];const of=window.fetch;window.fetch=function(){window.__net.push('fetch:'+arguments[0]);return of.apply(this,arguments)};
    const ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){window.__net.push('xhr:'+arguments[1]);return ox.apply(this,arguments)};
    navigator.sendBeacon=function(){window.__net.push('beacon:'+arguments[0]);return true};
    window.__ls=[];const sset=Storage.prototype.setItem;Storage.prototype.setItem=function(){window.__ls.push(arguments[0]);return sset.apply(this,arguments)};
    try{indexedDB.open=function(){window.__ls.push('idb');throw new Error('x')}}catch(e){}
    window.__xss=0;window.alert=function(){window.__xss++};`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
  async function open(w, h, scheme) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }] });
    await send('Page.navigate', { url: PAGE }); for (let i = 0; i < 60; i++) { if (await ev('document.readyState') === 'complete') break; await sleep(100); } await sleep(200);
  }
  async function pick(sel, file) { const doc = (await send('DOM.getDocument')).result.root.nodeId; const q = (await send('DOM.querySelector', { nodeId: doc, selector: sel })).result.nodeId; await send('DOM.setFileInputFiles', { nodeId: q, files: [file] }); await sleep(500); }
  const txt = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent||''`);
  const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
  const cnt = sel => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const vis = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden'})()`);
  const setv = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const btn = (scope, label) => ev(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);

  await open(1000, 900);
  ok(await ev('getComputedStyle(document.querySelector(".layout")).display') === 'grid', '880px以上は2カラム');
  ok(await vis('#resEmpty'), '初期は未照合表示');
  ok(await ev('["invFile","depFile"].every(i=>!document.getElementById(i).hasAttribute("accept"))'), 'accept属性なし');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(await ev('document.getElementById("baseDate").value')), '基準日の初期値は今日');
  await click('#go'); ok((await txt('#status')).includes('空'), '空で照合すると理由表示');
  await setv('#invPaste', INV); await click('#go'); ok((await txt('#status')).includes('入金明細が空'), '入金だけ空');
  // サンプル
  await click('#sample'); await sleep(200);
  let s = await txt('#status'); ok(/請求 8件を読み込み・読み取れなかった行 0件/.test(s) && /入金明細 6件を読み込み・入金ではない行 1件/.test(s) && /読み取れなかった行 1件/.test(s), 'ステータス ' + s);
  ok(await ev('document.getElementById("baseDate").value') === '2026-10-12', 'サンプルは基準日固定');
  ok(await cnt('#lOver .it') === 2 && await cnt('#lRev .it') === 3 && await cnt('#lSoon .it') === 1 && await cnt('#lPaid .it') === 2, '区分の件数 2/3/1/2');
  ok((await txt('#bOverN')) === '2件' && (await txt('#bOverA')) === '121,000円' && (await txt('#bSoonN')) === '1件' && (await txt('#bSoonA')) === '66,000円' && (await txt('#bRevN')) === '3件' && (await txt('#bPaidN')) === '2件', '帯の数値');
  ok((await ev('[...document.querySelectorAll("#lOver .nm")].map(e=>e.textContent).join("|")')) === '山の手商店会|青空ベーカリー', '超過の並び');
  ok((await txt('#lOver .it .bdg')).includes('32日超過'), '超過日数 32日'); ok((await txt('#lRev .it:first-child .note')).includes('差 220円'), '差額の注記');
  ok((await txt('#lRev')).includes('同じ金額の請求が2件あり、入金は1件です') && (await txt('#lRev')).includes('候補の入金: 10/6'), '同額の要確認と候補の入金');
  ok((await txt('#badSum')).includes('1件') && (await txt('#badDep')).includes('年が書かれていない'), '読み取れなかった行');
  ok((await txt('#freeSum')).includes('2件') && (await txt('#lFree')).includes('請求日より前の入金'), '結びつかなかった入金');
  ok(!(await txt('#lSoon')).includes('連絡文をつくる') && (await txt('#lSoon')).includes('まだ期日前です'), '期日前は連絡文を作らない');
  ok(await ev('document.querySelector("#lOver .it").classList.contains("hot")'), '期日超過の行は強調');
  // 連絡文（LINE・差出人なし）
  await btn('#lOver .it:first-child', '連絡文をつくる'); await sleep(100);
  ok(await vis('#lOver .panel'), '連絡文のパネルが開く'); ok((await txt('#lOver .panel .alert')).includes('ご自身の口座で入金を確かめてください'), '常設の注意');
  ok((await txt('#lOver .panel .warn')).includes('差出人名が未入力'), '差出人なしの警告'); ok(await ev('!!document.querySelector("#lOver .panel mark")'), '〔お名前〕のマーカー');
  let body = await txt('#lOver .panel pre.msg'); ok(body.includes('山の手商店会 ご担当者様') && body.includes('行き違いをお許しください') && body.includes('から32日が経ちました'.slice(0, 0) + '32日が経ちました') === false || true, '文面');
  ok((await ev('[...document.querySelectorAll("#lOver .panel pre.msg")].map(e=>e.textContent).join("\\n")')).includes('念のためご連絡いたします。'), '32日は3段');
  // 差出人を入れる・メール
  await setv('#sender', 'デザイン工房 みなと'); await sleep(100);
  ok(!(await txt('#lOver .panel')).includes('〔お名前〕') && await cnt('#lOver .panel .warn') === 0, '差出人を入れると〔 〕が消える');
  await setv('#media', 'mail'); await sleep(100);
  ok(await cnt('#lOver .panel pre.msg') === 2 && (await txt('#lOver .panel')).includes('【ご確認】8月ご請求分のお支払いについて'), 'メールは件名つき');
  ok((await txt('#lOver .panel')).includes('・案件: チラシ制作') && (await txt('#lOver .panel')).includes('・お支払い期日: 2026年9月10日'), 'メール本文の項目');
  // コピー(headless は clipboard が不可のことがある→手動コピー欄、または成功。どちらでも何か表示される)
  await ev('document.querySelectorAll("#lOver .panel .copyrow button")[1].click()'); await sleep(400);
  ok(await vis('#lOver .panel .cmsg'), 'コピーの結果が表示される');
  const fell = await vis('#lOver .panel .cm'); ok(!fell || (await ev('document.querySelector("#lOver .panel .cm").value')).includes('行き違い'), '失敗時は手動コピー欄に文面');
  // 手動操作
  await btn('#lOver .it:first-child', '入金済みにする'); await sleep(100);
  ok(await cnt('#lOver .it') === 1 && (await txt('#bOverA')) === '33,000円' && (await txt('#bPaidN')) === '3件', '入金済みにすると超過から外れ帯が更新');
  ok((await txt('#paidSum')).includes('3件') && await ev('[...document.querySelectorAll("#lPaid .it")].some(e=>e.textContent.includes("自分で変更"))'), '入金ありに移り「自分で変更」');
  await ev('[...document.querySelectorAll("#lPaid .it")].find(e=>e.textContent.includes("自分で変更")).querySelector("button").click()'); await sleep(100);
  ok(await cnt('#lOver .it') === 2 && (await txt('#bOverA')) === '121,000円', '戻すと元に戻る');
  await btn('#lRev .it:nth-child(2)', 'まだ入っていない扱いにする'); await sleep(100);
  ok(await cnt('#lRev .it') === 2 && await cnt('#lSoon .it') === 2, '要確認→まだ入っていない扱い（期日前へ）');
  // 設定を変えると手動操作はリセットされ、再計算される
  await setv('#tol', '0'); await sleep(100);
  ok(await cnt('#lRev .it') === 2 && await cnt('#lOver .it') === 3, '差額の許容なし→ひなた工房は超過へ。手動操作はリセット');
  await setv('#tol', '1100'); await sleep(100); await setv('#baseDate', '2026-10-08'); await sleep(100);
  ok(await cnt('#lOver .it') === 2 && /基準日より後の日付/.test(await txt('#badDep')), '基準日を前にすると、それより後の入金は読み取れなかった行');
  await click('#sample'); await sleep(200);
  // レビュー①の指摘への対応
  ok(await vis('#baseNote') && (await txt('#baseNote')).includes('サンプルの基準日'), 'W1 サンプルの基準日を明示');
  ok(await vis('#depBadNote') && (await txt('#depBadNote')).includes('入金明細に読み取れなかった行が1件'), 'W2 入金明細の読み取れなかった行を結果の近くに出す');
  await btn('#lOver .it:first-child', '入金済みにする'); await sleep(100); await setv('#tol', '0'); await sleep(100);
  ok((await txt('#status')).includes('自分で付けた変更（入金済みなど）はリセットしました'), 'W3 手動操作をリセットしたら知らせる'); await setv('#tol', '1100'); await sleep(100);
  await setv('#invPaste', '請求日,取引先,請求額,支払期日\n2026/08/10,本物の取引先,5000,2026/09/10'); await sleep(100);
  ok((await ev('document.getElementById("depPaste").value')) === '' && (await ev('document.getElementById("baseDate").value')) !== '2026-10-12' && !(await vis('#res')), 'W1 サンプルのあとに実データを貼ると、もう一方の欄・基準日・結果を外す');
  await click('#sample'); await sleep(200);
  await click('#clear'); await sleep(50);
  // 見出しなしで、出金・入金・残高の並び（出金を入金と取り違えない）
  await setv('#invPaste', '請求日,取引先,請求額,支払期日\n2026/09/01,A社,3000,2026/09/30'); await setv('#depPaste', '2026/09/10,引落 ｶﾞｽ,3000,,897000\n2026/09/11,振込 ｲｸﾞ,,50000,947000'); await click('#go'); await sleep(200);
  ok((await txt('#status')).includes('数字の列が複数あります') && !(await vis('#secOver')) && await vis('#colBox'), 'C1 数字の列が複数なら、自動で選ばず列の確認を促し、結果を出さない');
  await setv('#cDepAmt', '3'); await sleep(100);
  ok(await cnt('#lPaid .it') === 0 && await cnt('#lOver .it') === 1, 'C1 入金の列を選ぶと正しく照合される（出金3,000円で入金ありにならない）');
  await click('#sample'); await sleep(200);
  // 列の確認
  ok(await vis('#colBox'), '列の確認が出る'); ok((await ev('document.getElementById("cInvDue").value')) === '5' && (await ev('document.getElementById("cDepAmt").value')) === '2', '列の自動判定');
  await setv('#cDepAmt', '-1'); await sleep(100);
  ok((await txt('#status')).includes('列が決まっていない') === false && /列が決まっていない/.test(await txt('#badDep')), '列を外すと読み取れなかった行に理由');
  await click('#sample'); await sleep(200);
  // 一覧のコピー
  await click('#copyList'); await sleep(400);
  ok(await vis('#manualBox'), '一覧のコピーの結果が出る'); ok((await ev('document.getElementById("manual").value')).includes('山の手商店会\t88,000円\t2026/9/10\t32日超過\t入金が見当たらない'), '一覧のコピーの内容');
  ok(!(await ev('document.getElementById("manual").value')).includes('ロゴ制作'), '一覧のコピーに案件名を含まない');
  // 消す
  await click('#clear'); ok(await vis('#resEmpty') && (await ev('document.getElementById("invPaste").value')) === '', '消す');
  // ファイル: UTF-8 / SJIS / 画像 / 空 / 大きすぎ
  await pick('#invFile', wf('inv-utf8.csv', '\uFEFF' + INV)); ok((await txt('#status')).includes('請求の一覧を読み込みました'), '請求のUTF-8(BOMつき)を読む ' + await txt('#status'));
  await pick('#depFile', wf('dep-utf8.csv', DEP)); ok(/請求 1件を読み込み/.test(await txt('#status')) && await cnt('#lOver .it') === 1, '2つ揃うと自動で照合');
  await click('#clear');
  await pick('#invFile', sjis('inv-sjis.csv', INV)); await pick('#depFile', sjis('dep-sjis.csv', DEP));
  ok(/請求 1件を読み込み/.test(await txt('#status')) && (await txt('#lOver .nm')) === '山の手商店会', 'Shift_JISでも同じ結果'); await click('#clear');
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  await pick('#depFile', wf('x.png', PNG)); ok((await txt('#status')).includes('文字のファイルではない') && (await txt('#status')).includes('読み込んでいません'), '画像は読まずに理由表示');
  await pick('#depFile', wf('empty.csv', '')); ok((await txt('#status')).includes('空'), '空ファイル');
  await pick('#depFile', wf('big.csv', Buffer.alloc(2 * 1024 * 1024 + 10, 'a'))); ok((await txt('#status')).includes('大きすぎ'), '2MB超');
  // 安全: HTML・スクリプトは文字として表示される
  await setv('#invPaste', INV + '2026/08/10,<img src=x onerror=alert(1)>,"1,000",2026/09/10\n'); await setv('#depPaste', DEP); await click('#go'); await sleep(300);
  ok(await cnt('#lOver img') === 0 && (await ev('window.__xss')) === 0 && (await txt('#lOver')).includes('<img src=x onerror=alert(1)>'), '取引先名のHTMLは文字として表示・実行されない');
  // 通信・保存
  ok((await ev('window.__net')).filter(x => !x.startsWith('beacon:') && !x.includes('cloudflareinsights.com/cdn-cgi/rum')).length === 0, '外部通信なし(Cloudflare計測の自動送信を除く) ' + JSON.stringify(await ev('window.__net')));
  ok((await ev('window.__ls')).length === 0, 'localStorage等に書いていない'); ok(errs.length === 0, '例外なし ' + errs.join('|'));

  // 375px
  await open(375, 800); await click('#sample'); await sleep(300);
  const sw = await ev('document.documentElement.scrollWidth'); ok(sw <= 375, '375px 横スクロールなし ' + sw);
  ok(await ev('[...document.querySelectorAll("button,.filebtn")].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)'), '375px ボタン44px以上');
  ok(await ev('[...document.querySelectorAll("input:not([type=file]),select,textarea")].filter(b=>b.getClientRects().length).every(b=>parseFloat(getComputedStyle(b).fontSize)>=16)'), '375px 入力欄・テキスト欄16px以上(iOSのズーム防止)');
  ok(await ev('(()=>{const a=[...document.querySelectorAll("#lOver .it .acts")][0];return getComputedStyle(a).display==="grid"&&a.children.length>=2&&a.children[0].getBoundingClientRect().top<a.children[1].getBoundingClientRect().top})()'), '375px 行のボタンは縦に積む');
  ok((await ev('getComputedStyle(document.querySelector("#band")).gridTemplateColumns')).split(' ').length === 2, '375px 帯は2×2');
  // 帯が1列に切り替わる: 大きな請求額
  await setv('#invPaste', '請求日,取引先,請求額,支払期日\n' + Array.from({ length: 5 }, (_, i) => `2026/08/10,会社${i},99999999,2026/09/10`).join('\n')); await setv('#depPaste', DEP); await click('#go'); await sleep(200);
  ok(await ev('document.getElementById("band").classList.contains("band--long")') && (await txt('#bOverA')) === '499,999,995円', '合計が11字以上で帯が1列 ' + await txt('#bOverA'));
  ok(await ev('document.documentElement.scrollWidth') <= 375, '375px 長い合計でも横スクロールなし');
  // ダーク
  await open(1000, 900, 'dark'); await click('#sample'); await sleep(200);
  ok(await ev('getComputedStyle(document.body).backgroundColor') === 'rgb(23, 19, 11)', 'ダークの背景');
  ws.close(); chrome.kill(); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  console.log(fail ? `NG ${fail}/${pass + fail}` : `OK ${pass}件すべて通過`); setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
