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

console.log('chesnyi-detektyv: OK — логіка, шрінкфляція, PWA-маніфест, офлайн-кеш');
