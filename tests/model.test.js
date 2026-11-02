'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');
const { normalizeName: nn } = require('../js/sheet.js');

const sheet = {
  characterName: 'テスト',
  updateTime: '2026-11-02 18:00',
  categories: [
    {
      name: '石類',
      items: [
        { name: '魔晶石（５）', key: nn('魔晶石（５）'), effect: 'ＭＰを５点代用できる', price: 500, count: 3 },
        { name: '魔晶石（３）', key: nn('魔晶石（３）'), effect: '', price: 300, count: 2 }
      ]
    },
    { name: '薬', items: [{ name: '魔香草', key: nn('魔香草'), effect: '回復', price: 100, count: 6 }] }
  ],
  cards: [
    { color: 'Gre', colorLabel: '緑', rank: 'B', price: 20, count: 20 },
    { color: 'Gre', colorLabel: '緑', rank: 'A', price: 200, count: 10 }
  ]
};
const fresh = () => M.createState(sheet, { type: 'url', input: 'x', id: 'abc' }, 1000);
const ids = (s) => ({ m5: s.categories[0].items[0].id, m3: s.categories[0].items[1].id, herb: s.categories[1].items[0].id, gB: 'k-Gre-B', gA: 'k-Gre-A' });

test('初期状態: 基準と現在が同じで、精算は0円', () => {
  const s = fresh();
  assert.equal(s.categories.length, 2);
  assert.equal(s.cards.length, 2);
  const r = M.settle(s);
  assert.equal(r.total, 0);
  assert.deepEqual(r.refillRows, []);
  assert.deepEqual(r.writeRows, []);
});

test('増減: 下限0で止まり、変化が無ければログを残さない', () => {
  const s = fresh();
  const i = ids(s);
  assert.deepEqual(M.adjust(s, i.m3, -1, 2000), { from: 2, to: 1 });
  M.adjust(s, i.m3, -1, 2001);
  assert.equal(M.adjust(s, i.m3, -1, 2002), null);
  assert.equal(s.categories[0].items[1].count, 0);
  assert.equal(s.log.length, 2);
  assert.deepEqual(s.log[0], { t: 2000, name: '魔晶石（３）', from: 2, to: 1, note: '' });
});

test('上限は9999', () => {
  const s = fresh();
  M.setCount(s, ids(s).herb, 123456, 1);
  assert.equal(s.categories[1].items[0].count, 9999);
});

test('直接入力で個数を設定できる。数字でない値は無視', () => {
  const s = fresh();
  assert.deepEqual(M.setCount(s, ids(s).m5, 1, 1), { from: 3, to: 1 });
  assert.equal(M.setCount(s, ids(s).m5, NaN, 1), null);
  assert.equal(M.setCount(s, 'nothing', 1, 1), null);
});

test('精算: 不足分×単価。補充チェックを外すと合計から除く', () => {
  const s = fresh();
  const i = ids(s);
  M.adjust(s, i.m5, -2, 1); // 不足2 ×500
  M.adjust(s, i.herb, -1, 1); // 不足1 ×100
  M.adjust(s, i.gB, -5, 1); // 不足5 ×20
  let r = M.settle(s);
  assert.equal(r.total, 1000 + 100 + 100);
  assert.equal(r.refillRows.length, 3);
  M.setRefill(s, i.herb, false);
  r = M.settle(s);
  assert.equal(r.total, 1100);
  const herb = r.writeRows.find((w) => w.name === '魔香草');
  assert.deepEqual([herb.from, herb.to, herb.kind], [6, 5, 'decrease']);
});

test('精算: 補充する行はシートの個数のまま（書き込み一覧に出ない）', () => {
  const s = fresh();
  M.adjust(s, ids(s).m5, -1, 1);
  assert.deepEqual(M.settle(s).writeRows, []);
});

test('精算: 初期値より増えた物は書き込み一覧に出るが、金額には入らない', () => {
  const s = fresh();
  M.adjust(s, ids(s).m5, +2, 1);
  const r = M.settle(s);
  assert.equal(r.total, 0);
  assert.deepEqual(r.writeRows.map((w) => [w.name, w.from, w.to, w.kind]), [['魔晶石（５）', 3, 5, 'increase']]);
});

test('入手: 拾って使えば0円。新規アイテムは「新規」として出る', () => {
  const s = fresh();
  const res = M.addItem(s, { name: '新しい薬', effect: '効果', price: '200', count: '2' }, 5);
  assert.equal(res.ok, true);
  assert.equal(s.categories[s.categories.length - 1].name, '入手したアイテム');
  let r = M.settle(s);
  assert.deepEqual(r.writeRows.map((w) => [w.name, w.from, w.to, w.kind]), [['新しい薬', 0, 2, 'new']]);
  assert.equal(r.total, 0);
  M.adjust(s, res.item.id, -2, 6);
  r = M.settle(s);
  assert.deepEqual(r.writeRows, []);
  assert.equal(r.total, 0);
});

test('入手: 2つ目の追加も同じカテゴリに入る', () => {
  const s = fresh();
  M.addItem(s, { name: 'A', count: 1 }, 1);
  M.addItem(s, { name: 'B', count: 1 }, 1);
  assert.equal(s.categories.filter((c) => c.id === 'added').length, 1);
  assert.equal(s.categories[2].items.length, 2);
});

test('入手: 名称が空・同名・数字不正はエラー', () => {
  const s = fresh();
  assert.equal(M.addItem(s, { name: '  ', count: 1 }, 1).ok, false);
  assert.equal(M.addItem(s, { name: '魔晶石(5)', count: 1 }, 1).ok, false); // 全角半角違いの同名
  assert.equal(M.addItem(s, { name: 'X', count: 'abc' }, 1).ok, false);
  assert.equal(M.addItem(s, { name: 'X', count: 1, price: '-5' }, 1).ok, false);
  assert.equal(s.categories.length, 2);
});

test('入手: 個数・単価の入力が空なら 1個・0G', () => {
  const s = fresh();
  const res = M.addItem(s, { name: 'Z', count: '', price: '' }, 1);
  assert.deepEqual([res.item.count, res.item.price], [1, 0]);
});

test('カード追加: 新しい色×ランクは並び順どおりに入り、単価はランク固定', () => {
  const s = fresh();
  assert.equal(M.addCard(s, 'Red', 'S', 2, 1).ok, true);
  assert.equal(M.addCard(s, 'Gol', 'SS', 1, 1).ok, true);
  assert.deepEqual(s.cards.map((c) => c.id), ['k-Red-S', 'k-Gre-B', 'k-Gre-A', 'k-Gol-SS']);
  assert.equal(s.cards[0].price, 2000);
  const r = M.settle(s);
  assert.deepEqual(r.writeRows.map((w) => [w.name, w.to, w.kind]), [
    ['マテリアルカード（赤）S', 2, 'new'],
    ['マテリアルカード（金）SS', 1, 'new']
  ]);
});

test('カード追加: すでにある色×ランクは加算される', () => {
  const s = fresh();
  M.addCard(s, 'Gre', 'A', 3, 1);
  assert.equal(s.cards.find((c) => c.id === 'k-Gre-A').count, 13);
  assert.equal(M.addCard(s, 'Xxx', 'A', 1, 1).ok, false);
  assert.equal(M.addCard(s, 'Gre', 'A', 0, 1).ok, false);
});

test('カードの精算: ランク固定の金額', () => {
  const s = fresh();
  M.adjust(s, 'k-Gre-A', -2, 1);
  assert.equal(M.settle(s).total, 400);
});

test('コピー文面', () => {
  assert.equal(M.copyText({ name: '魔晶石（５）', effect: ' ＭＰを５点代用できる ' }), '【魔晶石（５）】ＭＰを５点代用できる');
  assert.equal(M.copyText({ name: 'X', effect: '' }), '【X】');
});

test('書き込み一覧の文面', () => {
  assert.equal(M.writeRowsText([{ name: 'A', from: 3, to: 5 }, { name: 'B', from: 1, to: 0 }]), 'A: 3 → 5\nB: 1 → 0');
});

test('保存と復元: 往復で同じになる。壊れたデータは null', () => {
  const s = fresh();
  M.adjust(s, ids(s).m5, -1, 1);
  const back = M.deserialize(M.serialize(s));
  assert.deepEqual(back, s);
  assert.equal(M.deserialize('{'), null);
  assert.equal(M.deserialize('{"version":2}'), null);
  assert.equal(M.deserialize(JSON.stringify({ ...s, categories: [{ id: 'c', name: 'x', items: [{}] }] })), null);
  assert.equal(M.deserialize('null'), null);
});

test('折りたたみの切り替え', () => {
  const s = fresh();
  M.toggleCollapsed(s, 'c1');
  assert.equal(s.collapsed.c1, true);
  M.toggleCollapsed(s, 'c1');
  assert.equal(s.collapsed.c1, undefined);
});

test('ログは最大500件', () => {
  const s = fresh();
  for (let i = 0; i < 600; i++) M.adjust(s, ids(s).herb, i % 2 ? 1 : -1, i);
  assert.equal(s.log.length, 500);
});

test('表示用の整形', () => {
  assert.equal(M.formatYen(1234567), '1,234,567');
  assert.equal(M.formatYen(0), '0');
  assert.match(M.formatTime(new Date(2026, 10, 2, 9, 5).getTime()), /^09:05$/);
});
