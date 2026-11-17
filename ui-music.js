/* Ui Books - reading music.
   Creates calm background sound live in the browser (pads, chimes, rain, fire, wind, sea).
   There are no music files: nothing to download and nothing to license.
   Used on the generated book pages and in the reader view of the main page. */
(function () {
"use strict";
if (window.UiMusic) { return; }
var W = window, D = document, KEY = "uimusic", SKEY = "uimusic-on";

/* ================= moods ================= */
var MOODS = [
  { id: "lantern", name: "Lantern Night", desc: "Soft pads and distant chimes", genres: ["Fantasy"] },
  { id: "moon", name: "Moonlit Strings", desc: "Warm, slow and romantic", genres: ["Romance"] },
  { id: "dragon", name: "Dragon\u2019s Keep", desc: "Deep drones and far-off drums", genres: ["Epic"] },
  { id: "rain", name: "Rain on Glass", desc: "Quiet rain with a low hum", genres: ["Mystery"] },
  { id: "forest", name: "Enchanted Forest", desc: "Wind, leaves and bright chimes", genres: ["Folklore"] },
  { id: "sea", name: "Sea Wind", desc: "Slow waves and open sky", genres: ["Adventure"] },
  { id: "fire", name: "Fireside Tales", desc: "A crackling hearth", genres: [] }
];
var DEF = {};
MOODS.forEach(function (m) { m.genres.forEach(function (g) { DEF[g] = m.id; }); });
function moodOk(id) { return MOODS.some(function (m) { return m.id === id; }); }
function moodName(id) { var r = MOODS.filter(function (m) { return m.id === id; })[0]; return r ? r.name : ""; }

/* ================= sound engine ================= */
var TRIM = { dragon: 0.92, rain: 1.35, forest: 1.05, sea: 1.08, fire: 1.3 };   // evens out loudness between moods
function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function makeNoise(ctx) {
  var len = Math.floor(ctx.sampleRate * 4), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (var c = 0; c < 2; c++) {
    var d = buf.getChannelData(c), b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  }
  return buf;
}
function makeImpulse(ctx, secs, decay) {
  var len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (var c = 0; c < 2; c++) {
    var d = buf.getChannelData(c);
    for (var i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  }
  return buf;
}

function Engine(ctx, opts) {
  opts = opts || {};
  this.ctx = ctx; this.live = opts.live !== false; this.vol = 0.5; this.cur = null; this.curId = null; this.timer = null;
  this.master = ctx.createGain(); this.master.gain.value = 0;
  this.comp = ctx.createDynamicsCompressor();
  this.comp.threshold.value = -22; this.comp.knee.value = 18; this.comp.ratio.value = 4; this.comp.attack.value = 0.02; this.comp.release.value = 0.4;
  this.master.connect(this.comp); this.comp.connect(ctx.destination);
  this.bus = ctx.createGain(); this.bus.connect(this.master);
  this.rev = ctx.createConvolver(); this.rev.buffer = makeImpulse(ctx, 3.2, 2.4);
  this.revIn = ctx.createGain(); this.revIn.gain.value = 0.6; this.revIn.connect(this.rev); this.rev.connect(this.master);
  this.noise = makeNoise(ctx);
}
Engine.prototype.setVolume = function (v, immediate) {
  v = Math.max(0, Math.min(1, +v || 0)); this.vol = v;
  var g = Math.pow(v, 1.6) * 0.9, p = this.master.gain, t = this.ctx.currentTime;
  if (immediate) { p.cancelScheduledValues(t); p.setValueAtTime(g, t); } else { p.setTargetAtTime(g, t, 0.08); }
};
Engine.prototype.loop = function () {
  var s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(0, Math.random() * 2); return s;
};
Engine.prototype.lfo = function (m, freq, depth, param) {
  var o = this.ctx.createOscillator(), g = this.ctx.createGain();
  o.frequency.value = freq; g.gain.value = depth; o.connect(g); g.connect(param); o.start(); m.srcs.push(o);
};
Engine.prototype.burst = function (m, t, o) {
  var ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = this.noise; f.type = o.type || "bandpass"; f.frequency.value = o.freq; f.Q.value = o.q || 1;
  g.gain.setValueAtTime(o.gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  s.connect(f); f.connect(g); g.connect(m.out); s.start(t, Math.random() * 3, o.dur + 0.02);
};
Engine.prototype.pad = function (m, o) {
  var ctx = this.ctx, t = ctx.currentTime + 0.05, i = 0;
  m.layers.push(function (until) {
    while (t < until) {
      var ch = o.chords[i++ % o.chords.length], peak = o.gain / Math.sqrt(ch.length);
      ch.forEach(function (n) {
        var g = ctx.createGain(), f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = o.cutoff; f.Q.value = 0.4;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + o.attack);
        g.gain.setValueAtTime(peak, t + o.dur); g.gain.linearRampToValueAtTime(0, t + o.dur + o.release);
        for (var v = 0; v < 2; v++) {
          var s = ctx.createOscillator(); s.type = o.types[v % o.types.length]; s.frequency.value = midi(n);
          s.detune.value = (v ? 1 : -1) * rnd(3, 9); s.connect(f); s.start(t); s.stop(t + o.dur + o.release + 0.1);
        }
        f.connect(g); g.connect(m.out);
        var sd = ctx.createGain(); sd.gain.value = o.send == null ? 0.7 : o.send; g.connect(sd); sd.connect(m.send);
      });
      t += o.dur;
    }
  });
};
Engine.prototype.bells = function (m, o) {
  var ctx = this.ctx, t = ctx.currentTime + rnd(1, 3);
  m.layers.push(function (until) {
    while (t < until) {
      var f = midi(pick(o.scale)), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);
      [[1, 1], [2.01, 0.25], [3.99, 0.08]].forEach(function (p) {
        var s = ctx.createOscillator(), pg = ctx.createGain();
        s.type = "sine"; s.frequency.value = f * p[0]; pg.gain.value = p[1]; s.connect(pg); pg.connect(g); s.start(t); s.stop(t + o.decay + 0.1);
      });
      g.connect(m.out); var sd = ctx.createGain(); sd.gain.value = 0.9; g.connect(sd); sd.connect(m.send);
      t += rnd(o.every[0], o.every[1]);
    }
  });
};
Engine.prototype.rain = function (m, gain) {
  var ctx = this.ctx, self = this, s = this.loop(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + 0.1;
  hp.type = "highpass"; hp.frequency.value = 900; lp.type = "lowpass"; lp.frequency.value = 6500; g.gain.value = gain;
  s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(m.out); m.srcs.push(s);
  m.layers.push(function (until) {
    while (t < until) {
      self.burst(m, t, { freq: rnd(2200, 6500), q: 2, dur: rnd(0.015, 0.05), gain: rnd(0.02, 0.08) });
      t += rnd(0.03, 0.14);
    }
  });
};
Engine.prototype.thunder = function (m) {
  var ctx = this.ctx, self = this, t = ctx.currentTime + rnd(12, 30);
  m.layers.push(function (until) {
    while (t < until) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = self.noise; f.type = "lowpass"; f.frequency.value = 130;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 2.5); g.gain.linearRampToValueAtTime(0, t + 8);
      s.connect(f); f.connect(g); g.connect(m.out); s.start(t, Math.random() * 2, 8.2);
      t += rnd(45, 90);
    }
  });
};
Engine.prototype.fire = function (m, gain) {
  var ctx = this.ctx, self = this, s = this.loop(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime + 0.1;
  lp.type = "lowpass"; lp.frequency.value = 380; g.gain.value = gain; s.connect(lp); lp.connect(g); g.connect(m.out); m.srcs.push(s);
  m.layers.push(function (until) {
    while (t < until) {
      var big = Math.random() < 0.12;
      self.burst(m, t, { type: "bandpass", freq: rnd(1200, 4200), q: 1.2, dur: big ? rnd(0.03, 0.07) : rnd(0.006, 0.03), gain: big ? rnd(0.25, 0.5) : rnd(0.04, 0.2) });
      t += rnd(0.05, 0.45);
    }
  });
};
Engine.prototype.wind = function (m, gain) {
  var ctx = this.ctx, s = this.loop(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 1.1; g.gain.value = gain;
  s.connect(bp); bp.connect(g); g.connect(m.out); m.srcs.push(s);
  this.lfo(m, 0.07, 260, bp.frequency); this.lfo(m, 0.045, gain * 0.5, g.gain);
};
Engine.prototype.waves = function (m, gain) {
  var ctx = this.ctx;
  [[0.075, 560], [0.052, 820]].forEach(function (w, k) {
    var s = this.loop(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = w[1]; g.gain.value = gain * (k ? 0.6 : 1) * 0.55;
    s.connect(lp); lp.connect(g); g.connect(m.out); m.srcs.push(s);
    this.lfo(m, w[0], gain * (k ? 0.6 : 1) * 0.5, g.gain); this.lfo(m, w[0] * 0.7, 260, lp.frequency);
  }, this);
};
Engine.prototype.drone = function (m, gain) {
  var ctx = this.ctx, f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = "lowpass"; f.frequency.value = 170; f.Q.value = 0.7; g.gain.value = gain; f.connect(g); g.connect(m.out);
  [[midi(26), 0], [midi(33), 6], [midi(38), -7]].forEach(function (n) {
    var o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = n[0]; o.detune.value = n[1]; o.connect(f); o.start(); m.srcs.push(o);
  });
  this.lfo(m, 0.03, 60, f.frequency);
};
Engine.prototype.drums = function (m, gain) {
  var ctx = this.ctx, self = this, t = ctx.currentTime + 2;
  m.layers.push(function (until) {
    while (t < until) {
      [0, 0.9].forEach(function (off, k) {
        var o = ctx.createOscillator(), g = ctx.createGain(), at = t + off;
        o.type = "sine"; o.frequency.setValueAtTime(64, at); o.frequency.exponentialRampToValueAtTime(38, at + 0.35);
        g.gain.setValueAtTime(gain * (k ? 0.6 : 1), at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
        o.connect(g); g.connect(m.out); var sd = ctx.createGain(); sd.gain.value = 0.8; g.connect(sd); sd.connect(m.send);
        o.start(at); o.stop(at + 1);
        self.burst(m, at, { type: "lowpass", freq: 160, q: 0.5, dur: 0.12, gain: gain * 0.7 });
      });
      t += rnd(4.4, 6.2);
    }
  });
};
Engine.prototype.leaves = function (m) {
  var self = this, t = this.ctx.currentTime + rnd(2, 6);
  m.layers.push(function (until) {
    while (t < until) { self.burst(m, t, { freq: rnd(3000, 5000), q: 0.8, dur: rnd(1.2, 2.4), gain: 0.012 }); t += rnd(6, 14); }
  });
};

Engine.prototype.build = function (id) {
  var ctx = this.ctx, m = { id: id, out: ctx.createGain(), send: ctx.createGain(), layers: [], srcs: [], trim: TRIM[id] || 1 };
  m.out.gain.value = 0; m.out.connect(this.bus); m.send.connect(this.revIn);
  switch (id) {
    case "moon":
      this.pad(m, { chords: [[50, 57, 61, 64, 69], [47, 54, 59, 62, 66], [43, 50, 59, 62, 66], [45, 52, 61, 64, 69]], dur: 14, types: ["sine", "triangle"], cutoff: 1100, gain: 0.2, attack: 5, release: 7, send: 0.8 });
      this.pad(m, { chords: [[62, 66, 69], [59, 62, 66], [59, 62, 67], [61, 64, 69]], dur: 14, types: ["sawtooth"], cutoff: 600, gain: 0.05, attack: 6, release: 8, send: 0.9 });
      this.bells(m, { scale: [74, 78, 81, 83, 86], every: [6, 12], gain: 0.05, decay: 6 });
      break;
    case "dragon":
      this.drone(m, 0.2);
      this.pad(m, { chords: [[38, 45, 50, 53, 57], [34, 41, 46, 50, 53], [36, 43, 48, 52, 55], [33, 40, 45, 48, 52]], dur: 16, types: ["sawtooth", "triangle"], cutoff: 420, gain: 0.16, attack: 6, release: 8, send: 0.6 });
      this.drums(m, 0.28);
      break;
    case "rain":
      this.rain(m, 0.2);
      this.pad(m, { chords: [[50, 57, 60, 64], [46, 53, 57, 62]], dur: 18, types: ["sine"], cutoff: 700, gain: 0.1, attack: 7, release: 9, send: 0.6 });
      this.thunder(m);
      break;
    case "forest":
      this.wind(m, 0.16);
      this.pad(m, { chords: [[43, 50, 55, 59, 62], [48, 55, 59, 64, 67], [45, 52, 57, 61, 64], [50, 57, 62, 66, 69]], dur: 13, types: ["triangle", "sine"], cutoff: 1000, gain: 0.17, attack: 4.5, release: 6, send: 0.7 });
      this.bells(m, { scale: [79, 81, 83, 86, 88], every: [5, 11], gain: 0.045, decay: 4 });
      this.leaves(m);
      break;
    case "sea":
      this.waves(m, 0.3);
      this.wind(m, 0.07);
      this.pad(m, { chords: [[40, 47, 52, 55, 59], [45, 52, 57, 60, 64], [43, 50, 55, 59, 62], [38, 45, 50, 54, 57]], dur: 15, types: ["sine", "triangle"], cutoff: 950, gain: 0.15, attack: 5, release: 7, send: 0.7 });
      break;
    case "fire":
      this.fire(m, 0.28);
      this.pad(m, { chords: [[45, 52, 57, 60], [41, 48, 53, 57]], dur: 16, types: ["triangle"], cutoff: 520, gain: 0.12, attack: 6, release: 8, send: 0.5 });
      break;
    default:
      this.pad(m, { chords: [[45, 57, 60, 64, 67], [41, 53, 60, 64, 69], [48, 55, 60, 64, 67], [43, 50, 59, 62, 67]], dur: 12, types: ["triangle", "sine"], cutoff: 900, gain: 0.2, attack: 4, release: 6, send: 0.7 });
      this.bells(m, { scale: [69, 72, 74, 76, 79, 81], every: [4, 9], gain: 0.06, decay: 5 });
  }
  return m;
};
Engine.prototype.pump = function (until) {
  var m = this.cur; if (!m) { return; }
  m.layers.forEach(function (l) { l(until); });
};
Engine.prototype.play = function (id, fade) {
  if (!moodOk(id)) { id = "lantern"; }
  if (this.curId === id && this.cur) { return; }
  var ctx = this.ctx, t = ctx.currentTime, f = fade == null ? 2.5 : fade, old = this.cur, m = this.build(id), self = this;
  m.out.gain.cancelScheduledValues(t);
  if (f > 0) { m.out.gain.setValueAtTime(0, t); m.out.gain.linearRampToValueAtTime(m.trim, t + f); } else { m.out.gain.setValueAtTime(m.trim, t); }
  this.cur = m; this.curId = id;
  this.pump(t + 14);
  if (old) {
    old.out.gain.cancelScheduledValues(t); old.out.gain.setValueAtTime(old.out.gain.value, t); old.out.gain.linearRampToValueAtTime(0, t + Math.max(f, 0.05));
    if (this.live) { setTimeout(function () { self.dispose(old); }, (f + 0.5) * 1000); }
  }
  if (this.live && !this.timer) { this.timer = setInterval(function () { self.pump(ctx.currentTime + 14); }, 2000); }
};
Engine.prototype.dispose = function (m) {
  m.layers = [];
  m.srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* already stopped */ } });
  try { m.out.disconnect(); m.send.disconnect(); } catch (e) { /* already disconnected */ }
};
Engine.prototype.stopTimer = function () { if (this.timer) { clearInterval(this.timer); this.timer = null; } };

/* ================= preferences ================= */
var prefs = { vol: 0.5, mood: "lantern", auto: true, byGenre: {} };
try {
  var raw = JSON.parse(localStorage.getItem(KEY) || "null");
  if (raw && typeof raw === "object") {
    if (typeof raw.vol === "number" && raw.vol >= 0 && raw.vol <= 1) { prefs.vol = raw.vol; }
    if (moodOk(raw.mood)) { prefs.mood = raw.mood; }
    if (raw.auto === false) { prefs.auto = false; }
    if (raw.byGenre && typeof raw.byGenre === "object") {
      Object.keys(raw.byGenre).slice(0, 40).forEach(function (g) { if (g.length <= 40 && moodOk(raw.byGenre[g])) { prefs.byGenre[g] = raw.byGenre[g]; } });
    }
  }
} catch (e) { /* ignore */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
function wantOn() { try { return sessionStorage.getItem(SKEY) === "1"; } catch (e) { return false; } }
function setOn(v) { try { if (v) { sessionStorage.setItem(SKEY, "1"); } else { sessionStorage.removeItem(SKEY); } } catch (e) { /* ignore */ } }

/* ================= state ================= */
var ctx = null, eng = null, playing = false, genre = null, reader = false, isStatic = false, isSpa = false, el = null, open = false;
function moodFor() {
  if (prefs.auto && genre) { return prefs.byGenre[genre] || DEF[genre] || prefs.mood; }
  return prefs.mood || DEF[genre] || "lantern";
}
function engine() {
  if (eng) { return eng; }
  var AC = W.AudioContext || W.webkitAudioContext; if (!AC) { return null; }
  try { if (navigator.audioSession) { navigator.audioSession.type = "playback"; } } catch (e) { /* not supported */ }
  ctx = new AC(); eng = new Engine(ctx); eng.setVolume(prefs.vol, true); return eng;
}
function start(mood) {
  var e = engine(); if (!e) { toast("Sound isn\u2019t supported in this browser."); return; }
  var go = function () {
    e.setVolume(prefs.vol); e.play(mood || moodFor(), playing ? 2.5 : 1.5); playing = true; setOn(true); ui();
  };
  if (ctx.state === "running") { go(); } else { ctx.resume().then(go).catch(function () { ui(); }); }
}
function stop() {
  playing = false; setOn(false);
  if (eng) { var t = ctx.currentTime; eng.master.gain.cancelScheduledValues(t); eng.master.gain.setTargetAtTime(0, t, 0.2); setTimeout(function () { if (!playing && ctx) { ctx.suspend(); } }, 900); }
  ui();
}
function choose(id) {
  prefs.mood = id; if (genre) { prefs.byGenre[genre] = id; } save();
  if (playing) { eng.play(id, 2.5); ui(); } else { start(id); }
}
function onGenre() {
  if (playing && prefs.auto) { var m = moodFor(); if (eng && m !== eng.curId) { eng.play(m, 3); } }
  ui();
}
function toast(msg) { var t = D.getElementById("toast"); if (t && t.style) { t.textContent = msg; t.hidden = false; setTimeout(function () { t.hidden = true; }, 3500); } }

/* ================= interface ================= */
var CSS = "#ui-music{position:fixed;left:16px;bottom:18px;z-index:40;font-family:Cinzel,serif;color:var(--ink,#f4ead2)}" +
  "#ui-music[hidden]{display:none}" +
  "#ui-music.um-spa{bottom:150px}@media(min-width:861px){#ui-music.um-spa{left:20px;bottom:76px}}" +
  ".um-btn{width:48px;height:48px;border-radius:50%;border:1px solid var(--gold,#e0b45a);background:var(--gl,rgba(12,7,32,.8));color:var(--gold,#e0b45a);display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:0}" +
  ".um-btn svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}" +
  ".um-btn:hover{color:var(--ink,#f4ead2)}.um-btn:focus-visible,.um-panel button:focus-visible,.um-panel input:focus-visible{outline:2px solid var(--teal,#3fc6b8);outline-offset:3px}" +
  "#ui-music.um-on .um-btn{animation:umPulse 2.6s ease-in-out infinite}" +
  "@keyframes umPulse{50%{box-shadow:0 0 0 9px rgba(224,180,90,.16),0 8px 28px rgba(0,0,0,.35)}}" +
  "@media(prefers-reduced-motion:reduce){#ui-music.um-on .um-btn{animation:none}}" +
  ".um-hint{position:absolute;left:58px;bottom:10px;white-space:nowrap;background:var(--gl,rgba(12,7,32,.9));border:1px solid var(--ln,rgba(190,160,255,.2));padding:6px 12px;border-radius:99px;font:600 12px Cinzel,serif}" +
  ".um-panel{position:absolute;left:0;bottom:60px;width:min(330px,calc(100vw - 32px));max-height:min(72vh,540px);overflow:auto;background:rgba(14,8,34,.97);border:1px solid var(--ln,rgba(190,160,255,.2));border-radius:20px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.5)}" +
  ":root[data-theme=light] .um-panel{background:rgba(255,250,239,.98)}" +
  ".um-panel h2{font:500 16px Cinzel,serif;color:var(--gold,#e0b45a);margin:0 0 4px}.um-sub{font:15px 'Crimson Pro',Georgia,serif;color:var(--mu,#a9a1c8);margin:0 0 10px}" +
  ".um-x{position:absolute;right:10px;top:6px;background:none;border:0;font-size:24px;line-height:1;color:var(--mu,#a9a1c8);cursor:pointer}" +
  ".um-row{display:flex;gap:12px;align-items:center;margin:10px 0}.um-play{flex:none;border:0;border-radius:10px;padding:10px 16px;font:700 12px Cinzel,serif;letter-spacing:.08em;background:linear-gradient(135deg,var(--gold,#e0b45a),#b9822f);color:#2a1606;cursor:pointer}" +
  ".um-vol{flex:1;display:flex;align-items:center;gap:8px;font:13px Cinzel,serif;color:var(--mu,#a9a1c8)}.um-vol input{flex:1;accent-color:var(--gold,#e0b45a);min-width:0}" +
  ".um-m{display:flex;gap:10px;align-items:center;padding:8px 6px;border-radius:12px;cursor:pointer}.um-m:hover{background:rgba(255,255,255,.06)}.um-m input{accent-color:var(--gold,#e0b45a);width:18px;height:18px;flex:none}" +
  ".um-m b{display:block;font:500 14px Cinzel,serif}.um-m small{display:block;font:14px 'Crimson Pro',Georgia,serif;color:var(--mu,#a9a1c8)}.um-m em{margin-left:auto;font:normal 12px Cinzel,serif;color:var(--gold,#e0b45a)}" +
  ".um-auto{display:flex;gap:10px;align-items:flex-start;margin:10px 0 4px;font:15px 'Crimson Pro',Georgia,serif;cursor:pointer}.um-auto input{accent-color:var(--gold,#e0b45a);width:18px;height:18px;margin-top:2px;flex:none}" +
  ".um-foot{font:13px 'Crimson Pro',Georgia,serif;color:var(--mu,#a9a1c8);margin:8px 0 0}";

function build() {
  var st = D.createElement("style"); st.textContent = CSS; D.head.appendChild(st);
  el = D.createElement("div"); el.id = "ui-music"; if (isSpa) { el.className = "um-spa"; }
  el.innerHTML = '<button class="um-btn" type="button" aria-label="Reading music" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg></button>' +
    '<div class="um-hint" hidden>Tap anywhere to resume the music</div>' +
    '<div class="um-panel" role="dialog" aria-label="Reading music" hidden>' +
    '<button class="um-x" type="button" aria-label="Close">\u00d7</button><h2>Reading music</h2><p class="um-sub" id="um-ctx"></p>' +
    '<div class="um-row"><button class="um-play" type="button">\u25b6 PLAY</button><label class="um-vol">Volume <input type="range" min="0" max="100" step="1" aria-label="Volume"></label></div>' +
    '<div id="um-list" role="radiogroup" aria-label="Choose a mood"></div>' +
    '<label class="um-auto"><input type="checkbox" id="um-auto"><span>Match the music to each book\u2019s genre, using my favourites</span></label>' +
    '<p class="um-foot">The sound is created live in your browser. Nothing is downloaded.</p></div>';
  D.body.appendChild(el);
  var btn = el.querySelector(".um-btn"), panel = el.querySelector(".um-panel");
  btn.addEventListener("click", function () { setOpen(!open); });
  el.querySelector(".um-x").addEventListener("click", function () { setOpen(false); btn.focus(); });
  el.querySelector(".um-play").addEventListener("click", function () { if (playing) { stop(); } else { start(); } });
  el.querySelector(".um-vol input").addEventListener("input", function (e) { prefs.vol = (+e.target.value) / 100; save(); if (eng) { eng.setVolume(prefs.vol); } });
  el.querySelector("#um-list").addEventListener("change", function (e) { if (e.target && e.target.name === "um-mood") { choose(e.target.value); } });
  el.querySelector("#um-auto").addEventListener("change", function (e) { prefs.auto = !!e.target.checked; save(); onGenre(); });
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) { setOpen(false); btn.focus(); } });
  D.addEventListener("click", function (e) { if (open && el && !el.contains(e.target)) { setOpen(false); } });
  var resume = function () {
    if (wantOn() && !playing && !resuming) { resuming = true; start(); setTimeout(function () { resuming = false; }, 600); }
  };
  ["pointerdown", "keydown", "touchend"].forEach(function (t) { D.addEventListener(t, resume, { passive: true }); });
}
var resuming = false;
function setOpen(v) {
  open = v; var panel = el.querySelector(".um-panel"), btn = el.querySelector(".um-btn");
  panel.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false");
  if (v) { ui(); }
}
function ui() {
  if (!el) { return; }
  var show = isStatic || reader || playing || wantOn();
  el.hidden = !show;
  el.classList.toggle("um-on", playing);
  var btn = el.querySelector(".um-btn");
  btn.setAttribute("title", playing ? "Reading music: on" : "Reading music");
  el.querySelector(".um-hint").hidden = !(wantOn() && !playing && !open);
  if (!open) { return; }
  var cur = playing && eng && eng.curId ? eng.curId : moodFor();
  el.querySelector(".um-play").textContent = playing ? "\u275a\u275a PAUSE" : "\u25b6 PLAY";
  el.querySelector(".um-vol input").value = Math.round(prefs.vol * 100);
  el.querySelector("#um-auto").checked = prefs.auto;
  el.querySelector("#um-ctx").textContent = genre ? "This book: " + genre + (prefs.byGenre[genre] ? " \u00b7 your favourite: " + moodName(prefs.byGenre[genre]) : "") : "Pick a mood for your reading.";
  var list = el.querySelector("#um-list");
  list.innerHTML = MOODS.map(function (m) {
    var tag = genre && prefs.byGenre[genre] === m.id ? "\u2605 favourite" : (genre && !prefs.byGenre[genre] && DEF[genre] === m.id ? "suggested" : "");
    return '<label class="um-m"><input type="radio" name="um-mood" value="' + m.id + '"' + (m.id === cur ? " checked" : "") + '><span><b>' + m.name + "</b><small>" + m.desc + "</small></span>" + (tag ? "<em>" + tag + "</em>" : "") + "</label>";
  }).join("");
}

/* ================= generated book pages: keep the music playing between pages ================= */
function readStatic() {
  var m = D.querySelector("main[data-genre]"), g = m ? m.getAttribute("data-genre") : null;
  var changed = g !== genre; genre = g || null; return changed;
}
var navToken = 0;
function basePath() { var i = location.pathname.indexOf("/books/"); return i < 0 ? null : location.pathname.slice(0, i + 1); }
function eligible(u) {
  var base = basePath(); return !!base && u.origin === location.origin && u.pathname.indexOf(base + "books/") === 0;
}
function swap(doc) {
  var cur = D.body, keep = el;
  Array.prototype.slice.call(cur.children).forEach(function (n) { if (n !== keep && n.tagName !== "SCRIPT") { cur.removeChild(n); } });
  Array.prototype.slice.call(doc.body.children).forEach(function (n) {
    if (n.tagName === "SCRIPT" || n.id === "ui-music") { return; }
    cur.insertBefore(D.importNode(n, true), keep);
  });
  D.title = doc.title;
  ["link[rel=canonical]", "meta[name=description]", "meta[property='og:title']", "meta[property='og:description']", "meta[property='og:url']", "meta[property='og:image']"].forEach(function (sel) {
    var a = D.head.querySelector(sel), b = doc.head.querySelector(sel);
    if (a && b) { a.setAttribute(a.hasAttribute("href") ? "href" : "content", b.getAttribute(b.hasAttribute("href") ? "href" : "content")); }
  });
}
function go(url, push) {
  var token = ++navToken;
  fetch(url, { credentials: "same-origin" }).then(function (r) {
    var ct = r.headers.get("content-type") || "";
    if (!r.ok || ct.indexOf("text/html") < 0) { throw new Error("not a page"); }
    return r.text();
  }).then(function (html) {
    if (token !== navToken) { return; }
    var doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.querySelector("main.wrap")) { throw new Error("not a book page"); }
    if (push) { history.pushState(null, "", url); }
    swap(doc);
    W.scrollTo(0, 0);
    var m = D.querySelector("main"); if (m) { m.setAttribute("tabindex", "-1"); try { m.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (readStatic()) { onGenre(); } else { ui(); }
  }).catch(function () { if (token === navToken) { location.href = url; } });
}
function softNav() {
  D.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target || a.hasAttribute("download") || (a.getAttribute("href") || "").charAt(0) === "#") { return; }
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (!eligible(u) || (u.pathname === location.pathname && u.search === location.search)) { return; }
    e.preventDefault(); go(u.href, true);
  });
  W.addEventListener("popstate", function () { if (eligible(new URL(location.href))) { go(location.href, false); } });
}

/* ================= start-up ================= */
W.UiMusic = {
  /* Used by the main page: tell the player which book is open in the reader (or null). */
  context: function (c) {
    var g = c && c.genre ? String(c.genre) : null, r = !!c;
    if (r === reader && (!r || g === genre)) { return; }
    reader = r; if (r) { genre = g; }
    onGenre();
  },
  _test: { engine: function () { return eng; }, Engine: Engine, MOODS: MOODS, DEF: DEF, prefs: function () { return prefs; }, state: function () { return { playing: playing, mood: eng && eng.curId, ctxState: ctx && ctx.state, genre: genre }; } }
};
function init() {
  isStatic = !!D.querySelector("main.wrap") && basePath() !== null;
  isSpa = !!D.getElementById("v-home");
  if (!isStatic && !isSpa) { return; }
  if (isStatic) { readStatic(); }
  build(); ui();
  if (isStatic) { softNav(); }
}
if (D.readyState === "loading") { D.addEventListener("DOMContentLoaded", init); } else { init(); }
})();
