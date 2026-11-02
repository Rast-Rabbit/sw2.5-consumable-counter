'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sheet.js');

// ゆとシートのJSONでは、改行が &lt;br&gt; になって1つの文字列に入る
const br = '&lt;br&gt;';
const sample = [
  '|~冒険道具類|~効果|',
  '|着替えセット|一週間分の着替え|',
  '',
  '**ポーション類[消耗品]',
  '|~名称　　　　|~個数|~効果|~単価|',
  '|魔香草　　　|6|[１０分]ＭＰを回復|100G|',
  '|ヒーリングＰ|5|[主]ＨＰを回復|100G|',
  '',
  '**石類[消耗品]',
  '|~名称　　　　|~個数|~効果|~単価|',
  '|魔晶石（２）|3|別名、&quot;破片&quot;|200G|',
  '|魔晶石（５）|3|ＭＰを５点代用|500G|',
  '',
  '**装飾品[消耗品]　',
  '|~名称|~個数|~効果|~単価|',
  '|知性の指輪|3|割る用の指輪|500G|',
  '',
  '__※現在装備中のものを個数に含む！！__',
  '',
  '**おうちアイテム',
  '|~名称|~内容|',
  '|アビスシャード×４|がちゃがちゃ|'
].join(br);

test('サンプル形式: 管理対象は [消耗品] の付いた見出しだけ', () => {
  const r = S.parseItems(sample);
  assert.equal(r.ok, true);
  assert.deepEqual(r.categories.map((c) => c.name), ['ポーション類', '石類', '装飾品']);
  assert.deepEqual(r.categories.map((c) => c.items.length), [2, 2, 1]);
  assert.deepEqual(r.warnings, []);
});

test('名称の前後の全角空白は取り除かれ、数字・単価・効果が読める', () => {
  const r = S.parseItems(sample);
  const herb = r.categories[0].items[0];
  assert.equal(herb.name, '魔香草');
  assert.equal(herb.count, 6);
  assert.equal(herb.price, 100);
  assert.equal(herb.effect, '[１０分]ＭＰを回復');
});

test('HTMLエスケープが戻る', () => {
  const r = S.parseItems(sample);
  assert.equal(r.categories[1].items[0].effect, '別名、"破片"');
});

test('列の順序が違っても読める', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~単価|~個数|~名称|~効果|' + br + '|300G|2|魔晶石（３）|ＭＰ３点|');
  const it = r.categories[0].items[0];
  assert.deepEqual([it.name, it.count, it.price, it.effect], ['魔晶石（３）', 2, 300, 'ＭＰ３点']);
});

test('全角数字・カンマ・単位つきでも読める', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|~単価|' + br + '|A|１２個|１，５００Ｇ|' + br + '|B|3|200ガメル|');
  assert.equal(r.categories[0].items[0].count, 12);
  assert.equal(r.categories[0].items[0].price, 1500);
  assert.equal(r.categories[0].items[1].price, 200);
});

test('効果・単価の列が無くても読める（単価は0）', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|' + br + '|A|2|');
  const it = r.categories[0].items[0];
  assert.deepEqual([it.effect, it.price], ['', 0]);
  assert.deepEqual(r.warnings, []);
});

test('全角括弧・【】のタグも認識する', () => {
  const r1 = S.parseItems('**薬［消耗品］' + br + '|~名称|~個数|' + br + '|A|1|');
  const r2 = S.parseItems('**薬【消耗品】' + br + '|~名称|~個数|' + br + '|A|1|');
  assert.equal(r1.categories.length, 1);
  assert.equal(r2.categories.length, 1);
});

test('見出しが * 1つでも認識する。見出しの名前が空なら「消耗品」', () => {
  const r = S.parseItems('*[消耗品]' + br + '|~名称|~個数|' + br + '|A|1|');
  assert.equal(r.categories[0].name, '消耗品');
});

test('個数が数字でない行は警告して無視する', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|' + br + '|A|たくさん|' + br + '|B|2|');
  assert.equal(r.categories[0].items.length, 1);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /「A」の個数/);
});

test('単価が読めない行は警告して0G', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|~単価|' + br + '|A|1|要相談|');
  assert.equal(r.categories[0].items[0].price, 0);
  assert.equal(r.warnings.length, 1);
});

test('空行・全セル空の行は無視する', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|' + br + '||||' + br + '|A|1|');
  assert.equal(r.categories[0].items.length, 1);
  assert.deepEqual(r.warnings, []);
});

test('見出し行（~）が無い表は警告して無視する', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|A|1|' + br + '|B|2|');
  assert.equal(r.categories.length, 0);
  assert.equal(r.warnings.length, 1);
});

test('名称・個数の列が無い表は警告して無視する', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~効果|' + br + '|A|x|');
  assert.equal(r.categories.length, 0);
  assert.match(r.warnings[0], /個数/);
});

test('[消耗品] が無ければ警告', () => {
  const r = S.parseItems('**薬' + br + '|~名称|~個数|' + br + '|A|1|');
  assert.equal(r.categories.length, 0);
  assert.equal(r.warnings.length, 1);
});

test('見出しの下に表が無ければ警告', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '説明だけ');
  assert.equal(r.warnings.length, 1);
});

test('同じ見出しの下に表が複数あっても読める', () => {
  const r = S.parseItems('**薬[消耗品]' + br + '|~名称|~個数|' + br + '|A|1|' + br + br + '|~名称|~個数|' + br + '|B|2|');
  assert.deepEqual(r.categories[0].items.map((i) => i.name), ['A', 'B']);
});

test('同名アイテムはエラー（全角半角・カテゴリ違いも同名）', () => {
  const r = S.parseItems(
    '**薬[消耗品]' + br + '|~名称|~個数|' + br + '|魔晶石（５）|1|' + br +
    '**石[消耗品]' + br + '|~名称|~個数|' + br + '|魔晶石(5) |2|'
  );
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.errors[0].categories, ['薬', '石']);
});

test('同名でなければエラーにならない（魔晶石の2と3）', () => {
  const r = S.parseItems('**石[消耗品]' + br + '|~名称|~個数|' + br + '|魔晶石（２）|1|' + br + '|魔晶石（３）|2|');
  assert.equal(r.ok, true);
});

test('空・未定義でも壊れない', () => {
  assert.equal(S.parseItems('').categories.length, 0);
  assert.equal(S.parseItems(undefined).categories.length, 0);
});

test('通常の改行 <br> でも読める', () => {
  const r = S.parseItems('**薬[消耗品]<br>|~名称|~個数|<br>|A|1|');
  assert.equal(r.categories[0].items.length, 1);
});

test('マテリアルカード: 値のある色×ランクのみ、単価はランク固定', () => {
  const cards = S.parseCards({ cardGreA: '10', cardGreB: '20', cardGolSS: '1', cardRedS: '0', cardBlaB: '' });
  assert.deepEqual(
    cards.map((c) => [c.colorLabel, c.rank, c.price, c.count]),
    [['緑', 'B', 20, 20], ['緑', 'A', 200, 10], ['金', 'SS', 20000, 1]]
  );
});

test('マテリアルカード: 値が無ければ空', () => {
  assert.deepEqual(S.parseCards({}), []);
});

test('URL: 閲覧ページ・編集ページ・IDだけ', () => {
  const view = S.parseSheetInput('https://yutorize.work/ytsheet/sw2.5/?id=NRp2oH');
  const edit = S.parseSheetInput('https://yutorize.work/ytsheet/sw2.5/?mode=edit&id=NRp2oH');
  const bare = S.parseSheetInput(' NRp2oH ');
  const expected = 'https://yutorize.work/ytsheet/sw2.5/?id=NRp2oH&mode=json';
  assert.equal(view.jsonUrl, expected);
  assert.equal(edit.jsonUrl, expected);
  assert.equal(bare.jsonUrl, expected);
  assert.equal(edit.id, 'NRp2oH');
});

test('URL: 不正な入力はエラーメッセージ', () => {
  assert.equal(S.parseSheetInput('').ok, false);
  assert.equal(S.parseSheetInput('これはURLではありません').ok, false);
  assert.equal(S.parseSheetInput('https://yutorize.work/ytsheet/sw2.5/').ok, false);
  assert.equal(S.parseSheetInput('https://yutorize.work/ytsheet/sw2.0/?id=abc').ok, false);
  assert.equal(S.parseSheetInput('https://example.com/ytsheet/sw2.5/?id=a<b').ok, false);
  assert.ok(S.parseSheetInput('').error);
});

test('取得: 正常・HTTPエラー・JSONでない応答', async () => {
  const ok = await S.fetchSheet('u', { fetch: async () => ({ ok: true, text: async () => '{"a":1}' }) });
  assert.deepEqual(ok, { a: 1 });
  await assert.rejects(S.fetchSheet('u', { fetch: async () => ({ ok: false, status: 404 }) }), /見つかりませんでした/);
  await assert.rejects(S.fetchSheet('u', { fetch: async () => ({ ok: false, status: 500 }) }), /500/);
  await assert.rejects(S.fetchSheet('u', { fetch: async () => ({ ok: true, text: async () => '<html>' }) }), /読み取れません/);
  await assert.rejects(S.fetchSheet('u', { fetch: async () => { throw new TypeError('x'); } }), /読み込みに失敗/);
});

test('シート全体: キャラ名の装飾を取り除く', () => {
  const r = S.readSheet({ characterName: '__シンク__', items: sample, cardGreB: '2' });
  assert.equal(r.characterName, 'シンク');
  assert.equal(r.cards.length, 1);
  assert.equal(r.ok, true);
});
