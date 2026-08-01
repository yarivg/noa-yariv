/* ============================================================
   texting.js: Texting. The chat thread game.

   Phrase Race gives you a sentence on a card and asks for it back.
   This one gives you the same job dressed as the thing you actually
   do forty times a day: your partner texts you, and you have to
   reply before they see you typing.

   The whole game is the illusion. The header is their name and a
   green dot, the message lands on the left after a "typing…" bubble,
   and while the microphone is open your own half-finished words sit
   in a translucent bubble on the right that firms up when it sends.
   Getting it right sends with a blue ✓✓; getting it nearly right
   sends with one tick and a quiet correction underneath.

   There is no big clock, because a chat has no clock. Twelve seconds
   run as a hair-thin bar across the composer, and when they are
   nearly gone the other side starts "typing…" at you, which is a
   more honest kind of pressure than a red number.
   ============================================================ */

window.Games = window.Games || {};
window.Games.texting = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var MIN_LINES = 8;        // a round is never shorter than this
  var MAX_LINES = 12;       // ...and never long enough to become a chore
  var LINE_MS = 12000;
  var FAST_MS = 5000;       // reply under this and the speed bonus pays
  var NAG_MS = 4000;        // they start "typing…" at you this late
  var LISTEN_MS = 8000;
  var TYPING_MS = 950;      // how long their typing bubble bounces
  var BASE_PTS = 20;
  var FAST_BONUS = 10;
  var THREAD_BONUS = 50;    // a whole conversation with no miss

  /* The shell fetches data/<file>.json and unwraps the key that matches
     the file name. chat.json wraps its content in `threads`, so what
     lands here can be either the array or the whole file. Take both,
     and take neither without falling over: this game ships before its
     content does. */
  function threadsFrom(data) {
    var raw = (data && data.chat) || [];
    if (!Array.isArray(raw) && raw.threads) raw = raw.threads;
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (t) {
      return t && Array.isArray(t.lines) && t.lines.length;
    });
  }

  /* One thread is the round. A five line thread would be over before
     the joke lands, so short threads roll straight into a second one,
     which reads as the two of you having moved on to another subject. */
  function buildRound(all, from, to) {
    var usable = all.map(function (t) {
      var lines = t.lines.filter(function (l) { return l && l[from] && l[to]; });
      return { id: t.id, title: t.title, emoji: t.emoji, level: t.level || 1, lines: lines };
    }).filter(function (t) { return t.lines.length; });

    // Threads are a short list, so the usual minimum of eight would
    // switch the difficulty filter off on every deck.
    var pool = U.shuffle(Store.levelled(usable, 3));

    var threads = [], lines = [];
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i];
      threads.push(t);
      for (var j = 0; j < t.lines.length && lines.length < MAX_LINES; j++) {
        lines.push({ line: t.lines[j], thread: threads.length - 1 });
      }
      if (lines.length >= MIN_LINES) break;
    }
    return { threads: threads, lines: lines };
  }

  function mount(root, ctx) {
    root.classList.add('texting-game');

    var me = ctx.player;
    var mate = ctx.partner || Store.other(me.id);
    var from = me.native, to = me.target;   // they text in one, you answer in the other
    var canMic = Speech.canListen();

    var round = buildRound(threadsFrom(ctx.data), from, to);
    if (!round.lines.length) return empty();

    var state = {
      idx: -1, score: 0, combo: 0, bestCombo: 0, hits: 0, misses: 0,
      missed: [], shownAt: 0, locked: true, dead: false,
      hurried: 0, thread: -1, threadMisses: 0, cleanThreads: 0
    };

    var clock = null, mic = null, timers = [];
    // A fake clock a few minutes in the past, so the first message is
    // not stamped with the exact second the player pressed Start.
    var stamp = Date.now() - 9 * 60000;

    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function stopClock() { if (clock) { clock.stop(); clock = null; } }
    function stopMic() { if (mic) { mic.stop(); mic = null; } }

    /* ---------------------------------------------------------- no content */

    function empty() {
      clear(root);
      root.appendChild(el('div.panel.tx-empty',
        el('div.intro-emoji', '💬'),
        el('h3', 'Nobody has texted yet'),
        el('p', 'data/chat.json has no thread with both languages in it, so there is nothing to reply to. Add one and this game turns itself on.'),
        el('button.big-btn.primary', {
          onclick: function () { SFX.tap(); ctx.exit(); }
        }, '← Back')
      ));
      return function teardown() { /* nothing was ever started */ };
    }

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);
      root.appendChild(el('div.intro',
        el('div.intro-emoji', '💬'),
        el('h2', 'Texting'),
        el('p.intro-lead',
          mate.name + ' is texting you in ' + langName(from) +
          '. Reply with the same line in ' + langName(to) + ' before the bar runs out.'),
        el('ul.rules',
          el('li', '📩 ' + round.lines.length + ' messages. 12 seconds each.'),
          el('li', canMic
            ? '🎤 Tap the mic and say your reply. It types itself into the bubble.'
            : '⌨️ No microphone in this browser, so you type your replies instead. Same game, same grading, and nobody can hear your accent.'),
          el('li', '✓✓ Spot on sends with two blue ticks. One tick means close enough.'),
          el('li', '🔥 3 in a row = double points. 6 in a row = triple. A clean thread is worth 50.')
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(next);
          }
        }, 'Open chat ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    var ui = {};

    function board() {
      clear(root);

      ui.status = el('div.tx-status', el('i.tx-dot'), el('span', 'online'));
      ui.score = el('div.hud-score.tx-points', '0');
      ui.combo = el('div.hud-combo.tx-streak');

      ui.phone = el('div.tx-phone',
        el('div.tx-head',
          el('div.tx-avatar.who-' + mate.color, mate.emoji),
          el('div.tx-who',
            el('div.tx-name', mate.name),
            ui.status),
          el('div.tx-tally', ui.score, ui.combo)
        ),
        ui.thread = el('div.tx-thread'),
        ui.composer = el('div.tx-composer',
          el('div.timebar.tx-timebar', ui.bar = el('i')))
      );
      root.appendChild(ui.phone);

      ui.pad = el('div.tx-pad');
      ui.composer.appendChild(ui.pad);
      idlePad('Waiting for ' + mate.name + '…');
    }

    /* ---------------------------------------------------------- bubbles */

    function clockLabel() {
      stamp += 40000 + Math.floor(Math.random() * 80000);
      var d = new Date(stamp);
      return d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }

    function scroll() {
      // Always keep the newest message on screen, the way a real thread does.
      ui.thread.scrollTop = ui.thread.scrollHeight;
    }

    function push(node) {
      ui.thread.appendChild(node);
      scroll();
      return node;
    }

    // The subject-change chip, so a second thread does not read as one
    // conversation that suddenly lost the plot.
    function divider(t) {
      push(el('div.tx-divider', el('span', (t.emoji ? t.emoji + ' ' : '') + (t.title || 'new chat'))));
    }

    function bubble(side, lang, text, extras) {
      var body = el('div.tx-bubble' + (lang === 'he' ? '.rtl' : ''), text);
      var msg = el('div.tx-msg.' + side, body);
      if (extras) extras.forEach(function (n) { if (n) msg.appendChild(n); });
      return msg;
    }

    function meta(time, ticks, tickClass) {
      return el('div.tx-meta',
        el('span', time),
        ticks ? el('span.tx-ticks' + (tickClass ? '.' + tickClass : ''), ticks) : null);
    }

    /* ---------------------------------------------------------- the loop */

    function next() {
      if (state.dead) return;
      state.idx++;
      if (state.idx >= round.lines.length) return closeThread(end);

      var item = round.lines[state.idx];
      if (item.thread !== state.thread) {
        // Finish scoring the old conversation before opening the new one.
        return closeThread(function () {
          state.thread = item.thread;
          state.threadMisses = 0;
          divider(round.threads[item.thread]);
          later(incoming, 320);
        });
      }
      incoming();
    }

    function current() { return round.lines[state.idx].line; }

    function incoming() {
      if (state.dead) return;
      state.locked = true;
      ctx.setSub('Message ' + (state.idx + 1) + ' of ' + round.lines.length);
      setStatus('typing…', true);
      idlePad(mate.name + ' is typing…');

      var dots = push(el('div.tx-msg.in.tx-typing',
        el('div.tx-bubble', el('i'), el('i'), el('i'))));

      later(function () {
        if (state.dead) return;
        dots.remove();
        setStatus('online', false);

        var s = current();
        // One flip as the message lands. Ticking on every dot cycle would
        // turn a two second wait into a woodpecker.
        SFX.flip();
        push(bubble('in', from, s[from], [
          from === 'he' && s.t ? el('div.tx-translit', s.t) : null,
          meta(clockLabel())
        ]));
        U.buzz(15);

        state.shownAt = Date.now();
        state.hurried = 0;
        state.locked = false;
        armPad(s);
        startClock(s);
      }, TYPING_MS);
    }

    function startClock(s) {
      stopClock();
      clock = U.ticker(LINE_MS, function (left) {
        ui.bar.style.width = Math.min(100, (left / LINE_MS) * 100) + '%';
        ui.composer.classList.toggle('hot', left < NAG_MS);
        // They start typing again while you are still stuck. That is the nag.
        if (left < NAG_MS) setStatus('typing…', true);
        var secs = Math.ceil(left / 1000);
        if (secs <= 3 && secs !== state.hurried) { state.hurried = secs; SFX.hurry(); }
      }, function () {
        if (!state.locked) timeout(s);
      });
    }

    /* ---------------------------------------------------------- composer */

    function idlePad(note) {
      clear(ui.pad);
      ui.pad.appendChild(el('div.tx-wait', note));
    }

    function armPad(s) {
      clear(ui.pad);
      if (canMic) {
        ui.pad.appendChild(el('div.tx-mic-row',
          el('div.tx-fakefield', 'Reply in ' + langName(to) + '…'),
          el('button.tx-mic', {
            'aria-label': 'Record your reply',
            onclick: function () { SFX.flip(); openMic(s); }
          }, '🎤')
        ));
      } else {
        typePad(s);
      }
    }

    /* The typed composer is not a consolation prize. Firefox has no
       recogniser at all, and typing a reply into a chat is exactly what
       the game is imitating, so it gets the real input, the real send
       button and the same bubble that flies out of it. */
    function typePad(s) {
      clear(ui.pad);
      var input = el('input.tx-input' + (to === 'he' ? '.rtl' : ''), {
        type: 'text',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        placeholder: 'Reply in ' + langName(to) + '…',
        onkeydown: function (e) { if (e.key === 'Enter') fire(); }
      });
      var btn = el('button.tx-send', { 'aria-label': 'Send', onclick: fire }, '➤');

      function fire() {
        if (state.locked) return;
        var text = input.value.trim();
        if (!text) { SFX.pass(); return; }
        judge(s, text);
      }

      ui.pad.appendChild(el('div.tx-type-row', input, btn));
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }

    /* ---------------------------------------------------------- the mic */

    function openMic(s) {
      if (state.locked) return;

      // The live transcript is the gag: a half-transparent outgoing
      // bubble that fills in while you are still talking.
      var ghostBody = el('div.tx-bubble' + (to === 'he' ? '.rtl' : ''), '…');
      var ghost = push(el('div.tx-msg.out.tx-ghost', ghostBody));

      clear(ui.pad);
      ui.pad.appendChild(el('div.listening.tx-listening', {
        onclick: function () { settle(ghostBody.textContent); }
      },
        el('div.mic-dot', '🎤'),
        el('div.mic-copy', el('b', 'Listening…'), el('div.heard', 'tap to send')),
        el('div.mic-bar')
      ));

      var settled = false;
      var micTimer = null;

      function settle(text) {
        if (settled || state.dead) return;
        settled = true;
        stopMic();
        clearTimeout(micTimer);
        ghost.remove();
        if (String(text || '').replace(/…/g, '').trim()) judge(s, text);
        else miss(s, null);
      }

      var accepted = answers(s);

      mic = Speech.listen({
        lang: to,
        continuous: false,
        onPartial: function (text) {
          ghostBody.textContent = text;
          scroll();
          // Send the instant it is already right, so a quick reply feels quick.
          if (U.grade(text, accepted, to) === 'exact') settle(text);
        },
        onFinal: function (text, alts) {
          ghostBody.textContent = text;
          scroll();
          // Prefer whichever alternative the grader likes best; the
          // recogniser's first guess is not always its cleverest.
          var best = text;
          for (var i = 0; i < alts.length; i++) {
            if (U.grade(alts[i], accepted, to) === 'exact') { best = alts[i]; break; }
          }
          settle(best);
        },
        onError: function () { settle(ghostBody.textContent); },
        onEnd: function () { later(function () { settle(ghostBody.textContent); }, 140); }
      });

      // No handle means the recogniser said yes and then died. Type instead,
      // for this line and every one after it.
      if (!mic) {
        ghost.remove();
        canMic = false;
        ctx.toast('No microphone here, type it instead', 'warn');
        return typePad(s);
      }
      micTimer = setTimeout(function () { settle(ghostBody.textContent); }, LISTEN_MS);
      timers.push(micTimer);
    }

    function answers(s) { return [s[to]].concat((s.alt && s.alt[to]) || []); }

    /* ---------------------------------------------------------- verdicts */

    function multiplier() { return state.combo >= 6 ? 3 : state.combo >= 3 ? 2 : 1; }

    function judge(s, text) {
      if (state.locked) return;
      state.locked = true;
      stopClock();
      stopMic();

      var quality = U.grade(text, answers(s), to);
      if (quality === 'no') return miss(s, text);

      var ms = Date.now() - state.shownAt;
      var pts = BASE_PTS + (ms < FAST_MS ? FAST_BONUS : 0);
      if (quality === 'close') pts = Math.round(pts * 0.6);
      pts *= multiplier();

      state.score += pts;
      state.combo++;
      state.hits++;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      Store.answered(me.id, true, ms);
      if (state.combo === 5) Store.earn(me.id, 'combo-5');
      if (state.combo === 10) Store.earn(me.id, 'combo-10');

      var exact = quality === 'exact';
      // Two blue ticks for spot on, one grey tick plus the model answer
      // for close enough: the correction has to be readable without
      // stopping the conversation to explain itself.
      sent(text, exact ? '✓✓' : '✓', exact ? 'read' : 'one',
        exact ? null : correction(s), exact ? 'ok' : 'near');

      SFX.correct(state.combo);
      U.buzz(25);
      paint('+' + pts + (state.combo >= 3 ? '  🔥×' + multiplier() : ''));
      readBack(s);
    }

    function miss(s, text) {
      state.locked = true;
      stopClock();
      stopMic();
      register(s);

      if (text) sent(text, '!', 'fail', null, 'bad');
      reveal(s);
      SFX.wrong();
      paint('');
      readBack(s);
    }

    // Out of time sends nothing at all, which on a phone is the loudest
    // thing you can possibly do.
    function timeout(s) {
      state.locked = true;
      stopClock();
      stopMic();
      register(s);

      push(el('div.tx-divider.tx-late', el('span', '⌛ you left them on read')));
      reveal(s);
      SFX.wrong();
      paint('');
      readBack(s);
    }

    function register(s) {
      state.combo = 0;
      state.misses++;
      state.threadMisses++;
      Store.answered(me.id, false);
      state.missed.push({
        prompt: s[from],
        answer: s[to],
        hint: to === 'he' ? s.t : s.en
      });
    }

    function sent(text, ticks, tickClass, note, kind) {
      idlePad('sent');
      SFX.swipe();
      var msg = push(bubble('out', to, text, [
        meta(clockLabel(), ticks, tickClass),
        note
      ]));
      msg.classList.add('tx-land');
      if (kind) msg.classList.add('tx-' + kind);
      scroll();
    }

    function correction(s) {
      return el('div.tx-fix',
        el('small', 'closer:'),
        el('span' + (to === 'he' ? '.rtl' : ''), s[to]),
        to === 'he' && s.t ? el('small.tx-fix-t', s.t) : null);
    }

    function reveal(s) {
      push(el('div.tx-reveal',
        el('small', 'you should have sent'),
        el('span' + (to === 'he' ? '.rtl' : ''), s[to]),
        to === 'he' && s.t ? el('small.tx-fix-t', s.t) : null));
    }

    /* Right or wrong, the phone reads the correct line before the next
       message arrives. Move on when the voice finishes or when the safety
       net fires, because a silent device must not stall the thread. */
    function readBack(s) {
      var moved = false;
      function go() {
        if (moved || state.dead) return;
        moved = true;
        idlePad(mate.name + ' is typing…');
        next();
      }
      Speech.speak(s[to], to, { rate: 0.9 }).then(function () { later(go, 500); });
      later(go, 4500);
    }

    function paint(pop) {
      ui.score.textContent = String(state.score);
      ui.combo.textContent = state.combo >= 2 ? '🔥 ' + state.combo : '';
      ui.combo.className = 'hud-combo tx-streak' + (state.combo >= 3 ? ' hot' : '');
      if (pop) {
        // Floated over the phone rather than added to the thread: points
        // are the game talking, not one of the two of you.
        var chip = el('div.tx-pop', pop);
        ui.phone.appendChild(chip);
        later(function () { chip.remove(); }, 1100);
      }
    }

    function setStatus(text, typing) {
      ui.status.lastChild.textContent = text;
      ui.status.classList.toggle('is-typing', !!typing);
    }

    /* ---------------------------------------------------------- threads */

    // A conversation you got through without a single miss is the unit
    // the bonus is paid on, not the round, so a two thread round can
    // still half-win.
    function closeThread(done) {
      if (state.thread >= 0 && state.threadMisses === 0) {
        state.score += THREAD_BONUS;
        state.cleanThreads++;
        SFX.badge();
        ctx.toast('Clean thread! +' + THREAD_BONUS, 'good');
        paint('');
        return later(done, 700);
      }
      done();
    }

    /* ---------------------------------------------------------- end */

    function end() {
      if (state.dead) return;
      state.dead = true;
      stopClock();
      stopMic();
      clearTimers();
      Speech.shutUp();

      var total = round.lines.length;
      var badges = [];
      if (state.cleanThreads > 0) badges.push(Store.earn(me.id, 'perfect'));

      var titles = round.threads.map(function (t) { return t.title || 'chat'; }).join(' + ');
      var half = Math.ceil(total / 2);

      ctx.finish({
        won: state.hits >= half,
        emoji: state.misses === 0 ? '🏆' : state.hits >= total - 1 ? '🎉' : state.hits >= half ? '👏' : '📵',
        title: state.misses === 0 ? 'Not one message missed'
          : state.hits >= total - 1 ? 'Fast fingers'
            : state.hits >= half ? 'You held the conversation' : 'They gave up on you',
        subtitle: state.cleanThreads > 0 ? 'A whole thread without a slip.' : null,
        score: state.score,
        xp: Math.round(state.score / 4) + state.hits * 3,
        lines: [
          ['Sent', state.hits],
          ['Missed', state.misses],
          ['Best chain', state.bestCombo],
          ['Thread', titles]
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
    id: 'texting',
    emoji: '💬',
    mode: 'solo',
    title: { en: 'Texting', he: 'הודעות', fr: 'Messages' },
    tagline: { en: 'Answer the chat before they see you typing' },
    mount: mount
  };
})();
