/* ============================================================
   tabou.js - Taboo. The talking game.

   One phone, two people, ninety seconds each. The describer holds
   the phone and talks; the guesser looks away and listens.

   The whole point is the direction of the language. You describe in
   the language you are LEARNING, and your partner hears their own
   native language, so they can guess quickly and you do all the
   work. The card therefore shows the describer the word in their
   NATIVE tongue (they need to know what to convey) and the four
   forbidden words in the language they are about to speak.

   Two halves, one shared score, because a pair that argues about
   whose points these are has stopped playing together.
   ============================================================ */

window.Games = window.Games || {};
window.Games.tabou = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var HALF_MS = 90000;
  var PASS_COST_MS = 3000;   // a pass is free of penalty but not of time
  var PASSES_PER_HALF = 3;
  var GOT_POINTS = 10;
  var SLIP_POINTS = -5;      // the honesty button, and it has to sting
  var TELEPATH_CARDS = 12;

  function mount(root, ctx) {
    root.classList.add('tabou-game');

    /* Co-op: ctx.player is null here, so never touch it. The pair
       always comes straight out of the store. */
    var noa = Store.player('noa');
    var yariv = Store.player('yariv');

    var halves = [half(noa), half(yariv)];
    function half(who) {
      return { who: who, score: 0, got: 0, passes: 0, slips: 0 };
    }

    var cards = (ctx.data && ctx.data.tabou) || [];
    var deck = U.shuffle(cards);
    var i = -1;                 // runs across both halves so half two gets fresh cards
    var h = 0;                  // which half we are in
    var missed = [];
    var combo = 0, bestCombo = 0;
    var shownAt = 0, dead = false, busy = false;
    var bestBefore = (Store.coop().best.tabou) || 0;

    var clock = null, hop = null, lastSec = 0;
    var ui = {};

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);

      if (!deck.length) {
        root.appendChild(el('div.intro',
          el('div.intro-emoji', '🚫'),
          el('h2', 'No cards'),
          el('p.intro-lead', 'The Taboo deck did not load. Try again in a moment.'),
          el('button.big-btn.primary.xl', {
            onclick: function () { SFX.tap(); ctx.exit(); }
          }, '🏠 Home')
        ));
        return;
      }

      root.appendChild(el('div.intro',
        el('div.intro-emoji', '🚫'),
        el('h2', 'Taboo'),
        el('p.intro-lead',
          'Describe the word out loud in the language you are learning. Your partner guesses in their own language.'),
        el('ul.rules',
          el('li', '📱 Only the describer looks at the screen.'),
          el('li', '🚫 Four words are forbidden. Say one and it costs you 5.'),
          el('li', '⏱️ 90 seconds each. ' + noa.name + ' first, then ' + yariv.name + '.'),
          el('li', '🤝 One score for the two of you.')
        ),
        el('div.tb-who-row', whoChip(noa), whoChip(yariv)),
        el('button.big-btn.primary.xl', {
          onclick: function () { SFX.wake(); SFX.tap(); handover(); }
        }, 'Start ▶')
      ));
    }

    // Says, up front, which way each person will be talking.
    function whoChip(p) {
      return el('div.tb-who.who-' + p.color,
        el('div.tb-who-emoji', p.emoji),
        el('div.tb-who-name', p.name),
        el('small', 'speaks ' + langName(p.target) + ' ' + p.targetFlag)
      );
    }

    /* ---------------------------------------------------------- handover */

    /* The most important screen in the game: the wrong person reading
       the card ruins the round, so this is loud about who holds it. */
    function handover() {
      var me = halves[h].who;
      var them = halves[h].who === noa ? yariv : noa;
      clear(root);
      ctx.setSub(me.name + ' describes · ' + langName(me.target) + ' ' + me.targetFlag);

      root.appendChild(el('div.panel.tb-hand.who-' + me.color,
        el('div.tb-hand-half', h === 0 ? 'First half' : 'Second half'),
        el('div.tb-hand-emoji', me.emoji),
        el('h2.tb-hand-name', me.name + ', take the phone'),
        el('p.tb-hand-lead',
          'You describe in ' + langName(me.target) + ' ' + me.targetFlag +
          '. ' + them.name + ', look away and shout your guesses in ' + langName(them.native) + '.'),
        el('div.tb-hand-warn', '🙈 ' + them.name + ' must not see the screen'),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(startHalf);
          }
        }, 'I have the phone ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    function board() {
      var me = halves[h].who;
      clear(root);

      ui.time = el('div.hud-time', U.clock(HALF_MS));
      ui.score = el('div.hud-score', String(total()));
      ui.combo = el('div.hud-combo');
      ui.bar = el('i');

      root.appendChild(el('div.hud',
        el('div.hud-cell', el('small', 'time'), ui.time),
        el('div.hud-cell.wide', el('div.timebar', ui.bar), ui.combo),
        el('div.hud-cell', el('small', 'team'), ui.score)
      ));

      root.appendChild(el('div.tb-turn.who-' + me.color,
        el('span.tb-turn-emoji', me.emoji),
        el('span', me.name + ' is describing in ' + langName(me.target)),
        el('span.tb-turn-flag', me.targetFlag)
      ));

      ui.card = el('div.card.tb-card');
      root.appendChild(el('div.card-stage', ui.card));

      ui.action = el('div.action-zone.tb-action');
      root.appendChild(ui.action);
    }

    function startHalf() {
      lastSec = Math.ceil(HALF_MS / 1000);
      clock = U.ticker(HALF_MS, function (left) {
        ui.time.textContent = U.clock(left);
        ui.bar.style.width = Math.min(100, (left / HALF_MS) * 100) + '%';
        ui.time.classList.toggle('urgent', left < 10000);
        beep(left);
      }, endHalf);
      nextCard();
    }

    // One sound per whole second, never per frame.
    function beep(left) {
      var s = Math.ceil(left / 1000);
      if (s >= lastSec) return;
      lastSec = s;
      if (s <= 0) return;
      if (s <= 5) SFX.tick();
      else if (s <= 10) SFX.hurry();
    }

    /* ---------------------------------------------------------- a card */

    function current() { return deck[i % deck.length]; }

    function nextCard() {
      if (dead) return;
      i++;
      busy = false;
      shownAt = Date.now();

      var me = halves[h].who;
      var show = me.native;    // the word, in the language the describer already has
      var speak = me.target;   // what they must talk in, and what is forbidden
      var w = current();

      clear(ui.card);
      ui.card.className = 'card tb-card';
      void ui.card.offsetWidth;
      ui.card.classList.add('deal');

      ui.card.appendChild(el('div.card-theme', '🗣️ get them to say it'));
      ui.card.appendChild(el('div.card-word' + (show === 'he' ? '.rtl' : ''), w[show]));
      if (show === 'he') ui.card.appendChild(el('div.card-translit', w.t));

      var banned = (w.banned && w.banned[speak]) || [];
      var list = el('div.tb-bans' + (speak === 'he' ? '.rtl' : ''));
      banned.forEach(function (b) {
        list.appendChild(el('div.tb-ban', el('span.tb-ban-x', '🚫'), el('span.tb-ban-w', b)));
      });
      ui.card.appendChild(el('div.tb-forbidden',
        el('div.tb-forbidden-title', 'forbidden'),
        list));

      ui.card.appendChild(el('div.tb-speaking',
        me.targetFlag + ' you are speaking ' + langName(speak)));

      drawButtons();
    }

    function drawButtons() {
      var st = halves[h];
      var left = PASSES_PER_HALF - st.passes;

      clear(ui.action);
      // Got it and Pass sit at opposite ends: a misfire here costs
      // real points, so the thumb must travel between them.
      ui.action.appendChild(el('div.tb-main-btns',
        el('button.big-btn.xl.tb-pass' + (left <= 0 ? '.is-spent' : ''), {
          disabled: left <= 0,
          onclick: function () { pass(); }
        }, '⏭️ Pass', el('small', left > 0 ? left + ' left · −3s' : 'none left')),
        el('button.big-btn.xl.good.tb-got', {
          onclick: function () { got(); }
        }, '✅ Got it')
      ));
      ui.action.appendChild(el('button.ghost-btn.tb-slip', {
        onclick: function () { slip(); }
      }, '🚫 I said a banned word (−5)'));
    }

    /* ---------------------------------------------------------- verdicts */

    function got() {
      if (busy || dead) return;
      busy = true;
      var st = halves[h];

      st.score += GOT_POINTS;
      st.got++;
      combo++;
      if (combo > bestCombo) bestCombo = combo;

      Store.answered(st.who.id, true, Date.now() - shownAt);
      SFX.correct(combo);
      U.buzz(25);
      flash('good', '+' + GOT_POINTS, combo >= 3 ? '🔥 ' + combo + ' in a row' : '');
      paint();
      advance(380);
    }

    function pass() {
      if (busy || dead) return;
      var st = halves[h];
      if (st.passes >= PASSES_PER_HALF) return;
      busy = true;

      st.passes++;
      combo = 0;
      Store.answered(st.who.id, false);
      remember(current(), st.who);

      SFX.pass();
      U.buzz(15);
      if (clock) clock.add(-PASS_COST_MS);   // the pass is paid for in seconds
      flash('bad', '−3s', 'passed');
      paint();
      advance(320);
    }

    function slip() {
      if (busy || dead) return;
      busy = true;
      var st = halves[h];

      st.score += SLIP_POINTS;
      st.slips++;
      combo = 0;
      Store.answered(st.who.id, false);
      remember(current(), st.who);

      SFX.wrong();
      U.buzz([40, 60, 40]);
      flash('bad', String(SLIP_POINTS), 'banned word');
      paint();
      advance(560);
    }

    // Everything they did not clear is the actual lesson.
    function remember(w, who) {
      if (!w) return;
      missed.push({
        prompt: w.en,
        answer: w[who.target],
        hint: w.t
      });
    }

    function advance(ms) {
      hop = setTimeout(nextCard, ms);
    }

    function flash(kind, big, small) {
      ui.card.classList.add('flash-' + kind);
      if (big) ui.card.appendChild(el('div.points-pop', big, small ? el('small', small) : null));
    }

    function paint() {
      ui.score.textContent = String(total());
      ui.combo.textContent = combo >= 2 ? '🔥 ' + combo + ' in a row' : '';
      ui.combo.className = 'hud-combo' + (combo >= 3 ? ' hot' : '');
      drawButtons();
    }

    function total() { return halves[0].score + halves[1].score; }
    function cleared() { return halves[0].got + halves[1].got; }
    function slips() { return halves[0].slips + halves[1].slips; }

    /* ---------------------------------------------------------- halves */

    function endHalf() {
      if (dead) return;
      if (clock) { clock.stop(); clock = null; }
      clearTimeout(hop);
      combo = 0;

      if (h === 0) { h = 1; halfTime(); return; }
      endGame();
    }

    function halfTime() {
      var done = halves[0], next = halves[1];
      clear(root);
      SFX.levelup();
      ctx.setSub('half time');

      root.appendChild(el('div.panel.tb-halftime',
        el('div.tb-hand-half', 'Half time'),
        el('div.tb-ht-score', String(total()), el('small', 'points so far')),
        el('div.tb-ht-line',
          el('span', done.who.emoji + ' ' + done.who.name),
          el('b', done.got + ' cleared'),
          el('small', done.passes + ' passed · ' + done.slips + ' slips')),
        el('p.tb-hand-lead',
          'Swap. ' + next.who.name + ' describes in ' + langName(next.who.target) + ' ' + next.who.targetFlag + ' now.'),
        el('button.big-btn.primary.xl', {
          onclick: function () { SFX.tap(); handover(); }
        }, '🔄 Swap over')
      ));
    }

    /* ---------------------------------------------------------- end */

    function endGame() {
      if (dead) return;
      dead = true;
      clearTimeout(hop);

      var score = total();
      var won = score > bestBefore;
      Store.coopResult(won, score);

      var badges = [];
      if (cleared() >= TELEPATH_CARDS) {
        badges.push(Store.earn('noa', 'telepath'));
        badges.push(Store.earn('yariv', 'telepath'));
      }

      ctx.finish({
        won: won,
        emoji: score >= 160 ? '🧠' : score >= 80 ? '🎉' : '👏',
        title: won ? 'New team record!' : score >= 80 ? 'Good talking' : 'Time!',
        subtitle: won
          ? 'Beat your old best of ' + bestBefore + '.'
          : 'Your best together is ' + bestBefore + '.',
        score: score,
        xp: Math.max(0, score * 2),
        lines: [
          [noa.emoji + ' ' + noa.name + "'s half", halves[0].score],
          [yariv.emoji + ' ' + yariv.name + "'s half", halves[1].score],
          ['Cards cleared', cleared()],
          ['Banned-word slips', slips()],
          ['Best chain', bestCombo]
        ],
        missed: missed,
        badges: badges
      });
    }

    /* ---------------------------------------------------------- helpers */

    function langName(l) { return l === 'he' ? 'Hebrew' : l === 'fr' ? 'French' : 'English'; }

    intro();

    return function teardown() {
      dead = true;
      if (clock) { clock.stop(); clock = null; }
      clearTimeout(hop);
    };
  }

  return {
    id: 'tabou',
    emoji: '🚫',
    mode: 'coop',
    title: { en: 'Taboo', he: 'טאבו', fr: 'Tabou' },
    tagline: { en: 'Describe it without the forbidden words' },
    mount: mount
  };
})();
