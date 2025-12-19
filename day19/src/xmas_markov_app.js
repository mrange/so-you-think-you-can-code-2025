/** SONG LIBRARY **/
const SONGS = {
  "Last Christmas": "A3:1.0,A3:0.5,F#3:0.5,E3:0.5,D3:0.5,B2:1.5,B2:0.5,C#3:0.5,D3:0.5,E3:0.5,F#3:1.5",
  "Jingle Bells": "E4:0.5,E4:0.5,E4:1.0,E4:0.5,E4:0.5,E4:1.0,E4:0.5,G4:0.5,C4:0.5,D4:0.5,E4:2.0",
  "The Feeling": "B3:0.25,D#4:0.25,F#4:0.25,B4:0.5,B4:0.25,A#4:0.25,G#4:0.5,G#4:0.25,F#4:0.25,E4:0.5,E4:0.5",
  "Seven Nation Army": "E3:1.5,E3:0.5,G3:0.5,E3:0.5,D3:0.5,C3:1.0,B2:1.0",
  "O Holy Night": "G3:0.5,G3:1.0,G3:0.5,A3:0.5,A3:0.5,G3:1.0,E3:0.5,D3:0.5,C3:1.5,E3:0.5,F3:0.5,G3:1.5,F3:0.5,D3:2.0",
  "Sweet Dreams": "C3:0.5,C3:0.5,D#3:0.5,C3:0.5,G#2:0.5,G#2:0.5,G2:0.5,G2:0.5"
};

/** MARKOV LOGIC **/
const choice = arr => arr[Math.floor(Math.random() * arr.length)];

const buildMarkov = (toks, o) => {
  const m = new Map();
  for (let i = 0; i + o < toks.length; i++) {
    const k = toks.slice(i, i + o).join('|');
    const n = toks[i + o];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  }
  return { m, o };
};

/**
 * Weighted choice with temperature control.
 * @param {Array<{item: string, weight: number}>} options
 * @param {number} temperature
 * @returns {string}
 */
function getWeightedChoice(options, temperature = 1) {
  const scaled = options.map(o => ({ item: o.item, weight: Math.pow(o.weight, 1 / temperature) }));
  const total = scaled.reduce((sum, o) => sum + o.weight, 0);
  let rnd = Math.random() * total;
  for (const o of scaled) {
    if (rnd < o.weight) return o.item;
    rnd -= o.weight;
  }
  return scaled[scaled.length - 1].item;
}

const generate = (markov, len, temperature = 1) => {
  const { m, o } = markov, keys = [...m.keys()];
  if (!keys.length) return [];
  let cur = choice(keys).split('|'), out = [...cur];
  while (out.length < len) {
    const optsRaw = m.get(cur.join('|'));
    if (!optsRaw) { cur = choice(keys).split('|'); continue; }
    // compute frequency weights
    const counts = {};
    optsRaw.forEach(t => counts[t] = (counts[t] || 0) + 1);
    const weightedOpts = Object.keys(counts).map(k => ({ item: k, weight: counts[k] }));
    const nxt = getWeightedChoice(weightedOpts, temperature);
    out.push(nxt); cur = out.slice(-o);
  }
  return out;
};

/** AUDIO ENGINE **/
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FREQ = {};
for (let oct = 0; oct < 9; oct++) NOTES.forEach((n, i) => FREQ[`${n}${oct}`] = 440 * Math.pow(2, ((oct - 4) * 12 + (i - 9)) / 12));

class Engine {
  constructor() { this.ctx = null; this.rafID = null; this.isPlaying = false; }
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.master = this.ctx.createGain(); this.master.gain.value = 0.4;
    this.reverb = this.ctx.createConvolver(); this.reverb.buffer = this.createIR();
    this.master.connect(this.reverb); this.reverb.connect(this.analyser); this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
  }
  createIR() {
    const len = this.ctx.sampleRate * 2.5, buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } return buf;
  }
  playDrum(t, freq, dec) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(0.01, t + dec); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.01, t + dec); o.connect(g); g.connect(this.analyser); o.start(t); o.stop(t + dec); }
  heartbeat(tokens, bpm, wave) {
    if (!this.isPlaying || !this.ctx) return; const spb = 60 / bpm;
    while (this.nextTime < this.ctx.currentTime + 0.1 && this.idx < tokens.length) {
      const [note, dur] = tokens[this.idx].split(':'); const t = this.nextTime, dSec = parseFloat(dur) * spb;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = wave; o.frequency.setValueAtTime(FREQ[note] || 440, t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dSec - 0.01);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dSec);
      if (this.idx % 2 === 0) this.playDrum(t, 100, 0.15);
      this.nextTime += dSec; this.idx++;
    }
    this.renderViz();
    if (this.idx < tokens.length) this.rafID = requestAnimationFrame(() => this.heartbeat(tokens, bpm, wave));
    else this.isPlaying = false;
  }
  renderViz() {
    const can = document.getElementById('viz'), b = can.getContext('2d'); const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data); b.fillStyle = '#010409'; b.fillRect(0, 0, can.width, can.height);
    const w = (can.width / data.length) * 2.5; for (let i = 0; i < data.length; i++) { const h = data[i] * 0.8; b.fillStyle = `hsl(${220 + data[i] / 5},80%,60%)`; b.fillRect(i * (w + 1), can.height - h, w, h); }
  }
  play(tokens, bpm, wave) { this.init(); if (this.ctx.state === 'suspended') this.ctx.resume(); this.stop(); this.isPlaying = true; this.idx = 0; this.nextTime = this.ctx.currentTime + 0.05; this.heartbeat(tokens, bpm, wave); }
  stop() { this.isPlaying = false; cancelAnimationFrame(this.rafID); }
}

/** UI **/
const libraryEl = document.getElementById('library'); Object.keys(SONGS).forEach((name, index) => { const label = document.createElement('label'); const isChecked = index === 0 ? 'checked' : ''; label.innerHTML = `<input type="checkbox" value="${name}" ${isChecked}> ${name}`; libraryEl.appendChild(label); });

const player = new Engine();
let currentSeq = [];

// Temperature display
const tempSlider = document.getElementById('temperature');
const tempDisplay = document.getElementById('tempValue');
tempSlider.oninput = () => tempDisplay.textContent = tempSlider.value;

document.getElementById('genBtn').onclick = () => {
  const selected = Array.from(libraryEl.querySelectorAll('input:checked')).map(i => SONGS[i.value]);
  if (!selected.length) return alert("Select at least one song!");
  const masterCorpus = selected.flatMap(song => song.split(','));
  const markov = buildMarkov(masterCorpus, parseInt(document.getElementById('order').value));
  const temperature = parseFloat(tempSlider.value);
  currentSeq = generate(markov, parseInt(document.getElementById('length').value), temperature);
  document.getElementById('output').textContent = "BAKED SEQUENCE: " + currentSeq.join(' ');
};

document.getElementById('playBtn').onclick = () => {
  if (!currentSeq.length) document.getElementById('genBtn').onclick();
  player.play(currentSeq, parseInt(document.getElementById('tempo').value), document.getElementById('waveform').value);
};

document.getElementById('stopBtn').onclick = () => player.stop();