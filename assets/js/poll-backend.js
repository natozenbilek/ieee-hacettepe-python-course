/* Canlı oylama: backend adapter (authoring/POLLS.md).
   window.PollBackend.create(config) returns one object with the same interface for both modes:
     submit(pollId, deviceId, n)            -> Promise {ok:true} | {ok:false, closed:true}; rejects when offline
     subscribe(pollId, onCounts, onStatus?) -> function that stops the subscription
                                                onCounts(counts[4], total, {open: true|false|null, loaded?: bool})
                                                onStatus("online" | "offline" | "badid"); badid: the poll id
                                                is not d1-d5, so the database would refuse it
     watchOpen(pollId, onOpen)              -> function that stops; onOpen(true|false, until) whenever the state is known;
                                                until is null for a poll never opened
                                                (the answer page; it never sees the counts)
     open(pollId), close(pollId, onUnload)  -> Promise {ok:true} | {ok:false, nokey|denied|badid|offline:true}
     answerBase()                           -> Promise of the answer page URL ending in "oy/"
     answerUrl(base, pollId)                -> the QR target
   "local"   : tools/poll_server.py, POST ../../api/vote and GET ../../api/stream?p= (SSE), paths relative to this file.
               open and close follow the deck; no key is needed.
   "firebase": Realtime Database REST and the REST streaming API, no SDK. The published rules
               (authoring/firebase-rules.json) accept a vote PUT /polls/<id>/<device>.json only while
               /control/<id>/until is later than the server's clock. Only the instructor laptop opens and
               closes a poll, with the instructor key K it keeps in sessionStorage (instructorKey()):
                 open : PUT /control/<id>.json {key: K + ":" + fresh random, until: server now + 15 min}
                 close: PUT /control/<id>.json {key: K + ":" + fresh random, until: {".sv": "timestamp"}}
               The rules accept a control write only when its key starts with K + ":" and differs from the
               stored one, so nobody can change until alone by reusing the key that an earlier write stored.
               REST has no /.info/serverTimeOffset, so the offset is learned from the server timestamp that a
               close write returns; the rules allow until up to now + 16 min, which leaves a minute for skew.
               Without a key the deck only reads: the QR, the live count and the open or closed state.
               Streaming also works from a deck opened as a local file (the database answers CORS requests);
               the QR then points at the published answer page (POLL_CONFIG.publishedAnswerBase).
   PollBackend.deviceId(pollId) gives the answer page its random id for that poll.
   No personal data: a separate random device id per poll lives in localStorage, so the votes of one
   phone in different polls cannot be linked; one vote per device per poll. */
(function () {
  'use strict';

  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
  var POLL_RE = /^d[1-5]-[a-z0-9-]{1,48}$/;          /* the Firebase rules accept only d1-d5 */
  var DEV_RE = /^[a-z0-9]{16,40}$/;
  var DEV_KEY = 'ieee-python-poll-device:';      /* + poll id: one random id per poll */
  var INSTRUCTOR_KEY = 'ieee-python-poll-instructor';
  var OPEN_MS = 15 * 60 * 1000;          /* a poll stays open at most 15 minutes after the slide is entered */
  var READ_MS = 2 * 60 * 60 * 1000;      /* the rules keep the votes readable 2 hours after closing */
  var WATCH_MS = 8000;                   /* the answer page asks for the state this often while visible */
  var memoryIds = {};

  function randomId() {
    var a = new Uint8Array(12), s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(36)).slice(-2);
    return s;
  }

  /* One random id per poll, so the answers of one phone in different polls share nothing.
     When storage is blocked the id lives only as long as the page. */
  function deviceId(pollId) {
    var k = DEV_KEY + String(pollId || ''), id = null;
    try { id = localStorage.getItem(k); } catch (e) { id = null; }
    if (!id || !DEV_RE.test(id)) {
      id = memoryIds[k] || randomId();
      memoryIds[k] = id;
      try { localStorage.setItem(k, id); } catch (e) { /* page lifetime only */ }
    }
    return id;
  }
  /* the single id of earlier versions links answers across polls; it is not used any more */
  try { localStorage.removeItem('ieee-python-poll-device'); } catch (e) { /* nothing stored */ }

  /* The instructor key: typed on the instructor laptop (poll.js, Shift+K) and kept in sessionStorage, i.e.
     only in this browser tab until it is closed. Not localStorage: every GitHub Pages project of the account
     shares the origin natozenbilek.github.io, and its other pages could read localStorage. */
  try { localStorage.removeItem(INSTRUCTOR_KEY); } catch (e) { /* nothing stored */ }
  function instructorKey() {
    try { return (sessionStorage.getItem(INSTRUCTOR_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function setInstructorKey(k) {
    k = String(k || '').trim();
    try {
      if (k) sessionStorage.setItem(INSTRUCTOR_KEY, k); else sessionStorage.removeItem(INSTRUCTOR_KEY);
      return true;
    } catch (e) { return false; }
  }

  function validVote(pollId, dev, n) {
    return POLL_RE.test(pollId) && DEV_RE.test(dev) && (n === 1 || n === 2 || n === 3 || n === 4);
  }

  function tally(votes) {
    var c = [0, 0, 0, 0], k, v;
    for (k in votes) {
      if (!Object.prototype.hasOwnProperty.call(votes, k)) continue;
      v = votes[k];
      if (v === 1 || v === 2 || v === 3 || v === 4) c[v - 1] += 1;
    }
    return c;
  }

  function sum(c) { return c[0] + c[1] + c[2] + c[3]; }
  function noop() {}
  function defaultAnswerBase() { return new URL('../../oy/', SCRIPT_URL).href; }
  /* A URL a phone can open: the configured base, else the page's own site; a local file falls back to the
     published answer page, because no phone can open a file:// address. */
  function phoneAnswerBase(cfg) {
    var own = defaultAnswerBase();
    if (cfg && cfg.answerBase) return cfg.answerBase;
    if (/^file:/.test(own) && cfg && cfg.publishedAnswerBase) return cfg.publishedAnswerBase;
    return own;
  }
  /* EventSource to an http(s) address. The local server is reached through this file's own address, so
     a local file has no server; the Firebase database is a full URL and also works from a local file. */
  function canStream(url) { return !!window.EventSource && /^https?:/.test(url); }
  function answerUrl(base, pollId) { return base + '?p=' + encodeURIComponent(pollId); }

  /* ---------- local: tools/poll_server.py ---------- */
  function Local() {
    var api = new URL('../../api/', SCRIPT_URL).href;

    function post(path, body, beacon) {
      if (!/^https?:/.test(api)) return Promise.reject(new Error('offline'));
      var json = JSON.stringify(body);
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(api + path, new Blob([json], { type: 'application/json' }));
        return Promise.resolve(null);
      }
      return fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, cache: 'no-store', keepalive: !!beacon });
    }

    function stream(pollId, onCounts, onStatus) {
      onStatus = onStatus || noop;
      if (!POLL_RE.test(pollId)) { onStatus('badid'); return noop; }
      if (!canStream(api)) { onStatus('offline'); return noop; }
      var es = new EventSource(api + 'stream?p=' + encodeURIComponent(pollId));
      es.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        onStatus('online');
        onCounts(m.counts, m.total, { open: !!m.open });
      };
      es.onerror = function () { onStatus('offline'); };
      return function () { es.close(); };
    }

    function drive(path, pollId, beacon) {
      if (!POLL_RE.test(pollId)) return Promise.resolve({ ok: false, badid: true });
      return post(path, { p: pollId }, beacon)
        .then(function () { return { ok: true }; }, function () { return { ok: false, offline: true }; });
    }

    return {
      mode: 'local',
      submit: function (pollId, dev, n) {
        if (!validVote(pollId, dev, n)) return Promise.reject(new Error('invalid'));
        return post('vote', { p: pollId, d: dev, n: n }).then(function (r) {
          if (r.ok) return { ok: true };
          if (r.status === 409) return { ok: false, closed: true };
          throw new Error('HTTP ' + r.status);
        });
      },
      subscribe: stream,
      watchOpen: function (pollId, onOpen) {
        return stream(pollId, function (c, t, info) { if (info && typeof info.open === 'boolean') onOpen(info.open); });
      },
      open: function (pollId) { return drive('open', pollId); },
      close: function (pollId, onUnload) { return drive('close', pollId, onUnload); },
      answerBase: function () {
        if (!/^https?:/.test(api)) return Promise.resolve(defaultAnswerBase());
        return fetch(api + 'config', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .then(function (c) { return c.answer_base || defaultAnswerBase(); })
          .catch(defaultAnswerBase);
      },
      /* the phone must use the local server too, whatever poll-config.js says */
      answerUrl: function (base, pollId) { return answerUrl(base, pollId) + '&oylama=yerel'; }
    };
  }

  /* ---------- firebase: Realtime Database REST and REST streaming ---------- */
  function Firebase(cfg) {
    var db = String(cfg.firebaseUrl || '').trim().replace(/\/+$/, '');
    var ready = /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9._-]+)*$/i.test(db);   /* http only for a local stand-in */
    var offset = null;          /* server clock minus this clock, ms; learned from a server timestamp */
    var lastUntil = {};         /* poll id -> last until this page has seen */
    var deniedAt = {};          /* poll id -> the until under which a vote was refused: closed, whatever the clock says */
    var queue = {};             /* poll id -> the last control write in flight */

    function serverNow() { return Date.now() + (offset || 0); }

    function isOpen(pollId, until) {
      if (typeof until !== 'number') return false;
      if (deniedAt[pollId] === until) return false;
      return until > serverNow();
    }

    function seen(pollId, until) {
      var prev = lastUntil[pollId];
      lastUntil[pollId] = until;
      /* A close writes the server's own time. When a live update lowers until, the poll has just closed,
         even if this clock runs behind and the new value still looks like the future. */
      if (typeof prev === 'number' && typeof until === 'number' && until < prev && until > serverNow()) deniedAt[pollId] = until;
    }

    function getJson(path) {
      return fetch(db + path, { cache: 'no-store' }).then(function (r) {
        if (r.status === 401 || r.status === 403) return { denied: true };
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json().then(function (v) { return { value: v }; });
      });
    }

    /* PUT /control/<id>.json with the key K + ":" + a fresh random part (the rules refuse a key equal to the
       stored one). The response echoes the key; only until is kept. */
    function putControl(pollId, until, keepalive) {
      var key = instructorKey();
      if (!ready) return Promise.resolve({ ok: false, offline: true });
      if (!POLL_RE.test(pollId)) return Promise.resolve({ ok: false, badid: true });
      if (!key) return Promise.resolve({ ok: false, nokey: true });
      var t0 = Date.now();
      return fetch(db + '/control/' + pollId + '.json', {
        method: 'PUT', body: JSON.stringify({ key: key + ':' + randomId(), until: until }), cache: 'no-store', keepalive: !!keepalive
      }).then(function (r) {
        if (r.status === 401 || r.status === 403) return { ok: false, denied: true };
        if (!r.ok) return { ok: false, offline: true };
        return r.json().then(function (body) {
          var u = body && typeof body.until === 'number' ? body.until : null;
          if (u !== null && typeof until === 'object') offset = u - (t0 + Date.now()) / 2;
          if (u !== null) lastUntil[pollId] = u;
          return { ok: true, until: u };
        }, function () { return { ok: true, until: null }; });
      }, function () { return { ok: false, offline: true }; });
    }

    var STAMP = { '.sv': 'timestamp' };

    var api = {
      mode: 'firebase',
      serverNow: serverNow,
      submit: function (pollId, dev, n) {
        if (!ready) return Promise.reject(new Error('no database URL'));
        if (!validVote(pollId, dev, n)) return Promise.reject(new Error('invalid'));
        return fetch(db + '/polls/' + pollId + '/' + dev + '.json', { method: 'PUT', body: JSON.stringify(n), cache: 'no-store' })
          .then(function (r) {
            if (r.ok) return { ok: true };
            /* The value is valid, so a refusal means the poll is closed. */
            if (r.status === 401 || r.status === 403) {
              if (pollId in lastUntil) deniedAt[pollId] = lastUntil[pollId];
              return { ok: false, closed: true };
            }
            throw new Error('HTTP ' + r.status);
          });
      },

      /* The deck: /control/<id>/until and, while the rules allow it, /polls/<id>, both streamed. */
      subscribe: function (pollId, onCounts, onStatus) {
        onStatus = onStatus || noop;
        if (!POLL_RE.test(pollId)) { onStatus('badid'); return noop; }
        if (!ready || !canStream(db)) { onStatus('offline'); return noop; }
        var votes = {}, loaded = false, until = null, vs = null, timer = null, retry = null, stopped = false;
        var cs = new EventSource(db + '/control/' + pollId + '/until.json');

        function emit() {
          if (stopped) return;
          var c = tally(votes);
          onCounts(c, sum(c), { open: isOpen(pollId, until), loaded: loaded });
        }
        /* flip to closed by itself when until passes */
        function schedule() {
          clearTimeout(timer);
          if (typeof until === 'number' && isOpen(pollId, until)) {
            timer = setTimeout(function () { emit(); schedule(); }, Math.min(until - serverNow() + 250, 2147483000));
          }
        }
        function readable() { return typeof until === 'number' && until > serverNow() - READ_MS; }
        function startVotes() {
          if (stopped || vs || !readable()) return;
          vs = new EventSource(db + '/polls/' + pollId + '.json');
          function apply(raw, merge) {
            var m;
            try { m = JSON.parse(raw); } catch (e) { return; }
            if (!m || typeof m.path !== 'string') return;
            var parts = m.path.split('/').filter(Boolean), data = m.data, k;
            if (parts.length === 0) {
              if (!merge) votes = {};
              if (data && typeof data === 'object') for (k in data) {
                if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
                if (data[k] === null) delete votes[k]; else votes[k] = data[k];
              }
            } else if (parts.length === 1) {
              if (data === null) delete votes[parts[0]]; else votes[parts[0]] = data;
            }
            loaded = true;
            emit();
          }
          vs.addEventListener('put', function (ev) { apply(ev.data, false); });
          vs.addEventListener('patch', function (ev) { apply(ev.data, true); });
          /* cancel: the rules refused the read (the poll has not been opened yet, or closed long ago).
             Close it so EventSource does not retry; the next change of until starts it again. */
          vs.addEventListener('cancel', function () {
            if (vs) vs.close();
            vs = null;
            clearTimeout(retry);
            retry = setTimeout(startVotes, 5000);
          });
          vs.onerror = function () { onStatus('offline'); };
        }

        cs.addEventListener('put', function (ev) {
          var m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (!m || m.path !== '/') return;
          until = typeof m.data === 'number' ? m.data : null;
          seen(pollId, until);
          onStatus('online');
          startVotes();
          emit();
          schedule();
        });
        cs.addEventListener('cancel', function () { cs.close(); onStatus('offline'); });
        cs.onerror = function () { onStatus('offline'); };

        return function () {
          stopped = true;
          clearTimeout(timer); clearTimeout(retry);
          cs.close();
          if (vs) vs.close();
        };
      },

      /* The answer page: a short GET of /control/<id>/until every few seconds while the page is visible,
         so phones do not hold a connection open (the free plan allows 100 at once). */
      watchOpen: function (pollId, onOpen) {
        if (!ready || !POLL_RE.test(pollId)) return noop;
        var stopped = false, tick = null, expiry = null;
        function check() {
          clearTimeout(tick);
          if (stopped) return;
          if (document.visibilityState === 'hidden') return;
          getJson('/control/' + pollId + '/until.json').then(function (res) {
            if (stopped) return;
            var until = res.denied ? null : (typeof res.value === 'number' ? res.value : null);
            seen(pollId, until);
            onOpen(isOpen(pollId, until), until);
            clearTimeout(expiry);
            if (isOpen(pollId, until)) expiry = setTimeout(check, Math.min(until - serverNow() + 500, 2147483000));
          }, noop).then(function () { if (!stopped) tick = setTimeout(check, WATCH_MS); });
        }
        function onVisible() { if (document.visibilityState === 'visible') check(); }
        document.addEventListener('visibilitychange', onVisible);
        check();
        return function () {
          stopped = true;
          clearTimeout(tick); clearTimeout(expiry);
          document.removeEventListener('visibilitychange', onVisible);
        };
      },

      /* Opening: until = server now + 15 min. The first open of the page, or one the server refuses,
         first writes a server timestamp, which also measures the clock offset. */
      open: function (pollId) {
        if (!instructorKey()) return Promise.resolve({ ok: false, nokey: true });
        return serial(pollId, function () { return openNow(pollId); });
      },
      close: function (pollId, onUnload) {
        if (!instructorKey()) return Promise.resolve({ ok: false, nokey: true });
        if (onUnload) return putControl(pollId, STAMP, true);
        return serial(pollId, function () { return putControl(pollId, STAMP); });
      },
      answerBase: function () { return Promise.resolve(phoneAnswerBase(cfg)); },
      answerUrl: answerUrl
    };
    return api;

    /* One control write at a time per poll, so a quick leave and re-enter cannot arrive out of order. */
    function serial(pollId, fn) {
      var next = (queue[pollId] || Promise.resolve()).then(fn, fn);
      queue[pollId] = next;
      return next;
    }

    function openNow(pollId) {
      function stampThenOpen() {
        return putControl(pollId, STAMP).then(function (r) {
          if (!r.ok || r.until === null) return r.ok ? { ok: false, offline: true } : r;
          return putControl(pollId, r.until + OPEN_MS);
        });
      }
      if (offset === null) return stampThenOpen();
      return putControl(pollId, Math.floor(serverNow()) + OPEN_MS).then(function (r) {
        return r.denied ? stampThenOpen() : r;
      });
    }
  }

  window.PollBackend = {
    create: function (cfg) {
      cfg = cfg || window.POLL_CONFIG || {};
      return cfg.mode === 'firebase' ? Firebase(cfg) : Local();
    },
    deviceId: deviceId,
    instructorKey: instructorKey,
    setInstructorKey: setInstructorKey,
    validPollId: function (p) { return POLL_RE.test(String(p || '')); },
    answerUrl: answerUrl
  };
})();
