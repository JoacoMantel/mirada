import { Predictor, pretty, split, morePages } from './predictor.js';
import { extractFeatures, GazeModel, OneEuro, classify, Dwell } from './gaze.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim'); // Pruebas automáticas: la malla llega simulada, sin cámara.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(k, d) { try { const v = localStorage.getItem('mirada.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mirada.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const settings = {
  dwell: store.get('dwell', 900),
  dot: store.get('dot', false),
  sound: store.get('sound', true),
};

const predictor = new Predictor();
const model = new GazeModel();
const dwell = new Dwell({ dwellMs: settings.dwell });
const euroX = new OneEuro();
const euroY = new OneEuro(0.6, 1.0); // El eje vertical es más ruidoso: se suaviza más.

// ---------- Teclado ----------

const zoneEls = [];
for (let i = 0; i < 6; i++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'zone';
  b.innerHTML = '<span class="fill"></span><span class="label"></span>';
  b.addEventListener('click', () => choose(i));
  $('zones').append(b);
  zoneEls.push(b);
}

let text = '';
let history = [];      // Cada elección guarda el estado anterior: Borrar la deshace entera.
let menu = [];         // Páginas y grupos abiertos del menú "Más".
let pages = [];        // Páginas pendientes del menú "Más".
let shownMain = [];
let items = [];

function groupLabel(g) {
  if (g.label) return g.label;
  return g.items.map(itemLabel).join(' ');
}
function itemLabel(it) {
  if (it.kind === 'space') return 'espacio';
  if (it.kind === 'word') return it.form;
  return it.label ?? it.ch;
}
function itemClass(it) {
  if (it.fixed) return 'command fixed';
  if (it.kind === 'letter' && it.ch.length === 1) return 'letter';
  if (it.kind === 'group') return 'group';
  if (it.kind === 'word') return 'word';
  return 'command';
}

function render() {
  const level = menu[menu.length - 1];
  const top = level ? level.items : predictor.options(text, 4);
  if (!level) shownMain = top.filter((o) => o.ch !== undefined).map((o) => o.ch);
  const main = top.slice(0, 4);
  while (main.length < 4) main.push({ kind: 'none' });
  const right = level
    ? (level.more ? { kind: 'next', fixed: true, label: 'Más' } : { kind: 'action', action: 'speak', fixed: true, label: 'Hablar' })
    : { kind: 'more', fixed: true, label: 'Más' };
  const left = level ? { kind: 'back', fixed: true, label: 'Volver' } : { kind: 'undo', fixed: true, label: 'Borrar' };
  items = [...main, left, right];
  items.forEach((it, i) => {
    const el = zoneEls[i];
    el.className = 'zone ' + itemClass(it);
    el.disabled = it.kind === 'none';
    el.querySelector('.label').textContent = it.kind === 'none' ? '' : it.kind === 'group' ? groupLabel(it) : itemLabel(it);
    el.style.setProperty('--p', 0);
  });
  const shown = pretty(text);
  $('text').innerHTML = '';
  if (!text) {
    const s = document.createElement('span');
    s.className = 'empty';
    s.textContent = hasGaze
      ? 'Mirá una letra para elegirla. Para descansar, mirá esta parte de arriba.'
      : 'Tocá una letra para elegirla.';
    $('text').append(s);
  } else {
    const line = document.createElement('div');
    line.textContent = shown;
    const c = document.createElement('span');
    c.className = 'caret';
    line.append(c);
    $('text').append(line);
  }
}

function pushState(sampleId) { history.push({ text, sampleId }); if (history.length > 200) history.shift(); }

function choose(i, sampleFeatures = null) {
  const it = items[i];
  if (!it || it.kind === 'none') return;
  flash(i);
  feedback();
  const zone = zoneCenters()[i];
  const correction = sampleFeatures && !['undo', 'back'].includes(it.kind);
  const sampleId = correction ? model.addOnline(sampleFeatures, zone.x, zone.y) : null;

  switch (it.kind) {
    case 'letter':
      pushState(sampleId); text += it.ch; menu = []; break;
    case 'space':
      pushState(sampleId); text = predictor.applySpace(text); menu = []; break;
    case 'word':
      pushState(sampleId); text = predictor.applyWord(text, it.form); menu = []; break;
    case 'group':
      menu.push({ items: split(it.items), more: false }); break;
    case 'more':
      pages = morePages(predictor, text, shownMain);
      menu = [pages[0]]; break;
    case 'next':
      menu.push(pages[pages.indexOf(menu[menu.length - 1]) + 1]); break;
    case 'back':
      menu.pop(); break;
    case 'undo': {
      const prev = history.pop();
      if (prev) {
        text = prev.text;
        if (prev.sampleId) model.removeOnline(prev.sampleId); // Una elección borrada no enseña nada.
      }
      break;
    }
    case 'action':
      if (it.action === 'speak') speak();
      if (it.action === 'clear') clearAll();
      break;
  }
  render();
}

function clearAll() {
  if (text) pushState(null); // Borrar deshace también esto.
  text = '';
  menu = [];
}

function flash(i) {
  const el = zoneEls[i];
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 170);
}

let audio = null;
function feedback() {
  if (settings.sound && audio) {
    try {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.12);
    } catch { /* sin audio */ }
  }
  if (navigator.vibrate) { try { navigator.vibrate(25); } catch { /* sin vibración */ } }
}

function speak() {
  if (!text.trim() || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(pretty(text));
  u.lang = 'es-AR';
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function zoneCenters() {
  const W = innerWidth, H = innerHeight;
  return zoneEls.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) / W, y: (r.top + r.height / 2) / H, w: r.width / W, h: r.height / H };
  });
}
function restLine() {
  return $('zones').getBoundingClientRect().top / innerHeight - 0.02;
}

// ---------- Mirada ----------

let hasGaze = false;
let mode = 'idle';     // idle | calib | typing
let collector = null;  // Junta rasgos durante la calibración y la prueba.
let openBase = null;
let lastFace = 0;
let frames = 0, fps = 0, fpsT = performance.now();
let currentZone = null;
let zoneSamples = new Map(); // Rasgos recientes de cada zona, para afinar la calibración.
let lastFaceWidth = 0;

function onLandmarks(lm, width, height) {
  const t = performance.now();
  frames++;
  if (t - fpsT > 1000) { fps = Math.round(frames * 1000 / (t - fpsT)); frames = 0; fpsT = t; }

  if (!lm) { handleNoFace(t); return; }
  lastFace = t;
  const { f, open, faceWidth } = extractFeatures(lm, width, height);
  lastFaceWidth = faceWidth;
  openBase = openBase === null ? open : openBase * 0.995 + open * 0.005;
  const blinking = open < openBase * 0.55;

  if (mode === 'calib') { if (collector && !blinking) collector.push(f); return; }
  if (mode !== 'typing' || !model.fitted) return;
  if ($('settings').open) { paint(null, 0); return; }
  $('face-status').textContent = '';
  if (blinking) return; // Parpadear no cuenta como dejar de mirar.

  const raw = model.predict(f);
  const point = { x: euroX.filter(raw.x, t), y: euroY.filter(raw.y, t) };
  if (settings.dot) {
    $('gaze-dot').style.transform = `translate(${point.x * innerWidth}px, ${point.y * innerHeight}px)`;
  }
  const zones = zoneCenters();
  currentZone = classify(point, zones, currentZone, restLine());
  const zoneOk = currentZone !== null && items[currentZone]?.kind !== 'none';
  const res = dwell.update(zoneOk ? currentZone : null, t);
  if (zoneOk) {
    const list = zoneSamples.get(currentZone) || [];
    list.push(f);
    if (list.length > 40) list.shift();
    zoneSamples.set(currentZone, list);
  }
  paint(res.zone, res.progress);
  if (res.selected !== null) {
    const samples = zoneSamples.get(res.selected) || [];
    zoneSamples = new Map();
    const mean = samples.length >= 4 ? averageFeatures(samples) : null;
    choose(res.selected, mean);
  }
}

function averageFeatures(list) {
  const out = new Array(list[0].length).fill(0);
  for (const f of list) f.forEach((v, i) => { out[i] += v / list.length; });
  return out;
}

function handleNoFace(t) {
  if (mode === 'typing' && hasGaze && t - lastFace > 700) {
    $('face-status').textContent = 'No se ve tu cara';
    dwell.reset();
    paint(null, 0);
  }
}

function paint(active, progress) {
  zoneEls.forEach((el, i) => el.style.setProperty('--p', i === active ? progress : 0));
}

// ---------- Cámara ----------

let faceMesh = null;
const video = $('video');

async function startCamera() {
  if (SIM) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Abrí la página con https en Chrome o Safari.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();

  faceMesh = new window.FaceMesh({ locateFile: (f) => `vendor/face_mesh/${f}` });
  faceMesh.setOptions({
    maxNumFaces: 1, refineLandmarks: true, selfieMode: false,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  faceMesh.onResults((r) => {
    onLandmarks(r.multiFaceLandmarks?.[0] ?? null, video.videoWidth, video.videoHeight);
  });
  await faceMesh.initialize();
  trackLoop();
}

async function trackLoop() {
  for (;;) {
    if (video.readyState >= 2 && !document.hidden) {
      try { await faceMesh.send({ image: video }); } catch (e) { console.error(e); await sleep(300); }
    }
    await new Promise((r) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(r) : requestAnimationFrame(r)));
  }
}

function placementLoop() {
  if ($('screen-place').hidden) return;
  const seen = performance.now() - lastFace < 500;
  const btn = $('btn-calibrate');
  btn.disabled = !seen;
  $('place-title').textContent = seen ? 'Tu cara está en cuadro' : 'Mostrá tu cara a la cámara';
  let msg = 'Si podés, buscá una luz de frente y evitá tener una ventana detrás.';
  if (!seen) msg = 'Sacate los anteojos si reflejan y mirá de frente al celular.';
  else if (lastFaceWidth < 0.17) msg = 'Acercá un poco el celular.';
  else if (lastFaceWidth > 0.6) msg = 'Alejá un poco el celular.';
  $('place-msg').textContent = msg;
  requestAnimationFrame(placementLoop);
}

// ---------- Calibración ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

async function collectAt(ms) {
  collector = [];
  await sleep(ms);
  const got = collector;
  collector = null;
  return got;
}

async function runCalibration() {
  mode = 'calib';
  model.reset();
  dwell.reset();
  video.classList.remove('preview');
  document.body.append(video);
  show('screen-calib');
  const screen = $('screen-calib');
  screen.classList.remove('testing');
  const msg = $('calib-msg');
  const dot = $('calib-dot');
  msg.textContent = 'Sin mover la cabeza, seguí cada punto con la mirada hasta que desaparezca.';
  await sleep(2600);
  msg.textContent = '';

  const zones = zoneCenters();
  // Cuatro alturas: el eje vertical es el más difícil y necesita más referencias.
  const ys = [0, 1, 2, 3].map((i) => zones[0].y + (zones[4].y - zones[0].y) * i / 3);
  const xs = [0.14, 0.5, 0.86];
  const targets = [];
  for (const y of ys) for (const x of xs) targets.push({ x, y });
  // Orden que evita saltos previsibles entre puntos vecinos.
  const order = [4, 0, 11, 2, 9, 7, 1, 10, 3, 8, 5, 6].map((i) => targets[i]);

  dot.hidden = false;
  for (const t of order) {
    dot.style.left = t.x * innerWidth + 'px';
    dot.style.top = t.y * innerHeight + 'px';
    dot.style.setProperty('--s', 1);
    await sleep(500);
    const start = performance.now();
    let samples = [];
    const shrink = setInterval(() => {
      dot.style.setProperty('--s', Math.max(0.3, 1 - (performance.now() - start) / 1500));
    }, 40);
    samples = samples.concat(await collectAt(1100));
    // Si la cara no se vio bien, se espera un poco más en el mismo punto.
    for (let tries = 0; samples.length < 6 && tries < 3; tries++) {
      msg.textContent = 'No se ve tu cara. Mirá el punto.';
      samples = samples.concat(await collectAt(1100));
    }
    msg.textContent = '';
    clearInterval(shrink);
    if (samples.length < 3) { dot.hidden = true; return failCalibration(); }
    samples.forEach((f) => model.addCalibration(f, t.x, t.y));
  }
  dot.hidden = true;
  if (!model.fit()) return failCalibration();

  // Prueba real con las 6 zonas: mide y también afina el ajuste.
  screen.classList.add('testing');
  $('text').textContent = 'Ahora mirá cada zona que se marca.';
  zoneEls.forEach((el) => { el.querySelector('.label').textContent = ''; el.className = 'zone'; });
  let hits = 0;
  const extra = [];
  const testOrder = [0, 5, 2, 1, 4, 3];
  for (const z of testOrder) {
    zoneEls[z].classList.add('target');
    zoneEls[z].querySelector('.label').textContent = 'Mirá acá';
    zoneEls[z].querySelector('.label').style.fontSize = '24px';
    await sleep(600);
    const samples = await collectAt(800);
    zoneEls[z].classList.remove('target');
    zoneEls[z].querySelector('.label').textContent = '';
    zoneEls[z].querySelector('.label').style.fontSize = '';
    if (samples.length) {
      const pred = model.predict(averageFeatures(samples));
      if (classify(pred, zones, null, -1) === z) hits++;
      samples.forEach((f) => extra.push({ f, x: zones[z].x, y: zones[z].y }));
    }
  }
  extra.forEach((s) => model.addCalibration(s.f, s.x, s.y));
  model.fit();
  mode = 'idle';
  hasGaze = true;
  showResult(hits);
}

function failCalibration() {
  mode = 'idle';
  $('result-title').textContent = 'No se pudo calibrar';
  $('result-msg').textContent = 'La cámara dejó de ver tu cara. Revisá la luz y la posición del celular, y probá de nuevo.';
  $('btn-go').hidden = true;
  show('screen-result');
}

function showResult(hits) {
  $('btn-go').hidden = false;
  $('result-title').textContent = `Reconoció ${hits} de 6 zonas`;
  $('result-msg').textContent = hits >= 5
    ? 'La calibración salió bien. Si con el uso empieza a fallar, volvé a calibrar desde Ajustes.'
    : 'Va a costar elegir algunas opciones. Probá de nuevo con el celular fijo, buena luz y la cabeza quieta.';
  show('screen-result');
}

async function beginTyping() {
  mode = 'typing';
  dwell.reset();
  currentZone = null;
  show('');
  $('gaze-dot').hidden = !settings.dot || !hasGaze;
  render();
  try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* opcional */ }
}
let wakeLock = null;
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* opcional */ }
  }
});

// ---------- Botones ----------

function unlockAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* sin audio */ }
  try {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch { /* sin voz */ }
}

$('btn-start').addEventListener('click', async () => {
  unlockAudio();
  const err = $('start-error');
  err.hidden = true;
  $('btn-start').disabled = true;
  try {
    show('screen-place');
    $('preview-slot').append(video);
    video.classList.add('preview');
    await startCamera();
    placementLoop();
  } catch (e) {
    show('screen-intro');
    err.hidden = false;
    err.textContent = e.name === 'NotAllowedError'
      ? 'El permiso de la cámara está bloqueado. Activalo en los ajustes del navegador y volvé a intentar.'
      : e.name === 'NotFoundError'
        ? 'No se encontró una cámara en este dispositivo.'
        : (e.message || 'No se pudo activar la cámara.');
    $('btn-start').disabled = false;
  }
});
$('btn-touch').addEventListener('click', () => { unlockAudio(); beginTyping(); });
$('btn-calibrate').addEventListener('click', runCalibration);
$('btn-go').addEventListener('click', beginTyping);
$('btn-recal').addEventListener('click', () => recalibrate());
function recalibrate() {
  mode = 'idle';
  if (!faceMesh && !SIM) { show('screen-intro'); return; }
  runCalibration();
}

const dialog = $('settings');
function renderSettings() {
  $('set-dwell').value = settings.dwell;
  $('dwell-value').textContent = (settings.dwell / 1000).toLocaleString('es-AR') + ' s';
  $('set-dot').checked = settings.dot;
  $('set-sound').checked = settings.sound;
  $('diag').textContent = hasGaze ? `La cámara analiza ${fps} imágenes por segundo.` : '';
}
$('btn-settings').addEventListener('click', () => { renderSettings(); dialog.showModal(); });
$('set-dwell').addEventListener('input', (e) => {
  settings.dwell = Number(e.target.value);
  dwell.dwellMs = settings.dwell;
  store.set('dwell', settings.dwell);
  renderSettings();
});
$('set-dot').addEventListener('change', (e) => {
  settings.dot = e.target.checked;
  store.set('dot', settings.dot);
  $('gaze-dot').hidden = !settings.dot || !hasGaze;
});
$('set-sound').addEventListener('change', (e) => { settings.sound = e.target.checked; store.set('sound', settings.sound); });
$('btn-settings-recal').addEventListener('click', () => {
  dialog.close();
  if (faceMesh || SIM) runCalibration(); else show('screen-intro');
});
$('btn-speak').addEventListener('click', speak);
$('btn-clear').addEventListener('click', () => { clearAll(); render(); });
$('btn-copy').addEventListener('click', async () => {
  const b = $('btn-copy');
  try { await navigator.clipboard.writeText(pretty(text)); b.textContent = 'Copiado'; }
  catch { b.textContent = 'No se pudo copiar'; }
  setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
});

render();

if (SIM) {
  window.__mirada = {
    feed: onLandmarks,
    state: () => ({ text, mode, raw: items, items: items.map((i) => i.ch ?? i.form ?? i.label ?? i.kind) }),
    zones: zoneCenters,
    model,
  };
  $('btn-start').addEventListener('click', () => { lastFace = performance.now(); });
}
