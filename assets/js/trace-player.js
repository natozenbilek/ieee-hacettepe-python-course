/* trace-player.js · in-slide trace player (authoring/TRACE.md; DECISIONS.md "In-slide trace demos")
   Markup:  <div class="trace" data-trace="traces/<name>.json" [data-step="5" | "last"] [data-labels="names values"]
                 [data-code-label="Önizleme"] [data-h="476" style="height:476px"]></div>
   Data:    written by tools/make_trace.py. The player loads the twin traces/<name>.js with a script tag
            (works from file:// and offline) and falls back to fetch() of the .json.
   Labels:  data-labels names the two columns of the picture by what the class has been taught so far
            (tools/typeset.py sets it from the slide's place in the course, 2026-10-14):
              data    one heading "Data" over the whole picture, as in Ders 1's computer model, where memory's Data
                      part holds the names and what they show (value not taught yet: Ders 1 before S116);
              names   "İsimler", the names sit in the column with no "Global frame" box (frame not taught yet);
              frames  "Frame'ler", each frame is a box: "Global frame" and the call frames (taught from Ders 4 S145);
              values  "Value'lar" (object not taught yet);  objects  "Object'ler" (taught from Ders 4 S74).
            Without the attribute: "frames objects".
   Steps:   each step is the state AFTER the highlighted line ran. Step 1 is the start.
   Keys:    "." next step, "," previous step, only while a trace is on the current slide; reveal's arrow
            keys are left alone. On-screen buttons do the same.
   Print:   in ?print-pdf it shows data-step, or the last step. ?trace-step=N|last sets every trace (tests).
   Layout:  all space is reserved by trace.css (1152x548 in a slide's content zone, or data-h when a focal line
            sits under the player); nothing shifts between steps. Text is never scaled below its size: the player
            tries the code at 26 px and then 24 px, each with the normal and then the compact spacing of the
            picture, then the compact spacing with the type tags of collections under their boxes, and takes the
            first that fits at 1:1; only when none fits does it scale the picture down (and warn in the console). The diagram uses the dg classes of slides.css / site.css and the dg v4
            type colours of dg-types.css (authoring/DIAGRAMS.md §3, §10). */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var TYPED = { int: 1, float: 1, str: 1, bool: 1, NoneType: 1, list: 1, tuple: 1, dict: 1, set: 1 };
  var SCALAR = { int: 1, float: 1, str: 1, bool: 1, NoneType: 1 };
  var SEQ = { list: 1, tuple: 1, set: 1, frozenset: 1 };
  /* geometry in px at 1:1 on a 1280x720 slide (content zone 1152x548) */
  var G = { W: 1152, H: 548, colGap: 32, barH: 52, barGap: 12, rowGap: 16, code: 26, codeLH: 1.4, out: 24, outLH: 1.35 };
  /* the picture's spacing: the normal one, and a compact one for pictures that would not fit at 1:1 */
  var GEOM = {
    base: { head: 44, nameH: 56, nameTy: 38, row: 68, fTitle: 48, fTitleTy: 34, fPad: 16, fIn: 16, fGap: 20, fMin: 220,
            arrow: 96, cellH: 48, cellTy: 32, cellPad: 24, pad: 6, idxH: 30, idxTy: 24, objGap: 20, tagGap: 12, indent: 40 },
    compact: { head: 40, nameH: 52, nameTy: 36, row: 60, fTitle: 44, fTitleTy: 31, fPad: 12, fIn: 12, fGap: 14, fMin: 180,
               arrow: 64, cellH: 44, cellTy: 30, cellPad: 16, pad: 5, idxH: 28, idxTy: 22, objGap: 14, tagGap: 8, indent: 20 }
  };
  /* the last resort before scaling: the compact spacing with the type tag of a list, tuple, set or dict under its box */
  GEOM.below = Object.assign({}, GEOM.compact, { tagsBelow: true, tagH: 28 });
  var HEADS = { data: 'Data', names: 'İsimler', frames: "Frame'ler", values: "Value'lar", objects: "Object'ler" };
  var MONO28 = 16.8, MONO24 = 14.4;
  var PRINT = /print-pdf/.test(location.search) || document.documentElement.classList.contains('reveal-print');
  var QSTEP = new URLSearchParams(location.search).get('trace-step');
  var players = [];
  var uid = 0;
  var loading = {};

  /* ---------- small helpers ---------- */
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, cls, s) {
    var t = el('text', { x: x, y: y, 'class': cls }, parent);
    if (/^ |  /.test(s)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    t.textContent = s;
    return t;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function tcls(t) { return t === 'NoneType' ? 't-none' : (TYPED[t] ? 't-' + t : ''); }
  var canvas;
  function sansW(s, weight) {
    try {
      canvas = canvas || document.createElement('canvas');
      var c = canvas.getContext('2d');
      c.font = (weight || 400) + ' 24px "Atkinson Hyperlegible Next", "Segoe UI", Arial, sans-serif';
      return Math.ceil(c.measureText(s).width);
    } catch (e) { return Math.ceil(s.length * 13.5); }
  }
  /* a function, module or class object is drawn as an untyped box with its kind, as in the course's drawings
     (a name tag pointing at a box "function"); the name tag already says which one it is */
  function disp(o) {
    if (!o) return '?';
    if (o.type === 'str') return JSON.stringify(o.value);
    if (o.repr != null) return o.repr;
    if (o.type === 'function') return 'function';
    if (o.type === 'module') return 'module ' + o.value;
    if (o.type === 'class') return 'class ' + o.value;
    return o.value != null ? String(o.value) : o.type;
  }
  function isScalar(o) { return o && SCALAR[o.type]; }
  /* a class box lists its methods by name; their function objects are not drawn */
  function isMethod(o, id, objs) { return o.type === 'class' && objs[id] && objs[id].type === 'function'; }

  /* ---------- Python syntax colours (the same roles as the highlight.js theme in slides.css) ---------- */
  var KW = /^(False|None|True|and|as|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|not|or|pass|raise|return|try|while|with)$/;
  function colour(line) {
    var re = /(#.*$)|([rbfRBF]{0,2}"(?:[^"\\]|\\.)*"|[rbfRBF]{0,2}'(?:[^'\\]|\\.)*')|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g, m, out = '';
    while ((m = re.exec(line))) {
      if (m[1]) out += '<span class="tr-c">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tr-s">' + esc(m[2]) + '</span>';
      else if (m[3]) out += KW.test(m[3]) ? '<span class="tr-k">' + m[3] + '</span>' : m[3];
      else out += esc(m[0]);
    }
    return out;
  }

  /* ---------- object geometry ---------- */
  /* opt (a collection under a list that holds references, Player.layout): noIdx draws no index row, tagBelow
     forces the type tag under (true) or beside (false) the box */
  function measure(o, objs, g, opt) {
    var w, h, ay;              /* ay: y of the anchor row centre, from the top */
    opt = opt || {};
    var below = opt.tagBelow != null ? opt.tagBelow : g.tagsBelow, tagH = g.tagH || 28;
    if (isScalar(o)) {
      w = Math.max(72, Math.ceil(MONO28 * disp(o).length + 32)); h = g.nameH; ay = g.nameH / 2;
      return { w: w, h: h, ay: ay, full: w + g.tagGap + Math.ceil(MONO24 * o.type.length) };
    }
    if (SEQ[o.type]) {
      var cells = (o.items || []).map(function (id) { return cellW(objs[id], g); });
      var inner = cells.reduce(function (a, b) { return a + b; }, 0) || 52;
      w = inner + 2 * g.pad; h = g.cellH + 2 * g.pad; ay = h / 2;
      var hh = (o.type === 'list' || o.type === 'tuple') && o.items.length && !opt.noIdx ? h + g.idxH : h;
      if (below) return { w: w, h: hh + tagH, boxH: h, ay: ay, cells: cells, full: Math.max(w, Math.ceil(MONO24 * o.type.length)), below: hh, noIdx: !!opt.noIdx };
      return { w: w, h: hh, boxH: h, ay: ay, cells: cells, full: w + g.tagGap + Math.ceil(MONO24 * o.type.length), noIdx: !!opt.noIdx };
    }
    if (o.type === 'dict') {
      var kw = 0, vw = 0;
      (o.items || []).forEach(function (p) { kw = Math.max(kw, cellW(objs[p[0]], g)); vw = Math.max(vw, cellW(objs[p[1]], g)); });
      w = (o.items.length ? kw + vw : 52) + 2 * g.pad;
      h = (Math.max(o.items.length, 1)) * g.cellH + 2 * g.pad; ay = g.pad + g.cellH / 2;
      if (g.tagsBelow) return { w: w, h: h + g.tagH, boxH: h, ay: ay, kw: kw, vw: vw, full: Math.max(w, Math.ceil(MONO24 * 4)), below: h };
      return { w: w, h: h, boxH: h, ay: ay, kw: kw, vw: vw, full: w + g.tagGap + Math.ceil(MONO24 * 4) };
    }
    if (o.attrs) {
      var head = (o.instance ? o.type : 'class ' + o.value);
      var nw = 0, cw = 0;
      o.attrs.forEach(function (p) {
        if (isMethod(o, p[1], objs)) { nw = Math.max(nw, MONO24 * (p[0].length + 2)); return; }
        nw = Math.max(nw, MONO24 * p[0].length); cw = Math.max(cw, cellW(objs[p[1]], g));
      });
      w = Math.max(Math.ceil(MONO24 * head.length + 32), Math.ceil(16 + nw + 16 + cw + g.pad));
      h = g.fTitle + o.attrs.length * g.cellH + (o.attrs.length ? g.pad : 0); ay = g.fTitle / 2;
      return { w: w, h: h, boxH: h, ay: ay, nw: nw, cw: cw, head: head, full: w };
    }
    w = Math.ceil(MONO24 * disp(o).length + 32); h = g.nameH; ay = g.nameH / 2;
    return { w: w, h: h, ay: ay, full: w };
  }
  function cellW(o, g) {
    if (isScalar(o)) return Math.max(48, Math.ceil(MONO24 * disp(o).length + g.cellPad));
    return 48;  /* a reference: a dot with an arrow */
  }

  /* ---------- one player ---------- */
  function Player(root, data) {
    this.root = root;
    this.data = data;
    this.steps = data.steps;
    this.n = this.steps.length;
    this.uid = 'tr' + (++uid);
    this.lines = data.code.split('\n');
    var want = PRINT ? (root.dataset.step || 'last') : (root.dataset.start || '1');
    if (QSTEP) want = QSTEP;
    this.i = want === 'last' ? this.n - 1 : Math.max(0, Math.min(this.n - 1, (parseInt(want, 10) || 1) - 1));
    this.build();
    this.go(this.i);
  }

  Player.prototype.build = function () {
    var root = this.root, data = this.data, self = this;
    var W = root.clientWidth && !root.closest('.reveal') ? root.clientWidth : G.W;
    this.H = parseInt(root.dataset.h, 10) || G.H;
    var lab = (root.dataset.labels || 'frames objects').split(/[\s,]+/);
    var dataMode = lab.indexOf('data') >= 0;
    this.namesMode = dataMode || lab.indexOf('names') >= 0;
    this.headNames = HEADS[dataMode ? 'data' : this.namesMode ? 'names' : 'frames'];
    this.valuesWord = dataMode ? 'data' : lab.indexOf('values') >= 0 ? 'values' : 'objects';
    this.headValues = dataMode ? '' : HEADS[this.valuesWord];
    var codeLabel = root.dataset.codeLabel || '';
    var labelH = codeLabel ? 37 : 0;       /* the label over the code panel: 24 px text, 8 px under it */
    /* left column width: the longest code or output line */
    var codeChars = 0, outW = 0, nl = this.lines.length;
    this.lines.forEach(function (l) { codeChars = Math.max(codeChars, l.length); });
    this.steps.forEach(function (s) {
      s.stdout.split('\n').forEach(function (l) { outW = Math.max(outW, l.length * G.out * 0.6 + 42); });
      if (s.exception) outW = Math.max(outW, s.exception.line.length * G.out * 0.6 + 42);
    });
    function codeW(size) { return (Math.max(2, String(nl).length) + codeChars) * size * 0.6 + 16 + 8 + 16 + 12 + 2; }
    this.svgH = this.H - G.barH - G.barGap;
    /* the first arrangement whose picture fits at 1:1: code 26 px then 24 px, normal then compact spacing */
    var sizes = (codeW(G.code) > 620 || nl * G.code * G.codeLH + 30 + labelH > this.H - 230) ? [24] : [G.code, 24];
    var tries = [];
    sizes.forEach(function (sz) { tries.push([sz, 'base'], [sz, 'compact']); });
    sizes.forEach(function (sz) { tries.push([sz, 'below']); });
    var size, leftW, ok = false, best = null;
    for (var t = 0; t < tries.length && !ok; t++) {
      size = tries[t][0];
      this.g = GEOM[tries[t][1]];
      leftW = Math.max(400, Math.min(620, Math.ceil(Math.max(codeW(size), outW))));
      this.rightW = W - leftW - G.colGap;
      ok = this.layoutAll();
      var k = Math.min(1, this.rightW / (this.needW + 4), this.svgH / (this.needH + 4));
      if (!best || k > best.k) best = { k: k, t: t };
    }
    if (!ok && best.t !== tries.length - 1) {
      /* nothing fits at 1:1: the arrangement that needs the least scaling */
      size = tries[best.t][0];
      this.g = GEOM[tries[best.t][1]];
      leftW = Math.max(400, Math.min(620, Math.ceil(Math.max(codeW(size), outW))));
      this.rightW = W - leftW - G.colGap;
      this.layoutAll();
    }
    if (codeW(size) > 620) console.warn('trace ' + data.name + ': a code line is too long for the slide (' + codeChars + ' characters)');
    var lh = size === G.code ? G.codeLH : 1.35;
    this.leftW = leftW;
    root.style.setProperty('--tr-left', leftW + 'px');
    /* output panel: as many rows as the longest output needs, 2 to 6, if the code leaves room. A line longer than the
       panel wraps with a hanging indent (as pre.wrap on the slides) instead of being cut off; its rows are counted */
    var cpr = this.cpr = Math.max(12, Math.floor((leftW - 42) / (G.out * 0.6)));
    var outMax = 1, self2 = this;
    this.steps.forEach(function (s) {
      var k = 0;
      self2.outLinesOf(s).forEach(function (l) { k += rowsOf(l, cpr); });
      outMax = Math.max(outMax, k);
    });
    var codeH = nl * size * lh + 30 + labelH;
    var room = Math.floor((this.H - codeH - G.rowGap - 34 - 26) / (G.out * G.outLH));
    this.outLines = Math.max(2, Math.min(6, outMax, room));

    root.innerHTML = '';
    root.classList.add('is-ready');
    var left = div('trace-left', root);
    var codeBox = left;
    if (codeLabel) {
      codeBox = div('trace-codebox', left);
      var cl = div('trace-label', codeBox); cl.textContent = codeLabel;
    }
    var code = div('trace-code', codeBox);
    code.setAttribute('aria-label', 'Kod');
    this.lineEls = this.lines.map(function (l, k) {
      var row = div('trace-line', code);
      row.innerHTML = '<span class="trace-ln">' + (k + 1) + '</span><span class="trace-src">' + (colour(l) || ' ') + '</span>';
      return row;
    });
    if (size !== G.code) code.classList.add('is-tight');
    var out = div('trace-out', left);
    var olab = div('trace-label', out); olab.textContent = 'Çıktı';
    this.outEl = document.createElement('pre');
    this.outEl.className = 'trace-out-pre';
    this.outEl.style.height = Math.ceil(this.outLines * G.out * G.outLH + 26) + 'px';
    out.appendChild(this.outEl);

    var right = div('trace-right', root);
    var fig = div('trace-fig', right);
    this.svg = el('svg', { 'class': 'dg trace-svg', role: 'img', width: this.rightW, height: this.svgH,
      viewBox: '0 0 ' + this.rightW + ' ' + this.svgH, preserveAspectRatio: 'xMinYMin meet' }, fig);
    var vw = Math.max(this.rightW, this.needW + 4), vh = Math.max(this.svgH, this.needH + 4);
    this.svg.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
    if (!ok) {
      console.warn('trace ' + data.name + ': the picture needs ' + Math.ceil(this.needW) + 'x' + Math.ceil(this.needH) +
        ' px and is scaled down to ' + this.rightW + 'x' + this.svgH + '; shorten the code or pause on fewer names');
    }
    var bar = div('trace-bar', right);
    this.prevBtn = button(bar, 'Önceki adım', 'M17,6 L7,14 L17,22 z');
    this.count = div('trace-count', bar);
    this.count.setAttribute('aria-live', 'polite');
    this.nextBtn = button(bar, 'Sonraki adım', 'M9,6 L19,14 L9,22 z');
    var key = div('trace-key', bar);
    key.innerHTML = '<span class="trace-swatch"></span>bu adımda';
    this.prevBtn.addEventListener('click', function () { self.go(self.i - 1); });
    this.nextBtn.addEventListener('click', function () { self.go(self.i + 1); });
    root.addEventListener('pointerdown', function () { Player.last = self; });
  };
  /* the printed lines of a step, the uncaught error's last line included */
  Player.prototype.outLinesOf = function (s) {
    var t = s.stdout.replace(/\n$/, ''), lines = t ? t.split('\n') : [];
    if (s.exception) lines.push(s.exception.line);
    return lines;
  };
  /* rows a line takes in a panel of cpr characters: wrapped at spaces, continuation rows indented by 2 */
  function rowsOf(line, cpr) {
    if (line.length <= cpr) return 1;
    var r = 1, x = 0, avail = cpr;
    line.split(' ').forEach(function (w, i) {
      var need = (i && x ? 1 : 0) + w.length;
      if (x + need <= avail) { x += need; return; }
      r += 1; avail = cpr - 2; x = w.length;
      while (x > avail) { r += 1; x -= avail; }
    });
    return r;
  }
  function div(cls, parent) { var d = document.createElement('div'); d.className = cls; parent.appendChild(d); return d; }
  function button(parent, label, d) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'trace-btn'; b.setAttribute('aria-label', label); b.title = label;
    b.innerHTML = '<svg width="26" height="28" viewBox="0 0 26 28" aria-hidden="true"><path d="' + d + '"/></svg>';
    parent.appendChild(b);
    return b;
  }

  /* a frame is drawn as a box, except the module's names while "frame" is not taught (data-labels names) */
  Player.prototype.boxed = function (f) { return !(this.namesMode && f.name === '<module>'); };

  /* frame column width and the largest extent over all steps, so the picture never rescales between steps;
     returns whether the picture fits the right column at 1:1 */
  Player.prototype.layoutAll = function () {
    var g = this.g, self = this, fw = 0, tags = 0, anyBox = false;
    this.steps.forEach(function (s) {
      s.frames.forEach(function (f) {
        if (self.boxed(f)) {
          anyBox = true;
          fw = Math.max(fw, g.fMin, f.name === '<module>' ? sansW('Global frame', 600) + 32 : Math.ceil(MONO24 * f.name.length + 32));
          f.vars.forEach(function (v) { fw = Math.max(fw, 2 * g.fIn + tagW(v[0])); });
          if (f.ret) fw = Math.max(fw, 2 * g.fIn + MONO24 * 6);
        } else {
          f.vars.forEach(function (v) { tags = Math.max(tags, tagW(v[0])); });
        }
      });
    });
    /* the names column is at least as wide as its heading, so the two headings never touch */
    this.fw = Math.ceil(Math.max(fw, tags, sansW(this.headNames, 600) + 24 - g.arrow, 64));
    this.ox = 2 + this.fw + g.arrow;
    var needW = 0, needH = 0;
    this.layouts = this.steps.map(function (s) {
      var L = self.layout(s);
      needW = Math.max(needW, L.w); needH = Math.max(needH, L.h);
      return L;
    });
    this.needW = needW; this.needH = needH;
    return needW + 4 <= this.rightW && needH + 4 <= this.svgH;
  };
  function tagW(name) { return Math.max(64, Math.ceil(MONO28 * name.length + 32)); }

  Player.prototype.layout = function (s) {
    var self = this, g = this.g, rows = [], frames = [], pos = {}, y = g.head, objs = s.objects, maxR = this.ox;
    s.frames.forEach(function (f) {
      var boxed = self.boxed(f);
      var list = f.vars.map(function (v) { return { name: v[0], id: v[1] }; });
      if (f.ret) list.push({ name: 'return', id: f.ret, ret: true });
      var top = boxed ? g.fTitle + g.fPad : 0, bot = boxed ? g.fPad : 0;
      var h = list.length ? top + list.length * g.row - (g.row - g.nameH) + bot : (boxed ? g.fTitle : 0);
      var fr = { f: f, y: y, h: h, rows: [], boxed: boxed };
      list.forEach(function (r, k) {
        r.y = y + top + k * g.row;
        r.cy = r.y + g.nameH / 2;
        r.x = boxed ? 2 + g.fIn : 2;
        r.fid = f.id;
        fr.rows.push(r); rows.push(r);
      });
      frames.push(fr);
      if (h) y += h + g.fGap;
    });
    var namesBottom = frames.length ? y - g.fGap : g.head;
    var bottom = g.head;
    var nextY = g.head;
    var order = [];
    function place(id, wantCy, x) {
      if (pos[id] || !objs[id]) return;
      var o = objs[id], m = measure(o, objs, g);
      var top = Math.max(Math.round(wantCy - m.ay), nextY);
      pos[id] = { x: x, y: top, m: m };
      order.push(id);
      nextY = top + m.h + g.objGap;
      bottom = Math.max(bottom, top + m.h);
      maxR = Math.max(maxR, x + m.full);
      children(o, objs).forEach(function (c) { if (!isScalar(objs[c])) place(c, nextY + g.nameH / 2, x + g.indent); });
    }
    rows.forEach(function (r) { place(r.id, r.cy, self.ox); });
    /* A list (or tuple) whose cells point at other collections (ders4-backup: a list of tuples, 2026-10-14): the
       collections it points at go in a column at the left, under the names, without index rows of their own (as in
       the course's drawing of the transcript, ders4-list-of-tuples.svg), with their type tags under them. Each
       arrow runs straight down from its cell's dot and turns left into its collection's right edge, so no arrow
       crosses a box or another arrow; the list keeps its type tag beside it, clear of the arrows. Only when the
       list and those collections are the last things drawn and the column fits left of the first dot. */
    order.forEach(function (pid, k) {
      var o = objs[pid];
      if (!SEQ[o.type]) return;
      var kids = [], seen = {}, firstRef = -1;
      (o.items || []).forEach(function (c, j) {
        if (!objs[c] || isScalar(objs[c])) return;
        if (firstRef < 0) firstRef = j;
        if (!seen[c]) { seen[c] = 1; kids.push(c); }
      });
      var after = order.slice(k + 1);
      if (!kids.length || after.length !== kids.length || !after.every(function (c) { return seen[c]; })) return;
      if (!kids.every(function (c) { return children(objs[c], objs).every(function (cc) { return isScalar(objs[cc]); }); })) return;
      var p = pos[pid], dot0 = p.x + g.pad + p.m.cells.slice(0, firstRef).reduce(function (a, b) { return a + b; }, 0) + p.m.cells[firstRef] / 2;
      var pm = measure(o, objs, g, { tagBelow: false }), ms = {}, colW = 0;
      kids.forEach(function (c) { ms[c] = measure(objs[c], objs, g, { noIdx: true, tagBelow: true }); colW = Math.max(colW, ms[c].full); });
      if (2 + colW + 16 > dot0 - 6 || p.x + pm.full + 4 > self.rightW) return;
      p.m = pm;
      p.stack = true;
      var top = Math.max(namesBottom, p.y + pm.h) + g.objGap;
      kids.forEach(function (c) { pos[c] = { x: 2, y: top, m: ms[c], lane: true }; top += ms[c].h + g.objGap; });
      bottom = g.head; maxR = self.ox;
      Object.keys(pos).forEach(function (id) {
        bottom = Math.max(bottom, pos[id].y + pos[id].m.h);
        maxR = Math.max(maxR, pos[id].x + pos[id].m.full);
      });
    });
    return { frames: frames, rows: rows, pos: pos, w: maxR, h: Math.max(y - g.fGap, bottom) };
  };
  function children(o, objs) {
    if (SEQ[o.type]) return o.items || [];
    if (o.type === 'dict') return (o.items || []).reduce(function (a, p) { return a.concat(p); }, []);
    if (o.attrs) return o.attrs.filter(function (p) { return !isMethod(o, p[1], objs); }).map(function (p) { return p[1]; });
    return [];
  }

  /* ---------- drawing one step ---------- */
  Player.prototype.go = function (i) {
    if (i < 0 || i >= this.n) return;
    this.i = i;
    var s = this.steps[i], prev = i > 0 ? this.steps[i - 1] : null;
    /* code */
    this.lineEls.forEach(function (r, k) {
      r.classList.toggle('is-ran', s.line === k + 1 && !s.exception);
      r.classList.toggle('is-err', s.line === k + 1 && !!s.exception);
    });
    /* output: the last lines that fit the panel's rows, each line a block that wraps with a hanging indent */
    var lines = this.outLinesOf(s), cpr = this.cpr, used = 0, from = lines.length;
    while (from > 0 && used + rowsOf(lines[from - 1], cpr) <= this.outLines) { used += rowsOf(lines[from - 1], cpr); from -= 1; }
    if (from === lines.length && from > 0) from -= 1;
    var nOut = lines.length - (s.exception ? 1 : 0);
    var html = lines.map(function (l, k) {
      return '<span class="tr-ol' + (k >= nOut ? ' tr-err' : '') + '">' + (esc(l) || ' ') + '</span>';
    });
    this.outEl.innerHTML = html.slice(from).join('');
    /* counter and buttons */
    this.count.textContent = 'Adım ' + (i + 1) + ' / ' + this.n;
    this.prevBtn.disabled = i === 0;
    this.nextBtn.disabled = i === this.n - 1;
    this.draw(s, prev, this.layouts[i]);
  };

  Player.prototype.draw = function (s, prev, L) {
    var svg = this.svg, id = this.uid, objs = s.objects, g = this.g;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = el('defs', {}, svg);
    var mk = el('marker', { id: id + '-ah', viewBox: '0 0 12 12', refX: 9, refY: 6, markerWidth: 12, markerHeight: 12,
      markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, defs);
    el('path', { 'class': 'ah', d: 'M0,0 L12,6 L0,12 z' }, mk);
    var vb = svg.getAttribute('viewBox').split(' ');
    el('rect', { 'class': 'bg', width: vb[2], height: vb[3] }, svg);
    var title = el('title', {}, svg);
    title.textContent = this.describe(s);

    /* what changed since the previous step */
    var prevObjs = prev ? prev.objects : {}, prevBind = {};
    if (prev) prev.frames.forEach(function (f) {
      f.vars.forEach(function (v) { prevBind[f.id + ' ' + v[0]] = v[1]; });
      if (f.ret) prevBind[f.id + ' return'] = f.ret;
    });
    var isNew = function (oid) { return !!prev && !prevObjs[oid]; };

    /* headers */
    text(svg, 2, 26, 'lb sub', this.headNames);
    if (this.headValues) text(svg, this.ox, 26, 'lb sub', this.headValues);

    var gBands = el('g', {}, svg), gFrames = el('g', {}, svg), gObjs = el('g', {}, svg), gArrows = el('g', {}, svg);
    var fw = this.fw;
    L.frames.forEach(function (fr) {
      var isMod = fr.f.name === '<module>';
      if (fr.boxed) {
        el('rect', { 'class': isMod ? 'frame' : 'local', x: 2, y: fr.y, width: fw, height: fr.h }, gFrames);
        text(gFrames, 18, fr.y + g.fTitleTy, isMod ? 'lb' : 'cd24 b7', isMod ? 'Global frame' : fr.f.name);
        if (fr.rows.length) el('path', { 'class': 'sep', d: 'M2,' + (fr.y + g.fTitle) + ' H' + (2 + fw) }, gFrames);
      }
      fr.rows.forEach(function (r) {
        if (r.ret) {
          text(gFrames, r.x, r.cy + 8, 'cd24 b7', 'return');
          r.x2 = r.x + MONO24 * 6 + 8;
        } else {
          var w = tagW(r.name);
          el('rect', { 'class': 'name', x: r.x, y: r.y, width: w, height: g.nameH, rx: 6 }, gFrames);
          text(gFrames, r.x + w / 2, r.y + g.nameTy, 'nm mid', r.name);
          r.x2 = r.x + w;
        }
      });
    });

    /* objects */
    var pos = L.pos, cellRefs = [];
    Object.keys(pos).forEach(function (oid) {
      var p = pos[oid], o = objs[oid], m = p.m, tc = tcls(o.type), hl = isNew(oid), po = prevObjs[oid];
      if (isScalar(o)) {
        el('rect', { 'class': (hl ? 'boxhl ' : 'box ') + tc, x: p.x, y: p.y, width: m.w, height: m.h, rx: 6 }, gObjs);
        text(gObjs, p.x + m.w / 2, p.y + g.nameTy, 'cd mid ' + tc, disp(o));
        text(gObjs, p.x + m.w + g.tagGap, p.y + g.nameTy - 2, 'ty ' + tc, o.type);
        return;
      }
      if (SEQ[o.type]) {
        el('rect', { 'class': (hl ? 'boxhl ' : 'box ') + tc, x: p.x, y: p.y, width: m.w, height: m.boxH, rx: 6 }, gObjs);
        var cx = p.x + g.pad;
        (o.items || []).forEach(function (cid, k) {
          var changed = !hl && po && po.items && po.items[k] !== cid;
          drawCell(gObjs, cx, p.y + g.pad, m.cells[k], objs[cid], changed, cid, cellRefs, g);
          /* under a cell whose arrow runs straight down (p.stack), the index sits left of the arrow */
          var ix = p.stack && !isScalar(objs[cid]) ? cx + 12 : cx + m.cells[k] / 2;
          if ((o.type === 'list' || o.type === 'tuple') && !m.noIdx) text(gObjs, ix, p.y + m.boxH + g.idxTy, 'ty mid', String(k));
          cx += m.cells[k];
        });
        if (m.below) text(gObjs, p.x, p.y + m.below + 22, 'ty ' + tc, o.type);
        else text(gObjs, p.x + m.w + g.tagGap, p.y + m.boxH / 2 + 8, 'ty ' + tc, o.type);
        return;
      }
      if (o.type === 'dict') {
        el('rect', { 'class': (hl ? 'boxhl ' : 'box ') + tc, x: p.x, y: p.y, width: m.w, height: m.boxH, rx: 6 }, gObjs);
        var prevMap = {};
        if (po && po.items) po.items.forEach(function (q) { prevMap[q[0]] = q[1]; });
        (o.items || []).forEach(function (q, k) {
          var cy = p.y + g.pad + k * g.cellH, changed = !hl && po && prevMap[q[0]] !== q[1];
          drawCell(gObjs, p.x + g.pad, cy, m.kw, objs[q[0]], false, q[0], cellRefs, g);
          drawCell(gObjs, p.x + g.pad + m.kw, cy, m.vw, objs[q[1]], changed, q[1], cellRefs, g);
        });
        if (m.below) text(gObjs, p.x, p.y + m.below + 22, 'ty ' + tc, 'dict');
        else text(gObjs, p.x + m.w + g.tagGap, p.y + g.pad + g.cellH / 2 + 8, 'ty ' + tc, 'dict');
        return;
      }
      if (o.attrs) {
        el('rect', { 'class': hl ? 'boxhl' : 'box', x: p.x, y: p.y, width: m.w, height: m.h, rx: 6 }, gObjs);
        text(gObjs, p.x + 16, p.y + g.fTitleTy - 2, 'cd24 b7', m.head);
        if (o.attrs.length) el('path', { 'class': 'sep', d: 'M' + p.x + ',' + (p.y + g.fTitle - 4) + ' H' + (p.x + m.w) }, gObjs);
        var pm = {};
        if (po && po.attrs) po.attrs.forEach(function (q) { pm[q[0]] = q[1]; });
        o.attrs.forEach(function (q, k) {
          var ry = p.y + g.fTitle + k * g.cellH;
          if (isMethod(o, q[1], objs)) { text(gObjs, p.x + 16, ry + g.cellTy, 'cd24', q[0] + '()'); return; }
          text(gObjs, p.x + 16, ry + g.cellTy, 'cd24', q[0]);
          drawCell(gObjs, p.x + m.w - g.pad - m.cw, ry, m.cw, objs[q[1]], !hl && po && pm[q[0]] !== q[1], q[1], cellRefs, g);
        });
        return;
      }
      el('rect', { 'class': hl ? 'boxhl' : 'box', x: p.x, y: p.y, width: m.w, height: m.h, rx: 6 }, gObjs);
      text(gObjs, p.x + m.w / 2, p.y + g.nameTy - 2, 'cd24 mid', disp(o));
    });

    /* arrows from names; a new arrow to a value that already existed gets a highlight band */
    L.rows.forEach(function (r) {
      var p = pos[r.id];
      if (!p) return;
      var x1 = r.x2, y1 = r.cy, x2 = p.x - 3;
      var y2 = Math.max(p.y + 16, Math.min(p.y + (p.m.boxH || p.m.h) - 16, y1));
      if (Math.abs(y2 - (p.y + p.m.ay)) < 24 && Math.abs(y1 - (p.y + p.m.ay)) < 24) y2 = y1;
      var key = r.fid + ' ' + r.name;
      if (prev && prevBind[key] !== r.id && !isNew(r.id)) band(gBands, x1, y1, x2, y2);
      el('path', { 'class': 'ar', d: 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2, 'marker-end': 'url(#' + id + '-ah)' }, gArrows);
    });
    /* arrows from reference cells */
    cellRefs.forEach(function (c) {
      var p = pos[c.id];
      if (!p) return;
      el('circle', { 'class': 'dot', cx: c.x, cy: c.y, r: 6 }, gArrows);
      var d = p.lane ? 'M' + c.x + ',' + c.y + ' V' + (p.y + p.m.ay) + ' H' + (p.x + p.m.w + 3)
        : 'M' + c.x + ',' + c.y + ' L' + (p.x + 12) + ',' + (p.y - 3);
      el('path', { 'class': 'ar', d: d, 'marker-end': 'url(#' + id + '-ah)' }, gArrows);
    });
  };

  function drawCell(gr, x, y, w, o, changed, cid, refs, g) {
    var tc = o ? tcls(o.type) : '';
    if (isScalar(o)) {
      el('rect', { 'class': (changed ? 'cellhl ' : 'cell ') + tc, x: x, y: y, width: w, height: g.cellH }, gr);
      text(gr, x + w / 2, y + g.cellTy, 'cd24 mid ' + tc, disp(o));
    } else {
      el('rect', { 'class': changed ? 'cellhl' : 'cell', x: x, y: y, width: w, height: g.cellH }, gr);
      refs.push({ x: x + w / 2, y: y + g.cellH / 2, id: cid });
    }
  }
  function band(gr, x1, y1, x2, y2) {
    var len = Math.hypot(x2 - x1, y2 - y1) - 16, ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    if (len < 20) return;
    el('rect', { 'class': 'boxhl', x: x1, y: y1 - 13, width: len, height: 26, rx: 4,
      transform: 'rotate(' + ang.toFixed(2) + ' ' + x1 + ' ' + y1 + ')' }, gr);
  }

  /* Turkish alt text for the picture of one step, in the words of the column headings */
  Player.prototype.describe = function (s) {
    var objs = s.objects, parts = [], self = this;
    var what = this.valuesWord === 'values' ? " value'sunu gösterir" : " object'ini gösterir";
    var data = this.valuesWord === 'data';
    s.frames.forEach(function (f) {
      var names = f.vars.map(function (v) { return data ? v[0] + ' ismi: ' + say(objs[v[1]], objs) : v[0] + ' ismi ' + say(objs[v[1]], objs) + what; });
      if (f.ret) names.push('dönüş değeri ' + say(objs[f.ret], objs));
      var head = !self.boxed(f) ? self.headNames : (f.name === '<module>' ? 'Global frame' : f.name + ' frame');
      parts.push(head + ': ' + (names.length ? names.join('; ') : 'boş'));
    });
    var head = 'Adım ' + (this.i + 1) + ' / ' + this.n + '. ' + (s.line ? s.line + '. satır çalıştı. ' : 'Henüz hiçbir satır çalışmadı. ');
    return head + parts.join('. ') + '.';
  };
  function say(o, objs) {
    if (!o) return '?';
    if (isScalar(o)) return o.type + ' ' + disp(o);
    if (SEQ[o.type]) return o.type + ' [' + o.items.map(function (c) { return isScalar(objs[c]) ? disp(objs[c]) : objs[c] ? objs[c].type : '?'; }).join(', ') + ']';
    if (o.type === 'dict') return 'dict, ' + o.items.length + ' çift';
    return disp(o);
  }

  /* ---------- loading ---------- */
  function load(src) {
    var name = src.replace(/^.*\//, '').replace(/\.json$/, '');
    window.TRACE_DATA = window.TRACE_DATA || {};
    if (window.TRACE_DATA[name]) return Promise.resolve(window.TRACE_DATA[name]);
    if (!loading[src]) {
      loading[src] = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = src.replace(/\.json$/, '.js');
        sc.onload = function () { window.TRACE_DATA[name] ? resolve(window.TRACE_DATA[name]) : reject(new Error('no data in ' + sc.src)); };
        sc.onerror = function () {
          fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + src); return r.json(); }).then(resolve, reject);
        };
        document.head.appendChild(sc);
      });
    }
    return loading[src];
  }

  function init() {
    var nodes = document.querySelectorAll('.trace[data-trace]');
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.traceInit) return;
      node.dataset.traceInit = '1';
      Promise.all([load(node.dataset.trace), fonts]).then(function (r) {
        players.push(new Player(node, r[0]));
      }).catch(function (e) {
        node.classList.add('is-failed');
        node.textContent = 'İz yüklenemedi: ' + node.dataset.trace;
        console.error(e);
      });
    });
  }

  function current() {
    var slide = window.Reveal && Reveal.getCurrentSlide ? Reveal.getCurrentSlide() : null;
    if (slide) {
      for (var k = 0; k < players.length; k++) if (slide.contains(players[k].root)) return players[k];
      return null;
    }
    if (Player.last) return Player.last;
    for (var j = 0; j < players.length; j++) {
      var b = players[j].root.getBoundingClientRect();
      if (b.bottom > 0 && b.top < innerHeight) return players[j];
    }
    return null;
  }
  /* capture phase on window: runs before reveal's keydown handler on document, so "." does not pause */
  window.addEventListener('keydown', function (e) {
    if (e.key !== '.' && e.key !== ',') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    var p = current();
    if (!p) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    p.go(p.i + (e.key === '.' ? 1 : -1));
  }, true);

  window.TracePlayer = { init: init, players: players };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
