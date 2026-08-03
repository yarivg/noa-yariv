/* ============================================================
   headsup.js — On My Forehead. The one you play sideways.

   One phone, held screen-out against the holder's forehead. The
   word on it is in the HOLDER's target language, because the holder
   is the one being trained to understand it: their partner is a
   native speaker of that language and describes it out loud without
   saying it. The holder shouts guesses.

   Two ways to score a card, both live at once. Tilt the phone down
   past 45 degrees for a hit, up past 45 to pass, or just tap: the
   bottom half of the screen is "got it", the top half is "pass".
   The tap half exists because a phone with no gyroscope, or an iOS
   permission prompt someone dismissed, must not end the game.

   Nothing here can be read by the holder mid-round, so the screen
   goes full-bleed green or red on every verdict: the describer,
   standing opposite, scores the round off the colour alone.
   ============================================================ */

window.Games = window.Games || {};
window.Games.headsup = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var TURN_MS = 60000;
  var FLASH_MS = 620;        // how long the full-bleed verdict stays up
  var HIT_ANGLE = 45;        // degrees off vertical that counts as a tilt
  var ARM_ANGLE = 20;        // must come back inside this before the next tilt counts
  var TILT_WAIT_MS = 1600;   // no reading by then means there is no gyroscope

  var DECKS = [
    { id: 'all',     emoji: '🎲', name: 'Everything' },
    { id: 'animals', emoji: '🐘', name: 'Animals' },
    { id: 'food',    emoji: '🍽️', name: 'Food' },
    { id: 'home',    emoji: '🏠', name: 'Home' },
    { id: 'city',    emoji: '🏙️', name: 'City' },
    { id: 'actions', emoji: '🏃', name: 'Actions' },
    { id: 'israel',  emoji: '🇮🇱', name: 'Israel' },
    { id: 'france',  emoji: '🇫🇷', name: 'France' }
  ];

  /* The component of gravity along the screen normal: 0 with the
     screen vertical, +90 face down, -90 face up. Derived from beta and
     gamma only, so it is the same number whichever way the phone is
     rotated in its own plane — and this game is always played sideways,
     where reading `beta` alone would be meaningless. */
  function tiltAngle(beta, gamma) {
    var b = beta * Math.PI / 180;
    var g = gamma * Math.PI / 180;
    var w = -Math.cos(b) * Math.cos(g);
    if (w > 1) w = 1;
    if (w < -1) w = -1;
    return Math.asin(w) * 180 / Math.PI;
  }

  /* iOS 13+ hands out motion data only after a prompt raised inside a
     real tap, which is why this is only ever called from the Start
     button. Anywhere else the promise never even appears. */
  function askTilt() {
    var D = window.DeviceOrientationEvent;
    if (!D) return Promise.resolve(false);
    if (typeof D.requestPermission !== 'function') return Promise.resolve(true);
    var p;
    try { p = D.requestPermission(); } catch (e) { return Promise.resolve(false); }
    if (!p || !p.then) return Promise.resolve(false);
    return p.then(
      function (r) { return r === 'granted'; },
      function () { return false; }
    );
  }

  function mount(root, ctx) {
    root.classList.add('headsup-game');

    var all = (ctx.data && ctx.data.headsup) || [];
    var noa = Store.player('noa');
    var yariv = Store.player('yariv');
    var untimed = Store.untimed();   // no buzzer: the turn ends on the 🏁 button

    var game = {
      holder: null,      // player object holding the phone this turn
      deckId: null,
      turns: [],         // one record per turn played
      played: {}         // card ids already burned, so turn two is fresh
    };

    var turn = null;     // live turn state, null between turns
    var clock = null;
    var flashTimer = null;
    var tiltTimer = null;
    var tiltOn = false;      // permission granted and readings arriving
    var dead = false;
    var ui = {};

    /* ---------------------------------------------------------- setup */

    function decks() {
      var seen = {};
      all.forEach(function (w) { seen[w.deck] = (seen[w.deck] || 0) + 1; });
      return DECKS.filter(function (d) { return d.id === 'all' ? all.length > 0 : seen[d.id]; });
    }

    function setup() {
      clear(root);
      root.classList.remove('playing');

      if (!all.length) {
        root.appendChild(el('div.panel.hu-empty',
          el('div.intro-emoji', '🙈'),
          el('h2', 'No cards yet'),
          el('p', 'data/headsup.json is empty, so there is nothing to hold up.'),
          el('button.big-btn', { onclick: function () { SFX.tap(); ctx.exit(); } }, '🏠 Home')));
        return;
      }

      var start = el('button.big-btn.primary.xl', { disabled: true }, 'Start ▶');

      function refresh() {
        var ok = !!(game.holder && game.deckId);
        if (ok) start.removeAttribute('disabled'); else start.setAttribute('disabled', '');
        start.textContent = ok
          ? 'Start ▶ ' + game.holder.name + ' holds it'
          : (game.holder ? 'Pick a deck' : 'Who is holding it?');
      }

      var whoRow = el('div.hu-who-row');
      [noa, yariv].forEach(function (p) {
        var picked = game.holder && game.holder.id === p.id;
        whoRow.appendChild(el('button.hu-who.who-' + p.color + (picked ? '.picked' : ''), {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            game.holder = p;
            setup();
          }
        },
          el('div.hu-who-emoji', p.emoji),
          el('div.hu-who-name', p.name),
          el('div.hu-who-lang', 'sees ' + langName(p.target) + ' ' + p.targetFlag),
          picked ? el('div.hu-who-tag', 'holding it') : null
        ));
      });

      var grid = el('div.hu-deck-grid');
      decks().forEach(function (d) {
        var picked = game.deckId === d.id;
        grid.appendChild(el('button.hu-deck' + (picked ? '.picked' : ''), {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            game.deckId = d.id;
            setup();
          }
        },
          el('div.hu-deck-emoji', d.emoji),
          el('div.hu-deck-name', d.name)
        ));
      });

      start.addEventListener('click', function () {
        if (!game.holder || !game.deckId) return;
        SFX.wake();
        SFX.tap();
        askTilt().then(function (granted) {
          tiltOn = granted;
          beginTurn();
        });
      });

      root.appendChild(el('div.intro.hu-setup',
        el('div.intro-emoji', '🙈'),
        el('h2', 'On My Forehead'),
        el('p.intro-lead', 'Hold the phone up. Your partner describes it. You shout the answer.'),
        el('ul.rules',
          el('li', '📱 Turn the phone sideways and hold it flat against your forehead, screen facing out.'),
          el('li', '🗣️ Your partner describes the word in ' + 'their own language, never saying it.'),
          el('li', '⬇️ Tilt down = got it. ⬆️ Tilt up = pass. Or tap: bottom half yes, top half skip.'),
          el('li', untimed
            ? '♾️ No clock. Tap 🏁 in the corner to end a turn, then swap the phone over.'
            : '⏱️ 60 seconds each, then swap the phone over.')
        ),
        el('h3.hu-step', '1 · Who is holding the phone?'),
        whoRow,
        el('h3.hu-step', '2 · Which deck?'),
        grid,
        start
      ));

      refresh();
    }

    /* ---------------------------------------------------------- the deck */

    /* Turn two should not replay turn one's cards, so the pool remembers
       what has been burned and only reshuffles once it runs dry. */
    function drawPile() {
      var pick = all.filter(function (w) {
        return game.deckId === 'all' || w.deck === game.deckId;
      });
      var fresh = pick.filter(function (w) { return !game.played[w.id]; });
      if (fresh.length < 6) {
        game.played = {};
        fresh = pick;
      }
      return U.shuffle(fresh);
    }

    /* ---------------------------------------------------------- board */

    function beginTurn() {
      var holder = game.holder;
      turn = {
        pid: holder.id,
        target: holder.target,
        pile: drawPile(),
        at: 0,
        card: null,
        shownAt: 0,
        hits: 0,
        passes: 0,
        combo: 0,
        best: 0,
        cards: [],       // every card seen this turn, hit or not
        busy: true,      // no scoring while a verdict is on screen
        armed: false,    // tilt must pass through vertical before it counts
        lastSec: 99,
        running: false
      };

      ctx.setSub(holder.name + ' holds it · ' + langName(holder.target));
      board();
      ctx.countdown(3).then(function () {
        if (dead || !turn) return;
        turn.running = true;
        turn.busy = false;
        watchTilt();
        clock = untimed ? U.noClock() : U.ticker(TURN_MS, tick, endTurn);
        nextCard();
      });
    }

    function board() {
      clear(root);
      root.classList.add('playing');

      ui.time = el('div.hud-time', untimed ? '∞' : '1:00');
      ui.score = el('div.hud-score', '0');
      ui.bar = el('i');
      ui.emoji = el('div.hu-emoji', '🙈');
      ui.word = el('div.hu-word');
      ui.tr = el('div.hu-tr');
      ui.note = el('div.hu-note');
      ui.flash = el('div.hu-flash');
      ui.combo = el('div.hu-combo');

      var stage = el('div.hu-stage',
        el('div.hu-half.hu-pass', { onclick: function () { score(false, 'tap'); } },
          el('div.hu-half-label', '⏭️ Pass')),
        el('div.hu-half.hu-hit', { onclick: function () { score(true, 'tap'); } },
          el('div.hu-half-label', '✅ Got it')),
        el('div.hu-card', ui.emoji, ui.word, ui.tr),
        el('div.hu-hud',
          el('div.hud-cell', ui.time),
          el('div.hu-bar', ui.bar),
          el('div.hud-cell', ui.score),
          // Without a buzzer the turn has to be ended by hand. It sits by
          // the quit button because that is the one corner the holder is
          // not tapping for verdicts.
          untimed ? el('button.hu-quit.hu-end', {
            onclick: function (e) {
              e.stopPropagation();
              SFX.tap();
              endTurn();
            }
          }, '🏁') : null,
          el('button.hu-quit', {
            onclick: function (e) {
              e.stopPropagation();
              SFX.tap();
              stopTurn();
              ctx.exit();
            }
          }, '✕')
        ),
        ui.combo,
        ui.note,
        ui.flash
      );

      root.appendChild(stage);
    }

    function tick(left) {
      if (!turn) return;
      ui.time.textContent = U.clock(left);
      ui.bar.style.width = Math.min(100, (left / TURN_MS) * 100) + '%';
      var urgent = left < 10000;
      ui.time.classList.toggle('urgent', urgent);

      // One beep per second in the last ten, louder for the last five,
      // because the holder cannot see the clock they are racing.
      var sec = Math.ceil(left / 1000);
      if (urgent && sec !== turn.lastSec && sec > 0) {
        turn.lastSec = sec;
        if (sec <= 5) { SFX.hurry(); U.buzz(15); } else SFX.tick();
      }
    }

    /* ---------------------------------------------------------- cards */

    function nextCard() {
      if (dead || !turn || !turn.running) return;
      if (turn.at >= turn.pile.length) turn.pile = U.shuffle(turn.pile);
      var w = turn.pile[turn.at % turn.pile.length];
      turn.at++;
      turn.card = w;
      turn.shownAt = Date.now();
      turn.busy = false;
      game.played[w.id] = true;

      var word = w[turn.target] || w.en;
      ui.emoji.textContent = w.emoji || '🃏';
      ui.word.textContent = word;
      ui.word.className = 'hu-word' + (turn.target === 'he' ? ' rtl' : '');
      ui.tr.textContent = turn.target === 'he' ? (w.t || '') : '';
      ui.tr.hidden = turn.target !== 'he';

      var card = ui.word.parentNode;
      card.classList.remove('deal');
      void card.offsetWidth;
      card.classList.add('deal');
      SFX.flip();
    }

    /* One card, one verdict. `how` is only there so a tilt cannot fire
       while the phone is already mid-swing on the previous one. */
    function score(hit, how) {
      if (dead || !turn || !turn.running || turn.busy || !turn.card) return;
      turn.busy = true;
      if (how === 'tilt') turn.armed = false;

      var w = turn.card;
      var ms = Date.now() - turn.shownAt;
      turn.cards.push({ w: w, hit: hit });
      Store.answered(turn.pid, hit, hit ? ms : 0);

      if (hit) {
        turn.hits++;
        turn.combo++;
        if (turn.combo > turn.best) turn.best = turn.combo;
        SFX.correct(turn.combo);
        U.buzz([30, 40, 30]);
      } else {
        turn.passes++;
        turn.combo = 0;
        SFX.pass();
        U.buzz(90);
      }

      ui.score.textContent = String(totalHits());
      ui.combo.textContent = turn.combo >= 3 ? '🔥 ' + turn.combo : '';

      flash(hit);
      flashTimer = setTimeout(function () {
        ui.flash.className = 'hu-flash';
        nextCard();
      }, FLASH_MS);
    }

    function flash(hit) {
      ui.flash.className = 'hu-flash';
      void ui.flash.offsetWidth;
      clear(ui.flash);
      ui.flash.appendChild(el('div.hu-flash-glyph', hit ? '✅' : '⏭️'));
      ui.flash.classList.add(hit ? 'good' : 'bad', 'on');
    }

    /* ---------------------------------------------------------- tilt */

    function onTilt(ev) {
      if (dead || !turn || !turn.running) return;
      if (ev.beta === null || ev.beta === undefined || ev.gamma === null || ev.gamma === undefined) return;

      if (!tiltOn) {
        // A reading arrived after all, so the gyroscope is live.
        tiltOn = true;
        if (ui.note) ui.note.textContent = '';
      }
      if (tiltTimer) { clearTimeout(tiltTimer); tiltTimer = null; }

      var a = tiltAngle(ev.beta, ev.gamma);

      // Coming back through vertical is what re-arms the card. Without
      // it a single sweep of the arm would burn the whole deck.
      if (Math.abs(a) < ARM_ANGLE) {
        turn.armed = true;
        return;
      }
      if (!turn.armed || turn.busy) return;
      if (a > HIT_ANGLE) score(true, 'tilt');
      else if (a < -HIT_ANGLE) score(false, 'tilt');
    }

    function watchTilt() {
      if (!window.DeviceOrientationEvent) {
        noTilt();
        return;
      }
      window.addEventListener('deviceorientation', onTilt);
      if (!tiltOn) {
        // Refused on iOS, or a laptop with nothing to report. Either way
        // say it once and let the taps carry the game.
        noTilt();
        return;
      }
      // Permission says yes, but a desktop Chrome says yes too and then
      // never fires. Give it a moment before admitting there is no tilt.
      tiltTimer = setTimeout(function () {
        tiltTimer = null;
        tiltOn = false;
        noTilt();
      }, TILT_WAIT_MS);
    }

    function noTilt() {
      if (ui.note) ui.note.textContent = '📵 No tilt on this phone — tap the top or bottom half instead.';
    }

    /* ---------------------------------------------------------- end of turn */

    function carried() {
      var n = 0;
      game.turns.forEach(function (t) { n += t.hits; });
      return n;
    }

    function totalHits() { return carried() + (turn ? turn.hits : 0); }

    function stopTurn() {
      if (clock) { clock.stop(); clock = null; }
      clearTimeout(flashTimer);
      clearTimeout(tiltTimer);
      tiltTimer = null;
      window.removeEventListener('deviceorientation', onTilt);
      if (turn) turn.running = false;
    }

    function endTurn() {
      if (dead || !turn) return;
      stopTurn();
      SFX.levelup();
      U.buzz([60, 60, 120]);
      game.turns.push(turn);
      var done = turn;
      turn = null;

      // A clean sweep is the same achievement as anywhere else on the site.
      if (done.hits >= 10 && done.passes === 0) Store.earn(done.pid, 'perfect');

      review(done);
    }

    /* ---------------------------------------------------------- review */

    function review(done) {
      clear(root);
      root.classList.remove('playing');
      var p = Store.player(done.pid);
      var other = Store.other(done.pid);
      var swapped = game.turns.length > 1;

      var panel = el('div.hu-review',
        el('div.hu-rev-head.who-' + p.color,
          el('div.hu-rev-emoji', p.emoji),
          el('div.hu-rev-title', p.name + '’s turn'),
          el('div.hu-rev-score', String(done.hits)),
          el('small', done.hits === 1 ? 'card' : 'cards')
        ),
        el('div.hu-rev-sub',
          '✅ ' + done.hits + '   ⏭️ ' + done.passes +
          (done.best >= 3 ? '   🔥 best chain ' + done.best : '') +
          '   ·   total ' + carried())
      );

      var list = el('div.hu-rev-list');
      if (!done.cards.length) {
        list.appendChild(el('div.hu-rev-none', 'Not a single card. Brutal.'));
      }
      done.cards.forEach(function (row) {
        var w = row.w;
        var word = w[done.target] || w.en;
        list.appendChild(el('div.hu-rev-row' + (row.hit ? '.hit' : '.miss'),
          el('span.hu-rev-mark', row.hit ? '✅' : '⏭️'),
          el('span.hu-rev-face', w.emoji || '🃏'),
          el('span.hu-rev-words',
            el('b' + (done.target === 'he' ? '.rtl' : ''), word),
            done.target === 'he' && w.t ? el('small.hu-rev-tr', w.t) : null,
            el('small.hu-rev-en', w.en)
          ),
          el('button.hu-say', {
            onclick: function () { SFX.tap(); Speech.speak(word, done.target, { rate: 0.85 }); }
          }, '🔊')
        ));
      });
      panel.appendChild(list);

      var btns = el('div.hu-rev-btns');
      if (!swapped) {
        btns.appendChild(el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.flip();
            game.holder = other;
            beginTurn();
          }
        }, '🔄 Pass it to ' + other.name));
        btns.appendChild(el('button.ghost-btn', {
          onclick: function () { SFX.tap(); done_(); }
        }, 'Stop here →'));
      } else {
        btns.appendChild(el('button.big-btn.primary.xl', {
          onclick: function () { SFX.tap(); done_(); }
        }, '🏁 See the score'));
      }
      panel.appendChild(btns);
      root.appendChild(panel);
    }

    /* ---------------------------------------------------------- results */

    function done_() {
      var total = carried();
      // Read the record before finish() writes the new one, otherwise
      // every round beats itself.
      var best = (Store.coop().best && Store.coop().best.headsup) || 0;
      var won = total > best;
      Store.coopResult(won, total);

      var lines = [];
      game.turns.forEach(function (t) {
        var p = Store.player(t.pid);
        lines.push([p.emoji + ' ' + p.name, t.hits + ' ✅ / ' + t.passes + ' ⏭️']);
      });
      var chain = 0;
      game.turns.forEach(function (t) { if (t.best > chain) chain = t.best; });
      lines.push(['Best chain', chain]);

      var missed = [];
      game.turns.forEach(function (t) {
        t.cards.forEach(function (row) {
          if (row.hit) return;
          var w = row.w;
          missed.push({
            prompt: w.en,
            answer: w[t.target] || w.en,
            hint: t.target === 'he' ? (w.t || '') : null
          });
        });
      });

      ctx.finish({
        won: won,
        emoji: total >= 20 ? '🚀' : total >= 12 ? '🎉' : '🙈',
        title: won ? 'New team record!' : total >= 12 ? 'Good shouting' : 'Phones down',
        subtitle: won ? null : 'Your record together is ' + best + '. Go again.',
        score: total,
        xp: total * 5,
        lines: lines,
        missed: missed,
        badges: []
      });
    }

    /* ---------------------------------------------------------- helpers */

    function langName(l) { return l === 'he' ? 'Hebrew' : l === 'fr' ? 'French' : 'English'; }

    setup();

    return function teardown() {
      dead = true;
      stopTurn();
      turn = null;
      Speech.shutUp();
      root.classList.remove('playing', 'headsup-game');
    };
  }

  return {
    id: 'headsup',
    emoji: '🙈',
    mode: 'coop',
    title: { en: 'On My Forehead', he: 'על המצח', fr: 'Sur le front' },
    tagline: { en: 'Hold the phone up. Your partner describes it.' },
    mount: mount
  };
})();
