/* Чесний Детектив — чиста логіка розрахунків (без DOM).
 * Працює і в браузері (window.HonestCalc), і в Node (module.exports) для тестів. */
(function (root) {
  'use strict';

  // Одиниці: множник до «малої» одиниці (г / мл / шт) та базова одиниця для ціни.
  var UNITS = {
    g:   { toSmall: 1,    base: 'kg',  small: 'г',  label: 'г' },
    kg:  { toSmall: 1000, base: 'kg',  small: 'г',  label: 'кг' },
    ml:  { toSmall: 1,    base: 'l',   small: 'мл', label: 'мл' },
    l:   { toSmall: 1000, base: 'l',   small: 'мл', label: 'л' },
    pcs: { toSmall: 1,    base: 'pcs', small: 'шт', label: 'шт' }
  };
  var BASE_LABEL = { kg: '1 кг', l: '1 л', pcs: '1 шт' };

  // Звичні «круглі» фасовки в г/мл. Упаковка трохи менша за найближчу —
  // типовий прийом шрінкфляції (900 г замість 1 кг). Це ПІДКАЗКА, а не вирок.
  var STANDARD_PACKS = [100, 200, 250, 300, 400, 500, 1000, 1500, 2000, 3000, 5000];
  var SHRINK_WINDOW = 0.2; // підозра, якщо до стандарту бракує від >0 до 20 %

  function num(v) {
    if (typeof v === 'string') v = v.replace(',', '.').trim();
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : NaN;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  function unitPrice(price, amount, unit) {
    var u = UNITS[unit];
    price = num(price); amount = num(amount);
    if (!u) throw new Error('Невідома одиниця: ' + unit);
    if (!(price > 0) || !(amount > 0)) return null;
    var small = amount * u.toSmall;              // г / мл / шт
    var perBase = u.base === 'pcs' ? price / small : price / small * 1000;
    return {
      base: u.base,
      baseLabel: BASE_LABEL[u.base],
      smallAmount: small,
      smallLabel: u.small,
      perBase: perBase,
      per100: u.base === 'pcs' ? null : perBase / 10
    };
  }

  function shrinkHint(amount, unit) {
    var u = UNITS[unit];
    amount = num(amount);
    if (!u || u.base === 'pcs' || !(amount > 0)) return null;
    var small = amount * u.toSmall;
    for (var i = 0; i < STANDARD_PACKS.length; i++) {
      var std = STANDARD_PACKS[i];
      if (std < small) continue;
      if (std === small) return null;
      var missing = std - small;
      if (missing / std > SHRINK_WINDOW) return null;
      return {
        standard: std,
        missing: round2(missing),
        missingPct: round2(missing / std * 100),
        smallLabel: u.small
      };
    }
    return null;
  }

  // Порівняння з попередньою упаковкою того ж товару (якщо користувач її пам'ятає).
  function compareOld(cur, old) {
    if (!cur || !old || cur.base !== old.base) return null;
    var changePct = (cur.perBase / old.perBase - 1) * 100;
    return {
      amountChangePct: round2((cur.smallAmount / old.smallAmount - 1) * 100),
      unitPriceChangePct: round2(changePct)
    };
  }

  function analyze(input) {
    var cur = unitPrice(input.price, input.amount, input.unit);
    if (!cur) return { ok: false, error: 'Вкажіть ціну та вагу/об\'єм більші за нуль.' };
    var res = { ok: true, current: cur, shrink: shrinkHint(input.amount, input.unit), old: null };
    if (num(input.oldAmount) > 0) {
      var oldUnit = input.oldUnit || input.unit;
      var oldPrice = num(input.oldPrice) > 0 ? input.oldPrice : input.price;
      var old = unitPrice(oldPrice, input.oldAmount, oldUnit);
      if (old && old.base === cur.base) {
        res.old = compareOld(cur, old);
        res.old.samePrice = !(num(input.oldPrice) > 0);
        res.old.oldSmallAmount = old.smallAmount;
      }
    }
    // «Ціна за 1 кг/л» з цінника (розпізнана з фото) — чи чесно порахував магазин?
    var tag = input.tagUnitPrice;
    if (tag && num(tag.value) > 0 && tag.base === cur.base) {
      var diffPct = (num(tag.value) / cur.perBase - 1) * 100;
      res.tag = { value: num(tag.value), realVsTagPct: round2((cur.perBase / num(tag.value) - 1) * 100), mismatch: Math.abs(diffPct) > 1 };
    }
    return res;
  }

  function money(n) { return (Math.round(n * 100) / 100).toFixed(2).replace('.', ','); }

  function reportText(input, res) {
    var c = res.current;
    var name = (input.name || '').trim();
    var lines = ['📊 ЧЕСНИЙ ПЕРЕРАХУНОК' + (name ? ' — ' + name : '')];
    lines.push('• Упаковка: ' + fmtAmount(num(input.amount), input.unit) + ' | Ціна: ' + money(num(input.price)) + ' грн');
    lines.push('------------------------------');
    lines.push('💰 Ціна за ' + c.baseLabel + ': ' + money(c.perBase) + ' грн');
    if (c.per100 !== null) lines.push('🔎 Ціна за 100 ' + c.smallLabel + ': ' + money(c.per100) + ' грн');
    lines.push('');
    if (res.shrink) {
      lines.push('📉 МОЖЛИВА ШРИНГФЛЯЦІЯ:');
      lines.push('⚠️ ' + fmtNum(c.smallAmount) + ' ' + c.smallLabel + ' замість звичних ' + fmtNum(res.shrink.standard) + ' ' + c.smallLabel +
        ' (−' + fmtNum(res.shrink.missing) + ' ' + c.smallLabel + ', −' + fmtNum(res.shrink.missingPct) + '%).');
      lines.push('Порівнюйте товари за ціною за ' + c.baseLabel + ', а не за ціною на полиці.');
    } else if (c.base !== 'pcs') {
      lines.push('✅ Фасовка не схожа на «урізану» стандартну.');
    }
    if (res.tag) {
      lines.push('');
      if (res.tag.mismatch) {
        lines.push('🚨 ЦІННИК НЕ ЗБІГАЄТЬСЯ:');
        lines.push('На ціннику за ' + c.baseLabel + ': ' + money(res.tag.value) + ' грн, а насправді: ' + money(c.perBase) + ' грн (' + signed(res.tag.realVsTagPct) + '%).');
      } else {
        lines.push('✅ Ціна за ' + c.baseLabel + ' на ціннику збігається з розрахунком.');
      }
    }
    if (res.old) {
      var o = res.old;
      lines.push('');
      lines.push('🕰 ПОРІВНЯННЯ З ПОПЕРЕДНЬОЮ УПАКОВКОЮ (' + fmtNum(o.oldSmallAmount) + ' ' + c.smallLabel + '):');
      lines.push('• Обсяг: ' + signed(o.amountChangePct) + '%');
      lines.push('• Ціна за ' + c.baseLabel + ': ' + signed(o.unitPriceChangePct) + '%' + (o.samePrice ? ' (за тієї ж ціни на полиці)' : ''));
      if (o.unitPriceChangePct > 0.5) lines.push('⚠️ Реальне подорожчання — ' + fmtNum(o.unitPriceChangePct) + '%.');
    }
    return lines.join('\n');
  }

  function fmtNum(n) { return String(round2(n)).replace('.', ','); }
  function fmtAmount(n, unit) { return fmtNum(n) + ' ' + UNITS[unit].label; }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n)); }

  var api = {
    UNITS: UNITS, STANDARD_PACKS: STANDARD_PACKS,
    parseNumber: num, unitPrice: unitPrice, shrinkHint: shrinkHint,
    analyze: analyze, reportText: reportText, money: money, fmtNum: fmtNum, fmtAmount: fmtAmount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HonestCalc = api;
})(this);
