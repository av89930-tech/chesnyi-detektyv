'use strict';
// Чесний Детектив — детермінована перевірка логіки та PWA-обв'язки.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const C = require('../calc.js');
const DIR = path.join(__dirname, '..');

const close = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// Ціна за базову одиницю
close(C.unitPrice(42, 900, 'g').perBase, 46.666666666666664, '900 г за 42 грн → грн/кг');
close(C.unitPrice('42,00', '0,9', 'kg').perBase, 46.666666666666664, 'кома як десятковий роздільник, кг');
close(C.unitPrice(50, 2, 'l').perBase, 25, '2 л → грн/л');
close(C.unitPrice(30, 870, 'ml').per100, 30 / 8.7, 'ціна за 100 мл');
assert.strictEqual(C.unitPrice(10, 5, 'pcs').per100, null, 'для шт немає ціни за 100');
close(C.unitPrice(10, 5, 'pcs').perBase, 2, 'ціна за 1 шт');
assert.strictEqual(C.unitPrice(0, 900, 'g'), null, 'нульова ціна → null');
assert.strictEqual(C.unitPrice(42, '', 'g'), null, 'порожня вага → null');

// Підказка про шрінкфляцію: лише «трохи менше круглої фасовки»
assert.deepStrictEqual(C.shrinkHint(900, 'g'), { standard: 1000, missing: 100, missingPct: 10, smallLabel: 'г' });
assert.strictEqual(C.shrinkHint(870, 'ml').standard, 1000);
assert.strictEqual(C.shrinkHint(0.9, 'l').standard, 1000);
assert.strictEqual(C.shrinkHint(180, 'g').standard, 200);
assert.strictEqual(C.shrinkHint(1000, 'g'), null, 'рівно 1 кг — без підозри');
assert.strictEqual(C.shrinkHint(500, 'ml'), null, 'рівно 500 мл — без підозри');
assert.strictEqual(C.shrinkHint(700, 'g'), null, '700 г — надто далеко від 1000 (30%)');
assert.strictEqual(C.shrinkHint(12, 'pcs'), null, 'для шт не рахуємо');

// Порівняння зі старою упаковкою: 1000 г → 900 г за ту саму ціну = +11,11 % за кг
const r = C.analyze({ price: 42, amount: 900, unit: 'g', oldAmount: 1000 });
assert(r.ok);
assert.strictEqual(r.old.unitPriceChangePct, 11.11);
assert.strictEqual(r.old.amountChangePct, -10);
assert.strictEqual(r.old.samePrice, true);
const r2 = C.analyze({ price: 45, amount: 900, unit: 'g', oldAmount: 1000, oldPrice: 50 });
assert.strictEqual(r2.old.unitPriceChangePct, 0, 'пропорційне зменшення ціни — не подорожчання');
assert.strictEqual(C.analyze({ price: '', amount: 900, unit: 'g' }).ok, false);

const text = C.reportText({ name: 'Гречка', price: 42, amount: 900, unit: 'g', oldAmount: 1000 }, r);
assert(text.includes('Гречка') && text.includes('46,67 грн') && text.includes('МОЖЛИВА ШРИНГФЛЯЦІЯ') && text.includes('+11,11%'), text);
assert(!/1 л/.test(text), 'для г не показуємо «ціну за літр» (стара вигадана формула ×1.03)');

// Розпізнавання: розбір тексту з фото
const O = require('../ocr-parse.js');
const L = (...rows) => rows.map(([text, h]) => ({ text, h }));
let o = O.parse(L(['Гречка ядриця 900г', 20], ['42,99', 90], ['Ціна за 1 кг 47,77 грн', 18]));
assert.strictEqual(o.prices[0].value, 42.99, 'ціна — найбільше число');
assert.deepStrictEqual([o.amounts[0].value, o.amounts[0].unit], [900, 'g']);
assert.deepStrictEqual(o.tagUnitPrice, { value: 47.77, base: 'kg' }, 'ціна за 1 кг із цінника');
o = O.parse(L(['Молоко 2,5% 870 мл', 15], ['-15%', 40], ['38.50 грн', 60], ['за 1л 44,25', 14]));
assert.strictEqual(o.prices[0].value, 38.5, 'відсотки (жирність, знижка) — не ціна');
assert.deepStrictEqual([o.amounts[0].value, o.amounts[0].unit], [870, 'ml']);
assert.deepStrictEqual(o.tagUnitPrice, { value: 44.25, base: 'l' });
o = O.parse(L(['Олія 0,85 л', 15], ['69 90', 70], ['4820001234567', 10]));
assert.strictEqual(o.prices[0].value, 69.9, '«69 90» великим шрифтом → 69,90; штрихкод — не ціна');
o = O.parse(L(['Сир', 20], ['189', 80], ['12.09.2026 10:15', 10], ['за 1 кг 189 грн', 12]));
assert.strictEqual(o.prices[0].value, 189, 'дата/час — не ціна');
o = O.parse(L(['Шоколад 90 г 45,90 ₴ за 100 г 51,00', 30]));
assert.strictEqual(o.prices[0].value, 45.9);
assert.deepStrictEqual(o.tagUnitPrice, { value: 510, base: 'kg' }, '«за 100 г» → перерахунок на 1 кг');
assert.deepStrictEqual([O.parse(L(['нетто 9oo r', 12])).amounts[0].value], [900], '«9oo r» → 900 г');
assert.deepStrictEqual(O.parse(L(['Hello', 10])), { prices: [], amounts: [], tagUnitPrice: null });

// Велика ціна з проходу «лише цифри» + голосування масштабів
const W = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
assert.strictEqual(O.bigPrice([W('900', 10, 10, 40, 22), W('42', 100, 40, 180, 110), W('99', 182, 40, 210, 70)], []).value, 42.99, 'копійки дрібно праворуч');
assert.strictEqual(O.bigPrice([W('900', 10, 10, 90, 80)], [{ value: 900, unit: 'g' }]), null, 'велике «900 г» — вага, не ціна');
const v = O.voteBig([{ value: 27, cents: false }, { value: 42.99, cents: true }, { value: 2, cents: false }]);
assert.strictEqual(v.values[0], 42.99, '«2» — це «42» без першої цифри; копійки з проходу, що їх бачив');
assert.strictEqual(v.winner.value, 42);
assert(O.parse(L(['x', 1]), [42.99, 42]).prices[0].value === 42.99, 'велика ціна має пріоритет');

// Цінник проти розрахунку
const tagRes = C.analyze({ price: 42.99, amount: 900, unit: 'g', tagUnitPrice: { value: 44.99, base: 'kg' } });
assert.strictEqual(tagRes.tag.mismatch, true, '44,99 за кг на ціннику ≠ 47,77 насправді');
assert(C.reportText({ price: 42.99, amount: 900, unit: 'g' }, tagRes).includes('ЦІННИК НЕ ЗБІГАЄТЬСЯ'));
assert.strictEqual(C.analyze({ price: 42.99, amount: 900, unit: 'g', tagUnitPrice: { value: 47.77, base: 'kg' } }).tag.mismatch, false);
assert.strictEqual(C.analyze({ price: 42.99, amount: 900, unit: 'g', tagUnitPrice: { value: 47.77, base: 'l' } }).tag, undefined, 'різні одиниці не порівнюємо');

// Локальні файли розпізнавання (без CDN — працює офлайн)
for (const f of ['tesseract.min.js', 'worker.min.js', 'core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js',
  'core/tesseract-core-relaxedsimd-lstm.wasm.js', 'lang/ukr.traineddata.gz']) {
  assert(fs.existsSync(path.join(DIR, 'vendor/tesseract', f)), `немає vendor/tesseract/${f}`);
}
assert(!/https?:\/\//.test(fs.readFileSync(path.join(DIR, 'ocr.js'), 'utf8')), 'ocr.js не має тягнути нічого з інтернету');

// PWA-обв'язка
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.webmanifest'), 'utf8'));
assert.strictEqual(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  assert(!/^https?:/.test(icon.src), `іконка має бути локальною: ${icon.src}`);
  assert(fs.existsSync(path.join(DIR, icon.src)), `немає файлу іконки: ${icon.src}`);
}
assert(manifest.icons.some((i) => i.purpose === 'maskable'), 'потрібна maskable-іконка');
const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
for (const a of sw.match(/'\.\/[^']*'/g).map((s) => s.slice(3, -1)).filter(Boolean)) {
  assert(fs.existsSync(path.join(DIR, a)), `sw.js кешує неіснуючий файл: ${a}`);
}
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
assert(/capture="environment"/.test(html), 'кнопка має відкривати задню камеру');
assert(!/onclick=/.test(html), 'без inline-обробників');

console.log('chesnyi-detektyv: OK — логіка, шрінкфляція, розпізнавання (парсер, голосування), цінник, PWA, офлайн');
