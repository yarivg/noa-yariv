/* ============================================================
   store.js — who the players are, and everything they have earned.

   Two fixed players, because this site was built for exactly two
   people. Noa is French and is learning Hebrew; Yariv is Israeli and
   is learning French. Both speak good English, so English is the
   language the site itself talks in and the hint of last resort.

   Everything lives in this browser's localStorage. No accounts, no
   server, nothing leaves the phone.
   ============================================================ */

window.Store = (function () {
  'use strict';

  var KEY = 'noayariv.v1';

  var PLAYERS = {
    noa: {
      id: 'noa',
      name: 'Noa',
      native: 'fr',        // what she already has
      target: 'he',        // what she is here to learn
      flag: '🇫🇷',
      targetFlag: '🇮🇱',
      emoji: '👩‍🎤',
      color: 'noa',
      hello: 'שלום, נועה!',
      learning: 'learning Hebrew'
    },
    yariv: {
      id: 'yariv',
      name: 'Yariv',
      native: 'he',
      target: 'fr',
      flag: '🇮🇱',
      targetFlag: '🇫🇷',
      emoji: '🧔',
      color: 'yariv',
      hello: 'Salut, Yariv !',
      learning: 'learning French'
    }
  };

  /* Levels are deliberately cheap early on. The point is that the
     first two minutes of play move the bar, not that level 20 means
     anything in particular. */
  var TITLES = [
    'Tourist', 'Menu reader', 'Small talker', 'Market haggler', 'Bus asker',
    'Phone caller', 'Joke teller', 'Argument winner', 'Dream speaker', 'Local'
  ];

  var BADGES = [
    { id: 'first-word',  emoji: '🐣', name: 'First word',      hint: 'Get one answer right.' },
    { id: 'combo-5',     emoji: '🔥', name: 'On fire',         hint: 'Five in a row.' },
    { id: 'combo-10',    emoji: '🌋', name: 'Volcano',         hint: 'Ten in a row.' },
    { id: 'speedster',   emoji: '⚡', name: 'Speedster',       hint: 'Answer in under two seconds.' },
    { id: 'hundred',     emoji: '💯', name: 'Century',         hint: 'A hundred correct answers.' },
    { id: 'sentence',    emoji: '📜', name: 'Full sentence',   hint: 'Nail ten whole sentences.' },
    { id: 'describer',   emoji: '🖼️', name: 'Describer',       hint: 'Clear a picture with every word.' },
    { id: 'telepath',    emoji: '🧠', name: 'Telepaths',       hint: 'Win a co-op game with a life to spare.' },
    { id: 'marathon',    emoji: '🏃', name: 'Marathon',        hint: 'Play five days.' },
    { id: 'allgames',    emoji: '🎪', name: 'Full circus',     hint: 'Play all six games.' },
    { id: 'night-owl',   emoji: '🦉', name: 'Night owl',       hint: 'Play after midnight.' },
    { id: 'perfect',     emoji: '🏆', name: 'Flawless',        hint: 'A whole round without a miss.' }
  ];

  function blankPlayer() {
    return {
      xp: 0, correct: 0, wrong: 0, best: {}, played: {},
      badges: [], days: [], lastPlayed: 0, fastest: 0
    };
  }

  function blank() {
    return {
      current: '',
      noa: blankPlayer(),
      yariv: blankPlayer(),
      coop: { wins: 0, losses: 0, bestStreak: 0, best: {} }
    };
  }

  var data = read();

  function read() {
    var base = blank();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var saved = JSON.parse(raw);
      ['noa', 'yariv'].forEach(function (p) {
        if (saved[p]) for (var k in base[p]) if (saved[p][k] !== undefined) base[p][k] = saved[p][k];
      });
      if (saved.coop) for (var c in base.coop) if (saved.coop[c] !== undefined) base.coop[c] = saved.coop[c];
      if (typeof saved.current === 'string') base.current = saved.current;
    } catch (e) { /* first run, or someone cleared the browser */ }
    return base;
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('store:change'));
  }

  /* ---------------------------------------------------------- players */

  function players() { return [PLAYERS.noa, PLAYERS.yariv]; }
  function player(id) { return PLAYERS[id] || null; }
  function current() { return PLAYERS[data.current] || null; }
  function setCurrent(id) { data.current = PLAYERS[id] ? id : ''; write(); }
  function other(id) { return id === 'noa' ? PLAYERS.yariv : PLAYERS.noa; }
  function stats(id) { return data[id] || blankPlayer(); }
  function coop() { return data.coop; }

  function levelOf(xp) { return Math.floor(Math.sqrt(xp / 60)) + 1; }
  function xpForLevel(n) { return Math.pow(n - 1, 2) * 60; }
  function title(level) { return TITLES[Math.min(level - 1, TITLES.length - 1)]; }

  function progress(id) {
    var xp = stats(id).xp;
    var lvl = levelOf(xp);
    var from = xpForLevel(lvl), to = xpForLevel(lvl + 1);
    return {
      xp: xp, level: lvl, title: title(lvl),
      into: xp - from, need: to - from,
      pct: Math.round(((xp - from) / (to - from)) * 100)
    };
  }

  /* ---------------------------------------------------------- awarding */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // Returns {levelled: bool, level: n} so the caller can celebrate.
  function award(id, xp) {
    var p = data[id];
    if (!p || !xp) return { levelled: false };
    var before = levelOf(p.xp);
    p.xp = Math.max(0, p.xp + xp);
    var after = levelOf(p.xp);
    touch(id);
    write();
    return { levelled: after > before, level: after };
  }

  function touch(id) {
    var p = data[id];
    if (!p) return;
    var d = today();
    if (p.days.indexOf(d) === -1) p.days.push(d);
    if (p.days.length > 400) p.days = p.days.slice(-400);
    p.lastPlayed = Date.now();
  }

  function answered(id, right, ms) {
    var p = data[id];
    if (!p) return;
    if (right) {
      p.correct++;
      if (ms && (!p.fastest || ms < p.fastest)) p.fastest = ms;
    } else p.wrong++;
    write();
  }

  function playedGame(id, gameId) {
    var p = data[id];
    if (!p) return;
    p.played[gameId] = (p.played[gameId] || 0) + 1;
    touch(id);
    write();
  }

  // Only writes when it is actually a record, and says so.
  function record(id, gameId, score) {
    var bag = id === 'coop' ? data.coop.best : data[id].best;
    var prev = bag[gameId] || 0;
    if (score > prev) { bag[gameId] = score; write(); return true; }
    return false;
  }

  function coopResult(won, streak) {
    if (won) data.coop.wins++; else data.coop.losses++;
    if (streak > data.coop.bestStreak) data.coop.bestStreak = streak;
    write();
  }

  /* ---------------------------------------------------------- badges */

  function badgeList() { return BADGES; }
  function hasBadge(id, badge) { return stats(id).badges.indexOf(badge) !== -1; }

  // Returns the badge object the first time it is earned, else null,
  // so callers can do: var b = Store.earn(id, 'combo-5'); if (b) party(b);
  function earn(id, badge) {
    var p = data[id];
    if (!p || p.badges.indexOf(badge) !== -1) return null;
    var found = BADGES.filter(function (b) { return b.id === badge; })[0];
    if (!found) return null;
    p.badges.push(badge);
    write();
    return found;
  }

  // The badges nobody has to remember to hand out.
  function checkAuto(id) {
    var p = data[id], won = [];
    function got(b) { var x = earn(id, b); if (x) won.push(x); }
    if (p.correct >= 1) got('first-word');
    if (p.correct >= 100) got('hundred');
    if (p.fastest && p.fastest < 2000) got('speedster');
    if (p.days.length >= 5) got('marathon');
    if (Object.keys(p.played).length >= 6) got('allgames');
    var h = new Date().getHours();
    if ((h >= 0 && h < 5) && p.correct > 0) got('night-owl');
    return won;
  }

  function reset(id) {
    if (id) data[id] = blankPlayer();
    else data = blank();
    write();
  }

  return {
    players: players, player: player, current: current, setCurrent: setCurrent, other: other,
    stats: stats, coop: coop, progress: progress, levelOf: levelOf, title: title,
    award: award, answered: answered, playedGame: playedGame, record: record, coopResult: coopResult,
    badgeList: badgeList, hasBadge: hasBadge, earn: earn, checkAuto: checkAuto,
    reset: reset
  };
})();
