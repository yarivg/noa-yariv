/* ============================================================
   util.js — DOM helpers and the answer comparison.

   The comparison is deliberately forgiving. Both players are
   speaking into a phone microphone in a language they are still
   learning, and the recogniser hands back whatever it thinks it
   heard. Marking "ani ra'ev" wrong because it came back without
   the apostrophe would teach nothing except to stop playing.
   ============================================================ */

window.U = (function () {
  'use strict';

  /* ---------------------------------------------------------- dom */

  // el('div.card.big', {onclick: f}, 'text', childNode)
  function el(spec) {
    var parts = String(spec).split(/(?=[.#])/);
    var node = document.createElement(parts[0] || 'div');
    for (var i = 1; i < parts.length; i++) {
      if (parts[i][0] === '.') node.classList.add(parts[i].slice(1));
      else node.id = parts[i].slice(1);
    }
    for (var a = 1; a < arguments.length; a++) add(node, arguments[a]);
    return node;
  }

  function add(node, thing) {
    if (thing === null || thing === undefined || thing === false) return;
    if (Array.isArray(thing)) { thing.forEach(function (t) { add(node, t); }); return; }
    if (thing instanceof Node) { node.appendChild(thing); return; }
    if (typeof thing === 'object') {
      for (var k in thing) {
        var v = thing[k];
        if (v === null || v === undefined || v === false) continue;
        if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') { for (var s in v) node.style[s] = v[s]; }
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else node.setAttribute(k, v === true ? '' : v);
      }
      return;
    }
    node.appendChild(document.createTextNode(String(thing)));
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  /* ---------------------------------------------------------- text */

  var NIKUD = /[֑-ׇ]/g;      // vowel points and cantillation
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  var PUNCT = /[.,!?;:¿¡"'`´’‘“”()\[\]{}…\-–—׳״]/g;

  // Everything a lenient match should ignore: accents, case, points,
  // punctuation, doubled spaces, final-letter forms.
  function norm(s, lang) {
    s = String(s || '').toLowerCase().trim();
    s = s.replace(NIKUD, '').replace(PUNCT, ' ');
    if (lang === 'fr' || lang === 'en') {
      s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    if (lang === 'he') {
      s = s.replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; });
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  // Filler the learner is not being tested on. "un chien" and "chien"
  // are the same answer when the prompt was the word "dog".
  var STOP = {
    fr: ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'je', 'j', 'c', 'est'],
    he: ['ה', 'את', 'של', 'זה', 'זאת'],
    en: ['the', 'a', 'an', 'to', 'it', 'is']
  };

  function strip(s, lang) {
    var stop = STOP[lang] || [];
    return norm(s, lang).split(' ').filter(function (w) {
      return w && stop.indexOf(w) === -1;
    }).join(' ');
  }

  // Levenshtein, capped — we only ever care whether it is small.
  function distance(a, b) {
    if (a === b) return 0;
    if (!a.length || !b.length) return Math.max(a.length, b.length);
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[b.length];
  }

  /* Grade an attempt against one or more accepted answers.
     Returns 'exact' | 'close' | 'no'. 'close' still scores, at less. */
  function grade(said, accepted, lang) {
    if (!Array.isArray(accepted)) accepted = [accepted];
    var a = strip(said, lang);
    if (!a) return 'no';
    var best = 'no';
    for (var i = 0; i < accepted.length; i++) {
      var b = strip(accepted[i], lang);
      if (!b) continue;
      if (a === b) return 'exact';
      // The recogniser loves to prepend "euh" or append a stray word.
      if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) { best = 'close'; continue; }
      var tolerance = b.length <= 4 ? 1 : b.length <= 9 ? 2 : 3;
      if (distance(a, b) <= tolerance) best = 'close';
    }
    return best;
  }

  // Did this transcript contain the word at all? Used by the games
  // where the player talks freely and we hunt for target words.
  function mentions(transcript, word, lang) {
    var t = ' ' + strip(transcript, lang) + ' ';
    var w = strip(word, lang);
    if (!w) return false;
    if (t.indexOf(' ' + w + ' ') !== -1) return true;
    var stem = w.length > 5 ? w.slice(0, w.length - 1) : w;
    return t.indexOf(' ' + stem) !== -1;
  }

  /* ---------------------------------------------------------- arrays */

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sample(list, n) { return shuffle(list).slice(0, n); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* ---------------------------------------------------------- misc */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* no motor */ }
  }

  // A countdown that survives being cancelled mid-round.
  function ticker(ms, onTick, onEnd) {
    var end = Date.now() + ms, id = null, dead = false;
    function step() {
      if (dead) return;
      var left = end - Date.now();
      if (left <= 0) { onTick(0); dead = true; onEnd(); return; }
      onTick(left);
      id = requestAnimationFrame(step);
    }
    step();
    return {
      stop: function () { dead = true; if (id) cancelAnimationFrame(id); },
      add: function (extra) { end += extra; },
      left: function () { return Math.max(0, end - Date.now()); }
    };
  }

  /* The same handle a ticker hands back, with nothing behind it: what a
     game holds when the player has switched the clock off. It never
     ticks and never ends, so the round finishes on the player's word. */
  function noClock() {
    return {
      stop: function () { },
      add: function () { },
      left: function () { return Infinity; }
    };
  }

  function confetti(host) {
    var burst = el('div.confetti');
    var glyphs = ['🎉', '⭐', '✨', '🎊', '💥', '🏆'];
    for (var i = 0; i < 18; i++) {
      var bit = el('span', glyphs[i % glyphs.length]);
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.animationDelay = (Math.random() * 0.4) + 's';
      bit.style.fontSize = (16 + Math.random() * 22) + 'px';
      burst.appendChild(bit);
    }
    host.appendChild(burst);
    setTimeout(function () { burst.remove(); }, 2600);
  }

  return {
    el: el, clear: clear, $: $,
    norm: norm, strip: strip, grade: grade, mentions: mentions, distance: distance,
    shuffle: shuffle, sample: sample, pick: pick,
    clock: clock, buzz: buzz, ticker: ticker, noClock: noClock, confetti: confetti
  };
})();
