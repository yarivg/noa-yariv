/* ============================================================
   pingpong.js — Ping-Pong. The two-of-you-on-one-couch game.

   One phone, handed back and forth. Noa gets a French word and
   says the Hebrew; Yariv gets a Hebrew word and says the French;
   repeat until the shared hearts run out.

   Two design choices drive everything:

   The chain never resets. A miss costs a heart, not the chain, so
   the number in the middle of the screen only ever goes up and the
   pair are always playing against their own record rather than
   against the last mistake.

   The clock shrinks. Ten seconds on turn one, three tenths less
   every turn, four seconds at the floor. Nothing else in the game
   gets harder, and nothing else needs to.
   ============================================================ */

window.Games = window.Games || {};
window.Games.pingpong = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var START_MS = 10000;   // the very first turn
  var DROP_MS = 300;      // shaved off every turn after that
  var FLOOR_MS = 4000;    // below this it stops being a language game
  var MAX_LIVES = 3;
  var LIFE_BACK = [10, 20, 30];   // chain links that hand a heart back
  var REVEAL_MS = 1900;   // how long the right answer stays up after a miss
  var LISTEN_MS = 6000;   // the mic window when there is no turn clock to borrow

  function mount(root, ctx) {
    root.classList.add('pingpong-game');

    // Co-op: ctx.player is null, so the pair come straight from the store.
    var noa = Store.player('noa');
    var yariv = Store.player('yariv');
    var order = [noa, yariv];   // Noa serves first, always

    var untimed = Store.untimed();   // hearts still go, but never to the clock
    var words = (ctx.data && ctx.data.words) ? Store.levelled(ctx.data.words) : [];
    var queues = { 1: [], 2: [], 3: [] };
    var source = { 1: byLevel(1), 2: byLevel(2), 3: byLevel(3) };

    var best = (Store.coop().best && Store.coop().best.pingpong) || 0;

    var state = {
      chain: 0,
      lives: MAX_LIVES,
      turns: 0,               // how many turns have been dealt, for the clock ramp
      turnIx: 0,              // whose turn it is: even = Noa
      hits: { noa: 0, yariv: 0 },
      missed: [],
      longest: 0,             // slowest answer that still landed, in ms
      limit: START_MS,
      shownAt: 0,
      answering: false,
      lastId: '',
      settled: true,          // the turn already has a verdict, ignore late callbacks
      over: false
    };

    var clock = null, mic = null, micTimer = null, gapTimer = null, overlay = null;
    var ui = {};

    /* ---------------------------------------------------------- deck */

    function byLevel(n) {
      var out = words.filter(function (w) { return (w.level || 1) === n; });
      // A thin data file should not starve a level: fall back to everything.
      return out.length ? out : words.slice();
    }

    function draw(level) {
      if (!queues[level].length) queues[level] = U.shuffle(source[level]);
      var w = queues[level].shift();
      // Never hand the same word to the two players back to back.
      if (w && w.id === state.lastId && queues[level].length) {
        var swap = queues[level].shift();
        queues[level].push(w);
        w = swap;
      }
      return w;
    }

    /* The ramp: pure level 1 while they warm up, level 2 folded in
       from link 8, level 3 from link 20. Lower levels stay in the mix
       so the run keeps a rhythm instead of turning into a wall. */
    function pickWord() {
      var r = Math.random(), level;
      if (state.chain < 8) level = 1;
      else if (state.chain < 20) level = r < 0.55 ? 1 : 2;
      else level = r < 0.2 ? 1 : (r < 0.6 ? 2 : 3);
      var w = draw(level) || draw(1);
      if (w) state.lastId = w.id;
      return w;
    }

    function limitFor(turnNo) {
      return Math.max(FLOOR_MS, START_MS - turnNo * DROP_MS);
    }

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);
      ctx.setSub(best ? 'best chain: ' + best : 'no record yet');
      root.appendChild(el('div.intro',
        el('div.intro-emoji', '🏓'),
        el('h2', 'Ping-Pong'),
        el('p.intro-lead',
          'One phone. ' + noa.name + ' answers, then ' + yariv.name + ', then ' + noa.name +
          '. Three hearts between you and one chain to protect.'),
        el('ul.rules',
          el('li', '🔁 Your word is in the language you already speak. Say it in the one you are learning.'),
          el('li', '❤️ A miss costs a shared heart. Three misses and the run is over.'),
          el('li', untimed
            ? '♾️ No clock on a turn. Only a wrong answer costs a heart.'
            : '⏱️ Ten seconds on the first turn, a little less on every turn after.'),
          el('li', '🔗 The chain never resets. One heart back at 10, 20 and 30.'),
          el('li', Speech.canListen()
            ? '🎤 Tap "I know it!", then say it out loud.'
            : '👀 No microphone in this browser — you mark each other. Chrome or Safari gives you the mic.'),
          best ? el('li', '🏆 Best chain so far: ' + best + '. Beat it.') : null
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(function () { handover(); });
          }
        }, 'Start ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    function board() {
      clear(root);

      ui.lives = el('div.pp-lives');
      ui.chain = el('div.pp-chain-num', '0');
      ui.turn = el('div.pp-turn');
      ui.bar = el('i');
      ui.secs = el('div.pp-secs', untimed ? '∞' : '10.0');

      root.appendChild(el('div.hud.pp-hud',
        el('div.hud-cell', el('small', 'hearts'), ui.lives),
        el('div.hud-cell.pp-chain-cell', el('small', 'chain'), ui.chain),
        el('div.hud-cell', el('small', 'serving'), ui.turn)
      ));

      root.appendChild(el('div.pp-clock',
        el('div.timebar', ui.bar),
        ui.secs
      ));

      ui.tallyNoa = el('b', '0');
      ui.tallyYariv = el('b', '0');
      root.appendChild(el('div.pp-tally',
        el('div.pp-tal.who-noa', el('span', noa.emoji), el('span', noa.name), ui.tallyNoa),
        el('div.pp-tal.who-yariv', el('span', yariv.emoji), el('span', yariv.name), ui.tallyYariv)
      ));

      ui.card = el('div.card');
      root.appendChild(el('div.card-stage', ui.card));

      ui.action = el('div.action-zone');
      root.appendChild(ui.action);

      paint();
    }

    function paint() {
      var p = order[state.turnIx % 2];
      clear(ui.lives);
      for (var i = 0; i < MAX_LIVES; i++) {
        ui.lives.appendChild(el('span.pp-heart' + (i < state.lives ? '' : '.gone'),
          i < state.lives ? '❤️' : '🖤'));
      }
      ui.chain.textContent = String(state.chain);
      clear(ui.turn);
      ui.turn.appendChild(el('span.pp-who.who-' + p.color, p.emoji + ' ' + p.name));
      ui.tallyNoa.textContent = String(state.hits.noa);
      ui.tallyYariv.textContent = String(state.hits.yariv);
    }

    /* ---------------------------------------------------------- handover */

    /* A full-screen card in the next player's colour. It exists for one
       reason: whoever is about to answer must not see the prompt while
       the phone is still in the other one's hand. */
    function handover() {
      if (state.over) return;
      killOverlay();
      var p = order[state.turnIx % 2];
      SFX.swipe();
      U.buzz(20);

      var card = el('div.pp-handover.who-' + p.color,
        el('div.pp-ho-emoji', p.emoji),
        el('div.pp-ho-pass', 'Pass the phone to ' + p.name),
        el('div.pp-ho-task', p.name + ' says it in ' + langName(p.target) + ' ' + p.targetFlag),
        el('div.pp-ho-state',
          el('span', '🔗 ' + state.chain),
          el('span', repeat('❤️', state.lives) + repeat('🖤', MAX_LIVES - state.lives))
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.tap();
            killOverlay();
            turn();
          }
        }, "I'm ready 👌")
      );

      // Banking is the only way out with a heart still in hand, which is
      // also the only way to the telepath badge.
      if (state.chain > 0) {
        card.appendChild(el('button.ghost-btn', {
          onclick: function () { SFX.pass(); stop(true); }
        }, '🏁 Stop here and keep ' + state.chain));
      }

      overlay = card;
      root.appendChild(card);
    }

    function killOverlay() {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
    }

    /* ---------------------------------------------------------- a turn */

    function turn() {
      if (state.over) return;
      var p = order[state.turnIx % 2];
      var w = pickWord();
      if (!w) return stop(false);   // no content, nothing to play

      var from = p.native, to = p.target;
      state.answering = false;
      state.settled = false;
      state.shownAt = Date.now();
      state.limit = limitFor(state.turns);
      state.turns++;

      paint();

      clear(ui.card);
      ui.card.className = 'card pp-card who-' + p.color;
      void ui.card.offsetWidth;
      ui.card.classList.add('deal');
      ui.card.appendChild(el('div.card-theme', themeEmoji(w.theme) + ' ' + (w.theme || 'word')));
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
      ui.action.appendChild(el('button.big-btn.primary.xl', {
        onclick: function () { SFX.flip(); attempt(p, w); }
      }, '💡 I know it!'));

      startClock(p, w);
    }

    function startClock(p, w) {
      if (untimed) { clock = U.noClock(); return; }
      var lastSec = 99;
      clock = U.ticker(state.limit, function (left) {
        ui.secs.textContent = (left / 1000).toFixed(1);
        ui.bar.style.width = Math.min(100, (left / state.limit) * 100) + '%';
        var urgent = left <= 3000;
        ui.secs.classList.toggle('urgent', urgent);
        var sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          if (urgent) SFX.hurry();
          else if (sec <= 5) SFX.tick();
          lastSec = sec;
        }
      }, function () {
        ui.bar.style.width = '0%';
        fail(p, w, true);
      });
    }

    function stopClock() {
      if (clock) { clock.stop(); clock = null; }
    }

    /* The player has claimed the word. Grade on the interim transcript
       so a fast answer feels fast; the turn clock, not a second timer,
       decides when they are out of road. */
    function attempt(p, w) {
      if (state.answering || state.over) return;
      state.answering = true;

      var to = p.target;
      var accepted = [w[to]].concat((w.alt && w.alt[to]) || []);

      clear(ui.action);
      var heard = el('div.heard', '…');

      if (!Speech.canListen()) return selfMark(p, w);

      ui.action.appendChild(el('div.listening',
        el('div.mic-dot', '🎤'),
        el('div.mic-copy', el('b', 'Say it in ' + langName(to)), heard),
        el('div.mic-bar')
      ));

      var settled = false;
      function settle(ok) {
        if (settled || state.over) return;
        settled = true;
        stopMic();
        if (ok) hit(p, w); else fail(p, w, false);
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

      if (!mic) return selfMark(p, w);

      // Never outlive the turn clock, which ends the turn on its own. With
      // no turn clock there is nothing to borrow, so the mic gets its own
      // window — an open microphone cannot be left running for ever.
      micTimer = setTimeout(function () { settle(false); },
        untimed ? LISTEN_MS : Math.max(500, clock ? clock.left() : 1000));
    }

    // Firefox has no recogniser, and a couple sitting together can
    // referee each other perfectly well.
    function selfMark(p, w) {
      var to = p.target;
      clear(ui.action);
      ui.action.appendChild(el('div.self-mark',
        el('div.answer-peek',
          el('span' + (to === 'he' ? '.rtl' : ''), w[to]),
          to === 'he' ? el('small', w.t) : null),
        el('div.self-btns',
          el('button.big-btn.good', { onclick: function () { hit(p, w); } }, '✅ Said it'),
          el('button.big-btn.bad', { onclick: function () { fail(p, w, false); } }, '❌ Nope')
        )));
    }

    function stopMic() {
      if (mic) { mic.stop(); mic = null; }
      clearTimeout(micTimer);
      micTimer = null;
    }

    /* ---------------------------------------------------------- verdicts */

    function hit(p, w) {
      // The clock running out and the mic reporting back can race; the
      // first one to arrive owns the turn.
      if (state.over || state.settled) return;
      state.settled = true;
      stopClock();
      stopMic();
      var ms = Date.now() - state.shownAt;
      if (ms > state.longest) state.longest = ms;

      state.chain++;
      state.hits[p.id]++;
      Store.answered(p.id, true, ms);

      SFX.correct(state.chain);
      U.buzz(25);
      flashCard('good', '🔗 ' + state.chain);
      paint();
      Speech.speak(w[p.target], p.target, { rate: 0.95 });

      milestone();

      state.turnIx++;
      gapTimer = setTimeout(handover, 750);
    }

    // Every fifth link is worth a noise; 10, 20 and 30 are worth a heart.
    function milestone() {
      if (state.chain % 5 !== 0) return;
      SFX.levelup();
      if (LIFE_BACK.indexOf(state.chain) !== -1) {
        if (state.lives < MAX_LIVES) {
          state.lives++;
          ctx.toast('❤️ ' + state.chain + ' links — a heart back!', 'good');
        } else {
          ctx.toast('💖 Hearts already full at ' + state.chain, 'good');
        }
        paint();
      } else {
        ctx.toast('🔗 ' + state.chain + ' in the chain!', 'good');
      }
      if (ui.chain) {
        ui.chain.classList.remove('pop');
        void ui.chain.offsetWidth;
        ui.chain.classList.add('pop');
      }
    }

    function fail(p, w, timedOut) {
      if (state.over || state.settled || !w) return;
      state.settled = true;
      stopClock();
      stopMic();

      state.lives--;
      Store.answered(p.id, false);
      state.missed.push({
        prompt: w[p.native],
        answer: w[p.target],
        hint: p.target === 'he' ? w.t : w.en
      });

      SFX.wrong();
      SFX.life();
      U.buzz([50, 60, 90]);
      flashCard('bad', timedOut ? '⏱️' : '❌');
      paint();

      clear(ui.action);
      ui.action.appendChild(el('div.answer-reveal',
        el('small', timedOut ? 'too slow — it was' : 'it was'),
        el('span' + (p.target === 'he' ? '.rtl' : ''), w[p.target]),
        p.target === 'he' ? el('small.tr', w.t) : null));
      Speech.speak(w[p.target], p.target, { rate: 0.85 });

      state.turnIx++;
      gapTimer = setTimeout(function () {
        if (state.lives <= 0) stop(false);
        else handover();
      }, REVEAL_MS);
    }

    function flashCard(kind, big) {
      if (!ui.card) return;
      ui.card.classList.add('flash-' + kind);
      if (big) ui.card.appendChild(el('div.points-pop', big));
    }

    /* ---------------------------------------------------------- end */

    function stop(banked) {
      if (state.over) return;
      state.over = true;
      stopClock();
      stopMic();
      clearTimeout(gapTimer);
      killOverlay();

      var beat = state.chain > best;
      Store.coopResult(beat, state.chain);

      // Telepath is for walking away while a heart is still beating.
      var badges = [];
      if (banked && state.lives > 0 && state.chain >= 15) {
        badges.push(Store.earn(noa.id, 'telepath'));
        badges.push(Store.earn(yariv.id, 'telepath'));
      }

      var carrier = state.hits.noa === state.hits.yariv ? null
        : (state.hits.noa > state.hits.yariv ? noa : yariv);

      ctx.finish({
        won: beat,
        emoji: beat ? '🏓' : (state.chain >= 10 ? '👏' : '💀'),
        title: beat ? 'New best chain!' : (banked ? 'Banked it' : 'Chain broken'),
        subtitle: beat
          ? 'You beat ' + best + '.'
          : (carrier ? carrier.name + ' carried that one.' : 'Dead even. Suspicious.'),
        score: state.chain,
        xp: state.chain * 4,
        lines: [
          ['Chain', state.chain],
          [noa.emoji + ' ' + noa.name + ' hits', state.hits.noa],
          [yariv.emoji + ' ' + yariv.name + ' hits', state.hits.yariv],
          ['Longest turn survived', (state.longest / 1000).toFixed(1) + 's']
        ],
        missed: state.missed,
        badges: badges
        // No playerId: co-op XP goes to both of them.
      });
    }

    /* ---------------------------------------------------------- helpers */

    function langName(l) { return l === 'he' ? 'Hebrew' : l === 'fr' ? 'French' : 'English'; }

    function repeat(s, n) {
      var out = '';
      for (var i = 0; i < n; i++) out += s;
      return out;
    }

    intro();

    return function teardown() {
      state.over = true;
      stopClock();
      if (mic) { mic.abort(); mic = null; }
      clearTimeout(micTimer);
      clearTimeout(gapTimer);
      killOverlay();
    };
  }

  var THEMES = {
    greetings: '👋', people: '👨‍👩‍👧', food: '🍽️', home: '🏠', city: '🏙️',
    time: '🕒', verbs: '🏃', adjectives: '🎨', nature: '🌳', numbers: '🔢',
    body: '🖐️', travel: '✈️', feelings: '💗', clothes: '👕', work: '💼'
  };
  function themeEmoji(t) { return THEMES[t] || '🏓'; }

  return {
    id: 'pingpong',
    emoji: '🏓',
    mode: 'coop',
    title: { en: 'Ping-Pong', he: 'פינג-פונג', fr: 'Ping-Pong' },
    tagline: { en: 'One phone, alternating turns, shared lives' },
    mount: mount
  };
})();
