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
    runOcr(file);
  });
  $('clearPhoto').addEventListener('click', function () {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('preview').removeAttribute('src');
    $('previewBox').hidden = true;
    $('cameraInput').value = '';
    resetOcr();
  });

  // ── Розпізнавання цифр з фото ─────────────────────────────────
  var ocrRun = 0;
  var ocrTag = null;       // «ціна за 1 кг/л» з цінника
  var touched = {};        // поля, які користувач змінив сам під час розпізнавання
  ['price', 'amount', 'unit'].forEach(function (id) {
    $(id).addEventListener('input', function () { touched[id] = true; });
  });

  function resetOcr() {
    ocrRun++;
    ocrTag = null;
    $('ocrBox').hidden = true;
    $('ocrFound').hidden = true;
  }

  function setStatus(text, pct) {
    $('ocrBox').hidden = false;
    $('ocrStatus').textContent = text;
    $('ocrProgressWrap').hidden = pct == null;
    if (pct != null) $('ocrProgress').style.width = Math.round(pct * 100) + '%';
  }

  function runOcr(file) {
    if (!window.HonestOcr) return;
    var run = ++ocrRun;
    touched = {};
    ocrTag = null;
    $('ocrFound').hidden = true;
    setStatus('🔍 Розпізнаю цифри…', 0);
    window.HonestOcr.recognize(file, function (m) {
      if (run !== ocrRun) return;
      if (m.status === 'recognizing text') setStatus('🔍 Розпізнаю цифри… ' + Math.round(m.progress * 100) + '%', m.progress);
      else if (/load|initializ/.test(m.status)) setStatus('⏳ Готую розпізнавання (лише перший раз, ~6 МБ)…', m.progress || 0);
    }).then(function (out) {
      if (run !== ocrRun) return;
      showOcr(out.result);
    }).catch(function () {
      if (run !== ocrRun) return;
      setStatus('⚠️ Не вдалося розпізнати фото. Введіть цифри вручну.', null);
    });
  }

  function chips(target, title, items, onPick) {
    target.textContent = '';
    if (!items.length) return;
    var b = document.createElement('b'); b.textContent = title + ' ';
    target.appendChild(b);
    items.forEach(function (it, i) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip' + (i === 0 ? ' on' : ''); c.textContent = it.label;
      c.addEventListener('click', function () {
        Array.prototype.forEach.call(target.querySelectorAll('.chip'), function (x) { x.classList.remove('on'); });
        c.classList.add('on');
        onPick(it);
      });
      target.appendChild(c);
    });
  }

  function fill(id, value) { $(id).value = String(value).replace('.', ','); }

  function showOcr(r) {
    var any = r.prices.length || r.amounts.length || r.tagUnitPrice;
    if (!any) {
      setStatus('🤷 Цифри не знайдено. Сфотографуйте цінник ближче, рівно й без відблисків — або введіть вручну.', null);
      return;
    }
    setStatus('✅ Знайдено на фото:', null);
    $('ocrFound').hidden = false;
    var pickPrice = function (p) { fill('price', p.value.toFixed(2)); };
    var pickAmount = function (a) { fill('amount', a.value); $('unit').value = a.unit; };
    chips($('ocrPrices'), 'Ціна:', r.prices, pickPrice);
    chips($('ocrAmounts'), 'Вага/об\'єм:', r.amounts, pickAmount);
    var askCents = r.centsMissing && !touched.price;
    if (r.prices[0] && !touched.price) {
      if (askCents) $('price').value = Math.floor(r.prices[0].value) + ',';
      else pickPrice(r.prices[0]);
    }
    if (r.amounts[0] && !touched.amount && !touched.unit) pickAmount(r.amounts[0]);
    ocrTag = r.tagUnitPrice;
    $('ocrTag').textContent = ocrTag
      ? 'На ціннику «за ' + (ocrTag.base === 'kg' ? '1 кг' : '1 л') + '»: ' + C.money(ocrTag.value) + ' грн — перевіримо.'
      : '';
    // Рахуємо одразу лише коли цифри підтверджують одна одну (ціна ÷ вага ≈ «ціна за 1 кг» з цінника);
    // інакше користувач перевіряє поля й сам тисне «Розрахувати» — без хибних тривог.
    var p0 = r.prices[0], a0 = r.amounts[0];
    var consistent = p0 && a0 && ocrTag && (function () {
      var u = C.unitPrice(p0.value, a0.value, a0.unit);
      return u && u.base === ocrTag.base && Math.abs(u.perBase / ocrTag.value - 1) < 0.02;
    })();
    if (askCents) {
      setStatus('✏️ Копійки не розпізнано — допишіть їх у поле ціни й натисніть «Розрахувати».', null);
      var f = $('price'); f.focus();
      try { f.setSelectionRange(f.value.length, f.value.length); } catch (_) {}
    } else if (consistent && $('calcForm').requestSubmit) $('calcForm').requestSubmit();
    else setStatus('✅ Знайдено на фото — перевірте цифри й натисніть «Розрахувати»:', null);
  }

  // ── Розрахунок ────────────────────────────────────────────────
  $('calcForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = {
      name: $('name').value,
      price: $('price').value,
      amount: $('amount').value,
      unit: $('unit').value,
      oldAmount: $('oldAmount').value,
      oldPrice: $('oldPrice').value,
      tagUnitPrice: ocrTag
    };
    var res = C.analyze(input);
    if (!res.ok) { showError(res.error); return; }
    showError('');
    var text = C.reportText(input, res);
    last = { input: input, res: res, text: text };
    var out = $('reportOutput');
    out.textContent = text;
    out.classList.toggle('warn', !!res.shrink || !!(res.old && res.old.unitPriceChangePct > 0.5) || !!(res.tag && res.tag.mismatch));
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
    $('clearPhoto').click(); // наступний товар — з чистого аркуша
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
