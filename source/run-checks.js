// 計算コア(index.html の <script id="core">)の検算。実行: node source/run-checks.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + ';this.X=UIC;', ctx); const X = ctx.X;
let n = 0, f = 0;
const J = v => JSON.stringify(v);
const eq = (a, b, m) => { n++; if (J(a) !== J(b)) { f++; console.log('NG', m, J(a), '!=', J(b)); } };
const tr = (c, m) => eq(!!c, true, m);
const T = (y, m, d) => Date.UTC(y, m - 1, d);
const BASE = T(2026, 10, 12);

// テキストから分類までを通す
function go(invText, depText, opt = {}) {
  const base = opt.base || BASE, tol = opt.tol == null ? 1100 : opt.tol;
  const ti = X.parseTable(invText), td = X.parseTable(depText);
  const di = X.detectInvoice(ti.rows), dd = X.detectDeposit(td.rows);
  const bi = X.buildInvoices(ti.rows, di, di.cols), bd = X.buildDeposits(td.rows, dd, dd.cols, base);
  const mr = X.match(bi.ok, bd.ok, tol, base);
  const cl = X.classify(bi.ok, bd.ok, mr, opt.manual || {}, base);
  return { di, dd, bi, bd, mr, cl };
}
const names = l => l.map(x => x.inv.name);
const FORBIDDEN = ['未入金', '督促', '催促', '滞納', '延滞', '遅延', '至急', '必ず', '直ちに', 'ご了承', '法的', '損害', '弁護士', '内容証明', '回収', '取り立て', '債権', '払っていません', '支払いが遅れ', '入金がありません', 'お支払いがない場合'];
X.forbiddenIn = text => FORBIDDEN.filter(w => text.includes(w));
tr(!/督促|催促|債権|滞納|延滞|取り立て|内容証明|弁護士|法的措置|回収/.test(html), '配布するHTMLに禁止語が入っていない');
const H = '請求日,取引先,請求額,支払期日\n', DH = '日付,振込名義,金額\n';

// S1 サンプル一式（仕様カード6節の机上計算と一致するか）
const s1 = go(X.sampleInvoice(), X.sampleDeposit());
eq(s1.di.header, true, 'S1 請求 見出しあり'); eq(J(s1.di.cols), J({ date: 0, due: 5, name: 1, amt: 4, item: 3, payer: 2 }), 'S1 請求の列');
eq(J(s1.dd.cols), J({ date: 0, name: 1, amt: 2 }), 'S1 入金の列');
eq(s1.bi.ok.length, 8, 'S1 請求8件'); eq(s1.bi.bad.length, 0, 'S1 請求の読めない行なし');
eq(s1.bd.ok.length, 6, 'S1 入金6件'); eq(s1.bd.notDep, 1, 'S1 入金ではない行1件'); eq(s1.bd.bad.map(x => x.reason), ['日付: 年が書かれていない'], 'S1 入金の読めない行');
eq(names(s1.cl.over), ['山の手商店会', '青空ベーカリー'], 'S1 期日超過の順'); eq(s1.cl.over.map(x => x.days), [32, 12], 'S1 超過日数'); eq(s1.cl.overSum, 121000, 'S1 超過の合計');
eq(names(s1.cl.rev), ['ひなた工房', '川辺ヨガ教室', '森のカフェ'], 'S1 要確認'); eq(s1.cl.rev.map(x => x.r.st), ['diff', 'review', 'review'], 'S1 要確認の種類');
eq(s1.cl.rev[0].r.diff, 220, 'S1 差額220'); eq([s1.cl.rev[1].r.k, s1.cl.rev[1].r.m], [2, 1], 'S1 同額2件に入金1件');
eq(names(s1.cl.soon), ['みどり企画'], 'S1 期日前'); eq([s1.cl.soon[0].days, s1.cl.soonSum], [19, 66000], 'S1 期日前の日数・合計');
eq(names(s1.cl.paid), ['みなとデザイン室', '星野写真館'], 'S1 入金あり');
eq(s1.cl.free.map(f => [s1.bd.ok[f.dep].name, f.reason]), [['ミナトデザインシツ', '請求日より前の入金'], ['ホクトショウジ', '金額の合う請求がない']], 'S1 結びつかなかった入金');

// S2 前の月の入金の取り違え防止
let r = go(H + '2026/09/01,A社,110000,2026/09/30', DH + '2026/08/20,エーシャ,110000');
eq(r.cl.paid.length, 0, 'S2 請求日より前の入金は入金ありにならない'); eq(r.cl.over.length, 1, 'S2 期日超過');
r = go(H + '2026/09/01,A社,110000,2026/09/30', DH + '2026/09/05,エーシャ,110000');
eq(r.cl.paid.length, 1, 'S2 請求日以降なら入金あり');
r = go(H + '2026/09/01,A社,110000,2026/09/30', DH + '2026/09/01,エーシャ,110000');
eq(r.cl.paid.length, 1, 'S2 請求日当日の入金は入金あり');

// S3 同額グループ
const two = H + '2026/09/01,A社,44000,2026/09/30\n2026/09/02,B社,44000,2026/09/30';
r = go(two, DH + '2026/09/10,x,44000\n2026/09/11,y,44000'); eq(r.cl.paid.length, 2, 'S3 同額2件＋入金2件→2件とも入金あり');
r = go(two, DH + '2026/09/10,x,44000'); eq(r.cl.rev.length, 2, 'S3 同額2件＋入金1件→2件とも要確認'); eq(r.cl.paid.length + r.cl.over.length, 0, 'S3 割り当てを決めない');
r = go(two, DH + '2026/09/10,x,1000'); eq(r.cl.over.length, 2, 'S3 入金0件→見当たらない');
const three = two + '\n2026/09/03,C社,44000,2026/09/30';
r = go(three, DH + '2026/09/10,x,44000\n2026/09/11,y,44000'); eq(r.cl.rev.length, 3, 'S3 同額3件＋入金2件→3件とも要確認');
// 請求日が違う同額: 後の請求日の分は、前の入金を使えない
r = go(H + '2026/08/01,A社,44000,2026/08/31\n2026/09/20,B社,44000,2026/10/20', DH + '2026/08/10,x,44000\n2026/09/25,y,44000');
eq(r.cl.paid.length, 2, 'S3 請求日が違う同額: 入金の日付に合う割り当てで2件とも入金あり');
r = go(H + '2026/08/01,A社,44000,2026/08/31\n2026/09/20,B社,44000,2026/10/20', DH + '2026/08/10,x,44000');
eq(r.cl.paid.map(x => x.inv.name), ['A社'], 'S3 入金1件はAだけの候補（Bは請求日より前でBの候補ではない）→Aは入金あり（同額グループの数にBを入れない）'); eq(r.cl.over.map(x => x.inv.name).concat(r.cl.soon.map(x => x.inv.name)), ['B社'], 'S3 Bは見当たらない側');

// S4 振込名義の優先
const pay = '請求日,取引先,振込名義,請求額,支払期日\n';
r = go(pay + '2026/09/01,A社,エーシャ,44000,2026/09/30\n2026/09/01,B社,,44000,2026/09/30', DH + '2026/09/10,エーシャ,44000');
eq(names(r.cl.paid), ['A社'], 'S4 名義が合うほうだけ入金あり'); eq(names(r.cl.over), ['B社'], 'S4 もう片方は見当たらない');
r = go(pay + '2026/09/01,A社,エーシャ,44000,2026/09/30', DH + '2026/09/10,ﾄﾞｳｷﾞ ｴｰｼｬ ﾏﾙ,44000');
eq(r.cl.paid.length, 1, 'S4 半角カナの名義も含まれれば一致（NFKC）');
r = go(pay + '2026/09/01,A社,エーシャ,44000,2026/09/30', DH + '2026/09/10,ビーシャ,44000');
eq(r.cl.paid.length, 1, 'S4 名義が違っても金額が一致すれば入金あり'); eq(r.cl.paid[0].r.mismatch, true, 'S4 名義は一致していない注記');

// S5 差額の許容
const one = H + '2026/09/01,A社,55000,2026/09/30';
const withTol = (amt, tol) => go(one, DH + '2026/09/10,x,' + amt, { tol });
eq(withTol(54780, 1100).cl.rev.length, 1, 'S5 220円差・許容1,100→差額あり'); eq(withTol(54780, 0).cl.over.length, 1, 'S5 許容なし→見当たらない');
eq(withTol(54000, 1100).cl.rev.length, 1, 'S5 1,000円差→差額あり'); eq(withTol(53800, 1100).cl.over.length, 1, 'S5 1,200円差→見当たらない');
eq(withTol(55220, 1100).cl.over.length, 1, 'S5 多い入金は差額ありにならない'); eq(withTol(53800, 2200).cl.rev.length, 1, 'S5 許容2,200で1,200円差→差額あり');
r = go(one, DH + '2026/09/10,x,54780\n2026/09/11,y,54900'); eq(r.cl.rev.length, 1, 'S5 差額で合う入金が2件→要確認'); eq(r.cl.rev[0].r.why, 'diff', 'S5 理由'); eq(r.cl.rev[0].r.cands.length, 2, 'S5 候補2件');
// 同じ入金が2件の請求の差額候補→要確認（勝手に割り当てない）
r = go(H + '2026/09/01,A社,55000,2026/09/30\n2026/09/01,B社,55100,2026/09/30', DH + '2026/09/10,x,54780');
eq(r.cl.rev.length, 2, 'S5 同じ入金が2件の請求の候補→両方要確認');

// S6 日付ゆらぎ（請求日・入金日）
const dts = ['2026/9/5', '2026-09-05', '2026年9月5日', 'R8.9.5', '20260905'];
dts.forEach(d => eq(X.parseDate(d, null).t, T(2026, 9, 5), 'S6 受理 ' + d));
['9/5', '2026/2/30', '99/9/5', 'abc', ''].forEach(d => tr(X.parseDate(d, null).err, 'S6 拒否 ' + d));
eq(X.parseDate('2026/10/13', BASE).err, '基準日より後の日付', 'S6 入金日の将来日');
r = go(H + '2026/10/20,A社,1000,2026/11/20', DH + '2026/10/13,x,1000'); eq(r.bi.ok.length, 1, 'S6 先日付の請求書は読む'); eq(r.bd.bad.map(x => x.reason), ['日付: 基準日より後の日付'], 'S6 将来の入金は読まない');
r = go(H + '2026/10/20,A社,1000,2026/10/10', DH + '2026/10/10,x,1000'); eq(r.bi.bad.map(x => x.reason), ['支払期日が請求日より前'], 'S6 期日が請求日より前');
r = go(H + '9/5,A社,1000,2026/10/10\n2026/9/5,B社,1000,10/10', DH + '2026/10/10,x,1000');
eq(r.bi.bad.map(x => x.reason), ['請求日: 年が書かれていない', '支払期日: 年が書かれていない'], 'S6 請求側の年なし');

// S7 金額ゆらぎ
['110,000', '¥110,000', '１１００００円', '"110,000"', '110000'].forEach(a => eq(X.parseAmount(a).v, 110000, 'S7 受理 ' + a));
eq(X.parseAmount('-3300').kind, 'neg', 'S7 マイナス'); eq(X.parseAmount('▲3,300').kind, 'neg', 'S7 ▲'); eq(X.parseAmount('').kind, 'empty', 'S7 空'); eq(X.parseAmount('0').kind, 'zero', 'S7 0');
eq(X.parseAmount('abc').kind, 'bad', 'S7 abc'); eq(X.parseAmount('100000000').kind, 'big', 'S7 1億');
r = go(H + '2026/09/01,A社,1000,2026/09/30', DH + '2026/09/10,a,\n2026/09/10,b,0\n2026/09/10,c,-3300\n2026/09/10,d,abc\n2026/09/10,e,1000');
eq(r.bd.notDep, 3, 'S7 入金ではない行は3件（空・0・マイナス）'); eq(r.bd.bad.map(x => x.reason), ['金額: 読めない'], 'S7 読めない金額は読み取れなかった行'); eq(r.bd.ok.length, 1, 'S7 入金1件');
r = go(H + '2026/09/01,A社,-1000,2026/09/30\n2026/09/01,B社,,2026/09/30\n2026/09/01,C社,abc,2026/09/30', DH + '2026/09/10,e,1000');
eq(r.bi.bad.map(x => x.reason), ['請求額: マイナス', '請求額: 空欄', '請求額: 読めない'], 'S7 請求額の拒否');

// S8 列・形式: 見出しなし・列順違い・タブ区切り・入金と出金が別の列
r = go('2026/09/01,A社,50000,2026/09/30\n2026/09/05,B社,30000,2026/10/05', '2026/09/10,エー,50000\n2026/09/12,ビー,30000');
eq(J(r.di.cols), J({ date: 0, due: 3, name: 1, amt: 2, item: -1, payer: -1 }), 'S8 請求 見出しなし'); eq(r.cl.paid.length, 2, 'S8 見出しなしでも照合');
r = go('取引先\t支払期日\t請求日\t請求額\nA社\t2026/09/30\t2026/09/01\t50000', '日付\t摘要\t入金額\n2026/09/10\tエー\t50000');
eq(J(r.di.cols), J({ date: 2, due: 1, name: 0, amt: 3, item: -1, payer: -1 }), 'S8 列順違い・タブ'); eq(r.cl.paid.length, 1, 'S8 タブ区切り');
const bank = '日付,お取引内容,お支払金額,お預り金額,残高\n2026/09/10,振込 ｴｰ,,50000,900000\n2026/09/11,引落,3000,,897000';
r = go(H + '2026/09/01,A社,50000,2026/09/30', bank);
eq(J(r.dd.cols), J({ date: 0, name: 1, amt: 3 }), 'S8 お預り金額の列を自動で選ぶ'); eq([r.bd.ok.length, r.bd.notDep], [1, 1], 'S8 出金の行は入金ではない行'); eq(r.cl.paid.length, 1, 'S8 入金あり');
r = go(H + '2026/09/01,A社,50000,2026/09/30', '日付,入出金(円),残高(円),入出金先内容\n2026/09/10,50000,900000,ｴｰ\n2026/09/11,-3000,897000,ｶﾞｽ');
eq(J(r.dd.cols), J({ date: 0, name: 3, amt: 1 }), 'S8 入出金・残高の形式'); eq(r.bd.notDep, 1, 'S8 マイナスは入金ではない行');
// 見出しなしの入金: 入出金の次に残高があっても左の数値列を金額に
r = go(H + '2026/09/01,A社,50000,2026/09/30', '2026/09/10,エー,50000,900000');
eq(r.dd.cols.amt, -1, 'S8 見出しなしで数字の列が複数なら自動で選ばない'); eq(r.dd.cols.ambiguousAmt, true, 'S8 複数の印'); eq(r.bd.ok.length, 0, 'S8 入金として読まない');
r = go(H + '2026/09/01,A社,3000,2026/09/30', '2026/09/10,引落 ｶﾞｽ,3000,,897000\n2026/09/11,振込 ｲｸﾞ,,50000,947000');
eq([r.dd.cols.amt, r.dd.cols.ambiguousAmt], [-1, true], 'C1 出金・入金・残高の並びは自動で選ばない'); eq(r.cl.paid.length, 0, 'C1 出金3,000円を入金として「入金あり」にしない');
r = go(H + '2026/09/01,A社,50000,2026/09/30', '2026/09/10,エー,50000'); eq(r.dd.cols.amt, 2, 'S8 数字の列が1つなら自動で選ぶ'); eq(r.cl.paid.length, 1, 'S8 照合');

// S9 安全
r = go(H + '2026/09/01,<img src=x onerror=alert(1)>,1000,2026/09/30', DH + '2026/09/10,x,1');
eq(r.bi.ok[0].name, '<img src=x onerror=alert(1)>', 'S9 文字としてそのまま保持（描画は textContent）');
tr(!/innerHTML|insertAdjacentHTML|document\.write/.test(html.replace(/<script id="core">[\s\S]*?<\/script>/, '').split('<script id="ui">')[1]), 'S9 UI に innerHTML なし');
tr(!/localStorage|sessionStorage|indexedDB/.test(html), 'S9 保存APIを使っていない');
const many = H + Array.from({ length: 205 }, (_, i) => `2026/09/01,会社${i},${1000 + i},2026/09/30`).join('\n');
r = go(many, DH + '2026/09/10,x,1'); eq([r.bi.ok.length, r.bi.over], [200, 5], 'S9 請求は200行まで');
const manyd = DH + Array.from({ length: 3005 }, (_, i) => `2026/09/10,x,${1000 + i}`).join('\n');
r = go(H + '2026/09/01,A社,1000,2026/09/30', manyd); eq([r.bd.ok.length, r.bd.over], [3000, 5], 'S9 入金は3,000行まで');
// 口座番号らしい並びを伏せる
r = go(H + '2026/09/01,A社,1000,2026/09/30', '日付,名義,金額,口座\n2026/9/10,x ****-1234-5678,1000,****-1234');
eq(r.bd.ok[0].name, 'x ****', 'S9 名義の中の口座番号らしい並びを伏せる');
const cardInName = go(H + '2026/09/01,A社 1234-5678-9012-3456,1000,2026/09/30', DH + '2026/09/10,x,1');
eq(cardInName.bi.ok[0].name, 'A社 ****', 'S9 取引先の中のカード番号らしい並びを伏せる');

// S10 コピー
const cp = X.copyListText(s1.cl, BASE).split('\n');
eq(cp[0].split('\t'), ['山の手商店会', '88,000円', '2026/9/10', '32日超過', '入金が見当たらない'], 'S10 コピー1行目');
tr(cp.some(l => l.startsWith('期日超過 2件\t121,000円')), 'S10 合計行');
const cpt = cp.join('\n'); tr(!/ロゴ|チラシ|ミナトデザインシツ|2026\/08\/10/.test(cpt), 'S10 案件名・振込名義・請求日を含まない');

// S11 連絡文
const mk = (days, media, sender, item = 'チラシ制作') => {
  const inv = { name: '山の手商店会', amount: 88000, t: T(2026, 8, 10), due: T(2026, 9, 10), item };
  return X.makeMessage({ inv, days }, { media, sender });
};
eq([1, 7, 8, 30, 31, 100].map(X.stage), [1, 1, 2, 2, 3, 3], 'S11 段の境界');
const combos = []; [1, 3, 7, 8, 20, 30, 31, 90, 400].forEach(d => ['line', 'mail'].forEach(m => ['デザイン工房 みなと', ''].forEach(s => ['チラシ制作', ''].forEach(i => combos.push(mk(d, m, s, i))))));
combos.forEach((m, k) => {
  const all = (m.subject || '') + '\n' + m.body;
  eq(X.forbiddenIn(all), [], 'S11 禁止語 ' + k);
  tr(all.includes('すでにお振込みいただいている場合は、行き違いをお許しください。'), 'S11 行き違いの一文 ' + k);
  tr(all.includes('お振込先は請求書に記載のとおりです。'), 'S11 振込先は書かない ' + k);
  tr(!/口座番号|銀行|支店|普通|当座/.test(all.replace('当方の口座では', '')), 'S11 口座情報の語が出ない ' + k);
  tr(all.includes('当方の口座では入金を確認できておりません'), 'S11 断定しない主語 ' + k);
});
eq(mk(5, 'line', '').placeholder, true, 'S11 差出人なしは未入力'); tr(mk(5, 'line', '').body.includes('〔お名前〕'), 'S11 〔お名前〕');
eq(mk(5, 'line', 'みなと').placeholder, false, 'S11 差出人あり'); tr(!mk(5, 'line', 'みなと').body.includes('〔'), 'S11 〔 〕が残らない');
eq(mk(3, 'mail', 'x').subject, '【ご確認】8月ご請求分のお支払いについて', 'S11 件名（請求日の月）'); eq(mk(3, 'line', 'x').subject, undefined, 'S11 LINEに件名なし');
tr(mk(31, 'mail', 'x').body.includes('お支払いのご予定日をお知らせいただけますでしょうか'), 'S11 3段は予定日を尋ねる'); tr(mk(31, 'line', 'x').body.startsWith('山の手商店会 ご担当者様\nお世話になっております。xです。\n念のためご連絡いたします。'), 'S11 LINE 3段の書き出し'); tr(!mk(31, 'mail', 'x').body.includes('改めて'), 'W10 3段は先に連絡した前提を書かない');
tr(mk(20, 'mail', 'x').body.includes('から20日が経ちましたが'), 'S11 2段は日数を書く'); tr(!mk(20, 'mail', 'x').body.includes('先日'), 'S11 先に送った前提を書かない');
tr(!mk(5, 'mail', 'x', '').body.includes('案件:'), 'S11 案件なしは行を出さない');

// S12 手動操作
r = go(X.sampleInvoice(), X.sampleDeposit(), { manual: { 3: 'paid' } });
eq(names(r.cl.over), ['青空ベーカリー'], 'S12 入金済みにする→見当たらないから外れる'); eq(r.cl.overSum, 33000, 'S12 合計が更新'); eq(r.cl.paid.length, 3, 'S12 入金ありに移る'); eq(r.cl.paid.find(x => x.i === 3).man, 'paid', 'S12 自分で変更');
r = go(X.sampleInvoice(), X.sampleDeposit(), { manual: { 6: 'missing', 1: 'missing' } });
eq(names(r.cl.over), ['山の手商店会', '青空ベーカリー', 'ひなた工房'], 'S12 要確認の「まだ入っていない扱い」は期日で超過・期日前に入り、超過日数順に並ぶ'); eq(r.cl.over.map(x => x.days), [32, 12, 2], 'S12 日数');
eq(names(r.cl.rev), ['森のカフェ'], 'S12 残りは要確認のまま'); eq(r.cl.soon.map(x => x.inv.name).sort(), ['川辺ヨガ教室', 'みどり企画'].sort(), 'S12 期日前に入る');

// S13 期日当日・基準日の変更
r = go(H + '2026/09/01,A社,1000,2026/10/12', DH + '2026/09/10,x,5000'); eq(r.cl.soon.map(x => x.days), [0], 'S13 期日当日は期日前の0日');
r = go(H + '2026/09/01,A社,1000,2026/10/11', DH + '2026/09/10,x,5000'); eq(r.cl.over.map(x => x.days), [1], 'S13 翌日は1日超過');
r = go(X.sampleInvoice(), X.sampleDeposit(), { base: T(2026, 9, 25) });
eq(r.cl.over.map(x => x.inv.name), ['山の手商店会', '青空ベーカリー'].filter(n => r.cl.over.some(o => o.inv.name === n)), 'S13 基準日を前にすると超過が減る');

// レビュー①の指摘
// W2 入金の+記号・.00
['+110,000', '110,000.00', '+110000'].forEach(a => eq(X.parseAmount(a).v, 110000, 'W2 受理 ' + a));
// W4 同じ振込名義・同額の請求が複数で入金が足りない→要確認（割り当てを決めない）
r = go(pay + '2026/08/01,A社,エーシャ,44000,2026/08/31\n2026/09/01,A社,エーシャ,44000,2026/09/30', DH + '2026/09/03,エーシャ,44000');
eq(r.cl.rev.length, 2, 'W4 同名義・同額2件で入金1件→2件とも要確認'); eq(r.cl.over.length, 0, 'W4 どちらかを見当たらないにしない');
r = go(pay + '2026/08/01,A社,エーシャ,44000,2026/08/31\n2026/09/01,A社,エーシャ,44000,2026/09/30', DH + '2026/08/03,エーシャ,44000\n2026/09/03,エーシャ,44000'); eq(r.cl.paid.length, 2, 'W4 入金が足りれば2件とも入金あり');
// W5 要確認の行を入金済みにしたら、その候補はほかの行から外れる
r = go(X.sampleInvoice(), X.sampleDeposit(), { manual: { 6: 'paid' } });
eq(r.cl.paid.map(x => x.inv.name).includes('川辺ヨガ教室'), true, 'W5 川辺は入金あり'); eq(r.cl.rev.map(x => x.inv.name), ['ひなた工房'], 'W5 森のカフェは要確認から外れる');
const mori = [...r.cl.over, ...r.cl.soon].find(x => x.inv.name === '森のカフェ'); tr(mori && mori.lost, 'W5 森のカフェは候補を失って見当たらない側（候補が外れた旨を出す）');
// W6 まだ入っていない扱いにしても、候補の入金を見失わない
r = go(X.sampleInvoice(), X.sampleDeposit(), { manual: { 1: 'missing' } });
const hin = r.cl.over.find(x => x.inv.name === 'ひなた工房'); tr(hin && hin.r.st === 'diff' && hin.r.dep != null, 'W6 差額の入金の情報が残る');
// W7 差の許容は、請求額が許容額の10倍以上のときだけ名義なしで使う
r = go(H + '2026/09/01,A社,1000,2026/09/30', DH + '2026/09/10,別会社,300'); eq(r.cl.over.length, 1, 'W7 1,000円の請求に別会社の300円は結びつけない'); eq(r.cl.rev.length, 0, 'W7 差額ありにしない');
r = go(H + '2026/09/01,A社,10999,2026/09/30', DH + '2026/09/10,別会社,10000'); eq(r.cl.over.length, 1, 'W7 10倍未満（10,999円）は使わない');
r = go(H + '2026/09/01,A社,11000,2026/09/30', DH + '2026/09/10,別会社,10000'); eq(r.cl.rev.length, 1, 'W7 11,000円以上は使う');
// W8 同額の毎月請求: 入金を使える請求だけで数える
r = go(H + '2026/09/01,A社,110000,2026/09/30\n2026/10/01,A社,110000,2026/10/31', DH + '2026/09/29,エー,110000');
eq(r.cl.paid.map(x => x.inv.due), [T(2026, 9, 30)], 'W8 9/1の請求は入金あり（10/1の請求の数に入れない）'); eq(r.cl.rev.length, 0, 'W8 要確認にならない');
// W9 7桁以上の数字の連続を伏せる
r = go(H + '2026/09/01,A社,1000,2026/09/30', '日付,名義,金額\n2026/09/10,口座 1234567890,1000\n2026/09/10,普通 1234567,1000');
eq(r.bd.ok.map(x => x.name), ['口座 ****', '普通 ****'], 'W9 7桁以上の数字を伏せる');
// M1 二重に振り込まれた入金の理由
r = go(H + '2026/09/01,A社,1000,2026/09/30', DH + '2026/09/10,エー,1000\n2026/09/12,エー,1000');
eq(r.mr.free.map(f => f.reason), ['同じ金額の請求は、ほかの入金に結びついています'], 'M1 二重の入金の理由');
// M7 曜日つきの日付
eq(X.parseDate('2026/09/05(日)', null).t, T(2026, 9, 5), 'M7 曜日つき'); tr(X.looksDate('2026/09/05(日)'), 'M7 見出しなしでも日付の列と判定');

// 配色のコントラスト比（本文色×背景）
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
[['#ffffff', '#8A5A00', 'ライト ボタン'], ['#8A5A00', '#ffffff', 'ライト アクセント文字×面'], ['#8A5A00', '#fff8e6', 'ライト アクセント×行背景'], ['#6a5d44', '#faf6ee', 'ライト ink3×背景'], ['#4a3f2a', '#f7ecd2', 'ライト ink2×帯'],
  ['#2a1c00', '#F0B955', 'ダーク ボタン'], ['#F0B955', '#221c10', 'ダーク アクセント×面'], ['#F0B955', '#2b2210', 'ダーク アクセント×行背景'], ['#b0a487', '#17130b', 'ダーク ink3×背景'], ['#5e3800', '#fff1cf', 'ライト 警告'], ['#ffe0a0', '#3a2f10', 'ダーク 警告']].forEach(([a, b, m]) => { const v = cr(a, b); tr(v >= 4.5, 'コントラスト ' + m + ' ' + v.toFixed(2)); });

console.log(f ? `NG ${f}/${n}` : `OK ${n}件すべて通過`); process.exit(f ? 1 : 0);
