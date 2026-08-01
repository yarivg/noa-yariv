/* ============================================================
   phrase.js: Phrase Race. The whole-sentence game.

   Speed Duel trains vocabulary; this one trains word order, which
   is the thing that actually breaks when you open your mouth in a
   new language. Eight sentences, level 1 first so the round warms
   up, and two alternating challenges so it never turns into the
   same tap eight times in a row:

     BUILD  the sentence arrives as shuffled word tiles and you put
            them back in order. Wrong order is not a loss, it is a
            correction: the misplaced tiles go red and you get one
            more go at half points.

     SAY    no tiles, no scaffolding. Read the whole thing out loud
            and the microphone marks it. Firefox has no recogniser,
            so on Firefox every sentence is a BUILD instead.

   Whatever happens, the phone reads the sentence back before the
   next one. Hearing the real thing is the point of the round.
   ============================================================ */

window.Games = window.Games || {};
window.Games.phrase = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var ROUND_LEN = 8;
  var QUOTA = [3, 3, 2];     // sentences drawn per level, easiest first
  var SENTENCE_MS = 20000;
  var FAST_MS = 8000;        // under this and the speed bonus pays
  var LISTEN_MS = 8000;      // a sentence needs a longer mic window than a word
  var BASE_PTS = 25;
  var FAST_BONUS = 15;
  var CLEAN_BONUS = 10;      // for not buying the English hint

  /* Level 1 then 2 then 3, so the round ramps instead of throwing a
     level 3 sentence at a cold player. */
  function pickRound(all) {
    var byLevel = { 1: [], 2: [], 3: [] };
    all.forEach(function (s) { (byLevel[s.level] || byLevel[1]).push(s); });

    var out = [];
    [1, 2, 3].forEach(function (lvl, i) { out = out.concat(U.sample(byLevel[lvl], QUOTA[i])); });

    // A thin data file must not hand back a four sentence round.
    if (out.length < ROUND_LEN) {
      var used = {};
      out.forEach(function (s) { used[s.id] = true; });
      var rest = all.filter(function (s) { return !used[s.id]; });
      out = out.concat(U.sample(rest, ROUND_LEN - out.length));
      out.sort(function (a, b) { return (a.level || 1) - (b.level || 1); });
    }
    return out.slice(0, ROUND_LEN);
  }

  function mount(root, ctx) {
    root.classList.add('phrase-game');

    var me = ctx.player;
    var from = me.native, to = me.target;   // prompt language, answer language
    var canMic = Speech.canListen();
    var deck = pickRound(Store.levelled(ctx.data.sentences || []));

    var state = {
      idx: -1, score: 0, combo: 0, bestCombo: 0, hits: 0, misses: 0,
      missed: [], shownAt: 0, hinted: false, attempt: 1, hurried: false,
      locked: false, dead: false
    };

    var clock = null, mic = null, timers = [];

    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function stopClock() { if (clock) { clock.stop(); clock = null; } }
    function stopMic() { if (mic) { mic.stop(); mic = null; } }

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);
      root.appendChild(el('div.intro',
        el('div.intro-emoji', '🧩'),
        el('h2', 'Phrase Race'),
        el('p.intro-lead',
          'Eight sentences in ' + langName(from) + '. Give each one back in ' + langName(to) + '.'),
        el('ul.rules',
          el('li', '🧩 Build: tap the word tiles into the right order.'),
          el('li', canMic
            ? '🎤 Say: every other sentence, just say the whole thing out loud.'
            : '🎤 This browser has no microphone recognition, so every sentence is a build. Chrome or Safari gives you the mic.'),
          el('li', '⏱️ 20 seconds each. Answer under 8 and there is a bonus.'),
          el('li', '🔥 3 in a row = double points. 6 in a row = triple.')
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(next);
          }
        }, 'Start ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    var ui = {};

    function board() {
      clear(root);
      ui.count = el('div.hud-score', '1/' + deck.length);
      ui.time = el('div.hud-time', '20s');
      ui.score = el('div.hud-score', '0');
      ui.combo = el('div.hud-combo');
      ui.bar = el('i');

      root.appendChild(el('div.hud',
        el('div.hud-cell', el('small', 'sentence'), ui.count),
        el('div.hud-cell.wide', el('div.timebar', ui.bar), ui.combo),
        el('div.hud-cell', el('small', 'points'), ui.score)
      ));

      ui.card = el('div.card');
      root.appendChild(el('div.card-stage', ui.card));

      ui.timeRow = el('div.phrase-timerow', ui.time);
      root.appendChild(ui.timeRow);

      ui.action = el('div.action-zone');
      root.appendChild(ui.action);
    }

    /* ---------------------------------------------------------- a sentence */

    // Odd sentences are builds, even ones are spoken. Without a
    // recogniser the whole round is builds.
    function modeFor(i) { return (!canMic || i % 2 === 0) ? 'build' : 'say'; }

    function next() {
      if (state.dead) return;
      state.idx++;
      if (state.idx >= deck.length) return end();

      var s = deck[state.idx];
      var mode = modeFor(state.idx);
      state.hinted = false;
      state.attempt = 1;
      state.hurried = false;
      state.locked = false;
      state.shownAt = Date.now();

      ui.count.textContent = (state.idx + 1) + '/' + deck.length;
      ctx.setSub('Sentence ' + (state.idx + 1) + ' of ' + deck.length +
        ' · ' + (mode === 'build' ? 'build it' : 'say it'));

      drawCard(s, mode);
      if (mode === 'build') buildStage(s); else sayStage(s);
      startClock(s);
    }

    function drawCard(s, mode) {
      clear(ui.card);
      ui.card.className = 'card';
      void ui.card.offsetWidth;              // restart the deal animation
      ui.card.classList.add('deal');

      ui.card.appendChild(el('div.card-theme',
        (mode === 'build' ? '🧩 build' : '🎤 say') + ' · ' + (s.theme || 'phrase')));
      ui.card.appendChild(el('div.card-word.phrase-prompt' + (from === 'he' ? '.rtl' : ''), s[from]));
      if (from === 'he') ui.card.appendChild(el('div.card-translit', s.t));

      ui.card.appendChild(el('button.hint-btn', {
        onclick: function (e) {
          e.stopPropagation();
          SFX.tap();
          // The hint is paid for with the bonuses, never with the base points.
          state.hinted = true;
          e.target.replaceWith(el('div.card-en', '🇬🇧 ' + s.en));
        }
      }, 'English?'));
    }

    function startClock(s) {
      stopClock();
      clock = U.ticker(SENTENCE_MS, function (left) {
        ui.bar.style.width = Math.min(100, (left / SENTENCE_MS) * 100) + '%';
        ui.time.textContent = Math.ceil(left / 1000) + 's';
        ui.time.classList.toggle('urgent', left < 6000);
        if (left < 5000 && !state.hurried) { state.hurried = true; SFX.hurry(); }
      }, function () {
        if (!state.locked) fail(s);
      });
    }

    /* ---------------------------------------------------------- build */

    function buildStage(s) {
      var target = s[to];
      var words = String(target).split(/\s+/).filter(Boolean);
      var pieces = U.shuffle(words.map(function (w, n) { return { w: w, n: n }; }));
      var chosen = [];

      clear(ui.action);
      var rtl = to === 'he' ? '.rtl' : '';
      var line = el('div.answer-line' + rtl);
      var tray = el('div.chip-tray' + rtl);
      ui.action.appendChild(el('div.build-zone',
        el('div.build-hint', 'tap the words into order'),
        line, tray));

      function paintLine(marks) {
        clear(line);
        chosen.forEach(function (p, pos) {
          var cls = '.chip.in-line' + rtl;
          if (marks) cls += marks[pos] ? '.chip-ok' : '.chip-bad';
          line.appendChild(el('button' + cls, {
            onclick: function () {
              if (state.locked) return;
              SFX.swipe();
              chosen.splice(chosen.indexOf(p), 1);
              paintLine(null);
              paintTray();
            }
          }, p.w));
        });
        // Empty sockets so the line has its full shape from the start.
        for (var k = chosen.length; k < words.length; k++) line.appendChild(el('span.slot'));
      }

      function paintTray() {
        clear(tray);
        pieces.forEach(function (p) {
          if (chosen.indexOf(p) !== -1) return;
          tray.appendChild(el('button.chip' + rtl, {
            onclick: function () {
              if (state.locked) return;
              SFX.tap();
              chosen.push(p);
              paintLine(null);
              paintTray();
              if (chosen.length === words.length) judge();
            }
          }, p.w));
        });
      }

      function judge() {
        var said = chosen.map(function (p) { return p.w; }).join(' ');
        // Compare the sentence, not the tiles: a sentence with the same
        // word twice can be built correctly from either copy.
        if (U.norm(said, to) === U.norm(target, to)) return win(s, 'exact');

        state.locked = true;
        paintLine(chosen.map(function (p, pos) {
          return U.norm(p.w, to) === U.norm(words[pos], to);
        }));
        SFX.wrong();
        U.buzz(60);

        if (state.attempt > 1) return later(function () { fail(s); }, 800);

        state.attempt = 2;
        later(function () {
          if (state.dead) return;
          // Everything goes back. Leaving the right tiles in place would
          // read as a hint the player did not earn.
          chosen = [];
          state.locked = false;
          paintLine(null);
          paintTray();
          ctx.toast('Not quite, one more go at half points', 'warn');
        }, 900);
      }

      paintLine(null);
      paintTray();
    }

    /* ---------------------------------------------------------- say */

    function sayStage(s) {
      clear(ui.action);
      ui.action.appendChild(el('div.say-zone',
        el('div.say-note', 'Say the whole sentence in ' + langName(to)),
        el('button.big-btn.primary.xl', {
          onclick: function () { SFX.flip(); openMic(s); }
        }, '🎤 Say it')
      ));
    }

    function openMic(s) {
      if (state.locked) return;
      var accepted = [s[to]].concat((s.alt && s.alt[to]) || []);
      var heard = el('div.heard', '…');

      clear(ui.action);
      ui.action.appendChild(el('div.listening',
        el('div.mic-dot', '🎤'),
        el('div.mic-copy', el('b', 'Listening…'), heard),
        el('div.mic-bar')));

      var settled = false;
      var micTimer = null;

      function settle(quality) {
        if (settled) return;
        settled = true;
        stopMic();
        clearTimeout(micTimer);
        if (quality !== 'no') return win(s, quality);
        if (state.attempt > 1) return fail(s);
        state.attempt = 2;
        retry(s, heard.textContent);
      }

      mic = Speech.listen({
        lang: to,
        continuous: false,
        onPartial: function (text) {
          heard.textContent = text;
          // Settle the moment it is already right, so a fast reader
          // is not made to wait for the recogniser to give up.
          if (U.grade(text, accepted, to) === 'exact') settle('exact');
        },
        onFinal: function (text, alts) {
          heard.textContent = text;
          var best = 'no';
          alts.forEach(function (a) {
            var g = U.grade(a, accepted, to);
            if (g === 'exact') best = 'exact';
            else if (g === 'close' && best === 'no') best = 'close';
          });
          settle(best);
        },
        onError: function () { settle('no'); },
        onEnd: function () { later(function () { settle('no'); }, 120); }
      });

      // No recogniser handle means no mic on this device after all.
      if (!mic) return buildStage(s);
      micTimer = setTimeout(function () { settle('no'); }, LISTEN_MS);
      timers.push(micTimer);
    }

    function retry(s, text) {
      SFX.pass();
      clear(ui.action);
      ui.action.appendChild(el('div.say-zone',
        el('div.say-note.miss', text ? 'Heard: "' + text + '"' : 'Did not catch that'),
        el('button.big-btn.primary.xl', {
          onclick: function () { SFX.flip(); openMic(s); }
        }, '🎤 Try again'),
        el('button.ghost-btn', {
          onclick: function () { SFX.pass(); fail(s); }
        }, 'Show me →')
      ));
    }

    /* ---------------------------------------------------------- verdicts */

    function multiplier() { return state.combo >= 6 ? 3 : state.combo >= 3 ? 2 : 1; }

    function win(s, quality) {
      state.locked = true;
      stopClock();
      stopMic();

      var ms = Date.now() - state.shownAt;
      var pts = BASE_PTS;
      if (!state.hinted) {
        if (ms < FAST_MS) pts += FAST_BONUS;
        pts += CLEAN_BONUS;
      }
      if (quality === 'close') pts = Math.round(pts * 0.6);
      if (state.attempt > 1) pts = Math.round(pts / 2);
      pts *= multiplier();

      state.score += pts;
      state.combo++;
      state.hits++;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      Store.answered(me.id, true, ms);
      if (state.combo === 5) Store.earn(me.id, 'combo-5');
      if (state.combo === 10) Store.earn(me.id, 'combo-10');

      SFX.correct(state.combo);
      U.buzz(25);
      flash('good', '+' + pts,
        quality === 'close' ? 'close enough 👌' : (state.combo >= 3 ? '🔥 ×' + multiplier() : ''));
      paint();
      readBack(s);
    }

    function fail(s) {
      state.locked = true;
      stopClock();
      stopMic();

      SFX.wrong();
      state.combo = 0;
      state.misses++;
      Store.answered(me.id, false);
      state.missed.push({
        prompt: s[from],
        answer: s[to],
        hint: to === 'he' ? s.t : s.en
      });

      clear(ui.action);
      ui.action.appendChild(el('div.answer-reveal',
        el('small', 'it was'),
        el('span' + (to === 'he' ? '.rtl' : ''), s[to]),
        to === 'he' ? el('small.tr', s.t) : null));
      flash('bad', '', '');
      paint();
      readBack(s);
    }

    /* The sentence is spoken whatever the verdict was: right or wrong,
       the last thing you hear should be the correct version. Advance on
       whichever comes first, the voice finishing or the safety net,
       because a missing voice must not stall the round. */
    function readBack(s) {
      var moved = false;
      function go() {
        if (moved || state.dead) return;
        moved = true;
        next();
      }
      Speech.speak(s[to], to, { rate: 0.85 }).then(function () { later(go, 400); });
      later(go, 4500);
    }

    function flash(kind, big, small) {
      ui.card.classList.add('flash-' + kind);
      if (big) ui.card.appendChild(el('div.points-pop', big, small ? el('small', small) : null));
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
      stopClock();
      stopMic();
      clearTimers();

      var badges = [];
      // Six clean sentences in one round is the "Full sentence" badge.
      if (state.hits >= 6) badges.push(Store.earn(me.id, 'sentence'));
      if (state.hits === deck.length && deck.length) badges.push(Store.earn(me.id, 'perfect'));

      var half = Math.ceil(deck.length / 2);
      ctx.finish({
        won: state.hits >= half,
        emoji: state.hits === deck.length ? '🏆' : state.hits >= 6 ? '🎉' : state.hits >= half ? '👏' : '📚',
        title: state.hits === deck.length ? 'Every single one'
          : state.hits >= 6 ? 'You can hold a conversation'
            : state.hits >= half ? 'Solid round' : 'Round over',
        subtitle: state.hits === deck.length ? 'Eight sentences, no help.' : null,
        score: state.score,
        xp: Math.round(state.score / 4) + state.hits * 3,
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
      stopClock();
      if (mic) { mic.abort(); mic = null; }
      clearTimers();
      Speech.shutUp();
    };
  }

  return {
    id: 'phrase',
    emoji: '🧩',
    mode: 'solo',
    title: { en: 'Phrase Race', he: 'מרוץ משפטים', fr: 'Course aux phrases' },
    tagline: { en: 'Whole sentences, not single words' },
    mount: mount
  };
})();
