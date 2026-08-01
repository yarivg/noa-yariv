/* ============================================================
   speech.js — the phone talks, and listens.

   Two independent browser APIs, both flaky in their own way:

   speechSynthesis   reads Hebrew and French aloud. Voices load
                     asynchronously, and on iOS the list is empty
                     until the first utterance, so we re-check.

   SpeechRecognition grades what the player says. Chrome (desktop
                     and Android) and Safari on iOS have it;
                     Firefox does not. Every game that uses it must
                     fall back to a self-graded button, because a
                     game that cannot be played on your partner's
                     phone is not a game you will play.
   ============================================================ */

window.Speech = (function () {
  'use strict';

  var LOCALE = { he: 'he-IL', fr: 'fr-FR', en: 'en-US' };
  var voices = [];

  function loadVoices() {
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function isGoogle(v) { return /google/i.test(v.name || ''); }

  /* Voice preference, in order:

     1. Google. "Google français" and "Google עברית" are the two best
        voices either language has in a browser, and they are the same
        voice on every device that has them, so a word does not sound
        like a different person on the phone than on the laptop. They
        are network voices, which costs a round trip on first use, and
        that is worth it: a wrong-sounding model of the language is the
        one thing a pronunciation drill cannot afford.
     2. Any other local voice, so Safari (Carmit for Hebrew, Thomas or
        Amelie for French) and Firefox still speak.
     3. Anything at all in the right language. */
  function voiceFor(lang) {
    if (!voices.length) loadVoices();
    var want = LOCALE[lang] || lang;
    var exact = voices.filter(function (v) { return v.lang === want; });
    var loose = voices.filter(function (v) {
      return v.lang && v.lang.replace('_', '-').slice(0, 2) === want.slice(0, 2);
    });
    var pool = exact.length ? exact : loose;
    if (!pool.length) return null;
    var google = pool.filter(isGoogle);
    if (google.length) return google[0];
    var local = pool.filter(function (v) { return v.localService; });
    return local[0] || pool[0];
  }

  function canSpeak(lang) { return !!(window.speechSynthesis && voiceFor(lang)); }

  function speak(text, lang, opts) {
    opts = opts || {};
    if (!window.speechSynthesis || !text) return Promise.resolve(false);
    return new Promise(function (resolve) {
      try {
        window.speechSynthesis.cancel();
        var utt = new SpeechSynthesisUtterance(String(text));
        utt.lang = LOCALE[lang] || lang || 'en-US';
        var v = voiceFor(lang);
        if (v) utt.voice = v;
        utt.rate = opts.rate || 0.95;
        utt.pitch = opts.pitch || 1;
        utt.onend = function () { resolve(true); };
        utt.onerror = function () { resolve(false); };
        window.speechSynthesis.speak(utt);
        // Safari sometimes fires neither event.
        setTimeout(function () { resolve(true); }, 6000);
      } catch (e) { resolve(false); }
    });
  }

  function shutUp() {
    try { window.speechSynthesis.cancel(); } catch (e) { /* nothing playing */ }
  }

  /* ---------------------------------------------------------- listening */

  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function canListen() { return !!Rec; }

  /* listen({lang, continuous, onPartial, onFinal}) -> handle

     Interim results matter here: in a speed game the player wants to
     see the word land while they are still saying it, not a second
     after they stop. Games grade on partials and stop early on a hit. */
  function listen(opts) {
    opts = opts || {};
    if (!Rec) return null;
    var rec;
    try { rec = new Rec(); } catch (e) { return null; }
    rec.lang = LOCALE[opts.lang] || opts.lang || 'en-US';
    rec.continuous = !!opts.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    var stopped = false;
    var heard = [];

    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        var alts = [];
        for (var a = 0; a < res.length; a++) alts.push(res[a].transcript);
        if (res.isFinal) {
          heard = heard.concat(alts);
          if (opts.onFinal) opts.onFinal(alts[0] || '', alts);
        } else {
          interim += res[0].transcript;
          if (opts.onPartial) opts.onPartial(interim, alts);
        }
      }
    };
    rec.onerror = function (ev) {
      if (opts.onError) opts.onError(ev.error || 'error');
    };
    rec.onend = function () {
      if (stopped) { if (opts.onEnd) opts.onEnd(heard); return; }
      // Chrome ends the session on a pause; in a continuous game we
      // want the mic back immediately.
      if (opts.continuous) {
        try { rec.start(); return; } catch (e) { /* fall through */ }
      }
      if (opts.onEnd) opts.onEnd(heard);
    };

    try { rec.start(); } catch (e) { return null; }

    return {
      stop: function () {
        stopped = true;
        try { rec.stop(); } catch (e) { /* already dead */ }
      },
      abort: function () {
        stopped = true;
        try { rec.abort(); } catch (e) { /* already dead */ }
      }
    };
  }

  return {
    speak: speak, shutUp: shutUp, canSpeak: canSpeak,
    listen: listen, canListen: canListen, locale: function (l) { return LOCALE[l] || l; }
  };
})();
