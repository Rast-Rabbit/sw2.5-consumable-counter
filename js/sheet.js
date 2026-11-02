/* ゆとシートの読み込みと解析（ブラウザ・Node.js 共用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SheetReader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_BASE = 'https://yutorize.work/ytsheet/sw2.5/';

  var CARD_COLORS = [
    { key: 'Red', label: '赤' },
    { key: 'Gre', label: '緑' },
    { key: 'Bla', label: '黒' },
    { key: 'Whi', label: '白' },
    { key: 'Gol', label: '金' }
  ];
  var CARD_RANKS = [
    { key: 'B', price: 20 },
    { key: 'A', price: 200 },
    { key: 'S', price: 2000 },
    { key: 'SS', price: 20000 }
  ];

  var COLUMN_ROLES = {
    name: /^(名称|名前|アイテム名|アイテム|品名)$/,
    count: /^(個数|数|所持数|数量|残数)$/,
    price: /^(単価|価格|値段|金額)$/,
    effect: /^(効果|効能|説明|内容|備考)$/
  };

  function nfkc(s) {
    return String(s == null ? '' : s).normalize('NFKC');
  }

  // trim は全角スペースも取り除く
  function clean(s) {
    return String(s == null ? '' : s).trim();
  }

  // 同名判定用: 全角半角・空白・大文字小文字の違いを無視する
  function normalizeName(s) {
    return nfkc(s).replace(/\s+/g, '').toLowerCase();
  }

  // ---- URL ----

  function parseSheetInput(input) {
    var text = clean(input);
    var fail = function (error) { return { ok: false, id: null, jsonUrl: null, error: error }; };
    if (!text) return fail('URLを入力してください。');

    if (/^[A-Za-z0-9_-]{3,40}$/.test(text)) {
      return {
        ok: true,
        id: text,
        jsonUrl: DEFAULT_BASE + '?id=' + encodeURIComponent(text) + '&mode=json',
        error: null
      };
    }

    var url;
    try {
      url = new URL(text);
    } catch (e) {
      return fail('URLの形式が正しくありません。ゆとシートのページのアドレスを、そのまま貼り付けてください。');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return fail('URLの形式が正しくありません。ゆとシートのページのアドレスを、そのまま貼り付けてください。');
    }
    var id = url.searchParams.get('id');
    if (!id) {
      return fail('URLの中に「id=」が見つかりませんでした。キャラクターシートのページのアドレスを貼り付けてください。');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return fail('URLの「id=」の部分が正しくないようです。');
    }
    if (!/sw2\.5/.test(url.pathname)) {
      return fail('ソード・ワールド2.5のシートのURLではないようです。');
    }
    return {
      ok: true,
      id: id,
      jsonUrl: 'https://' + url.host + url.pathname + '?id=' + encodeURIComponent(id) + '&mode=json',
      error: null
    };
  }

  // ---- 取得 ----

  async function fetchSheet(jsonUrl, options) {
    options = options || {};
    var doFetch = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!doFetch) throw new Error('このブラウザでは読み込みができません。');
    var timeoutMs = options.timeoutMs || 15000;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    var res;
    try {
      res = await doFetch(jsonUrl, controller ? { signal: controller.signal } : {});
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('時間内に読み込めませんでした。しばらくしてから、もう一度試してください。');
      }
      throw new Error('読み込みに失敗しました。インターネットに接続されているか確認してください。');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 404) {
      throw new Error('シートが見つかりませんでした。URLが正しいか、シートが公開されているか確認してください。');
    }
    if (!res.ok) {
      throw new Error('シートを取得できませんでした（エラー番号 ' + res.status + '）。URLが正しいか確認してください。');
    }
    var data;
    try {
      data = JSON.parse(await res.text());
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('シートのデータを読み取れませんでした。URLが正しいか、シートが公開されているか確認してください。');
    }
    return data;
  }

  // ---- アイテム欄 ----

  function unescapeEntities(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&#x27;/gi, "'")
      .replace(/&amp;/g, '&');
  }

  function splitLines(raw) {
    var s = String(raw == null ? '' : raw);
    s = s.replace(/&lt;br\s*\/?&gt;|<br\s*\/?>|\r\n|\r/gi, '\n');
    return s.split('\n').map(unescapeEntities);
  }

  function splitRow(line) {
    var t = clean(line);
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
    return t.split('|').map(clean);
  }

  function parseCount(text) {
    var t = nfkc(text).replace(/[,\s]/g, '');
    var m = /^(\d+)(個|本|枚|つ|コ|ヶ|ケ)?$/.exec(t);
    return m ? parseInt(m[1], 10) : null;
  }

  // 空・ハイフンは 0、読めなければ null
  function parsePrice(text) {
    var t = nfkc(text).replace(/[,\s]/g, '');
    if (t === '' || /^[-ー―–—]+$/.test(t)) return 0;
    var m = /^(\d+)(G|ガメル|gp|円)?$/i.exec(t);
    return m ? parseInt(m[1], 10) : null;
  }

  function detectColumns(headerCells) {
    var cols = {};
    headerCells.forEach(function (cell, index) {
      var label = nfkc(cell.replace(/^~/, '')).replace(/\s+/g, '');
      Object.keys(COLUMN_ROLES).forEach(function (role) {
        if (cols[role] === undefined && COLUMN_ROLES[role].test(label)) cols[role] = index;
      });
    });
    return cols;
  }

  function parseTable(rowLines, categoryName, items, warnings) {
    var rows = rowLines.map(splitRow);
    var headerIndex = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].some(function (c) { return c.charAt(0) === '~'; })) { headerIndex = i; break; }
    }
    if (headerIndex < 0) {
      warnings.push('「' + categoryName + '」の表に、1行目の見出し（例: |~名称|~個数|）が無いため、読み込めませんでした。');
      return;
    }
    var cols = detectColumns(rows[headerIndex]);
    if (cols.name === undefined || cols.count === undefined) {
      warnings.push('「' + categoryName + '」の表に「名称」または「個数」の列が見つからないため、読み込めませんでした。');
      return;
    }
    rows.slice(headerIndex + 1).forEach(function (cells) {
      if (cells.some(function (c) { return c.charAt(0) === '~'; })) return; // 繰り返しの見出し行
      if (cells.every(function (c) { return c === ''; })) return;
      var name = cells[cols.name] || '';
      if (!name) {
        warnings.push('「' + categoryName + '」に、名称が空の行がありました（' + cells.join(' | ') + '）。');
        return;
      }
      var countText = cells[cols.count] || '';
      var count = parseCount(countText);
      if (count === null) {
        warnings.push('「' + name + '」の個数「' + countText + '」を数字として読み取れなかったため、この行は読み込めませんでした。');
        return;
      }
      var price = 0;
      if (cols.price !== undefined) {
        var priceText = cells[cols.price] || '';
        price = parsePrice(priceText);
        if (price === null) {
          warnings.push('「' + name + '」の単価「' + priceText + '」を数字として読み取れなかったため、0Gとして扱います。');
          price = 0;
        }
      }
      items.push({
        name: name,
        key: normalizeName(name),
        effect: cols.effect !== undefined ? (cells[cols.effect] || '') : '',
        price: price,
        count: count
      });
    });
  }

  var TAG = /[\[【]\s*消耗品\s*[\]】]/;

  function parseItems(raw) {
    var lines = splitLines(raw);
    var categories = [];
    var warnings = [];
    var current = null;
    var tagFound = false;

    function closeCategory() {
      if (!current) return;
      if (current.items.length > 0) {
        categories.push(current);
      } else if (!current.hadTable) {
        warnings.push('「' + current.name + '」の見出しの下に、表が見つかりませんでした。');
      }
      current = null;
    }

    var i = 0;
    while (i < lines.length) {
      var line = clean(lines[i]);
      var heading = /^\*+\s*(.*)$/.exec(line);
      if (heading) {
        closeCategory();
        var text = nfkc(heading[1]).replace(/［/g, '[').replace(/］/g, ']');
        if (TAG.test(text)) {
          tagFound = true;
          var name = clean(text.replace(TAG, '')) || '消耗品';
          current = { name: name, items: [], hadTable: false };
        }
        i++;
        continue;
      }
      if (current && line.charAt(0) === '|') {
        var block = [];
        while (i < lines.length && clean(lines[i]).charAt(0) === '|') {
          block.push(lines[i]);
          i++;
        }
        current.hadTable = true;
        parseTable(block, current.name, current.items, warnings);
        continue;
      }
      i++;
    }
    closeCategory();

    if (!tagFound) {
      warnings.push('「[消耗品]」が付いた見出しが見つかりませんでした。「使い方」タブの書き方を確認してください。');
    }

    // 同名のアイテムは記入ミスとみなす
    var seen = {};
    categories.forEach(function (cat) {
      cat.items.forEach(function (item) {
        (seen[item.key] = seen[item.key] || []).push({ name: item.name, category: cat.name });
      });
    });
    var errors = [];
    Object.keys(seen).forEach(function (key) {
      var list = seen[key];
      if (list.length < 2) return;
      var cats = list.map(function (x) { return x.category; });
      errors.push({
        name: list[0].name,
        categories: cats,
        text: '「' + list[0].name + '」が' + list.length + '件あります（' + cats.join('、') + '）。'
      });
    });

    return { categories: categories, warnings: warnings, errors: errors, ok: errors.length === 0 };
  }

  // ---- マテリアルカード ----

  function parseCards(data) {
    var cards = [];
    CARD_COLORS.forEach(function (color) {
      CARD_RANKS.forEach(function (rank) {
        var n = parseInt(nfkc(data['card' + color.key + rank.key]), 10);
        if (n > 0) {
          cards.push({ color: color.key, colorLabel: color.label, rank: rank.key, price: rank.price, count: n });
        }
      });
    });
    return cards;
  }

  // ---- シート全体 ----

  function displayName(data) {
    var name = clean(data.characterName || data.name || '');
    name = name.replace(/\|?([^|《》]+)《[^》]*》/g, '$1').replace(/^_+|_+$/g, '');
    return clean(name) || '（名前なし）';
  }

  function readSheet(data) {
    var items = parseItems(data.items);
    return {
      characterName: displayName(data),
      updateTime: data.updateTime || '',
      categories: items.categories,
      cards: parseCards(data),
      warnings: items.warnings,
      errors: items.errors,
      ok: items.ok
    };
  }

  return {
    CARD_COLORS: CARD_COLORS,
    CARD_RANKS: CARD_RANKS,
    normalizeName: normalizeName,
    parseSheetInput: parseSheetInput,
    fetchSheet: fetchSheet,
    parseItems: parseItems,
    parseCards: parseCards,
    readSheet: readSheet
  };
});
