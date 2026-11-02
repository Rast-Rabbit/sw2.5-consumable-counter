/* 画面の制御 */
(function () {
  'use strict';

  var Sheet = window.SheetReader;
  var Model = window.Model;

  var STATE_KEY = 'sw25cc.state.v1';
  var INPUT_KEY = 'sw25cc.lastInput';
  var TAB_KEY = 'sw25cc.tab';
  var TABS = ['main', 'settle', 'help', 'settings'];

  var state = null;
  var storageWarned = false;

  function $(id) { return document.getElementById(id); }

  // ---- 保存 ----

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        toast('この端末では自動保存ができません。「設定」の「保存する」で、ファイルに残してください。', 6000);
      }
      return false;
    }
  }
  function save() {
    if (state) storageSet(STATE_KEY, Model.serialize(state));
  }
  function loadSaved() {
    var text = storageGet(STATE_KEY);
    return text ? Model.deserialize(text) : null;
  }

  // ---- 小さな部品 ----

  function el(tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k === 'data') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  var toastTimer = null;
  function toast(message, ms) {
    var t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2200);
  }

  function confirmDialog(message, yesLabel, noLabel) {
    return new Promise(function (resolve) {
      var modal = $('modal');
      var yes = $('modalYes');
      var no = $('modalNo');
      $('modalMessage').textContent = message;
      yes.textContent = yesLabel || 'はい';
      no.textContent = noLabel || 'いいえ';
      modal.hidden = false;
      no.focus();
      function done(result) {
        modal.hidden = true;
        yes.removeEventListener('click', onYes);
        no.removeEventListener('click', onNo);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      function onKey(e) { if (e.key === 'Escape') done(false); }
      yes.addEventListener('click', onYes);
      no.addEventListener('click', onNo);
      document.addEventListener('keydown', onKey);
    });
  }

  function fallbackCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function copyWithToast(text, label) {
    copyToClipboard(text).then(function () {
      var shown = text.length > 40 ? text.slice(0, 40) + '…' : text;
      toast((label || 'コピーしました') + (label ? '' : ': ' + shown.replace(/\n/g, ' / ')));
    }, function () {
      toast('コピーできませんでした。');
    });
  }

  // ---- タブ ----

  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = 'main';
    TABS.forEach(function (t) {
      $('tab-' + t).hidden = t !== name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    storageSet(TAB_KEY, name);
    window.scrollTo(0, 0);
  }

  // ---- 描画: 消耗品 ----

  function deltaChips(entry) {
    var chips = [];
    if (entry.added) {
      chips.push(el('span', { class: 'chip new', text: '入手' }));
    } else if (entry.count < entry.base) {
      chips.push(el('span', { class: 'chip short', text: '−' + (entry.base - entry.count) }));
    } else if (entry.count > entry.base) {
      chips.push(el('span', { class: 'chip plus', text: '+' + (entry.count - entry.base) }));
    }
    return chips;
  }

  function entryRow(entry, isCard) {
    var name = isCard ? Model.cardName(entry) : entry.name;
    var info = el('div', { class: 'info' }, [
      el('span', { class: 'name', text: name })
    ].concat(deltaChips(entry)));
    if (!isCard && entry.effect) info.appendChild(el('div', { class: 'effect', text: entry.effect }));

    var actions = el('div', { class: 'actions' }, [
      el('button', { type: 'button', class: 'minus', 'aria-label': name + 'を1つ減らす', data: { action: 'minus', id: entry.id }, text: '−', disabled: entry.count <= 0 }),
      el('button', { type: 'button', class: 'plus-btn', 'aria-label': name + 'を1つ増やす', data: { action: 'plus', id: entry.id }, text: '＋' })
    ]);
    if (!isCard) {
      actions.appendChild(el('button', { type: 'button', class: 'copy', 'aria-label': name + 'の使用宣言をコピー', data: { action: 'copy', id: entry.id }, text: 'コピー' }));
    }

    return el('div', { class: 'row' + (entry.count === 0 ? ' zero' : '') }, [
      el('button', { type: 'button', class: 'count', 'aria-label': name + 'の個数 ' + entry.count + '（タップで数字を入力）', data: { action: 'edit', id: entry.id }, text: String(entry.count) }),
      info,
      actions
    ]);
  }

  function section(id, title, entries, isCard) {
    var collapsed = !!state.collapsed[id];
    var box = el('div', { class: 'box' });
    box.appendChild(el('button', { type: 'button', class: 'cat-head', 'aria-expanded': collapsed ? 'false' : 'true', data: { action: 'toggle', id: id } }, [
      el('span', { class: 'arrow', text: '▼' }),
      el('span', { text: title }),
      el('span', { class: 'num', text: entries.length + '件' })
    ]));
    if (!collapsed) {
      box.appendChild(el('div', { class: 'cat-rows' }, entries.map(function (e) { return entryRow(e, isCard); })));
    }
    return box;
  }

  function renderMain() {
    var view = $('listView');
    view.textContent = '';
    $('mainTools').hidden = !state;
    if (!state) {
      view.appendChild(el('div', { class: 'box' }, [
        el('div', { class: 'empty' }, [
          el('p', { text: 'まだシートを読み込んでいません。' }),
          el('button', { type: 'button', class: 'primary', data: { action: 'goto-settings' }, text: '「設定」でシートを読み込む' })
        ])
      ]));
      return;
    }
    state.categories.forEach(function (cat) {
      if (cat.items.length) view.appendChild(section(cat.id, cat.name, cat.items, false));
    });
    if (state.cards.length) view.appendChild(section('cards', 'マテリアルカード', state.cards, true));
    if (!view.firstChild) {
      view.appendChild(el('div', { class: 'box' }, [el('div', { class: 'empty', text: '管理するアイテムがありません。下の「アイテムを追加」から入れられます。' })]));
    }
    renderLog();
  }

  function renderLog() {
    var list = $('logList');
    list.textContent = '';
    var log = state ? state.log : [];
    $('logCount').textContent = String(log.length);
    for (var i = log.length - 1; i >= 0; i--) {
      var l = log[i];
      list.appendChild(el('li', {}, [
        el('span', { class: 't', text: Model.formatTime(l.t) }),
        el('span', { class: 'n', text: l.name + (l.note ? '（' + l.note + '）' : '') }),
        el('span', { class: 'c', text: l.from + ' → ' + l.to })
      ]));
    }
    if (!log.length) list.appendChild(el('li', { text: 'まだ操作はありません。' }));
  }

  // ---- 描画: 精算 ----

  function renderSettle() {
    var view = $('settleView');
    view.textContent = '';
    if (!state) {
      view.appendChild(el('div', { class: 'box' }, [el('div', { class: 'empty', text: 'シートを読み込むと、ここに精算が出ます。' })]));
      return;
    }
    var r = Model.settle(state);

    var refill = el('div', { class: 'box' }, [el('h2', { text: '補充する物' })]);
    if (!r.refillRows.length) {
      refill.appendChild(el('p', { class: 'note pad', text: '足りなくなった物はありません。' }));
    } else {
      r.refillRows.forEach(function (row) {
        refill.appendChild(el('label', { class: 'settle-row' + (row.refill ? '' : ' off') }, [
          el('input', { type: 'checkbox', checked: row.refill, data: { action: 'refill', id: row.id } }),
          el('span', {}, [
            el('span', { class: 'name', text: row.name }),
            el('div', { class: 'sub', text: '不足 ' + row.shortage + '個' })
          ]),
          el('span', { class: 'amount', text: Model.formatYen(row.subtotal) + ' G' })
        ]));
      });
      refill.appendChild(el('div', { class: 'total' }, [
        el('span', { text: '補充の合計' }),
        el('span', { class: 'sum', text: Model.formatYen(r.total) + ' G' })
      ]));
    }
    refill.appendChild(el('p', { class: 'note pad', text: '買い足す物にチェックを入れます。チェックした物の合計を、報酬や所持金から引いてください。' }));
    view.appendChild(refill);

    var write = el('div', { class: 'box' }, [el('h2', { text: 'シートに書き込む個数' })]);
    if (!r.writeRows.length) {
      write.appendChild(el('p', { class: 'note pad', text: 'ゆとシートの個数を書き換える必要はありません。' }));
    } else {
      var kindLabel = { increase: '増えた', decrease: '減ったまま', 'new': '新しく入手' };
      r.writeRows.forEach(function (row) {
        write.appendChild(el('div', { class: 'write-row' }, [
          el('span', {}, [
            el('span', { class: 'name', text: row.name }),
            el('span', { class: 'chip ' + (row.kind === 'decrease' ? 'short' : row.kind === 'increase' ? 'plus' : 'new'), text: kindLabel[row.kind] })
          ]),
          el('span', { class: 'change', text: row.from + ' → ' + row.to })
        ]));
      });
      write.appendChild(el('div', { class: 'btn-row pad' }, [
        el('button', { type: 'button', data: { action: 'copy-write' }, text: 'この一覧をコピー' })
      ]));
    }
    write.appendChild(el('p', { class: 'note pad', text: '買い足した物は、シートの個数が元のままなので書き換え不要です。ここに出た物だけ、ゆとシートの個数を直してください。' }));
    view.appendChild(write);
  }

  // ---- 描画: 設定 ----

  function sheetSummary(sheet) {
    var itemCount = sheet.categories.reduce(function (n, c) { return n + c.items.length; }, 0);
    return { itemCount: itemCount, cardKinds: sheet.cards.length };
  }

  function showResult(kind, parts) {
    var box = $('loadResult');
    box.textContent = '';
    if (!kind) return;
    box.appendChild(el('div', { class: 'result ' + kind }, parts));
  }

  function previewDetails(sheet) {
    var list = el('ul', { class: 'cat-list' });
    sheet.categories.forEach(function (cat) {
      list.appendChild(el('li', {
        text: cat.name + '（' + cat.items.map(function (i) { return i.name + '×' + i.count; }).join('、') + '）'
      }));
    });
    if (sheet.cards.length) {
      list.appendChild(el('li', {
        text: 'マテリアルカード（' + sheet.cards.map(function (c) { return c.colorLabel + c.rank + '×' + c.count; }).join('、') + '）'
      }));
    }
    return el('details', { open: true }, [el('summary', { text: '読み取れた内容' }), list]);
  }

  function warningList(warnings) {
    return el('ul', {}, warnings.map(function (w) { return el('li', { text: w }); }));
  }

  function renderLoadedInfo() {
    var info = $('loadedInfo');
    if (!state) { info.textContent = ''; return; }
    var d = new Date(state.source.loadedAt);
    info.textContent = '「' + state.characterName + '」を ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + Model.formatTime(state.source.loadedAt) + ' に読み込みました。' +
      (state.source.sheetUpdateTime ? '（シートの更新: ' + state.source.sheetUpdateTime + '）' : '');
  }

  // ---- 全体の描画 ----

  function render() {
    var name = $('charName');
    name.hidden = !state;
    name.textContent = state ? state.characterName : '';
    renderMain();
    renderSettle();
    renderLoadedInfo();
  }

  function changed() {
    save();
    render();
  }

  // ---- 読み込み ----

  function applySheet(sheet, source) {
    var summary = sheetSummary(sheet);
    if (!sheet.ok) {
      showResult('error', [
        el('p', { text: '同じ名前のアイテムが複数あるため、読み込めませんでした。' }),
        el('p', { text: 'ゆとシートの編集画面で名前を直してから、もう一度読み込んでください。' }),
        el('ul', {}, sheet.errors.map(function (e) { return el('li', { text: e.text }); }))
      ]);
      return false;
    }
    if (summary.itemCount === 0 && summary.cardKinds === 0) {
      showResult('error', [
        el('p', { text: '管理できるアイテムが見つかりませんでした。' }),
        el('p', { text: '見出しの最後に [消耗品] を付けた表を書いているか、「使い方」で確認してください。' })
      ].concat(sheet.warnings.length ? [warningList(sheet.warnings)] : []));
      return false;
    }
    state = Model.createState(sheet, source, Date.now());
    save();
    render();
    var parts = [
      el('p', { text: '「' + sheet.characterName + '」を読み込みました。消耗品 ' + summary.itemCount + '件、マテリアルカード ' + summary.cardKinds + '種類。' })
    ];
    if (sheet.warnings.length) {
      parts.push(el('p', { text: '次の点を確認してください。' }));
      parts.push(warningList(sheet.warnings));
    }
    parts.push(previewDetails(sheet));
    showResult(sheet.warnings.length ? 'warn' : 'ok', parts);
    if (!sheet.warnings.length) {
      toast('読み込みました');
      showTab('main');
    }
    return true;
  }

  async function onLoadClick() {
    var text = $('urlInput').value;
    var parsed = Sheet.parseSheetInput(text);
    if (!parsed.ok) {
      showResult('error', [el('p', { text: parsed.error })]);
      return;
    }
    if (state) {
      var yes = await confirmDialog('このシートの内容でツールを初期化しますか？\n今の個数と操作ログは消えます。', 'はい、初期化する', 'いいえ');
      if (!yes) return;
    }
    var btn = $('loadBtn');
    btn.disabled = true;
    showResult('ok', [el('p', { text: '読み込み中です…' })]);
    try {
      var data = await Sheet.fetchSheet(parsed.jsonUrl);
      var sheet = Sheet.readSheet(data);
      if (applySheet(sheet, { type: 'url', input: text.trim(), id: parsed.id })) {
        storageSet(INPUT_KEY, text.trim());
      }
    } catch (e) {
      showResult('error', [el('p', { text: e.message })]);
    } finally {
      btn.disabled = false;
    }
  }

  async function onPasteClick() {
    var text = $('pasteInput').value;
    if (!text.trim()) {
      showResult('error', [el('p', { text: '文章を貼り付けてください。' })]);
      return;
    }
    if (state) {
      var yes = await confirmDialog('この文章でツールを初期化しますか？\n今の個数と操作ログは消えます。', 'はい、初期化する', 'いいえ');
      if (!yes) return;
    }
    var parsed = Sheet.parseItems(text);
    var sheet = {
      characterName: state && state.characterName ? state.characterName : '（貼り付け）',
      updateTime: '',
      categories: parsed.categories,
      cards: [],
      warnings: parsed.warnings,
      errors: parsed.errors,
      ok: parsed.ok
    };
    applySheet(sheet, { type: 'paste', input: '', id: '' });
  }

  // ---- ファイルの保存・読み込み ----

  function onExport() {
    if (!state) {
      $('fileResult').textContent = '保存できるデータがありません。先にシートを読み込んでください。';
      return;
    }
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    var safeName = state.characterName.replace(/[\\/:*?"<>|\s]/g, '') || 'data';
    var blob = new Blob([Model.serialize(state)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '消耗品カウンター_' + safeName + '_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $('fileResult').textContent = 'ファイルを保存しました。';
  }

  function onImportFile(file) {
    var result = $('fileResult');
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      var loaded = Model.deserialize(String(reader.result));
      if (!loaded) {
        result.textContent = 'このファイルは読み込めませんでした。このツールで「保存する」を押して作ったファイルを選んでください。';
        return;
      }
      if (state) {
        var yes = await confirmDialog('このファイルの内容で、今の記録を置き換えますか？\n今の個数と操作ログは消えます。', 'はい、置き換える', 'いいえ');
        if (!yes) { result.textContent = ''; return; }
      }
      state = loaded;
      save();
      render();
      result.textContent = '「' + state.characterName + '」の記録を読み込みました。';
      toast('読み込みました');
      showTab('main');
    };
    reader.onerror = function () { result.textContent = 'ファイルを読み込めませんでした。'; };
    reader.readAsText(file);
  }

  // ---- 個数の直接入力 ----

  function startEdit(button) {
    var id = button.dataset.id;
    var found = Model.find(state, id);
    if (!found) return;
    var input = el('input', { type: 'number', class: 'count-input', inputmode: 'numeric', min: '0', max: String(Model.MAX_COUNT), value: String(found.entry.count), 'aria-label': '個数を入力' });
    var finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      if (commit && input.value !== '') {
        var n = parseInt(input.value, 10);
        if (isFinite(n)) Model.setCount(state, id, n, Date.now());
      }
      changed();
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
    button.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---- イベント ----

  function vibrate() {
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* 何もしない */ }
  }

  function onListClick(e) {
    var target = e.target.closest('[data-action]');
    if (!target || !state) {
      if (target && target.dataset.action === 'goto-settings') showTab('settings');
      return;
    }
    var action = target.dataset.action;
    var id = target.dataset.id;
    var now = Date.now();
    if (action === 'minus') {
      if (Model.adjust(state, id, -1, now)) { vibrate(); changed(); }
    } else if (action === 'plus') {
      if (Model.adjust(state, id, +1, now)) { vibrate(); changed(); }
    } else if (action === 'copy') {
      var found = Model.find(state, id);
      if (found) copyWithToast(Model.copyText(found.entry));
    } else if (action === 'edit') {
      startEdit(target);
    } else if (action === 'toggle') {
      Model.toggleCollapsed(state, id);
      changed();
    }
  }

  function onSettleClick(e) {
    var target = e.target.closest('[data-action]');
    if (!target || !state) return;
    if (target.dataset.action === 'copy-write') {
      copyWithToast(Model.writeRowsText(Model.settle(state).writeRows), 'コピーしました');
    }
  }

  function onSettleChange(e) {
    var target = e.target;
    if (target.dataset && target.dataset.action === 'refill' && state) {
      Model.setRefill(state, target.dataset.id, target.checked);
      changed();
    }
  }

  function onAddCard(e) {
    e.preventDefault();
    var err = $('addCardError');
    err.textContent = '';
    if (!state) return;
    var res = Model.addCard(state, $('cardColor').value, $('cardRank').value, $('cardCount').value, Date.now());
    if (!res.ok) { err.textContent = res.error; return; }
    $('cardCount').value = '1';
    changed();
    toast('マテリアルカードを追加しました');
  }

  function onAddItem(e) {
    e.preventDefault();
    var err = $('addItemError');
    err.textContent = '';
    if (!state) return;
    var res = Model.addItem(state, {
      name: $('itemName').value,
      effect: $('itemEffect').value,
      count: $('itemCount').value,
      price: $('itemPrice').value
    }, Date.now());
    if (!res.ok) { err.textContent = res.error; return; }
    $('itemName').value = '';
    $('itemEffect').value = '';
    $('itemCount').value = '1';
    $('itemPrice').value = '0';
    changed();
    toast('「' + res.item.name + '」を追加しました');
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    });
    $('listView').addEventListener('click', onListClick);
    $('settleView').addEventListener('click', onSettleClick);
    $('settleView').addEventListener('change', onSettleChange);
    $('addCardForm').addEventListener('submit', onAddCard);
    $('addItemForm').addEventListener('submit', onAddItem);
    $('loadBtn').addEventListener('click', onLoadClick);
    $('urlInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); onLoadClick(); }
    });
    $('pasteBtn').addEventListener('click', onPasteClick);
    $('exportBtn').addEventListener('click', onExport);
    $('importFile').addEventListener('change', function (e) {
      onImportFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });

    var last = storageGet(INPUT_KEY);
    if (last) $('urlInput').value = last;

    state = loadSaved();
    render();
    showTab(state ? (storageGet(TAB_KEY) || 'main') : 'settings');
  }

  init();
})();
