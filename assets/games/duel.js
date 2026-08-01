/* ============================================================
   duel.js — Speed Duel. The deck game.

   Sixty seconds, one card at a time. The card shows a word in the
   language you already speak; you say it in the one you are
   learning. Tap "I know it!", say it, the microphone marks it.

   Answering right adds two seconds to the clock, so a good run
   lasts longer than a bad one. The combo multiplier is the whole
   engine of the game: three in a row doubles every card after it,
   and one miss puts you back to single points.
   ============================================================ */

window.Games = window.Games || {};
window.Games.duel = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var ROUND_MS = 60000;
  var BONUS_MS = 2000;      // reward for a hit
  var LISTEN_MS = 6000;     // how long the mic stays open per card

  function mount(root, ctx) {
    var me = ctx.player;
    var from = me.native, to = me.target;   // prompt language, answer language
    var deck = U.shuffle(ctx.data.words);
    var i = 0;

    var state = {
      score: 0, combo: 0, bestCombo: 0, hits: 0, misses: 0,
      missed: [], answering: false, shownAt: 0, dead: false
    };

    var clock = null, mic = null, cardTimer = null;

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);
      root.appendChild(el('div.intro',
        el('div.intro-emoji', '⚡'),
        el('h2', 'Speed Duel'),
        el('p.intro-lead',
          'A card in ' + langName(from) + '. Say it in ' + langName(to) + '. As fast as you can.'),
        el('ul.rules',
          el('li', '⏱️ 60 seconds. Every right answer buys you 2 more.'),
          el('li', '🔥 3 in a row = double points. 6 in a row = triple.'),
          el('li', Speech.canListen()
            ? '🎤 Tap "I know it!", then say it out loud.'
            : '👀 This browser has no microphone recognition — you will mark yourself. Chrome or Safari gives you the mic.')
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(start);
          }
        }, 'Start ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    var ui = {};

    function board() {
      clear(root);
      ui.time = el('div.hud-time', '1:00');
      ui.score = el('div.hud-score', '0');
      ui.combo = el('div.hud-combo');
      ui.bar = el('i');

      root.appendChild(el('div.hud',
        el('div.hud-cell', el('small', 'time'), ui.time),
        el('div.hud-cell.wide', el('div.timebar', ui.bar), ui.combo),
        el('div.hud-cell', el('small', 'points'), ui.score)
      ));

      ui.card = el('div.card');
      root.appendChild(el('div.card-stage',
        el('div.card.ghost.g2'), el('div.card.ghost.g1'), ui.card));

      ui.action = el('div.action-zone');
      root.appendChild(ui.action);
    }

    function start() {
      clock = U.ticker(ROUND_MS, function (left) {
        ui.time.textContent = U.clock(left);
        ui.bar.style.width = Math.min(100, (left / ROUND_MS) * 100) + '%';
        ui.time.classList.toggle('urgent', left < 10000);
      }, end);
      next();
    }

    /* ---------------------------------------------------------- a card */

    function current() { return deck[i % deck.length]; }

    function next() {
      if (state.dead) return;
      i++;
      state.answering = false;
      state.shownAt = Date.now();
      var w = current();

      clear(ui.card);
      ui.card.className = 'card';
      void ui.card.offsetWidth;
      ui.card.classList.add('deal');
      ui.card.appendChild(el('div.card-theme', themeEmoji(w.theme) + ' ' + w.theme));
      ui.card.appendChild(el('div.card-word' + (from === 'he' ? '.rtl' : ''), w[from]));
      if (from === 'he') ui.card.appendChild(el('div.card-translit', w.t));
      ui.card.appendChild(el('button.hint-btn', {
        onclick: function (e) {
          e.stopPropagation();
          SFX.tap();
          e.target.replaceWith(el('div.card-en', '🇬🇧 ' + w.en));
        }
      }, 'English?'));

      clear(ui.action);
      ui.action.appendChild(el('button.big-btn.primary.xl.know', {
        onclick: function () { SFX.flip(); attempt(w); }
      }, '💡 I know it!'));
      ui.action.appendChild(el('button.ghost-btn', {
        onclick: function () { SFX.pass(); miss(w, true); }
      }, 'Skip →'));
    }

    /* The player has claimed the word. Open the mic, grade the moment
       the transcript matches so a fast answer feels fast, and fall
       back to self-marking wherever the mic cannot go. */
    function attempt(w) {
      if (state.answering) return;
      state.answering = true;

      var accepted = [w[to]].concat((w.alt && w.alt[to]) || []);

      clear(ui.action);
      var heard = el('div.heard', '…');
      var bar = el('div.mic-bar');

      if (Speech.canListen()) {
        ui.action.appendChild(el('div.listening',
          el('div.mic-dot', '🎤'),
          el('div.mic-copy', el('b', 'Say it in ' + langName(to)), heard),
          bar));

        var settled = false;
        function settle(ok) {
          if (settled) return;
          settled = true;
          if (mic) { mic.stop(); mic = null; }
          clearTimeout(cardTimer);
          if (ok) hit(w); else reveal(w);
        }

        mic = Speech.listen({
          lang: to,
          continuous: false,
          onPartial: function (text) {
            heard.textContent = text;
            if (U.grade(text, accepted, to) !== 'no') settle(true);
          },
          onFinal: function (text, alts) {
            heard.textContent = text;
            var ok = alts.some(function (a) { return U.grade(a, accepted, to) !== 'no'; });
            settle(ok);
          },
          onError: function () { settle(false); },
          onEnd: function () { setTimeout(function () { settle(false); }, 120); }
        });

        if (!mic) return selfMark(w);
        cardTimer = setTimeout(function () { settle(false); }, LISTEN_MS);
      } else {
        selfMark(w);
      }
    }

    function selfMark(w) {
      clear(ui.action);
      ui.action.appendChild(el('div.self-mark',
        el('div.answer-peek',
          el('span' + (to === 'he' ? '.rtl' : ''), w[to]),
          to === 'he' ? el('small', w.t) : null),
        el('div.self-btns',
          el('button.big-btn.good', { onclick: function () { hit(w); } }, '✅ Got it'),
          el('button.big-btn.bad', { onclick: function () { miss(w); } }, '❌ Nope')
        )));
    }

    /* ---------------------------------------------------------- verdicts */

    function multiplier() { return state.combo >= 6 ? 3 : state.combo >= 3 ? 2 : 1; }

    function hit(w) {
      var ms = Date.now() - state.shownAt;
      var pts = 10 * multiplier() + (ms < 2500 ? 5 : 0);
      state.score += pts;
      state.combo++;
      state.hits++;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      Store.answered(me.id, true, ms);
      if (state.combo === 5) Store.earn(me.id, 'combo-5');
      if (state.combo === 10) Store.earn(me.id, 'combo-10');

      SFX.correct(state.combo);
      U.buzz(25);
      if (clock) clock.add(BONUS_MS);
      flash('good', '+' + pts, state.combo >= 3 ? '🔥 ×' + multiplier() : '');
      paint();
      Speech.speak(w[to], to, { rate: 0.9 });
      setTimeout(next, 550);
    }

    function reveal(w) {
      // The mic did not hear it. Show the answer, then move on — a
      // speed game that stops to argue is not a speed game.
      SFX.wrong();
      state.combo = 0;
      state.misses++;
      Store.answered(me.id, false);
      state.missed.push({ prompt: w[from], answer: w[to], hint: to === 'he' ? w.t : w.en });
      clear(ui.action);
      ui.action.appendChild(el('div.answer-reveal',
        el('small', 'it was'),
        el('span' + (to === 'he' ? '.rtl' : ''), w[to]),
        to === 'he' ? el('small.tr', w.t) : null));
      flash('bad', '', '');
      paint();
      Speech.speak(w[to], to, { rate: 0.85 });
      setTimeout(next, 1400);
    }

    function miss(w, skipped) {
      SFX.pass();
      state.combo = 0;
      if (!skipped) {
        state.misses++;
        Store.answered(me.id, false);
      }
      state.missed.push({ prompt: w[from], answer: w[to], hint: to === 'he' ? w.t : w.en });
      paint();
      next();
    }

    function flash(kind, big, small) {
      ui.card.classList.add('flash-' + kind);
      if (big) {
        var pop = el('div.points-pop', big, small ? el('small', small) : null);
        ui.card.appendChild(pop);
      }
    }

    function paint() {
      ui.score.textContent = String(state.score);
      ui.combo.textContent = state.combo >= 2 ? '🔥 ' + state.combo + ' in a row' : '';
      ui.combo.className = 'hud-combo' + (state.combo >= 3 ? ' hot' : '');
    }

    /* ---------------------------------------------------------- end */

    function end() {
      if (state.dead) return;
      state.dead = true;
      if (mic) { mic.stop(); mic = null; }
      clearTimeout(cardTimer);
      var perfect = state.hits > 0 && state.misses === 0;
      var badges = [];
      if (perfect && state.hits >= 8) badges.push(Store.earn(me.id, 'perfect'));

      ctx.finish({
        won: state.score > 0,
        emoji: state.score >= 200 ? '🚀' : state.score >= 100 ? '🎉' : '👏',
        title: state.score >= 200 ? 'Absolutely flying' : state.score >= 100 ? 'Strong round' : 'Round over',
        subtitle: perfect ? 'Not a single miss.' : null,
        score: state.score,
        xp: Math.round(state.score / 4) + state.hits * 2,
        lines: [
          ['Right', state.hits],
          ['Missed', state.misses],
          ['Best chain', state.bestCombo]
        ],
        missed: state.missed,
        badges: badges
      });
    }

    /* ---------------------------------------------------------- helpers */

    function langName(l) { return l === 'he' ? 'Hebrew' : l === 'fr' ? 'French' : 'English'; }

    intro();

    return function teardown() {
      state.dead = true;
      if (clock) clock.stop();
      if (mic) mic.abort();
      clearTimeout(cardTimer);
    };
  }

  var THEMES = {
    greetings: '👋', people: '👨‍👩‍👧', food: '🍽️', home: '🏠', city: '🏙️',
    time: '🕒', verbs: '🏃', adjectives: '🎨', nature: '🌳', numbers: '🔢',
    body: '🖐️', travel: '✈️', feelings: '💗', clothes: '👕', work: '💼'
  };
  function themeEmoji(t) { return THEMES[t] || '🃏'; }

  return {
    id: 'duel',
    emoji: '⚡',
    mode: 'solo',
    title: { en: 'Speed Duel', he: 'דו-קרב', fr: 'Duel éclair' },
    tagline: { en: 'One word at a time, against the clock' },
    mount: mount
  };
})();
