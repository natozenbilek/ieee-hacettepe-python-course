/* Canlı oylama: reveal.js plugin (authoring/POLLS.md). Global RevealPoll.
   Load order in a deck: poll-config.js, vendor/qrcode-generator/qrcode.js, poll-backend.js, poll.js;
   then plugins: [RevealHighlight, RevealNotes, RevealPoll].

   Slide markup (the poll contract; the layout wrappers are those of slides.css, SPEC.md §6):
     <section class="s-poll" data-poll-id="d<N>-<slug>" data-answer="<1-4>">
       <h2>Python ne yazdırır?</h2>
       <div class="content l-poll">
         <div class="col">
           <pre><code class="language-python" data-trim>…</code></pre>
           <ol class="poll-opts"><li data-n="1">…</li> … <li data-n="4">…</li></ol>
           <p class="poll-why" hidden>reason</p>
         </div>
         <div class="poll-side"><div class="poll-qr"></div><div class="poll-count"></div><div class="poll-bars" hidden></div></div>
       </div>
     </section>
   poll.js finds the parts by class anywhere inside the section, so it does not depend on the wrappers.
   Optional: data-result="a,b,c,d" freezes a recorded distribution for the PDF when no server answers.

   Flow, like Kahoot, driven by reveal's own "next" (Right, Space, Page Down, a presenter clicker):
     arriving   the question and the options only. The QR box is empty (three faint corner squares), the
                count is blank, the poll stays closed.
     next       the QR appears and the poll opens (15 minutes at most); the live count "N cevap" runs.
     next       the poll closes, the bars grow to their values, the correct option is marked and .poll-why
                shows: results and answer in one press.
     next       the next slide. Leaving the slide closes an open poll.
   The two steps are invisible reveal fragments (span.fragment.poll-step, display:none) that poll.js appends
   to each section.s-poll at init (in the speaker view's frames: at the first state the speaker view sends);
   fragmentshown, fragmenthidden and slidechanged drive the poll, so "previous" walks back: from the results
   to the QR (results hidden), then to the empty box (an open poll closes).
   A poll whose answer was shown is not opened again until the page is reloaded: back from the results, the
   QR is dimmed and the count reads "N cevap, kapalı". Arriving on the QR or the results step of a poll whose
   answer this page has not shown (back from the next slide after a jump, a reload or a URL with the step in
   it, the speaker view) starts it from the question: nothing opens and no answer shows without a press.
   Keys, as manual overrides at any step: D removes (or puts back) the hidden attribute of .poll-bars and the
   bars grow to their values; C does the same for .poll-why, adds .show-answer, which marks the correct option,
   and closes the poll. While a poll is closed the count reads "N cevap, kapalı" and the QR is dimmed. The
   count is laid out in fixed slots (number, "cevap", ", kapalı"), so nothing in it moves when the poll closes.
   Firebase mode: only a browser tab with the instructor key opens and closes polls. Shift+K opens a small
   instructor panel (outside the slides) where the key is typed; it is kept in sessionStorage, i.e. in this
   tab only, until the tab is closed.
   Without a key the deck only reads: the QR, the live count and the open or closed state.
   ?print-pdf and ?final show every step: the QR, the answer and the distribution.
   Offline: the QR still shows, the count reads "çevrimdışı", and the class votes with fingers.
   A poll id outside d1-d5, which the database refuses, reads "geçersiz soru kimliği" on the slide. */
(function () {
  'use strict';

  var KEY_C = 67, KEY_D = 68;
  var STEPS = 2;                 /* fragments per poll slide: 1 QR and open, 2 results and answer */
  var EXPECT_MS = 5000;          /* how long the slide trusts its own open or close before the stream confirms it */
  var PANEL_TEXT = {
    none: 'Bu sekmede kayıtlı anahtar yok. Slaytlar oylamayı yalnızca izler, soruyu açmaz.',
    stored: 'Anahtar bu sekmede kayıtlı. Soru slaytında bir kez ileri basınca QR çıkar ve oylama 15 dakikalığına açılır.',
    saved: 'Anahtar kaydedildi. Soru slaytında ileri basınca QR çıkar ve oylama açılır.',
    opened: 'Anahtar kaydedildi ve bu soru oylamaya açıldı.',
    denied: 'Veritabanı anahtarı kabul etmedi. Anahtarı kontrol edip yeniden kaydedin.',
    badid: 'Bu sorunun kimliği d1 ile d5 arasındaki bir dersle başlamıyor; veritabanı bu soruyu kabul etmez. Slayttaki data-poll-id değerini düzeltin.',
    offline: 'Veritabanına ulaşılamadı. Bağlantıyı kontrol edin.',
    removed: 'Anahtar silindi. Slaytlar oylamayı yalnızca izler.',
    blocked: 'Tarayıcı anahtarı saklayamadı. Tarayıcının site verisi ayarlarını kontrol edin.',
    local: 'Yerel denemede anahtar gerekmez. Soruyu tools/poll_server.py açar ve kapatır.'
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function svgBox(size) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('shape-rendering', 'crispEdges');
    return svg;
  }

  /* QR as one SVG path, drawn from qrcode-generator's module matrix; 2-module margin inside the white .poll-qr box. */
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return null;
    var qr = window.qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount(), m = 2, d = '', r, c;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    var svg = svgBox(n + 2 * m);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cevap sayfasının QR kodu: ' + text);
    svg.setAttribute('data-url', text);
    var bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', n + 2 * m); bg.setAttribute('height', n + 2 * m); bg.setAttribute('fill', '#FFFFFF');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#14172E');
    svg.appendChild(bg); svg.appendChild(p);
    svg.n = n;
    return svg;
  }

  /* The empty QR box before the first press: only the three corner squares of a QR of n modules, faint, at the
     places where the real ones will appear. Not scannable; hidden from screen readers. It lies over the content
     box of .poll-qr (border 1 + padding 8, slides.css), so swapping it with the QR moves nothing. */
  function qrGhost(n) {
    var m = 2, d = '';
    [[m, m], [m + n - 7, m], [m, m + n - 7]].forEach(function (o) {
      var x = o[0], y = o[1];
      d += 'M' + x + ' ' + y + 'h7v7h-7z' + 'M' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5z' + 'M' + (x + 2) + ' ' + (y + 2) + 'h3v3h-3z';
    });
    var svg = svgBox(n + 2 * m);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'poll-qr-ghost');
    svg.style.cssText = 'position:absolute;left:8px;top:8px;width:calc(100% - 16px);height:calc(100% - 16px)';
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#DCDFE8');
    svg.appendChild(p);
    return svg;
  }

  function parseResult(s) {
    if (!s) return null;
    var a = String(s).split(',').map(function (x) { return parseInt(x, 10); });
    if (a.length !== 4 || a.some(function (x) { return !(x >= 0); })) return null;
    return a;
  }

  window.RevealPoll = {
    id: 'poll',
    init: function (deck) {
      var q = new URLSearchParams(location.search);
      var printing = /print-pdf/.test(location.search) || (deck.isPrintView && deck.isPrintView());
      var showAll = printing || q.has('final');
      var receiver = q.has('receiver');
      /* The speaker view's iframes (?receiver) and review renders (?final, ?print-pdf) never open or close a poll. */
      var drives = !showAll && !receiver;
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var backend = window.PollBackend ? window.PollBackend.create(window.POLL_CONFIG) : null;
      var polls = [];
      var current = null;

      /* the steps: invisible fragments at the end of the section, after any fragment the slide has */
      function addSteps(p) {
        if (p.marks.length) return;
        for (var s = 1; s <= STEPS; s++) {
          var mark = el('span', 'fragment poll-step');
          mark.setAttribute('data-poll-step', String(s));
          mark.setAttribute('aria-hidden', 'true');
          mark.style.display = 'none';
          p.sec.appendChild(mark);
          p.marks.push(mark);
        }
      }

      function setup(sec) {
        var p = {
          sec: sec,
          id: sec.getAttribute('data-poll-id'),
          answer: parseInt(sec.getAttribute('data-answer'), 10),
          counts: [0, 0, 0, 0], total: 0, status: 'idle', unsub: null, shown: [0, 0, 0, 0],
          open: null,
          answered: false,   /* the answer was shown in this page (second press or C); the poll is not opened again */
          step: null,        /* the step shown while this slide is current: 0, 1 or 2; null when not current */
          opened: false,     /* this tab opened the poll and has not closed it */
          expect: null, expectTimer: null, ctl: null,
          qr: sec.querySelector('.poll-qr'),
          count: sec.querySelector('.poll-count'),
          bars: sec.querySelector('.poll-bars'),
          why: sec.querySelector('.poll-why'),
          code: null, ghost: null,
          marks: [],
          rows: []
        };
        /* bars: <div class="pb" data-n="1"><span class="pb-fill" style="width:40%"></span><span class="pb-v">12</span></div> */
        if (p.bars) {
          p.bars.textContent = '';
          p.bars.setAttribute('role', 'group');
          p.bars.setAttribute('aria-label', 'Cevap dağılımı');
          for (var i = 1; i <= 4; i++) {
            var row = el('div', 'pb');
            row.setAttribute('data-n', String(i));
            var fill = el('span', 'pb-fill');
            fill.style.width = '0%';
            var num = el('span', 'pb-v', '0');
            row.appendChild(fill); row.appendChild(num);
            p.bars.appendChild(row);
            p.rows.push({ row: row, fill: fill, num: num });
          }
        }
        /* the speaker view's frames get their steps later (see stepsOnFirstState) */
        if (!showAll && !receiver) addSteps(p);
        if (p.count) p.count.setAttribute('role', 'status');
        if (p.qr) {
          p.qr.textContent = '';
          p.qr.style.position = 'relative';
          p.ghost = qrGhost(33);
          p.qr.appendChild(p.ghost);
        }
        renderCount(p);
        if (p.qr && backend) {
          backend.answerBase().then(function (base) {
            var url = backend.answerUrl(base, p.id), node;
            /* a phone cannot open a file:// address; such a QR would only mislead */
            if (/^file:/.test(url)) node = el('span', 'poll-qr-none', 'QR yok: cevap sayfasının adresi yerel bir dosya.');
            else node = qrSvg(url);
            if (!node) return;
            if (node.n && node.n !== 33) {
              var g = qrGhost(node.n);
              p.qr.replaceChild(g, p.ghost);
              p.ghost = g;
            }
            if (p.code) p.qr.removeChild(p.code);
            p.code = node;
            p.qr.appendChild(node);
            renderCount(p);
          });
        }
        return p;
      }

      /* The step the slide's fragments show: 0 before the first press, 1 the QR, 2 the results. */
      function stepOf(p) {
        var s = 0;
        p.marks.forEach(function (m, i) { if (m.classList.contains('visible')) s = i + 1; });
        return s;
      }

      /* Open or closed as the slide shows it: what this tab has just asked for, until the stream confirms it
         (so the QR does not flash dimmed while the open write travels), else what the stream reports. */
      function isOpenNow(p) { return p.expect !== null ? p.expect : p.open; }

      /* "N cevap", or "N cevap, kapalı" with a dimmed QR while the poll does not take votes
         (not in the review renders ?final and ?print-pdf). Three fixed slots: the number (right-aligned in a
         box three digits wide), " cevap" and ", kapalı", which keeps its space while the poll is open, so the
         count never moves when the poll closes or the number gains a digit.
         Before the first press the QR box shows only its faint corners and the count is blank. Both are hidden
         with visibility, never removed or resized, so every box keeps its place between the steps. The count
         is never .is-closed while it is blank: slides.css makes ", kapalı" visible inside a closed count. */
      function renderCount(p) {
        var down = p.status === 'offline' || p.status === 'badid';
        var waiting = !showAll && !(p.step >= 1);
        var closed = !showAll && !waiting && !down && isOpenNow(p) === false;
        if (p.qr) {
          var showCode = !waiting && !!p.code;
          if (p.code) p.code.style.visibility = showCode ? '' : 'hidden';
          if (p.ghost) p.ghost.style.visibility = showCode ? 'hidden' : '';
          p.qr.style.opacity = closed && showCode ? '0.35' : '';
        }
        if (!p.count) return;
        p.count.style.visibility = waiting ? 'hidden' : '';
        p.count.classList.toggle('is-offline', down);
        p.count.classList.toggle('is-closed', closed);
        p.count.textContent = '';
        if (down) { p.count.appendChild(el('span', 'pc-msg', p.status === 'badid' ? 'geçersiz soru kimliği' : 'çevrimdışı')); return; }
        p.count.appendChild(el('b', 'pc-n', String(p.total)));
        p.count.appendChild(el('span', 'pc-word', ' cevap'));
        p.count.appendChild(el('span', 'pc-state', ', kapalı'));
      }

      function renderBars(p, animate) {
        var visible = p.bars && !p.bars.hidden;
        /* the longest bar fills its column (Kahoot-like, readable from the back row); the counts give the numbers */
        var max = Math.max.apply(null, p.rows.map(function (r, i) { return p.counts[i] || 0; }));
        p.rows.forEach(function (r, i) {
          var c = p.counts[i] || 0;
          var pct = p.total ? Math.round(100 * c / p.total) : 0;
          var f = max ? 100 * c / max : 0;
          r.num.textContent = String(c);
          r.row.setAttribute('aria-label', 'ABCD'.charAt(i) + ': ' + c + ' cevap, yüzde ' + pct);
          var from = animate ? 0 : p.shown[i];
          r.fill.style.width = f + '%';
          if (visible && !printing && !reduceMotion && r.fill.animate && from !== f) {
            r.fill.animate([{ width: from + '%' }, { width: f + '%' }], { duration: 500, easing: 'cubic-bezier(.2,.7,.3,1)' });
          }
          p.shown[i] = f;
        });
      }

      function onCounts(p) {
        return function (counts, total, info) {
          if (!counts || counts.length !== 4) return;
          if (info && typeof info.open === 'boolean') {
            p.open = info.open;
            if (p.expect === info.open) { p.expect = null; clearTimeout(p.expectTimer); }
          }
          p.counts = counts.slice(0, 4);
          p.total = typeof total === 'number' ? total : p.counts.reduce(function (a, b) { return a + b; }, 0);
          p.status = 'online';
          renderCount(p);
          renderBars(p, false);
        };
      }

      function onStatus(p) {
        return function (s) {
          if (s === p.status) return;
          p.status = s;
          renderCount(p);
        };
      }

      function setDist(p, on) {
        p.sec.classList.toggle('show-dist', on);
        if (p.bars) p.bars.hidden = !on;
        if (on) renderBars(p, true);
      }

      /* Showing the answer closes the poll: nobody votes after seeing it. */
      function setAnswer(p, on) {
        p.sec.classList.toggle('show-answer', on);
        if (p.why) p.why.hidden = !on;
        if (on && !showAll && !p.answered) {
          p.answered = true;
          if (p.opened || p.open !== false) closePoll(p);
        }
      }

      var lastResult = null;
      function report(r) { if (r && !r.nokey) lastResult = r; return r; }

      /* One open or close at a time per poll, so a quick next and previous cannot arrive out of order. */
      function control(p, fn) {
        function run() { return fn().then(report); }
        p.ctl = (p.ctl || Promise.resolve()).then(run, run);
        return p.ctl;
      }

      function expect(p, open) {
        p.expect = open;
        clearTimeout(p.expectTimer);
        p.expectTimer = setTimeout(function () { p.expect = null; renderCount(p); }, EXPECT_MS);
        renderCount(p);
      }

      /* a refused or failed request: the slide shows what the stream reports */
      function settle(p, r, wanted) {
        if (r && r.ok) return;
        if (p.expect === wanted) { p.expect = null; clearTimeout(p.expectTimer); renderCount(p); }
      }

      function openPoll(p) {
        if (!drives || !backend || p.answered) return Promise.resolve(null);
        p.opened = true;
        expect(p, true);
        return control(p, function () { return backend.open(p.id); })
          .then(function (r) { settle(p, r, true); return r; });
      }

      function closePoll(p) {
        if (!drives || !backend) return;
        p.opened = false;
        expect(p, false);
        control(p, function () { return backend.close(p.id); })
          .then(function (r) { settle(p, r, false); });
      }

      /* Bring the slide to the step its fragments show. Going forward from the empty box to the QR keeps what
         D or C showed; arriving, going back from the results and going back to the empty box hide both. */
      function applyStep(p) {
        if (!p || showAll) return;
        var s = stepOf(p), prev = p.step;
        if (s === prev) return;
        if (prev === null && s >= 1 && !p.answered && drives) {
          /* Arriving on a later step of a poll whose answer this page has not shown (back from the next slide
             after a jump, a reload or a link with the step in the URL, the speaker view): start from the question.
             The next press opens the poll; nothing opens and no answer shows without a press on this slide. */
          setTimeout(function () {
            if (current !== p || p.step !== null || deck.getCurrentSlide() !== p.sec || stepOf(p) < 1) return;
            var ix = deck.getIndices();
            deck.slide(ix.h, ix.v, -1);
            applyStep(p);
          }, 0);
          return;
        }
        p.step = s;
        if (s === STEPS) {
          if (!p.sec.classList.contains('show-dist')) setDist(p, true);
          setAnswer(p, true);
        } else {
          if (prev === null || prev === STEPS || s === 0) { setDist(p, false); setAnswer(p, false); }
          if (s === 1) openPoll(p);
          else if (p.opened) closePoll(p);
        }
        renderCount(p);
      }

      function enter(p) {
        if (!p) return;
        if (backend && !p.unsub) p.unsub = backend.subscribe(p.id, onCounts(p), onStatus(p));
      }

      function leave(p) {
        if (!p) return;
        if (p.unsub) { p.unsub(); p.unsub = null; }
        if (p.opened && !p.answered) closePoll(p);
        p.step = null;
        renderCount(p);
      }

      function pollOf(slide) {
        for (var i = 0; i < polls.length; i++) if (polls[i].sec === slide) return polls[i];
        return null;
      }

      function follow(slide) {
        var next = pollOf(slide);
        if (next !== current) {
          leave(current);
          current = next;
          enter(current);
        }
        applyStep(current);
      }

      function sync() { follow(deck.getCurrentSlide()); }

      polls = Array.prototype.map.call(
        deck.getSlidesElement().querySelectorAll('section.s-poll[data-poll-id]'), setup);
      /* a deck that registers the plugin after it started has to index the new fragments */
      if (!showAll && !receiver && polls.length && deck.isReady && deck.isReady() && deck.sync) deck.sync();
      if (!showAll && receiver && polls.length) stepsOnFirstState();

      /* The speaker view (S) loads its current-slide frame at the main window's slide with no step, and sends
         that frame's first slidechanged back to the main window as a setState. With the steps already in the
         frame, that state would carry indexf -1 and take a poll on screen back to the question, closing it.
         So the speaker view's frames get their steps from the first state the speaker view sends them, just
         before reveal applies it: this listener runs first (capture phase, and added before reveal starts). */
      function stepsOnFirstState() {
        function onMessage(e) {
          if (typeof e.data !== 'string' || e.data.indexOf('setState') < 0 || !(deck.isReady && deck.isReady())) return;
          var m = null;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (!m || m.method !== 'setState') return;
          window.removeEventListener('message', onMessage, true);
          polls.forEach(addSteps);
        }
        window.addEventListener('message', onMessage, true);
      }

      if (showAll) {
        polls.forEach(function (p) {
          var frozen = parseResult(p.sec.getAttribute('data-result'));
          if (frozen) onCounts(p)(frozen, frozen[0] + frozen[1] + frozen[2] + frozen[3]);
          else { p.status = 'online'; renderCount(p); }
          setDist(p, true);
          setAnswer(p, true);
          /* a running server fills in the recorded counts; one message, then the stream is closed */
          if (!frozen && backend) {
            var stop = backend.subscribe(p.id, function (c, t, info) {
              if (info && info.loaded === false) return;
              onCounts(p)(c, t);
              if (stop) { stop(); stop = null; }
            }, function () {});
          }
        });
        if (!q.has('final')) return;
      }

      deck.addKeyBinding({ keyCode: KEY_D, key: 'D', description: 'Oylama: dağılımı göster ya da gizle' }, function () {
        var p = pollOf(deck.getCurrentSlide());
        if (p) setDist(p, !p.sec.classList.contains('show-dist'));
      });
      deck.addKeyBinding({ keyCode: KEY_C, key: 'C', description: 'Oylama: doğru cevabı ve nedenini göster' }, function () {
        var p = pollOf(deck.getCurrentSlide());
        if (p) setAnswer(p, !p.sec.classList.contains('show-answer'));
      });

      deck.on('ready', sync);
      deck.on('slidechanged', sync);
      deck.on('fragmentshown', sync);
      deck.on('fragmenthidden', sync);
      if (deck.isReady && deck.isReady()) sync();
      window.addEventListener('pagehide', function () {
        if (current && backend && drives && current.opened && !current.answered) backend.close(current.id, true);
      });
      window.addEventListener('pageshow', function (e) {
        if (e.persisted && current && current.step === 1) openPoll(current);
      });
      if (drives && backend) instructorPanel();

      /* Shift+K: the instructor panel, outside .reveal so it is not scaled with the slides. */
      function instructorPanel() {
        var panel = null, input = null, msg = null;
        var css = 'position:fixed;right:16px;bottom:16px;z-index:100;width:360px;box-sizing:border-box;padding:16px;' +
          'background:#FFFFFF;color:#14172E;border:2px solid #3B4595;border-radius:6px;' +
          'font:400 16px/1.45 "Atkinson Hyperlegible Next","Segoe UI",Arial,sans-serif;text-align:left';
        var btnCss = 'font:600 15px/1 "Atkinson Hyperlegible Next","Segoe UI",Arial,sans-serif;padding:8px 12px;margin:0 8px 0 0;border:2px solid #3B4595;' +
          'border-radius:4px;background:#FFFFFF;color:#3B4595;cursor:pointer';

        function say(t) { msg.textContent = t; }
        function status() {
          if (backend.mode !== 'firebase') return PANEL_TEXT.local;
          if (current && !window.PollBackend.validPollId(current.id)) return PANEL_TEXT.badid;
          if (lastResult && lastResult.denied) return PANEL_TEXT.denied;
          return window.PollBackend.instructorKey() ? PANEL_TEXT.stored : PANEL_TEXT.none;
        }
        function button(text, fn) {
          var b = el('button', null, text);
          b.type = 'button';
          b.style.cssText = btnCss;
          b.addEventListener('click', fn);
          return b;
        }
        function save() {
          var k = input.value.trim();
          if (!k) { input.focus(); return; }
          if (!window.PollBackend.setInstructorKey(k)) { say(PANEL_TEXT.blocked); return; }
          input.value = '';
          lastResult = null;
          /* only a poll whose QR is on screen is opened now; otherwise the next press opens it */
          if (!current || current.answered || current.step !== 1) { say(PANEL_TEXT.saved); return; }
          say(' ');
          openPoll(current).then(function (r) {
            if (!r) say(PANEL_TEXT.saved);
            else if (r.ok) say(PANEL_TEXT.opened);
            else say(r.badid ? PANEL_TEXT.badid : r.denied ? PANEL_TEXT.denied : PANEL_TEXT.offline);
          });
        }
        function build() {
          panel = el('div');
          panel.setAttribute('role', 'dialog');
          panel.setAttribute('aria-label', 'Eğitmen anahtarı');
          panel.style.cssText = css;
          panel.hidden = true;
          var h = el('p', null, 'Eğitmen anahtarı');
          h.style.cssText = 'margin:0 0 8px;font-weight:700;color:#181C3E';
          msg = el('p');
          msg.setAttribute('role', 'status');
          msg.style.cssText = 'margin:0 0 12px;min-height:2.9em';
          panel.appendChild(h);
          panel.appendChild(msg);
          if (backend.mode === 'firebase') {
            input = el('input');
            input.type = 'password';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.setAttribute('aria-label', 'Eğitmen anahtarı');
            input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0 0 12px;padding:8px;' +
              'border:2px solid #C9CDDA;border-radius:4px;font:400 16px/1.3 "JetBrains Mono",Menlo,monospace';
            input.addEventListener('keydown', function (e) {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
            });
            panel.appendChild(input);
            panel.appendChild(button('Kaydet', save));
            panel.appendChild(button('Sil', function () {
              window.PollBackend.setInstructorKey('');
              lastResult = null;
              say(PANEL_TEXT.removed);
            }));
          }
          panel.appendChild(button('Kapat', toggle));
          document.body.appendChild(panel);
        }
        function toggle() {
          if (!panel) build();
          panel.hidden = !panel.hidden;
          if (panel.hidden) { if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur(); return; }
          say(status());
          if (input) input.focus();
        }
        window.addEventListener('keydown', function (e) {
          var t = e.target, typing = t && /^(input|textarea|select)$/i.test(t.tagName || '');
          if (e.key === 'Escape' && panel && !panel.hidden) {
            e.preventDefault(); e.stopImmediatePropagation(); toggle(); return;
          }
          if (typing || e.ctrlKey || e.metaKey || e.altKey || !e.shiftKey) return;
          if (e.keyCode === 75 || e.key === 'K' || e.key === 'k') {
            e.preventDefault(); e.stopImmediatePropagation(); toggle();
          }
        }, true);
      }
    }
  };
})();
