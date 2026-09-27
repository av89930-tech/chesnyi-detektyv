/* Чесний Детектив — розпізнавання тексту з фото на пристрої (Tesseract.js, локальні файли).
 * Бібліотека (~6 МБ) вантажиться лише під час першого фото, далі береться з кешу. */
(function (root) {
  'use strict';
  var BASE = new URL('vendor/tesseract/', document.baseURI).href;
  var workerPromise = null;
  var onProgress = function () {};

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('Не вдалося завантажити ' + src)); };
      document.head.appendChild(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (root.Tesseract ? Promise.resolve() : loadScript(BASE + 'tesseract.min.js'))
        .then(function () {
          return root.Tesseract.createWorker('ukr', 1 /* LSTM */, {
            workerPath: BASE + 'worker.min.js',
            corePath: BASE + 'core',
            langPath: BASE + 'lang',
            workerBlobURL: false, // воркер з нашого origin → його запити кешує sw.js (офлайн)
            logger: function (m) { onProgress(m); }
          });
        })
        .catch(function (e) { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  // Фото з камери 12+ Мп: зменшуємо до ~1800 px, сірий + розтяг контрасту.
  function prepare(file) {
    var load = root.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (resolve, reject) {
          var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
    return load.then(function (img) {
      var w = img.width, h = img.height;
      var scale = Math.min(1, 1800 / Math.max(w, h));
      if (Math.max(w, h) < 900) scale = 900 / Math.max(w, h);
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, cw, ch);
      var raw = shrink(c, 100000); // копія без обробки: цифровий прохід на ній точніший
      var d = ctx.getImageData(0, 0, cw, ch), px = d.data, lo = 255, hi = 0, i, g;
      for (i = 0; i < px.length; i += 4) {
        g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
        px[i] = g; if (g < lo) lo = g; if (g > hi) hi = g;
      }
      var k = hi > lo ? 255 / (hi - lo) : 1;
      for (i = 0; i < px.length; i += 4) { g = (px[i] - lo) * k; px[i] = px[i + 1] = px[i + 2] = g; }
      ctx.putImageData(d, 0, 0);
      return { text: c, digits: raw };
    });
  }

  function shrink(canvas, longSide) {
    var k = Math.min(1, longSide / Math.max(canvas.width, canvas.height));
    var c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  var SCALES = [330, 420, 520]; // підібрано сіткою масштаб × режим на тестових цінниках

  function rec(worker, image, psm, whitelist, output) {
    return worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist })
      .then(function () { return worker.recognize(image, {}, output); });
  }

  // Дрібні копійки («42⁹⁹»): рамка слова від Tesseract часто вже охоплює їх, тому вирізаємо
  // від середини великого числа праворуч і читаємо окремо; останні дві цифри — копійки.
  function readCents(worker, raw, scale, box) {
    var k = raw.width / scale.width, h = (box.y1 - box.y0) * k;
    var x = (box.x0 + (box.x1 - box.x0) * 0.55) * k, y = Math.max(0, box.y0 * k - h * 0.1);
    var w = Math.min(raw.width - x, box.x1 * k - x + h * 1.2), hh = Math.min(raw.height - y, h * 1.2);
    if (!(w > 4 && hh > 4)) return Promise.resolve(null);
    var c = document.createElement('canvas'), out = 80 / hh;
    c.width = Math.round(w * out); c.height = Math.round(hh * out);
    c.getContext('2d').drawImage(raw, x, y, w, hh, 0, 0, c.width, c.height);
    return rec(worker, c, '7', '0123456789', { text: true }).then(function (r) {
      var d = (r.data.text || '').replace(/\D/g, '');
      return d.length >= 2 && d.length <= 3 ? d.slice(-2) : null;
    });
  }

  // Проходи: (1) увесь текст — вага, «ціна за 1 кг»; (2) лише цифри на кількох зменшених
  // копіях — велика ціна (гігантські символи Tesseract у повному розмірі читає погано);
  // (3) за потреби — копійки з вирізаної ділянки.
  function recognize(file, progress) {
    onProgress = progress || function () {};
    var P = root.OcrParse, worker, img, base, textRes;
    return Promise.all([getWorker(), prepare(file)]).then(function (r) {
      worker = r[0]; img = r[1];
      return rec(worker, img.text, '3', '', { text: true, blocks: true });
    }).then(function (res) {
      textRes = res;
      var lines = P.linesFromBlocks(res.data.blocks);
      if (!lines.length && res.data.text) lines = res.data.text.split('\n').map(function (t) { return { text: t, h: 0 }; });
      base = lines;
      var amounts = P.parse(lines).amounts;
      var scaled = SCALES.map(function (s) { return shrink(img.digits, s); });
      var bigs = [];
      return scaled.reduce(function (chain, cv) {
        return chain.then(function () {
          return rec(worker, cv, '11', '0123456789.,', { blocks: true }).then(function (d) {
            var b = P.bigPrice(P.wordsFromBlocks(d.data.blocks), amounts);
            if (b) b.scale = cv;
            bigs.push(b);
          });
        });
      }, Promise.resolve()).then(function () { return P.voteBig(bigs); });
    }).then(function (vote) {
      var w = vote.winner;
      if (!w || w.cents) return { vote: vote, cents: null };
      return readCents(worker, img.digits, w.scale, w.box)
        .catch(function () { return null; })
        .then(function (cents) { return { vote: vote, cents: cents }; });
    }).then(function (v) {
      var w = v.vote.winner, values = v.vote.values;
      if (v.cents) values = [w.value + Number(v.cents) / 100].concat(values);
      var result = P.parse(base, values);
      // Якщо копійок так і не видно — не вигадуємо «,00», а просимо дописати.
      result.centsMissing = !!(w && !w.cents && !v.cents && result.prices[0] && result.prices[0].value === w.value);
      return { text: textRes.data.text || '', result: result };
    });
  }

  root.HonestOcr = { recognize: recognize };
})(this);
