/* ============================================================
   audio.js — every sound in the site, synthesised.

   No audio files: a phone on a hotel wifi should not wait on a
   download to hear that it got a word right. Everything here is a
   few oscillators through a gain envelope, which is also why the
   feedback lands within a frame of the tap.
   ============================================================ */

window.SFX = (function () {
  'use strict';

  var KEY = 'noayariv.sound';
  var ctx = null;
  var on = load();

  function load() {
    try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; }
  }
  function enabled() { return on; }
  function toggle() {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* private mode */ }
    if (on) blip(880, 0.08, 'sine', 0.2);
    return on;
  }

  // iOS will not make a sound until an audio context is created or
  // resumed inside a real gesture, so every entry point calls this.
  function wake() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function blip(freq, dur, shape, vol, when, slideTo) {
    if (!on) return;
    var c = wake();
    if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = shape || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol === undefined ? 0.18 : vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterHz) {
    if (!on) return;
    var c = wake();
    if (!c) return;
    var frames = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, frames, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = c.createBufferSource();
    src.buffer = buf;
    var filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterHz || 1800;
    var gain = c.createGain();
    gain.gain.value = vol || 0.12;
    src.connect(filt).connect(gain).connect(c.destination);
    src.start();
  }

  function chord(freqs, dur, shape, vol) {
    freqs.forEach(function (f, i) { blip(f, dur, shape, (vol || 0.14) / (i + 1.2), i * 0.055); });
  }

  /* ---------------------------------------------------------- the kit */

  var S = {
    tap:      function () { blip(520, 0.06, 'triangle', 0.10); },
    flip:     function () { blip(300, 0.10, 'triangle', 0.10, 0, 620); },
    swipe:    function () { noise(0.14, 0.07, 2600); },

    // The combo count raises the pitch, so a run *sounds* like a run.
    correct:  function (combo) {
      var step = Math.min(combo || 0, 8);
      var base = 523.25 * Math.pow(1.0595, step * 2);
      chord([base, base * 1.26, base * 1.5], 0.20, 'sine', 0.16);
    },
    wrong:    function () { blip(180, 0.26, 'sawtooth', 0.12, 0, 90); U.buzz(60); },
    pass:     function () { blip(330, 0.14, 'triangle', 0.10, 0, 220); },
    tick:     function () { blip(1400, 0.03, 'square', 0.05); },
    hurry:    function () { blip(1000, 0.06, 'square', 0.09); },

    life:     function () { blip(160, 0.5, 'sawtooth', 0.14, 0, 60); U.buzz([40, 60, 90]); },
    levelup:  function () { [523, 659, 784, 1047].forEach(function (f, i) { blip(f, 0.22, 'triangle', 0.16, i * 0.09); }); },
    win:      function () {
      [523, 659, 784, 1047, 1319].forEach(function (f, i) { blip(f, 0.3, 'sine', 0.18, i * 0.11); });
      setTimeout(function () { chord([784, 988, 1175], 0.6, 'triangle', 0.16); }, 620);
      U.buzz([30, 40, 30, 40, 120]);
    },
    lose:     function () { [440, 392, 330, 262].forEach(function (f, i) { blip(f, 0.3, 'triangle', 0.14, i * 0.14); }); U.buzz(240); },
    badge:    function () { [1047, 1319, 1568].forEach(function (f, i) { blip(f, 0.25, 'sine', 0.17, i * 0.08); }); },
    countdown: function (n) { blip(n <= 1 ? 900 : 600, 0.16, 'square', 0.12); }
  };

  S.wake = wake;
  S.enabled = enabled;
  S.toggle = toggle;
  return S;
})();
