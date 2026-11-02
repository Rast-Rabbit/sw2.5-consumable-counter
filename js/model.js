/* 消耗品の状態と計算（ブラウザ・Node.js 共用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sheet.js'));
  else root.Model = factory(root.SheetReader);
})(typeof self !== 'undefined' ? self : this, function (Sheet) {
  'use strict';

  var VERSION = 1;
  var MAX_COUNT = 9999;
  var MAX_LOG = 500;
  var ADDED_ID = 'added';
  var ADDED_NAME = '入手したアイテム';

  function clean(s) { return String(s == null ? '' : s).trim(); }

  function createState(sheet, source, now) {
    var state = {
      version: VERSION,
      source: {
        type: source.type || 'url',
        input: source.input || '',
        id: source.id || '',
        loadedAt: now,
        sheetUpdateTime: sheet.updateTime || ''
      },
      characterName: sheet.characterName || '',
      categories: [],
      cards: [],
      collapsed: {},
      log: [],
      nextId: 1
    };
    sheet.categories.forEach(function (cat, i) {
      state.categories.push({
        id: 'c' + (i + 1),
        name: cat.name,
        items: cat.items.map(function (it) {
          return {
            id: 'i' + (state.nextId++),
            name: it.name,
            key: it.key,
            effect: it.effect,
            price: it.price,
            base: it.count,
            count: it.count,
            refill: true,
            added: false
          };
        })
      });
    });
    (sheet.cards || []).forEach(function (c) {
      state.cards.push(makeCard(c.color, c.colorLabel, c.rank, c.price, c.count, false));
    });
    return state;
  }

  function makeCard(color, colorLabel, rank, price, count, added) {
    return {
      id: 'k-' + color + '-' + rank,
      color: color,
      colorLabel: colorLabel,
      rank: rank,
      price: price,
      base: added ? 0 : count,
      count: count,
      refill: true,
      added: added
    };
  }

  function cardName(card) {
    return 'マテリアルカード（' + card.colorLabel + '）' + card.rank;
  }

  function allEntries(state) {
    var list = [];
    state.categories.forEach(function (cat) {
      cat.items.forEach(function (it) { list.push({ entry: it, isCard: false, category: cat }); });
    });
    state.cards.forEach(function (c) { list.push({ entry: c, isCard: true, category: null }); });
    return list;
  }

  function find(state, id) {
    var all = allEntries(state);
    for (var i = 0; i < all.length; i++) if (all[i].entry.id === id) return all[i];
    return null;
  }

  function entryName(found) {
    return found.isCard ? cardName(found.entry) : found.entry.name;
  }

  function pushLog(state, now, name, from, to, note) {
    state.log.push({ t: now, name: name, from: from, to: to, note: note || '' });
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
  }

  function clampCount(n) {
    return Math.max(0, Math.min(MAX_COUNT, n));
  }

  function setCount(state, id, n, now) {
    var found = find(state, id);
    if (!found || typeof n !== 'number' || !isFinite(n)) return null;
    var to = clampCount(Math.floor(n));
    var from = found.entry.count;
    if (to === from) return null;
    found.entry.count = to;
    pushLog(state, now, entryName(found), from, to);
    return { from: from, to: to };
  }

  function adjust(state, id, delta, now) {
    var found = find(state, id);
    if (!found) return null;
    return setCount(state, id, found.entry.count + delta, now);
  }

  function setRefill(state, id, value) {
    var found = find(state, id);
    if (found) found.entry.refill = !!value;
  }

  function toggleCollapsed(state, categoryId) {
    if (state.collapsed[categoryId]) delete state.collapsed[categoryId];
    else state.collapsed[categoryId] = true;
  }

  function parseIntStrict(value) {
    var t = String(value == null ? '' : value).normalize('NFKC').replace(/[,\s]/g, '');
    return /^\d+$/.test(t) ? parseInt(t, 10) : null;
  }

  function addItem(state, input, now) {
    var name = clean(input.name);
    if (!name) return { ok: false, error: '名称を入力してください。' };
    var count = parseIntStrict(input.count === '' || input.count == null ? '1' : input.count);
    if (count === null || count > MAX_COUNT) return { ok: false, error: '個数は0以上の整数で入力してください。' };
    var price = parseIntStrict(input.price === '' || input.price == null ? '0' : input.price);
    if (price === null) return { ok: false, error: '単価は0以上の整数で入力してください。' };
    var key = Sheet.normalizeName(name);
    var dup = allEntries(state).some(function (x) { return !x.isCard && x.entry.key === key; });
    if (dup) return { ok: false, error: '「' + name + '」はすでにリストにあります。個数はそのアイテムの＋ボタンで増やしてください。' };

    var cat = null;
    state.categories.forEach(function (c) { if (c.id === ADDED_ID) cat = c; });
    if (!cat) {
      cat = { id: ADDED_ID, name: ADDED_NAME, items: [] };
      state.categories.push(cat);
    }
    var item = {
      id: 'i' + (state.nextId++),
      name: name,
      key: key,
      effect: clean(input.effect),
      price: price,
      base: 0,
      count: count,
      refill: true,
      added: true
    };
    cat.items.push(item);
    pushLog(state, now, name, 0, count, '追加');
    return { ok: true, item: item };
  }

  function sortCards(state) {
    var colors = Sheet.CARD_COLORS.map(function (c) { return c.key; });
    var ranks = Sheet.CARD_RANKS.map(function (r) { return r.key; });
    state.cards.sort(function (a, b) {
      return colors.indexOf(a.color) - colors.indexOf(b.color) || ranks.indexOf(a.rank) - ranks.indexOf(b.rank);
    });
  }

  function addCard(state, color, rank, count, now) {
    var colorInfo = Sheet.CARD_COLORS.filter(function (c) { return c.key === color; })[0];
    var rankInfo = Sheet.CARD_RANKS.filter(function (r) { return r.key === rank; })[0];
    if (!colorInfo || !rankInfo) return { ok: false, error: '色とランクを選んでください。' };
    var n = typeof count === 'number' ? count : parseIntStrict(count);
    if (n === null || n < 1 || n > MAX_COUNT) return { ok: false, error: '枚数は1以上の整数で入力してください。' };
    var id = 'k-' + color + '-' + rank;
    var existing = find(state, id);
    if (existing) {
      setCount(state, id, existing.entry.count + n, now);
      return { ok: true, card: existing.entry };
    }
    var card = makeCard(color, colorInfo.label, rank, rankInfo.price, clampCount(n), true);
    state.cards.push(card);
    sortCards(state);
    pushLog(state, now, cardName(card), 0, card.count, '追加');
    return { ok: true, card: card };
  }

  // 精算: 補充する物の一覧・合計・シートに書き込む個数
  function settle(state) {
    var refillRows = [];
    var writeRows = [];
    var total = 0;
    allEntries(state).forEach(function (x) {
      var e = x.entry;
      var name = entryName(x);
      var shortage = Math.max(0, e.base - e.count);
      if (shortage > 0) {
        var subtotal = shortage * e.price;
        refillRows.push({ id: e.id, name: name, shortage: shortage, price: e.price, subtotal: subtotal, refill: e.refill });
        if (e.refill) total += subtotal;
      }
      var finalCount = shortage > 0 && e.refill ? e.base : e.count;
      if (finalCount !== e.base) {
        writeRows.push({
          id: e.id,
          name: name,
          from: e.base,
          to: finalCount,
          kind: e.base === 0 ? 'new' : (finalCount > e.base ? 'increase' : 'decrease')
        });
      }
    });
    return { refillRows: refillRows, writeRows: writeRows, total: total };
  }

  function copyText(item) {
    var effect = clean(item.effect);
    return '【' + item.name + '】' + effect;
  }

  function writeRowsText(rows) {
    return rows.map(function (r) { return r.name + ': ' + r.from + ' → ' + r.to; }).join('\n');
  }

  function serialize(state) {
    return JSON.stringify(state);
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function validEntry(e) {
    return e && typeof e.id === 'string' && isNum(e.price) && isNum(e.base) && isNum(e.count) && typeof e.refill === 'boolean';
  }

  function deserialize(text) {
    var s;
    try { s = JSON.parse(text); } catch (e) { return null; }
    if (!s || s.version !== VERSION || typeof s !== 'object') return null;
    if (!Array.isArray(s.categories) || !Array.isArray(s.cards) || !Array.isArray(s.log)) return null;
    if (!s.source || typeof s.source !== 'object' || !isNum(s.nextId)) return null;
    var ok = s.categories.every(function (c) {
      return c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.items) &&
        c.items.every(function (it) { return validEntry(it) && typeof it.name === 'string' && typeof it.key === 'string' && typeof it.effect === 'string'; });
    }) && s.cards.every(function (c) {
      return validEntry(c) && typeof c.colorLabel === 'string' && typeof c.rank === 'string' && typeof c.color === 'string';
    }) && s.log.every(function (l) {
      return l && isNum(l.t) && typeof l.name === 'string' && isNum(l.from) && isNum(l.to);
    });
    if (!ok) return null;
    if (!s.collapsed || typeof s.collapsed !== 'object') s.collapsed = {};
    if (typeof s.characterName !== 'string') s.characterName = '';
    return s;
  }

  function formatTime(t) {
    var d = new Date(t);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function formatYen(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  return {
    VERSION: VERSION,
    MAX_COUNT: MAX_COUNT,
    createState: createState,
    find: find,
    allEntries: allEntries,
    cardName: cardName,
    adjust: adjust,
    setCount: setCount,
    setRefill: setRefill,
    toggleCollapsed: toggleCollapsed,
    addItem: addItem,
    addCard: addCard,
    settle: settle,
    copyText: copyText,
    writeRowsText: writeRowsText,
    serialize: serialize,
    deserialize: deserialize,
    formatTime: formatTime,
    formatYen: formatYen
  };
});
