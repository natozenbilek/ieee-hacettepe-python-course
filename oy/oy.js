/* Cevap sayfası (site/oy/index.html?p=<soru kimliği>), authoring/POLLS.md.
   Option texts come from ../slides/polls-dersN.json: { "<poll id>": [option 1, option 2, option 3, option 4] },
   each option {"code": "..."} (program output, monospace) or {"text": "..."} (an outcome such as "Hata verir");
   a plain string counts as text. Without the file the buttons show only 1-4.
   The demo deck's polls (slug "deneme-...") read ../slides/polls-ders0.json.
   Open or closed: the page follows the poll's state (backend.watchOpen). A vote the database refuses
   means the poll has closed; the page then says so plainly and keeps the last accepted answer.
   Once a poll that was opened has closed (until in the past; null means never opened), the page shows the
   answer in its own colour, the reason from the same JSON file and, if this phone voted, whether it was right
   (Nezih, 2026-10-15). The answer and the reason are public in the deck anyway. */
(function () {
  'use strict';

  var pid = new URLSearchParams(location.search).get('p') || '';
  var btns = Array.prototype.slice.call(document.querySelectorAll('.oy-btn'));
  var durum = document.getElementById('durum');
  var not = document.getElementById('not');
  var dersEl = document.getElementById('ders');
  var VOTE_KEY = 'ieee-python-poll-vote:' + pid;
  var cevap = document.getElementById('cevap');
  var chosen = 0, isOpen = true, busy = false;
  var answer = 0, why = '', revealed = false, pending = false;
  function letter(n) { return 'ABCD'.charAt(n - 1); }

  function say(text, kind) {
    durum.textContent = text || ' ';
    durum.classList.toggle('is-ok', kind === 'ok');
    durum.classList.toggle('is-err', kind === 'err');
  }

  function mark(n) {
    chosen = n;
    btns.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-n') === n)); });
  }

  function setOpen(open) {
    isOpen = open;
    btns.forEach(function (b) { b.disabled = !open; });
    not.classList.toggle('is-on', open && chosen > 0);
    if (!open && revealed) return;
    if (!open) say('Bu soru şu an oylamaya kapalı.');
    else if (chosen) say('Cevabınız: ' + 'ABCD'.charAt(chosen - 1) + '.', 'ok');
    else say('');
  }

  function remember(n) { try { localStorage.setItem(VOTE_KEY, String(n)); } catch (e) { /* page lifetime only */ } }
  function recall() {
    try { var n = parseInt(localStorage.getItem(VOTE_KEY), 10); return n >= 1 && n <= 4 ? n : 0; } catch (e) { return 0; }
  }

  /* The answer: the right option in its colour with a tick, a wrong pick of this phone with a cross, the rest
     faded; the reason under the buttons. Waits for the JSON file when the closed state arrives first. */
  function reveal() {
    if (!answer) { pending = true; return; }
    revealed = true; pending = false;
    btns.forEach(function (b) {
      var n = +b.getAttribute('data-n');
      b.disabled = true;
      b.classList.toggle('is-right', n === answer);
      b.classList.toggle('is-wrong', n === chosen && n !== answer);
      b.classList.toggle('is-dim', n !== answer && n !== chosen);
    });
    not.classList.remove('is-on');
    say('');
    /* the big line at the top (Nezih, 2026-10-15: "tebrikler doğru bildin ... yanlış diye titreşimli"); vibration
       works on Android browsers, not on iPhones; it follows a tap on a vote, which browsers require */
    var sonuc = document.getElementById('sonuc'), right = chosen === answer;
    sonuc.className = 'oy-sonuc' + (chosen ? (right ? ' is-ok' : ' is-err') : '');
    sonuc.textContent = !chosen ? 'Doğru cevap: ' + letter(answer)
      : right ? 'Tebrikler, doğru bildin!' : 'Yanlış. Doğru cevap: ' + letter(answer);
    sonuc.hidden = false;
    if (chosen && navigator.vibrate) { try { navigator.vibrate(right ? 250 : [120, 80, 120, 80, 120]); } catch (e) { /* no vibration */ } }
    cevap.setAttribute('data-n', String(answer));
    document.getElementById('cevap-b').textContent = 'Doğru cevap: ' + letter(answer);
    document.getElementById('cevap-n').textContent = why;
    cevap.hidden = false;
  }
  function unreveal() {
    if (!revealed) return;
    revealed = false;
    btns.forEach(function (b) { b.classList.remove('is-right', 'is-wrong', 'is-dim'); });
    cevap.hidden = true;
    document.getElementById('sonuc').hidden = true;
  }

  function fill(map) {
    var entry = map && map[pid];
    var opts = Array.isArray(entry) ? entry : entry && entry.options;   /* old files: a bare list of options */
    if (entry && !Array.isArray(entry)) {
      answer = entry.answer >= 1 && entry.answer <= 4 ? entry.answer : 0;
      why = typeof entry.why === 'string' ? entry.why : '';
    }
    if (pending) reveal();
    if (!Array.isArray(opts) || opts.length !== 4) return;
    btns.forEach(function (b, i) {
      var o = opts[i], t = b.querySelector('.oy-t');
      t.textContent = '';
      if (o && typeof o === 'object' && typeof o.code === 'string') {
        var c = document.createElement('code'); c.textContent = o.code; t.appendChild(c);
      } else {
        t.textContent = typeof o === 'string' ? o : (o && o.text) || '';
      }
      b.classList.toggle('is-bare', !t.textContent);
    });
  }

  if (!window.PollBackend || !window.PollBackend.validPollId(pid)) {
    btns.forEach(function (b) { b.disabled = true; });
    say('Soru bulunamadı. Slayttaki QR kodunu yeniden okutun.', 'err');
    return;
  }

  var ders = /^d(\d{1,2})-/.exec(pid)[1];
  var demo = ders === '0' || /^d\d{1,2}-deneme-/.test(pid);
  dersEl.textContent = demo ? 'Deneme sorusu' : 'Ders ' + ders;
  fetch('../slides/polls-ders' + (demo ? '0' : ders) + '.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(fill)
    .catch(function () { /* the buttons keep 1-4 */ });

  var backend = window.PollBackend.create(window.POLL_CONFIG);
  var dev = window.PollBackend.deviceId(pid);   /* one random id per poll */
  mark(recall());
  setOpen(true);

  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      var n = +b.getAttribute('data-n');
      if (busy || !isOpen) return;
      var before = chosen;
      busy = true;
      b.setAttribute('aria-busy', 'true');
      mark(n);
      say('Gönderiliyor.');
      backend.submit(pid, dev, n).then(function (res) {
        if (res.ok) {
          remember(n);
          say(before && before !== n ? 'Cevabınız değişti: ' + 'ABCD'.charAt(n - 1) + '.' : 'Cevabınız alındı: ' + 'ABCD'.charAt(n - 1) + '.', 'ok');
          not.classList.add('is-on');
        } else if (res.closed) {
          mark(before);
          setOpen(false);
        } else {
          mark(before);
          say('Cevap kaydedilemedi.', 'err');
        }
      }).catch(function () {
        mark(before);
        say('Cevap gönderilemedi. Bağlantınızı kontrol edip yeniden deneyin.', 'err');
      }).then(function () {
        busy = false;
        b.removeAttribute('aria-busy');
      });
    });
  });

  /* Follow the open or closed state. Counts are not shown here, so they cannot bias the vote. */
  backend.watchOpen(pid, function (open, until) {
    if (open && revealed) unreveal();
    if (open !== isOpen && !busy) setOpen(open);
    if (!open && typeof until === 'number' && !revealed) reveal();
  });
})();
