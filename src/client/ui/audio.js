/* ============================================================
   Respite · ui/audio.js · What the Camp Sounds Like
   ------------------------------------------------------------
   One music track on a loop and a handful of short sounds, both
   behind switches in Settings. Nothing here is game state, so it
   is kept in localStorage with the rest of the tab's preferences
   and never goes near a save.

   Browsers will not let a page make noise until the player has
   touched it, so the track is armed at boot and started on the
   first press, keypress or tap. A missing file is not an error:
   the switches stay, the camp is simply quiet. Drop your own
   track in at assets/audio/ under the names below and it plays.
   ============================================================ */

const KEY = "respite.sound";

/* The files the camp looks for. Nothing ships in the repo: put a track you hold
   the rights to at these paths and it is picked up on the next load. Two names
   so one covers Safari and the other everything else; whichever answers wins. */
export const TRACKS = Object.freeze({
  music: ["assets/audio/bgm.mp3", "assets/audio/bgm.ogg"],
});

const CUES = Object.freeze({
  press: "assets/audio/press.mp3",
  good: "assets/audio/good.mp3",
  bad: "assets/audio/bad.mp3",
  coin: "assets/audio/coin.mp3",
});

const DEFAULTS = Object.freeze({ music: true, sfx: true, volume: 0.4 });

const clamp = (v) => Math.max(0, Math.min(1, Number(v)));

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const got = raw ? JSON.parse(raw) : null;
    if (!got || typeof got !== "object") return { ...DEFAULTS };
    return {
      music: got.music !== false,
      sfx: got.sfx !== false,
      volume: Number.isFinite(Number(got.volume)) ? clamp(got.volume) : DEFAULTS.volume,
    };
  } catch (err) {
    return { ...DEFAULTS };   // private windows and blocked storage: the camp still plays
  }
}

function write(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (err) {
    /* nothing kept, which is no worse than a fresh tab */
  }
}

let prefs = read();
let track = null;          // the looping element, once armed
let armed = false;
let started = false;
const cues = new Map();
const listeners = new Set();

const announce = () => listeners.forEach((fn) => {
  try {
    fn({ ...prefs });
  } catch (err) {
    console.error("audio: listener failed", err);
  }
});

function element(src, { loop = false } = {}) {
  if (typeof Audio !== "function") return null;
  const el = new Audio();
  el.src = src;
  el.loop = loop;
  el.preload = "auto";
  el.volume = prefs.volume;
  // A file that is not there is a quiet camp, not a broken one.
  el.addEventListener("error", () => { el.dataset.dead = "1"; }, { once: true });
  return el;
}

/* The first source the browser will admit it can play. Safari and Chrome
   disagree about ogg, so the list is tried in order and the first yes wins. */
function pickSource(list) {
  if (typeof Audio !== "function") return null;
  const probe = new Audio();
  const guess = (src) => {
    const type = src.endsWith(".ogg") ? "audio/ogg" : src.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
    return probe.canPlayType(type);
  };
  return list.find((src) => guess(src) === "probably") || list.find((src) => guess(src)) || null;
}

function ensureTrack() {
  if (track || !prefs.music) return track;
  const src = pickSource(TRACKS.music);
  if (!src) return null;
  track = element(src, { loop: true });
  return track;
}

// Autoplay is blocked until the player has touched the page: take the first touch.
function arm() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const go = () => {
    started = true;
    play();
    ["pointerdown", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, go));
  };
  ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, go, { passive: true }));
}

function play() {
  if (!started || !prefs.music) return;
  const el = ensureTrack();
  if (!el || el.dataset.dead) return;
  el.volume = prefs.volume;
  const p = el.play();
  // A refused play is a browser policy, not a fault: the next press tries again.
  if (p && typeof p.catch === "function") p.catch(() => {});
}

function stop() {
  if (!track) return;
  track.pause();
  try {
    track.currentTime = 0;
  } catch (err) {
    /* a source that never loaded has no time to seek */
  }
}

export const sound = {
  get prefs() {
    return { ...prefs };
  },

  /* Called once at boot. Nothing sounds until the player touches the page,
     which is what every browser requires and what a player expects anyway. */
  start() {
    arm();
  },

  set(patch) {
    const next = {
      music: patch && "music" in patch ? !!patch.music : prefs.music,
      sfx: patch && "sfx" in patch ? !!patch.sfx : prefs.sfx,
      volume: patch && "volume" in patch ? clamp(patch.volume) : prefs.volume,
    };
    const was = prefs;
    prefs = next;
    write(prefs);
    if (track) track.volume = prefs.volume;
    if (!prefs.music && was.music) stop();
    if (prefs.music && (!was.music || was.volume !== prefs.volume)) play();
    announce();
  },

  // A short sound, if the player wants them and the file is there.
  cue(name) {
    if (!prefs.sfx || !CUES[name]) return;
    let el = cues.get(name);
    if (!el) {
      el = element(CUES[name]);
      if (!el) return;
      cues.set(name, el);
    }
    if (el.dataset.dead) return;
    el.volume = prefs.volume;
    try {
      el.currentTime = 0;
    } catch (err) {
      /* never loaded: play() below simply does nothing */
    }
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  },

  // Whether a music file was actually found, so Settings can say when it was not.
  get silent() {
    return !pickSource(TRACKS.music) || !!(track && track.dataset.dead);
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
