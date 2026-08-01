/* ============================================================
   app.js — the shell: who is playing, which game, and the bits
   every game shares (countdown, HUD, results, toasts).

   Games register themselves on window.Games before this file runs
   and never touch the router. A game gets a root element and a
   context, and hands back a teardown function; the shell handles
   everything around it.

      window.Games.duel = {
        id, emoji, mode: 'solo' | 'coop',
        title: {en, he, fr}, tagline: {en},
        mount: function (root, ctx) { ...; return function teardown() {}; }
      }
   ============================================================ */

(function () {
  'use strict';

  var el = U.el, clear = U.clear;

  var ORDER = ['duel', 'phrase', 'describe', 'pingpong', 'tabou', 'headsup'];
  var DATA = null;
  var teardown = null;
  var screen, topbar, topTitle, topSub, backBtn, soundBtn;

  /* ---------------------------------------------------------- data */

  function loadData() {
    var files = ['words', 'sentences', 'scenes', 'tabou', 'headsup'];
    return Promise.all(files.map(function (f) {
      return fetch('data/' + f + '.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(f + '.json returned ' + r.status);
        return r.json();
      });
    })).then(function (parts) {
      var bag = {};
      files.forEach(function (f, i) { bag[f] = parts[i][f] || parts[i]; });
      return bag;
    });
  }

  /* ---------------------------------------------------------- routing */

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function route() {
    var h = (location.hash || '#/').replace(/^#/, '');
    var bits = h.split('/').filter(Boolean);
    if (!bits.length) return { name: 'home' };
    if (bits[0] === 'play' && bits[1]) return { name: 'play', game: bits[1] };
    if (bits[0] === 'score') return { name: 'score' };
    if (bits[0] === 'badges') return { name: 'badges' };
    return { name: 'home' };
  }

  function render() {
    if (teardown) { try { teardown(); } catch (e) { /* game already gone */ } teardown = null; }
    Speech.shutUp();
    clear(screen);
    screen.scrollTop = 0;
    var r = route();
    if (r.name === 'play') return renderPlay(r.game);
    if (r.name === 'score') return renderScore();
    if (r.name === 'badges') return renderBadges();
    renderHome();
  }

  function setTop(title, sub, showBack) {
    topTitle.textContent = title || '';
    topSub.textContent = sub || '';
    backBtn.style.visibility = showBack ? 'visible' : 'hidden';
  }

  /* ---------------------------------------------------------- home */

  function renderHome() {
    setTop('Noa & Yariv', 'עברית · français', false);
    var me = Store.current();

    screen.appendChild(el('div.hero',
      el('h1.hero-title', el('span.h-noa', 'Noa'), el('span.h-amp', '&'), el('span.h-yariv', 'Yariv')),
      el('p.hero-sub', 'Six games. Two languages. One of you is always losing.')
    ));

    screen.appendChild(pickerCard(me));

    if (me) {
      screen.appendChild(el('h2.section-title', el('span', '🎮'), 'Play alone'));
      var solo = el('div.game-grid');
      ORDER.filter(function (g) { return Games[g] && Games[g].mode === 'solo'; })
        .forEach(function (g) { solo.appendChild(gameCard(Games[g], me)); });
      screen.appendChild(solo);

      screen.appendChild(el('h2.section-title', el('span', '🤝'), 'Play together',
        el('small', 'one phone, pass it back and forth')));
      var duo = el('div.game-grid');
      ORDER.filter(function (g) { return Games[g] && Games[g].mode === 'coop'; })
        .forEach(function (g) { duo.appendChild(gameCard(Games[g], me)); });
      screen.appendChild(duo);

      screen.appendChild(el('div.home-links',
        el('button.pill-btn', { onclick: function () { SFX.tap(); go('#/score'); } }, '📊 Scoreboard'),
        el('button.pill-btn', { onclick: function () { SFX.tap(); go('#/badges'); } }, '🏅 Badges')
      ));
    }
  }

  function pickerCard(me) {
    var wrap = el('div.picker');
    Store.players().forEach(function (p) {
      var prog = Store.progress(p.id);
      var active = me && me.id === p.id;
      wrap.appendChild(el('button.who.who-' + p.color + (active ? '.is-me' : ''), {
        onclick: function () {
          SFX.wake();
          SFX.tap();
          Store.setCurrent(active ? '' : p.id);
          render();
        }
      },
        el('div.who-emoji', p.emoji),
        el('div.who-name', p.name),
        el('div.who-flags', p.flag, el('span.who-arrow', '→'), p.targetFlag),
        el('div.who-lvl', 'Lv ' + prog.level + ' · ' + prog.title),
        el('div.bar', el('i', { style: { width: prog.pct + '%' } })),
        active ? el('div.who-tag', 'that is you') : null
      ));
    });
    return wrap;
  }

  function gameCard(g, me) {
    var target = g.mode === 'coop' ? null : me;
    var best = target ? (Store.stats(target.id).best[g.id] || 0) : (Store.coop().best[g.id] || 0);
    return el('button.game-card.g-' + g.id, {
      onclick: function () { SFX.wake(); SFX.flip(); go('#/play/' + g.id); }
    },
      el('div.gc-emoji', g.emoji),
      el('div.gc-body',
        el('div.gc-title', g.title.en),
        el('div.gc-sub', g.tagline.en)
      ),
      best ? el('div.gc-best', el('small', 'best'), String(best)) : el('div.gc-go', '▶')
    );
  }

  /* ---------------------------------------------------------- play */

  function renderPlay(id) {
    var g = Games[id];
    if (!g) return go('#/');
    var me = Store.current();
    if (!me && g.mode === 'solo') return go('#/');

    setTop(g.title.en, g.mode === 'coop' ? 'together' : me.name + ' · ' + me.learning, true);

    var root = el('div.game-root');
    screen.appendChild(root);

    var ctx = {
      game: g,
      data: DATA,
      player: me,
      partner: me ? Store.other(me.id) : null,
      players: Store.players(),
      exit: function () { go('#/'); },
      replay: function () { render(); },
      countdown: countdown,
      toast: toast,
      finish: function (result) { finish(root, g, result); },
      setSub: function (s) { topSub.textContent = s; }
    };

    if (me) Store.playedGame(me.id, g.id);
    else Store.players().forEach(function (p) { Store.playedGame(p.id, g.id); });

    teardown = g.mount(root, ctx) || null;
  }

  /* 3-2-1 over the top of whatever the game already drew, so the
     player can read the rules while it counts. */
  function countdown(from) {
    from = from || 3;
    return new Promise(function (resolve) {
      var layer = el('div.countdown');
      var num = el('div.cd-num');
      layer.appendChild(num);
      document.body.appendChild(layer);
      var n = from;
      function step() {
        if (n === 0) {
          num.textContent = 'GO!';
          num.className = 'cd-num cd-go';
          SFX.countdown(1);
          setTimeout(function () { layer.remove(); resolve(); }, 450);
          return;
        }
        num.textContent = String(n);
        num.className = 'cd-num';
        void num.offsetWidth;
        num.classList.add('cd-pop');
        SFX.countdown(n);
        n--;
        setTimeout(step, 700);
      }
      step();
    });
  }

  /* ---------------------------------------------------------- results */

  function finish(root, g, res) {
    res = res || {};
    Speech.shutUp();
    clear(root);

    var won = res.won !== false;
    var isRecord = false;
    if (res.score !== undefined) {
      isRecord = Store.record(res.playerId || (g.mode === 'coop' ? 'coop' : Store.current().id), g.id, res.score);
    }

    var earned = [];
    if (res.xp) {
      var who = res.playerId ? [res.playerId] : (g.mode === 'coop' ? ['noa', 'yariv'] : [Store.current().id]);
      who.forEach(function (pid) {
        var out = Store.award(pid, res.xp);
        if (out.levelled) earned.push({ emoji: '⬆️', name: Store.player(pid).name + ' reached level ' + out.level });
        Store.checkAuto(pid).forEach(function (b) { earned.push(b); });
      });
    }
    (res.badges || []).forEach(function (b) { if (b) earned.push(b); });

    var card = el('div.result' + (won ? '.win' : '.lose'),
      el('div.result-emoji', won ? (res.emoji || '🎉') : '💀'),
      el('h2.result-title', res.title || (won ? 'Nice!' : 'Next time.')),
      res.subtitle ? el('p.result-sub', res.subtitle) : null
    );

    if (res.score !== undefined) {
      card.appendChild(el('div.result-score',
        el('span.rs-num', String(res.score)),
        el('span.rs-label', isRecord ? '🏆 new record!' : 'points')
      ));
    }

    if (res.lines && res.lines.length) {
      var list = el('div.result-lines');
      res.lines.forEach(function (l) {
        list.appendChild(el('div.rl', el('span.rl-k', l[0]), el('span.rl-v', String(l[1]))));
      });
      card.appendChild(list);
    }

    if (res.xp) card.appendChild(el('div.xp-chip', '+' + res.xp + ' XP'));

    if (earned.length) {
      var bl = el('div.badge-drop');
      earned.forEach(function (b) {
        bl.appendChild(el('div.badge-won', el('span.bw-emoji', b.emoji), el('span', b.name)));
      });
      card.appendChild(bl);
      SFX.badge();
    }

    // The misses are the actual lesson, so they get real estate.
    if (res.missed && res.missed.length) {
      var m = el('div.missed', el('h3', '📎 Worth another look'));
      res.missed.slice(0, 12).forEach(function (item) {
        m.appendChild(el('div.miss-row',
          el('span.miss-a', item.prompt),
          el('span.miss-arrow', '→'),
          el('span.miss-b', item.answer),
          item.hint ? el('small.miss-hint', item.hint) : null
        ));
      });
      card.appendChild(m);
    }

    card.appendChild(el('div.result-btns',
      el('button.big-btn.primary', { onclick: function () { SFX.tap(); render(); } }, '🔁 Again'),
      el('button.big-btn', { onclick: function () { SFX.tap(); go('#/'); } }, '🏠 Home')
    ));

    root.appendChild(card);
    if (won) { SFX.win(); U.confetti(card); } else SFX.lose();
  }

  /* ---------------------------------------------------------- scores */

  function renderScore() {
    setTop('Scoreboard', 'who is actually winning', true);
    var a = Store.progress('noa'), b = Store.progress('yariv');
    var lead = a.xp === b.xp ? null : (a.xp > b.xp ? 'noa' : 'yariv');

    screen.appendChild(el('div.versus',
      scoreCol(Store.player('noa'), a, lead === 'noa'),
      el('div.vs-mid', el('span', 'VS'), el('small', Math.abs(a.xp - b.xp) + ' XP apart')),
      scoreCol(Store.player('yariv'), b, lead === 'yariv')
    ));

    var c = Store.coop();
    screen.appendChild(el('div.panel',
      el('h3', '🤝 Together'),
      el('div.stat-row',
        stat('🏆', c.wins, 'wins'),
        stat('💀', c.losses, 'losses'),
        stat('🔗', c.bestStreak, 'best chain')
      )
    ));

    ['noa', 'yariv'].forEach(function (pid) {
      var s = Store.stats(pid), p = Store.player(pid);
      var acc = s.correct + s.wrong ? Math.round((s.correct / (s.correct + s.wrong)) * 100) : 0;
      screen.appendChild(el('div.panel',
        el('h3', p.emoji + ' ' + p.name),
        el('div.stat-row',
          stat('✅', s.correct, 'right'),
          stat('❌', s.wrong, 'wrong'),
          stat('🎯', acc + '%', 'accuracy'),
          stat('📅', s.days.length, 'days')
        ),
        el('div.best-list', ORDER.filter(function (g) { return Games[g] && s.best[g]; }).map(function (g) {
          return el('div.best-row', el('span', Games[g].emoji + ' ' + Games[g].title.en), el('b', String(s.best[g])));
        }))
      ));
    });

    screen.appendChild(el('div.home-links',
      el('button.pill-btn.danger', {
        onclick: function () {
          if (confirm('Wipe every score and badge for both players?')) { Store.reset(); render(); }
        }
      }, 'Reset everything')
    ));
  }

  function scoreCol(p, prog, leading) {
    return el('div.score-col.who-' + p.color + (leading ? '.leading' : ''),
      leading ? el('div.crown', '👑') : null,
      el('div.sc-emoji', p.emoji),
      el('div.sc-name', p.name),
      el('div.sc-xp', String(prog.xp)),
      el('small.sc-lvl', 'Lv ' + prog.level + ' · ' + prog.title),
      el('div.bar', el('i', { style: { width: prog.pct + '%' } }))
    );
  }

  function stat(emoji, value, label) {
    return el('div.stat', el('div.st-emoji', emoji), el('div.st-val', String(value)), el('small', label));
  }

  /* ---------------------------------------------------------- badges */

  function renderBadges() {
    setTop('Badges', 'collect them all', true);
    Store.players().forEach(function (p) {
      var mine = Store.stats(p.id).badges;
      screen.appendChild(el('div.panel',
        el('h3', p.emoji + ' ' + p.name + ' — ' + mine.length + '/' + Store.badgeList().length),
        el('div.badge-grid', Store.badgeList().map(function (b) {
          var has = mine.indexOf(b.id) !== -1;
          return el('div.badge' + (has ? '.has' : ''),
            el('div.b-emoji', has ? b.emoji : '🔒'),
            el('div.b-name', b.name),
            el('small.b-hint', b.hint));
        }))
      ));
    });
  }

  /* ---------------------------------------------------------- toasts */

  function toast(msg, kind) {
    var t = el('div.toast' + (kind ? '.' + kind : ''), msg);
    U.$('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 1500);
    setTimeout(function () { t.remove(); }, 2100);
  }

  /* ---------------------------------------------------------- boot */

  function boot() {
    screen = U.$('#screen');
    topbar = U.$('#topbar');
    topTitle = U.$('#topTitle');
    topSub = U.$('#topSub');
    backBtn = U.$('#backBtn');
    soundBtn = U.$('#soundBtn');

    backBtn.addEventListener('click', function () {
      SFX.tap();
      if (route().name === 'play') go('#/'); else history.back();
    });
    soundBtn.addEventListener('click', function () {
      SFX.wake();
      soundBtn.textContent = SFX.toggle() ? '🔊' : '🔇';
    });
    soundBtn.textContent = SFX.enabled() ? '🔊' : '🔇';

    window.addEventListener('hashchange', render);

    loadData().then(function (bag) {
      DATA = bag;
      U.$('#boot').remove();
      topbar.hidden = false;
      screen.hidden = false;
      render();
    }).catch(function (err) {
      U.$('#boot').innerHTML = '<div class="boot-emoji">😵</div><div class="boot-text">' +
        'Could not load the cards.<br><small>' + err.message + '</small></div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
