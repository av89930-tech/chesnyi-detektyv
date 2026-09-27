/* Чесний Детектив — розбір тексту, розпізнаного з фото цінника/етикетки (без DOM).
 * Вхід: рядки [{ text, h }], де h — висота найбільшого «цифрового» слова в рядку (px).
 * Вихід: кандидати ціни, ваги/об'єму та «ціни за 1 кг/л», яку надрукував магазин.
 * Працює і в браузері (window.OcrParse), і в Node (module.exports) для тестів. */
(function (root) {
  'use strict';

  // Типові помилки OCR у маленьких словах одиниць (латиниця ↔ кирилиця).
  var UNIT_MAP = {
    'кг': 'kg', 'kg': 'kg', 'kr': 'kg', 'кr': 'kg', 'kг': 'kg',
    'г': 'g', 'гр': 'g', 'g': 'g', 'r': 'g', 'rp': 'g',
    'мл': 'ml', 'ml': 'ml', 'mл': 'ml', 'мl': 'ml', 'mn': 'ml',
    'л': 'l', 'l': 'l',
    'шт': 'pcs'
  };
  var UNIT_ALT = 'кг|kg|kr|кr|kг|гр|rp|г|g|r|мл|ml|mл|мl|mn|л|l|шт';
  var LETTER = 'a-zа-яіїєґ';
  var AMOUNT_RE = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*(' + UNIT_ALT + ')\\.?(?![' + LETTER + '])', 'gi');
  var CURRENCY_RE = /(\d{1,5})(?:\s*[.,]\s*(\d{2})|\s+(\d{2}))?\s*(?:грн|грв|гpн|₴|uah)/gi;
  var DECIMAL_RE = /(^|[^\d.,])(\d{1,5})\s*[.,]\s*(\d{2})(?![\d%])/g;
  var PER_RE = new RegExp('(?:за|/)\\s*(?:1\\s*)?(кг|kg|kr|л|l)(?![' + LETTER + '])', 'i');
  var PER100_RE = /за\s*100\s*(г|g|r|мл|ml)/i;

  var LIMITS = { g: [1, 50000], kg: [0.01, 50], ml: [1, 50000], l: [0.01, 50], pcs: [1, 500] };

  function toNum(s) { return parseFloat(String(s).replace(',', '.')); }

  function normalize(text) {
    var t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var prev;
    do { // «9oo г» → «900 г», «1l5» → «115» (повторюємо, доки є що міняти)
      prev = t;
      t = t.replace(/(?<=\d)[оo]|[оo](?=\d)/g, '0').replace(/(?<=\d)[іil|](?=\d)/g, '1');
    } while (t !== prev);
    return t;
  }

  function pushUnique(list, item, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i][key] === item[key]) {
        list[i].h = Math.max(list[i].h, item.h);
        list[i].hits++;
        if (item.strong) list[i].strong = true;
        if (item.rank > list[i].rank) list[i].rank = item.rank;
        return;
      }
    }
    item.hits = 1;
    list.push(item);
  }

  function fmt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }

  function parse(lines, bigValues) {
    var prices = [];
    var amounts = [];
    var tagUnit = null;

    (lines || []).forEach(function (line) {
      var raw = typeof line === 'string' ? line : line.text;
      var h = (line && line.h) || 0;
      var full = normalize(raw);
      if (!/\d/.test(full)) return;
      // «… 45,90 ₴ за 100 г 51,00»: до «за …» — товар, після — ціна за одиницю.
      var cut = full.search(/(?:ціна\s*)?(?:за|\/)\s*(?:1\s*|100\s*)?(?:кг|kg|kr|л|l|г|g|r|мл|ml)(?![a-zа-яіїєґ])/i);
      var text = cut > 0 ? full.slice(0, cut) : full;
      var unitPart = cut >= 0 ? full.slice(cut) : '';
      if (cut === 0) text = '';

      var perMatch = unitPart.match(PER_RE);
      var per100 = unitPart.match(PER100_RE);

      // 1) Ціна за 1 кг / л, яку надрукував магазин (перевіримо його розрахунок).
      if ((perMatch || per100) && /(грн|₴|\d[.,]\d{2})/.test(unitPart)) {
        var m = unitPart.match(/(\d{1,5})\s*[.,]\s*(\d{2})/) || unitPart.match(/(\d{1,5})\s*(?:грн|₴)/);
        if (m) {
          var v = toNum(m[1] + (m[2] ? '.' + m[2] : ''));
          var base = per100 ? (/[мm]/.test(per100[1]) ? 'l' : 'kg') : (UNIT_MAP[perMatch[1]] === 'kg' ? 'kg' : 'l');
          if (per100) v = v * 10;
          if (v > 0 && (!tagUnit || h > tagUnit.h)) tagUnit = { value: Math.round(v * 100) / 100, base: base, h: h };
        }
      }
      if (!/\d/.test(text)) return;

      // 2) Вага / об'єм: число + одиниця.
      var am;
      AMOUNT_RE.lastIndex = 0;
      while ((am = AMOUNT_RE.exec(text))) {
        var unit = UNIT_MAP[am[2]];
        var val = toNum(am[1]);
        var lim = LIMITS[unit];
        if (!unit || !(val >= lim[0] && val <= lim[1])) continue;
        // одиночні латинські l/r/g після цифри — найменш надійні
        var weak = /^[lrg]$/.test(am[2]);
        pushUnique(amounts, { value: val, unit: unit, key: val + unit, h: h, strong: !weak }, 'key');
      }
      var textNoAmounts = text.replace(AMOUNT_RE, ' ')
        .replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ')   // дати: 12.09.2026
        .replace(/\d{1,2}:\d{2}/g, ' ')                       // час
        .replace(/\d{6,}/g, ' ')                                // штрихкоди, артикули
        .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');               // жирність, знижки

      // 3) Ціна: спершу з «грн/₴», потім — десяткові числа без одиниць.
      var pm;
      CURRENCY_RE.lastIndex = 0;
      while ((pm = CURRENCY_RE.exec(textNoAmounts))) {
        var cents = pm[2] || pm[3];
        var p = toNum(pm[1] + (cents ? '.' + cents : ''));
        if (p > 0 && p < 100000) pushUnique(prices, { value: p, h: h, rank: 3 }, 'value');
      }
      DECIMAL_RE.lastIndex = 0;
      while ((pm = DECIMAL_RE.exec(textNoAmounts))) {
        var d = toNum(pm[2] + '.' + pm[3]);
        if (d > 0 && d < 100000 && !/%/.test(textNoAmounts.slice(DECIMAL_RE.lastIndex, DECIMAL_RE.lastIndex + 2))) {
          pushUnique(prices, { value: d, h: h, rank: 2 }, 'value');
        }
      }
      // «69 90» великим шрифтом (копійки дрібно поруч) — рядок лише з двох чисел.
      var split = textNoAmounts.trim().match(/^(\d{1,4})\s+(\d{2})$/);
      if (split) pushUnique(prices, { value: toNum(split[1] + '.' + split[2]), h: h, rank: 1 }, 'value');
      // Запасний варіант: ціле число (≤ 4 цифр) без одиниць — ціна без копійок.
      var ints = textNoAmounts.match(/(?:^|[^\d.,])(\d{1,4})(?![\d.,%])/g) || [];
      if (!split) ints.forEach(function (t) {
        var n = toNum(t.replace(/\D/g, ''));
        if (n > 0) pushUnique(prices, { value: n, h: h, rank: 0 }, 'value');
      });
    });

    // Кандидати з проходу «лише цифри» (велика ціна) — вище за все, у порядку голосування.
    (bigValues || []).slice().reverse().forEach(function (v) {
      // рядок «42 ,99 ген» із повного проходу міг дати сміття на кшталт 2,00 — велике число важливіше
      prices = prices.filter(function (p) { return p.value !== v; });
      prices.unshift({ value: v, h: Infinity, rank: 9, hits: 1 });
    });
    // Найімовірніша ціна — з «грн», далі найбільший шрифт (на цінниках ціна найбільша).
    prices.sort(function (a, b) { return (b.rank - a.rank) || (b.h - a.h) || (b.hits - a.hits); });
    amounts.sort(function (a, b) { return (b.strong - a.strong) || (b.hits - a.hits) || (b.h - a.h); });

    return {
      prices: prices.slice(0, 4).map(function (p) { return { value: p.value, label: p.value.toFixed(2).replace('.', ',') + ' грн' }; }),
      amounts: amounts.slice(0, 4).map(function (a) {
        return { value: a.value, unit: a.unit, label: fmt(a.value) + ' ' + ({ g: 'г', kg: 'кг', ml: 'мл', l: 'л', pcs: 'шт' })[a.unit] };
      }),
      tagUnitPrice: tagUnit ? { value: tagUnit.value, base: tagUnit.base } : null
    };
  }

  // Прохід «лише цифри» на зменшеному фото: найбільше число на цінику — це ціна.
  // Копійки часто надруковані дрібно праворуч/вгорі («42⁹⁹») — беремо їх із сусіднього слова.
  function bigPrice(words, amounts) {
    var nums = (words || []).filter(function (w) {
      return w.bbox && /^\d{1,4}(?:[.,]\d{0,2})?[.,]*$/.test(w.text) && /\d/.test(w.text);
    }).map(function (w) {
      return { text: w.text, h: w.bbox.y1 - w.bbox.y0, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 };
    });
    if (!nums.length) return null;
    nums.sort(function (a, b) { return b.h - a.h; });
    var top = nums[0];
    var m = top.text.match(/^(\d{1,4})(?:[.,](\d{2}))?/);
    var intPart = m[1], cents = m[2] || null;
    if (!cents) {
      nums.forEach(function (w) {
        if (cents || w === top) return;
        var sameRow = w.y0 < top.y1 && w.y1 > top.y0;
        var right = w.x0 >= top.x1 - top.h * 0.1 && w.x0 - top.x1 < top.h;
        var digits = w.text.replace(/\D/g, '');
        if (sameRow && right && w.h < top.h * 0.85 && digits.length >= 2 && digits.length <= 3) cents = digits.slice(-2);
      });
    }
    var value = toNum(intPart + '.' + (cents || '00'));
    // Велике «900» на упаковці — це вага, а не ціна.
    if ((amounts || []).some(function (a) { return a.value === toNum(intPart); })) return null;
    return value > 0 ? { value: value, h: top.h, cents: !!cents, box: { x0: top.x0, y0: top.y0, x1: top.x1, y1: top.y1 } } : null;
  }

  // Голосування між масштабами: однакове значення з кількох проходів — найнадійніше.
  // Повертає значення у порядку довіри та «переможця» (для дочитування копійок).
  function voteBig(results) {
    // Голосуємо за цілою частиною; копійки беремо з того проходу, що їх побачив.
    var tally = {};
    (results || []).forEach(function (r, i) {
      if (!r) return;
      var key = String(Math.floor(r.value));
      var t = tally[key] || (tally[key] = { int: key, n: 0, first: i, best: r, cents: {} });
      t.n++;
      if (r.cents) {
        var c = Math.round((r.value - Math.floor(r.value)) * 100);
        t.cents[c] = (t.cents[c] || 0) + 1;
      }
    });
    var list = Object.keys(tally).map(function (k) { return tally[k]; });
    // Типова помилка OCR — загублена перша цифра («42» → «2»): голос за «2» віддаємо «42».
    list.forEach(function (a) {
      list.forEach(function (b) {
        if (a !== b && a.n && b.int.length > a.int.length && b.int.slice(-a.int.length) === a.int) {
          b.n += a.n; a.n = 0;
          Object.keys(a.cents).forEach(function (c) { b.cents[c] = (b.cents[c] || 0) + a.cents[c]; });
        }
      });
    });
    list = list.filter(function (t) { return t.n > 0; });
    list.sort(function (a, b) { return (b.n - a.n) || (b.int.length - a.int.length) || (a.first - b.first); });
    var values = [];
    list.forEach(function (t) {
      var cs = Object.keys(t.cents).sort(function (a, b) { return t.cents[b] - t.cents[a]; });
      cs.forEach(function (c) { values.push(Number(t.int) + Number(c) / 100); });
      values.push(Number(t.int));
    });
    var win = list[0];
    return {
      values: values,
      winner: win ? { value: Number(win.int), cents: Object.keys(win.cents).length > 0, box: win.best.box, scale: win.best.scale } : null
    };
  }

  // Tesseract.js blocks → слова з bbox (для проходу «лише цифри»).
  function wordsFromBlocks(blocks) {
    var out = [];
    (blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) { out.push({ text: (w.text || '').trim(), bbox: w.bbox }); });
        });
      });
    });
    return out;
  }

  // Tesseract.js blocks → рядки { text, h }.
  function linesFromBlocks(blocks) {
    var out = [];
    (blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          var h = 0;
          (l.words || []).forEach(function (w) {
            if (/\d/.test(w.text) && w.bbox) h = Math.max(h, w.bbox.y1 - w.bbox.y0);
          });
          out.push({ text: l.text, h: h });
        });
      });
    });
    return out;
  }

  var api = { parse: parse, bigPrice: bigPrice, voteBig: voteBig, linesFromBlocks: linesFromBlocks, wordsFromBlocks: wordsFromBlocks, normalize: normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OcrParse = api;
})(this);
