/* ============================================================
   describe.js - Describe It. The picture game.

   A scene built out of nothing but emoji, and forty-five seconds
   to talk about it out loud in the language you are learning. The
   words we are listening for sit under the picture as face-down
   chips: you can see what each one *means* in English, but not
   what it is. Say it and it flips.

   The mic runs continuously for the whole scene rather than per
   answer, because the point of this game is a stream of speech,
   not a sequence of single words. Nothing here punishes a wrong
   guess: the only clock is the clock, so the player keeps talking
   instead of stopping to be careful.

   Firefox has no recogniser, so the same board doubles as an
   honour-system board: the player says the word themselves and
   taps the chip. That is worth less, and the intro says so.
   ============================================================ */

window.Games = window.Games || {};
window.Games.describe = (function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var SCENE_MS = 45000;
  var SCENES = 3;           // one round is three pictures, easy to hard
  var PER_WORD = 20;
  var HONOUR = 0.6;         // self-marked chips pay less
  var CLEAR_PER_SEC = 3;    // bonus for every second left on a cleared scene

  // Soft washes for the picture frame. One per scene so three
  // pictures in a row do not blur into the same beige rectangle.
  var TINTS = ['tint-sun', 'tint-sea', 'tint-mint', 'tint-berry', 'tint-plum'];

  function mount(root, ctx) {
    root.classList.add('describe-game');

    var me = ctx.player;
    var to = me.target;                 // the language we listen in
    var scenes = pickScenes(Store.levelled(ctx.data.scenes, 3), to);
    var untimed = Store.untimed();      // no buzzer: the player moves on by hand

    var state = {
      score: 0, combo: 0, bestCombo: 0,
      found: 0, cleared: 0, missed: [],
      dead: false
    };

    // live is not the same question as Speech.canListen(): the
    // recogniser can also refuse to start (denied mic, another tab
    // holding it), and then we drop to honour mode mid-round.
    var live = Speech.canListen();

    var mic = null, clock = null, gap = null;
    var scene = null;                   // the scene currently on screen
    var ui = {};

    /* ---------------------------------------------------------- intro */

    function intro() {
      clear(root);
      root.appendChild(el('div.intro',
        el('div.intro-emoji', '🖼️'),
        el('h2', 'Describe It'),
        el('p.intro-lead',
          'Three pictures. Talk about each one out loud in ' + langName(to) +
          ' and the words hiding underneath flip over.'),
        el('ul.rules',
          el('li', untimed
            ? '♾️ No clock. Stay on a picture as long as you like, then tap for the next one.'
            : '⏱️ 45 seconds a picture. Keep talking, do not stop to think.'),
          el('li', '🃏 Each chip shows only its English meaning. Say the ' +
            langName(to) + ' word and it turns face up.'),
          el('li', '🔥 Chips in a row build a multiplier, like the duel.'),
          el('li', untimed
            ? '🏁 Flip every chip to clear the picture. The time bonus needs a clock, so there is none.'
            : '🏁 Flip every chip before the buzzer for a big time bonus.'),
          el('li', live
            ? '🎤 The microphone listens the whole time - just describe the picture.'
            : '👆 This browser has no microphone recognition, so it is on your honour: say the word out loud, then tap its chip. Those are worth 40% less. Chrome or Safari gives you the mic.')
        ),
        el('button.big-btn.primary.xl', {
          onclick: function () {
            SFX.wake();
            SFX.tap();
            board();
            ctx.countdown(3).then(function () { nextScene(0); });
          }
        }, 'Start ▶')
      ));
    }

    /* ---------------------------------------------------------- board */

    function board() {
      clear(root);
      ui.time = el('div.hud-time', untimed ? '∞' : '0:45');
      ui.score = el('div.hud-score', '0');
      ui.combo = el('div.hud-combo');
      ui.bar = el('i');

      root.appendChild(el('div.hud',
        el('div.hud-cell', el('small', 'time'), ui.time),
        el('div.hud-cell.wide', el('div.timebar', ui.bar), ui.combo),
        el('div.hud-cell', el('small', 'points'), ui.score)
      ));

      ui.frame = el('div.pic-frame');
      ui.caption = el('div.pic-caption');
      ui.stage = el('div.pic-stage', ui.frame, ui.caption);
      root.appendChild(ui.stage);

      ui.chips = el('div.chip-row');
      root.appendChild(ui.chips);

      ui.strip = el('div.action-zone');
      root.appendChild(ui.strip);
    }

    /* ---------------------------------------------------------- a scene */

    function nextScene(n) {
      if (state.dead) return;
      if (n >= scenes.length) return end();

      var data = scenes[n];
      ctx.setSub('Picture ' + (n + 1) + ' of ' + scenes.length);

      scene = {
        n: n,
        data: data,
        targets: targetsFor(data, to).map(function (t) {
          return { t: t, found: false, chip: null, back: null };
        }),
        left: 0,
        lastAt: Date.now(),
        over: false
      };

      paintPicture(data, n);
      paintChips();
      paintStrip();

      SFX.swipe();

      clock = untimed ? U.noClock() : U.ticker(SCENE_MS, function (left) {
        scene.left = left;
        ui.time.textContent = U.clock(left);
        ui.bar.style.width = Math.min(100, (left / SCENE_MS) * 100) + '%';
        ui.time.classList.toggle('urgent', left < 10000);
      }, function () { sceneOver(false); });

      if (live) openMic();
    }

    function paintPicture(data, n) {
      clear(ui.frame);
      ui.frame.className = 'pic-frame ' + TINTS[n % TINTS.length];
      void ui.frame.offsetWidth;
      ui.frame.classList.add('deal');

      var art = data.emoji || [];
      var cols = art.length <= 4 ? 2 : 3;
      var rows = Math.max(2, Math.ceil(art.length / cols));

      // Scatter on a jittered grid rather than at random: pure random
      // placement clumps, and a clump reads as a pile, not a scene.
      art.forEach(function (glyph, i) {
        var col = i % cols, row = Math.floor(i / cols);
        var cw = 100 / cols, ch = 100 / rows;
        var left = col * cw + cw * (0.28 + Math.random() * 0.44);
        var top = row * ch + ch * (0.3 + Math.random() * 0.4);
        var big = i % 3 === 0;                    // one in three is a hero
        var bit = el('span.pic-bit', glyph);
        bit.style.left = left.toFixed(1) + '%';
        bit.style.top = top.toFixed(1) + '%';
        bit.style.fontSize = (big ? 3.6 : 2.5) + Math.random() * 1.1 + 'rem';
        bit.style.transform = 'translate(-50%,-50%) rotate(' + (Math.random() * 32 - 16).toFixed(1) + 'deg)';
        bit.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's';
        bit.style.animationDuration = (3.4 + Math.random() * 2.2).toFixed(2) + 's';
        ui.frame.appendChild(bit);
      });

      clear(ui.caption);
      ui.caption.appendChild(el('span', data.title || 'What do you see?'));
    }

    function paintChips() {
      clear(ui.chips);
      scene.targets.forEach(function (slot) {
        var front = el('div.chip-face.chip-front',
          el('small', slot.t.en),
          el('b', '?'));
        var back = el('div.chip-face.chip-back',
          el('span.chip-word' + (to === 'he' ? '.rtl' : ''), slot.t.w),
          to === 'he' && slot.t.t ? el('small.chip-tr', slot.t.t) : null);

        // Always a button: in mic mode it simply refuses the tap, which
        // keeps one element to style and lets us fall back to honour
        // mode mid-scene without rebuilding the board.
        var chip = el('button.chip', {
          type: 'button',
          onclick: function () {
            if (live || slot.found || scene.over) return;
            SFX.flip();
            claim(slot, true);
          }
        }, el('div.chip-inner', front, back));

        slot.chip = chip;
        slot.back = back;
        ui.chips.appendChild(chip);
      });
      markMode();
    }

    function markMode() {
      ui.chips.classList.toggle('tappable', !live);
    }

    function paintStrip() {
      clear(ui.strip);
      if (live) {
        ui.heard = el('div.heard', '…');
        ui.strip.appendChild(el('div.listening',
          el('div.mic-dot', '🎤'),
          el('div.mic-copy', el('b', 'Describe it in ' + langName(to)), ui.heard),
          el('div.mic-bar')));
      } else {
        ui.heard = null;
        ui.strip.appendChild(el('div.self-mark',
          el('div.honour',
            el('b', '🗣️ Say it out loud, then tap its chip'),
            el('small', 'Honour system: ' + Math.round(PER_WORD * HONOUR) + ' points a chip instead of ' + PER_WORD + '.'))));
      }
      // With no buzzer, a word you cannot get would strand the round.
      if (untimed) {
        ui.strip.appendChild(el('button.ghost-btn', {
          onclick: function () { SFX.tap(); sceneOver(false); }
        }, '🏁 Done with this picture →'));
      }
    }

    /* ---------------------------------------------------------- the mic */

    function openMic() {
      if (mic) { mic.abort(); mic = null; }
      mic = Speech.listen({
        lang: to,
        continuous: true,
        onPartial: function (text) { hear(text); },
        onFinal: function (text, alts) {
          hear(text);
          // The alternatives often carry the word the top guess mangled.
          (alts || []).forEach(function (a) { scan(a); });
        },
        onError: function (e) {
          // A denied or unavailable mic is not recoverable inside a
          // round, so hand the player the tappable board instead.
          if (e === 'not-allowed' || e === 'service-not-allowed' || e === 'audio-capture') dropToHonour();
        },
        onEnd: function () { mic = null; }
      });
      if (!mic) dropToHonour();
    }

    function hear(text) {
      if (ui.heard) ui.heard.textContent = text || '…';
      scan(text);
    }

    function scan(text) {
      if (!text || !scene || scene.over) return;
      scene.targets.forEach(function (slot) {
        if (slot.found) return;
        if (mentionsAny(text, slot.t, to)) claim(slot, false);
      });
    }

    // A target may legitimately be said several ways ("la mer" / "mer"),
    // so check the word and anything the data offers as an alternative.
    function mentionsAny(text, t, lang) {
      if (U.mentions(text, t.w, lang)) return true;
      var alts = t.alt || [];
      for (var i = 0; i < alts.length; i++) {
        if (U.mentions(text, alts[i], lang)) return true;
      }
      return false;
    }

    function dropToHonour() {
      if (!live) return;
      live = false;
      if (mic) { mic.abort(); mic = null; }
      markMode();
      paintStrip();
      ctx.toast('No microphone - tap the chips instead', 'warn');
    }

    /* ---------------------------------------------------------- scoring */

    function multiplier() { return state.combo >= 6 ? 3 : state.combo >= 3 ? 2 : 1; }

    function claim(slot, honour) {
      if (slot.found || scene.over) return;
      slot.found = true;

      var ms = Date.now() - scene.lastAt;
      scene.lastAt = Date.now();

      state.combo++;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      state.found++;

      var pts = Math.round(PER_WORD * multiplier() * (honour ? HONOUR : 1));
      state.score += pts;
      Store.answered(me.id, true, ms);

      flip(slot, 'good', '+' + pts);
      SFX.correct(state.combo);
      U.buzz(25);
      paint();

      if (allFound()) sceneOver(true);
    }

    function flip(slot, kind, pop) {
      slot.chip.classList.add('flipped', 'chip-' + kind);
      if (pop) {
        var p = el('div.points-pop', pop, state.combo >= 3 ? el('small', '🔥 ×' + multiplier()) : null);
        slot.chip.appendChild(p);
      }
    }

    function allFound() {
      return scene.targets.every(function (s) { return s.found; });
    }

    function paint() {
      ui.score.textContent = String(state.score);
      ui.combo.textContent = state.combo >= 2 ? '🔥 ' + state.combo + ' in a row' : '';
      ui.combo.className = 'hud-combo' + (state.combo >= 3 ? ' hot' : '');
    }

    /* ---------------------------------------------------------- end of scene */

    function sceneOver(clearedIt) {
      if (!scene || scene.over) return;
      scene.over = true;
      if (clock) { clock.stop(); clock = null; }
      if (mic) { mic.stop(); mic = null; }

      var wait = 1500;

      if (clearedIt) {
        // No clock means no seconds left to be paid for, only the clear.
        var secs = untimed ? 0 : Math.floor(scene.left / 1000);
        var bonus = secs * CLEAR_PER_SEC;
        state.score += bonus;
        state.cleared++;
        Store.earn(me.id, 'describer');
        paint();
        ui.frame.classList.add('cleared');
        ui.caption.appendChild(el('span.clear-bonus',
          bonus ? '🏁 cleared! +' + bonus + ' for ' + secs + 's left' : '🏁 cleared!'));
        SFX.win();
        // The frame clips its own overflow, so the burst goes on the
        // stage around it or nobody ever sees it.
        U.confetti(ui.stage);
        U.buzz([30, 40, 30, 40, 120]);
        wait = 1900;
      } else {
        // A chain does not survive a picture the player could not finish.
        state.combo = 0;
        paint();
        var lost = 0;
        scene.targets.forEach(function (slot) {
          if (slot.found) return;
          lost++;
          slot.chip.classList.add('flipped', 'chip-bad');
          Store.answered(me.id, false);
          state.missed.push({
            prompt: slot.t.en,
            answer: slot.t.w,
            hint: (to === 'he' && slot.t.t) ? slot.t.t : scene.data.title
          });
        });
        SFX.wrong();
        ui.caption.appendChild(el('span.clear-miss', lost === 1 ? '1 word got away' : lost + ' words got away'));
        // Read the misses back: hearing them is the whole lesson.
        speakMisses();
        wait = 900 + lost * 700;
      }

      var n = scene.n + 1;
      gap = setTimeout(function () { nextScene(n); }, wait);
    }

    function speakMisses() {
      var words = scene.targets.filter(function (s) { return !s.found; })
        .map(function (s) { return s.t.w; }).slice(0, 4);
      words.forEach(function (w, i) {
        setTimeout(function () {
          if (!state.dead) Speech.speak(w, to, { rate: 0.85 });
        }, 500 + i * 700);
      });
    }

    /* ---------------------------------------------------------- end */

    function end() {
      if (state.dead) return;
      state.dead = true;
      if (clock) { clock.stop(); clock = null; }
      if (mic) { mic.stop(); mic = null; }
      clearTimeout(gap);

      var perfect = state.cleared === scenes.length;

      ctx.finish({
        won: state.cleared > 0 || state.found > 0,
        emoji: perfect ? '🏆' : state.cleared ? '🎉' : '👏',
        title: perfect ? 'Every picture, every word' :
          state.cleared ? 'Nice describing' : 'Round over',
        subtitle: live ? null : 'Honour mode - no microphone in this browser.',
        score: state.score,
        xp: Math.round(state.score / 5) + state.cleared * 5,
        lines: [
          ['Words found', state.found],
          ['Pictures cleared', state.cleared + '/' + scenes.length],
          ['Best chain', state.bestCombo]
        ],
        missed: state.missed,
        badges: []
      });
    }

    /* ---------------------------------------------------------- helpers */

    function langName(l) { return l === 'he' ? 'Hebrew' : l === 'fr' ? 'French' : 'English'; }

    intro();

    return function teardown() {
      state.dead = true;
      if (scene) scene.over = true;
      if (clock) clock.stop();
      if (mic) mic.abort();
      clearTimeout(gap);
    };
  }

  /* ---------------------------------------------------------- content */

  function targetsFor(sceneData, lang) {
    var t = (sceneData.targets && sceneData.targets[lang]) || [];
    return t.filter(function (x) { return x && x.w; });
  }

  /* Three pictures, easy to hard. One from each level where the data
     allows it, so a round always warms up before it bites; if a level
     is missing we just take the next easiest thing available. */
  function pickScenes(all, lang) {
    var usable = (all || []).filter(function (s) { return targetsFor(s, lang).length > 0; });
    if (!usable.length) return [];

    var out = [];
    [1, 2, 3].forEach(function (lvl) {
      var bucket = usable.filter(function (s) {
        return (s.level || 1) === lvl && out.indexOf(s) === -1;
      });
      if (bucket.length) out.push(U.pick(bucket));
    });

    var spare = U.shuffle(usable.filter(function (s) { return out.indexOf(s) === -1; }));
    while (out.length < SCENES && spare.length) out.push(spare.shift());

    out.sort(function (a, b) { return (a.level || 1) - (b.level || 1); });
    return out.slice(0, SCENES);
  }

  return {
    id: 'describe',
    emoji: '🖼️',
    mode: 'solo',
    title: { en: 'Describe It', he: 'תאר לי', fr: 'Décris-moi' },
    tagline: { en: 'Talk about the picture, out loud' },
    mount: mount
  };
})();
