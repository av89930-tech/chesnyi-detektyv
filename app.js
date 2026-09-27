(function () {
  'use strict';
  var C = window.HonestCalc;
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'honest-detective:list:v1';
  var previewUrl = null;
  var last = null; // { input, res, text }

  // ── Фото етикетки ─────────────────────────────────────────────
  $('cameraInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $('preview').src = previewUrl;
    $('previewBox').hidden = false;
    $('price').focus();
  });
  $('clearPhoto').addEventListener('click', function () {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('preview').removeAttribute('src');
    $('previewBox').hidden = true;
    $('cameraInput').value = '';
  });

  // ── Розрахунок ────────────────────────────────────────────────
  $('calcForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = {
      name: $('name').value,
      price: $('price').value,
      amount: $('amount').value,
      unit: $('unit').value,
      oldAmount: $('oldAmount').value,
      oldPrice: $('oldPrice').value
    };
    var res = C.analyze(input);
    if (!res.ok) { showError(res.error); return; }
    showError('');
    var text = C.reportText(input, res);
    last = { input: input, res: res, text: text };
    var out = $('reportOutput');
    out.textContent = text;
    out.classList.toggle('warn', !!res.shrink || !!(res.old && res.old.unitPriceChangePct > 0.5));
    $('result').hidden = false;
    $('saveBtn').disabled = false;
    $('saveBtn').textContent = '➕ До порівняння';
    document.activeElement && document.activeElement.blur();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function showError(msg) { $('error').textContent = msg; $('error').hidden = !msg; }

  // ── Поділитися ────────────────────────────────────────────────
  $('shareBtn').addEventListener('click', function () {
    if (!last) return;
    if (navigator.share) {
      navigator.share({ title: 'Чесний Детектив', text: last.text }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(last.text).then(function () { flash($('shareBtn'), '✅ Скопійовано'); });
    }
  });

  function flash(btn, text) {
    var old = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  // ── Список порівняння (localStorage, лише на пристрої) ────────
  function load() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY)); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function save(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (_) {} }

  $('saveBtn').addEventListener('click', function () {
    if (!last) return;
    var list = load();
    var c = last.res.current;
    list.push({
      id: Date.now(),
      name: (last.input.name || '').trim() || 'Товар ' + (list.length + 1),
      price: C.parseNumber(last.input.price),
      amount: C.parseNumber(last.input.amount),
      unit: last.input.unit,
      base: c.base,
      baseLabel: c.baseLabel,
      perBase: c.perBase,
      shrink: !!last.res.shrink
    });
    save(list.slice(-50));
    render();
    $('saveBtn').disabled = true;
    $('saveBtn').textContent = '✅ Додано';
    ['name', 'price', 'amount', 'oldAmount', 'oldPrice'].forEach(function (id) { $(id).value = ''; });
  });

  $('clearList').addEventListener('click', function () {
    if (confirm('Очистити список порівняння?')) { save([]); render(); }
  });

  $('compareList').addEventListener('click', function (e) {
    var id = e.target && e.target.getAttribute('data-del');
    if (!id) return;
    save(load().filter(function (x) { return String(x.id) !== id; }));
    render();
  });

  function render() {
    var list = load().slice().sort(function (a, b) {
      return a.base === b.base ? a.perBase - b.perBase : a.base < b.base ? -1 : 1;
    });
    var ol = $('compareList');
    ol.textContent = '';
    $('compare').hidden = list.length === 0;
    var bestSeen = {};
    list.forEach(function (x) {
      var li = document.createElement('li');
      var isBest = !bestSeen[x.base] && list.filter(function (y) { return y.base === x.base; }).length > 1;
      bestSeen[x.base] = true;
      var title = document.createElement('span');
      title.textContent = (isBest ? '🏆 ' : '') + x.name + (x.shrink ? ' ⚠️' : '') + ' — ' + C.money(x.perBase) + ' грн/' + x.baseLabel.replace('1 ', '');
      if (isBest) title.className = 'best';
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'link del'; del.textContent = '✕';
      del.setAttribute('data-del', String(x.id));
      del.setAttribute('aria-label', 'Видалити ' + x.name);
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = C.money(x.price) + ' грн за ' + C.fmtAmount(x.amount, x.unit);
      li.appendChild(del); li.appendChild(title); li.appendChild(meta);
      ol.appendChild(li);
    });
  }
  render();

  // ── Встановлення PWA ──────────────────────────────────────────
  var deferred = null;
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    $('installBox').hidden = false;
  });
  $('installBtn').addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function () { deferred = null; $('installBox').hidden = true; });
  });
  window.addEventListener('appinstalled', function () { $('installBox').hidden = true; });
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone) $('iosHint').hidden = false;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    });
  }
})();
