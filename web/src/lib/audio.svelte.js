// Sound.
//
// Placeholders are synthesised with WebAudio rather than shipped as files, so there is
// nothing to replace later: drop real files into web/public/sfx/<name>.mp3 and they
// take over automatically. Nothing in the calling code changes.
//
// Every cue is short and front-loaded. This is a race, so a correct answer must never
// make the player wait for a sound to finish.

const NAMES = ['correct', 'wrong', 'start', 'finish', 'peek', 'best']
const STORE = 'hh-audio'

let ctx = null
const buffers = new Map()

const state = $state({
  volume: 0.6,
  muted: false,
})

try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}')
  if (typeof saved.volume === 'number') state.volume = Math.min(1, Math.max(0, saved.volume))
  if (typeof saved.muted === 'boolean') state.muted = saved.muted
} catch { /* first visit */ }

const persist = () => localStorage.setItem(STORE, JSON.stringify({ volume: state.volume, muted: state.muted }))

export const audio = {
  get volume() { return state.volume },
  set volume(v) { state.volume = Math.min(1, Math.max(0, v)); if (state.volume > 0) state.muted = false; persist() },
  get muted() { return state.muted },
  set muted(v) { state.muted = Boolean(v); persist() },
  toggleMute() { state.muted = !state.muted; persist() },
}

/** Browsers will not start an AudioContext until the user has interacted. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    void loadFiles()
  }
  if (ctx.state === 'suspended') void ctx.resume()
}

/** If a real file exists it wins. Missing files fall through to the synth silently. */
async function loadFiles() {
  await Promise.all(NAMES.map(async name => {
    try {
      const res = await fetch(`/sfx/${name}.mp3`, { cache: 'force-cache' })
      if (!res.ok) return
      buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()))
    } catch { /* synth it is */ }
  }))
}

const gainFor = level => {
  const g = ctx.createGain()
  g.gain.value = state.muted ? 0 : state.volume * level
  g.connect(ctx.destination)
  return g
}

/** One short tone. `slide` bends the pitch, which is what makes a cue feel like it is
 *  going up (good) or falling over (bad) rather than just beeping. */
function tone({ freq, to = freq, dur = 0.09, type = 'sine', level = 1, delay = 0 }) {
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  // Fast attack, smooth tail. A click here would be very noticeable at 500 words.
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(1, t0 + 0.006)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(env)
  env.connect(gainFor(level))
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise({ dur = 0.12, level = 0.5, delay = 0 }) {
  const t0 = ctx.currentTime + delay
  const frames = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 900
  src.connect(filter)
  filter.connect(gainFor(level))
  src.start(t0)
}

const SYNTH = {
  // Barely there. A tick with a hint of lift, over in 70ms.
  correct: () => tone({ freq: 880, to: 1320, dur: 0.07, type: 'triangle', level: 0.32 }),
  // Lower, buzzier, falling. Unmistakable without being punishing.
  wrong: () => {
    tone({ freq: 220, to: 150, dur: 0.16, type: 'sawtooth', level: 0.3 })
    noise({ dur: 0.1, level: 0.16 })
  },
  start: () => {
    tone({ freq: 523, dur: 0.08, type: 'sine', level: 0.3 })
    tone({ freq: 784, dur: 0.11, type: 'sine', level: 0.3, delay: 0.09 })
  },
  finish: () => {
    tone({ freq: 659, dur: 0.1, type: 'sine', level: 0.34 })
    tone({ freq: 880, dur: 0.1, type: 'sine', level: 0.34, delay: 0.1 })
    tone({ freq: 1175, dur: 0.22, type: 'sine', level: 0.3, delay: 0.2 })
  },
  peek: () => tone({ freq: 440, dur: 0.04, type: 'sine', level: 0.18 }),
  best: () => {
    tone({ freq: 784, dur: 0.1, type: 'triangle', level: 0.32 })
    tone({ freq: 1047, dur: 0.1, type: 'triangle', level: 0.32, delay: 0.1 })
    tone({ freq: 1568, dur: 0.3, type: 'triangle', level: 0.28, delay: 0.2 })
  },
}

export function play(name) {
  if (state.muted || state.volume <= 0) return
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()

  const buf = buffers.get(name)
  if (buf) {
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(gainFor(1))
    src.start()
    return
  }
  SYNTH[name]?.()
}

/**
 * Pronunciation playback. Separate from the cues so muting effects can be a different
 * decision later if it needs to be.
 *
 * The voice used to be an <audio> element whose fetch started at the moment of a
 * correct answer, so the clip arrived a full round trip late: on the real deployment
 * (a Pi behind a tunnel) the player was already sounding out the next word over the
 * previous one. The race now calls preloadSpeech() while a word is still being typed,
 * and a decoded AudioBuffer starts within the same frame as speak(). The element path
 * survives underneath as the fallback for anything not preloaded in time.
 */
let speech = null
const clips = new Map() // word -> Promise<AudioBuffer|null>, null meaning no clip exists
const CLIPS_MAX = 8     // the race only ever needs the current word and the next

export function preloadSpeech(word) {
  // No context yet means no user gesture yet, and every caller races behind one, so
  // rather than buffering bytes for a context that may never exist, just decline.
  if (!word || !ctx || clips.has(word)) return
  // Insertion order is oldest first, and the words that matter are always the newest
  // two, so evicting from the front can never throw away a clip still ahead of play.
  // Without the cap a muted 500 word run would quietly hold 500 decoded buffers.
  if (clips.size >= CLIPS_MAX) clips.delete(clips.keys().next().value)
  clips.set(word, (async () => {
    try {
      const res = await fetch(`/audio/${encodeURIComponent(word)}.mp3`, { cache: 'force-cache' })
      if (!res.ok) return null
      return await ctx.decodeAudioData(await res.arrayBuffer())
    } catch { return null }
  })())
}

export function speak(word) {
  if (state.muted || state.volume <= 0) return
  const clip = ctx ? clips.get(word) : null
  if (clip) {
    clips.delete(word) // spoken once per run, so the map stays two entries deep
    void clip.then(buf => {
      if (!buf) return speakViaElement(word)
      if (ctx.state === 'suspended') void ctx.resume()
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gainFor(1))
      src.start()
    })
    return
  }
  speakViaElement(word)
}

function speakViaElement(word) {
  speech ??= new Audio()
  speech.volume = state.volume
  speech.src = `/audio/${encodeURIComponent(word)}.mp3`
  speech.play().catch(() => { /* not generated yet */ })
}
