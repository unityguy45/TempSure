'use strict';
/*
 * TempSure: Medicine Integrity Passport (hackathon demo)
 * Sensor readings are simulated in the browser. Everything else (prediction,
 * quarantine, evidence report, decisions, hash-chained audit log, QR passport)
 * runs exactly as it would with live sensor data.
 */

// ---------- config ----------
const TRIP_END = 92;                       // simulated minutes per trip
const TICK_MS = { 1: 650, 2: 320, 4: 160 }; // real ms per simulated minute
const START_CLOCK = 13 * 60 + 40;          // trips start at 13:40
const STORE_KEY = 'tempsure.v1';

const PRODUCTS = [
  { name: 'Insulin glargine 100 U/mL pens', min: 2, max: 8, freeze: true, unit: 'pens' },
  { name: 'Hepatitis B vaccine vials', min: 2, max: 8, freeze: true, unit: 'vials' },
  { name: 'MMR vaccine (lyophilised) vials', min: 2, max: 8, freeze: false, unit: 'vials' },
  { name: 'Adalimumab biologic pre-filled pens', min: 2, max: 8, freeze: true, unit: 'pens' },
];

const SCENARIOS = {
  normal: { label: 'Normal delivery', desc: 'The cold chain holds from warehouse to clinic. A clean, complete record is produced automatically.' },
  near:   { label: 'Near-miss: loading delay', desc: 'Van doors are left open at the dock in 44°C heat. TempSure predicts the breach before it happens and the team acts in time.' },
  breach: { label: 'Breach: cooling failure', desc: 'The van\'s refrigeration fails mid-route and nobody responds. TempSure quarantines the stock and builds the evidence report.' },
  freeze: { label: 'Silent freeze: over-cooling', desc: 'The van unit over-cools. Frozen vaccines look normal but may no longer protect. TempSure catches what the eye cannot.' },
};

const PHASES = [
  { key: 'warehouse', label: 'Warehouse', short: 'Store', start: 0 },
  { key: 'loading',   label: 'Loading dock', short: 'Dock', start: 8 },
  { key: 'transit',   label: 'Van transit', short: 'Van transit', start: 28 },
  { key: 'handoff',   label: 'Handoff', short: 'Drop', start: 76 },
  { key: 'received',  label: 'Clinic', short: 'Clinic', start: 82 },
];

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = n => (n == null || isNaN(n)) ? '–' : (Math.round(n * 10) / 10).toFixed(1);
const clock = m => { const t = START_CLOCK + m; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const phaseIndex = m => { let i = 0; PHASES.forEach((p, j) => { if (m >= p.start) i = j; }); return i; };
const last = arr => arr[arr.length - 1];

// ---------- SHA-256 (pure JS so it works on file:// and http too) ----------
const SHA = (() => {
  const primes = []; for (let n = 2; primes.length < 64; n++) { if (primes.every(p => n % p)) primes.push(n); }
  const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
  const K = primes.map(p => frac(Math.cbrt(p)));
  const H0 = primes.slice(0, 8).map(p => frac(Math.sqrt(p)));
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  return str => {
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, padded = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padded); buf.set(bytes); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padded - 4, (len * 8) >>> 0); dv.setUint32(padded - 8, Math.floor(len * 8 / 0x100000000));
    const H = H0.slice(), w = new Uint32Array(64);
    for (let i = 0; i < padded; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
      for (let j = 16; j < 64; j++) {
        const a = w[j - 15], b = w[j - 2];
        w[j] = (w[j - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + w[j - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10))) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let j = 0; j < 64; j++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) >>> 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, k) => { H[k] = (H[k] + v) >>> 0; });
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  };
})();

// ---------- analytics ----------
function slopeOf(points) {
  if (points.length < 3) return 0;
  const n = points.length, mx = points.reduce((s, p) => s + p.m, 0) / n, my = points.reduce((s, p) => s + p.t, 0) / n;
  let num = 0, den = 0;
  points.forEach(p => { num += (p.m - mx) * (p.t - my); den += (p.m - mx) ** 2; });
  return den ? num / den : 0;
}
// Mean kinetic temperature (USP <1079>), ΔH/R = 10000 K
function mkt(readings) {
  if (!readings.length) return null;
  const mean = readings.reduce((s, r) => s + Math.exp(-10000 / (r.t + 273.15)), 0) / readings.length;
  return 10000 / -Math.log(mean) - 273.15;
}

// ---------- state ----------
let state = { seq: 143, shipments: [] };
let sim = { id: null, timer: null, speed: 1 };
const tamperBackup = {};

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: demo still works in memory */ }
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const s = JSON.parse(raw); if (s && Array.isArray(s.shipments)) return s; } } catch (e) { /* ignore */ }
  return null;
}
const byId = id => state.shipments.find(s => s.id === id);

// ---------- domain ----------
function actorFor(key) {
  return {
    warehouse: 'Warehouse QA · S. Nair',
    loading: 'Dock team · K. Menon',
    transit: 'Driver · A. Rahman (Van 12)',
    handoff: 'A. Rahman → Dr. L. Haddad',
    received: 'Pharmacist · Dr. L. Haddad',
  }[key];
}
function custodyFor(s, key) {
  return {
    warehouse: `${s.origin} warehouse`,
    loading: `${s.origin} loading dock`,
    transit: 'Van 12 (refrigerated)',
    handoff: `${s.destination} receiving dock`,
    received: s.destination,
  }[key];
}
function phaseText(s, key) {
  return {
    warehouse: `Released from cold room. Sensor ${s.sensor} linked with ${s.min}–${s.max}°C storage profile.`,
    loading: 'Moved to loading dock for van loading.',
    transit: `Custody scanned to driver. Departed for ${s.destination}.`,
    handoff: 'Arrived. Handoff scanned by driver and receiving pharmacist.',
    received: s.quarantined ? 'Received into a quarantine fridge. Not released for use.' : 'Received and stored in clinic fridge.',
  }[key];
}

function addEvent(s, type, actor, text) {
  const prev = s.events.length ? last(s.events).hash : 'GENESIS';
  const ev = { seq: s.events.length + 1, min: s.minute, clock: clock(s.minute), type, actor, text, prev };
  ev.hash = SHA(prev + '|' + JSON.stringify([ev.seq, ev.min, ev.type, ev.actor, ev.text]));
  s.events.push(ev);
  return ev;
}
function verifyChain(s) {
  let prev = 'GENESIS';
  for (const ev of s.events) {
    const h = SHA(prev + '|' + JSON.stringify([ev.seq, ev.min, ev.type, ev.actor, ev.text]));
    if (ev.prev !== prev || ev.hash !== h) return { ok: false, at: ev.seq };
    prev = ev.hash;
  }
  return { ok: true, count: s.events.length, head: prev };
}

function resetSim(s) {
  Object.assign(s, {
    status: 'Created', minute: 0, phase: -1, readings: [], events: [], custody: `${s.origin} warehouse`,
    quarantined: false, warningActive: false, pred: null, minutesOut: 0, consec: 0, peak: null, low: null,
    correctedAt: null, autoActAt: null, freezeLogged: false, finished: false, decision: null,
    firstAlertMin: null, excursionMin: null, excursionCustody: null, excursionActor: null, alerts: 0, actions: [],
  });
  addEvent(s, 'create', 'Distributor QA · S. Nair', `Passport created for ${s.qty} ${s.unit} of ${s.product}, lot ${s.lot}, expiry ${s.expiry}.`);
}

function newShipment(f) {
  const id = 'TS-' + String(state.seq++).padStart(4, '0');
  const s = {
    id, product: f.product, lot: f.lot, expiry: f.expiry, qty: Number(f.qty) || 1, unit: f.unit || 'units',
    min: Number(f.min), max: Number(f.max), freeze: !!f.freeze, origin: f.origin, destination: f.destination,
    scenario: f.scenario || 'normal', sensor: 'SN-' + Math.floor(40000 + Math.random() * 9999),
  };
  resetSim(s);
  state.shipments.unshift(s);
  return s;
}

function targetFor(s) {
  const key = PHASES[phaseIndex(s.minute)].key;
  if (s.correctedAt != null) return { target: (s.min + s.max) / 2 + 0.5, k: 0.12 };
  if (s.scenario === 'near' && key === 'loading' && s.minute >= 10) return { target: 12, k: 0.03 };
  if (s.scenario === 'breach' && s.minute >= 32 && (key === 'transit' || key === 'handoff')) return { target: 17, k: 0.025 };
  if (s.scenario === 'freeze' && s.minute >= 32 && (key === 'transit' || key === 'handoff')) return { target: -4, k: 0.025 };
  return { target: key === 'loading' ? 5.6 : 5.0, k: 0.15 };
}

function logAction(s, actor, text) {
  s.correctedAt = s.minute;
  s.actions.push({ clock: clock(s.minute), actor, text });
  addEvent(s, 'action', actor, text);
}

function tick(s) {
  if (s.finished) return false;
  if (s.minute >= TRIP_END) { finish(s); return false; }
  s.minute++;
  const pi = phaseIndex(s.minute);
  if (pi !== s.phase) {
    s.phase = pi; const key = PHASES[pi].key;
    s.custody = custodyFor(s, key);
    addEvent(s, 'custody', actorFor(key), phaseText(s, key));
  }
  const { target, k } = targetFor(s);
  const prevT = s.readings.length ? last(s.readings).t : 5.1;
  const t = Math.round((prevT + (target - prevT) * k + (Math.random() - 0.5) * 0.12) * 100) / 100;
  s.readings.push({ m: s.minute, t });
  evaluate(s);
  if (s.minute >= TRIP_END) finish(s);
  return !s.finished;
}

function evaluate(s) {
  const r = s.readings, t = last(r).t, key = PHASES[phaseIndex(s.minute)].key;
  s.peak = s.peak == null ? t : Math.max(s.peak, t);
  s.low = s.low == null ? t : Math.min(s.low, t);
  const out = t > s.max || t < s.min;
  if (out) { s.minutesOut++; s.consec++; } else s.consec = 0;

  // excursion confirmed after 2 consecutive out-of-range readings
  if (!s.quarantined && s.consec >= 2) {
    s.quarantined = true; s.status = 'Quarantined'; s.warningActive = false;
    s.excursionMin = s.minute - 1; s.excursionCustody = s.custody; s.excursionActor = actorFor(key);
    addEvent(s, 'danger', 'TempSure', `Excursion confirmed: ${fmt1(t)}°C, outside ${s.min}–${s.max}°C. ${s.qty} ${s.unit} of lot ${s.lot} placed on quarantine hold. Qualified assessor notified.`);
  }
  if (s.freeze && t <= 0 && !s.freezeLogged) {
    s.freezeLogged = true;
    addEvent(s, 'danger', 'TempSure', 'Freeze exposure (0°C or below) on a freeze-sensitive product. Damage may be invisible. Do not use without qualified assessment.');
  }

  // predictive warning from the trend of the last 6 readings
  const slope = slopeOf(r.slice(-6));
  s.pred = null;
  if (!out && !s.quarantined) {
    if (slope > 0.06) { const eta = (s.max - t) / slope; if (eta <= 20) s.pred = { dir: 'heat', eta, slope }; }
    else if (slope < -0.06) { const eta = (t - s.min) / -slope; if (eta <= 20) s.pred = { dir: 'cold', eta, slope }; }
  }
  if (s.pred && !s.warningActive && !s.quarantined) {
    s.warningActive = true; s.status = 'Warning'; s.alerts++;
    if (s.firstAlertMin == null) s.firstAlertMin = s.minute;
    const limit = s.pred.dir === 'heat' ? `${s.max}°C` : `${s.min}°C`;
    addEvent(s, 'alert', 'TempSure', `Early warning: predicted to cross ${limit} in about ${Math.max(1, Math.round(s.pred.eta))} min (${fmt1(t)}°C, ${slope > 0 ? 'rising' : 'falling'} ${Math.abs(slope).toFixed(2)}°C/min). Alert sent to ${actorFor(key)} and supervisor.`);
    if (s.scenario === 'near' && s.autoActAt == null && s.correctedAt == null) s.autoActAt = s.minute + 6;
  }
  if (s.warningActive && !s.quarantined && !out && Math.abs(slope) < 0.04 && t > s.min + 0.5 && t < s.max - 0.8) {
    s.warningActive = false; s.status = 'In transit';
    addEvent(s, 'ok', 'TempSure', `Conditions stabilised at ${fmt1(t)}°C, within range.`);
  }
  if (s.autoActAt != null && s.minute >= s.autoActAt && s.correctedAt == null) {
    logAction(s, actorFor(key), 'Responded to alert: closed van doors and moved stock into validated cold room at the dock.');
  }
}

function finish(s) {
  if (s.finished) return;
  s.finished = true;
  if (!s.quarantined) {
    s.status = 'Delivered';
    addEvent(s, 'ok', 'TempSure', `Delivered within range. Trip mean kinetic temperature ${fmt1(mkt(s.readings))}°C. Record closed.`);
  } else {
    addEvent(s, 'info', 'TempSure', 'Trip ended. Stock remains on quarantine hold pending qualified assessment.');
  }
  save();
}

function decide(s, choice, name, role, note) {
  const label = { release: 'Released for use', return: 'Returned to supplier', dispose: 'Disposed' }[choice];
  s.status = { release: 'Released', return: 'Returned', dispose: 'Disposed' }[choice];
  s.decision = { choice, label, name, role, note, clock: clock(s.minute) };
  addEvent(s, 'decision', `${role} · ${name}`, `Decision: ${label}.${note ? ' Rationale: ' + note : ''}`);
  save();
}

// ---------- simulation control ----------
function startSim(s) {
  if (s.finished) return;
  stopSim();
  if (s.phase === -1) {
    s.readings.push({ m: 0, t: 5.1 });
    s.phase = 0; s.custody = custodyFor(s, 'warehouse'); s.status = 'In transit';
    s.peak = s.low = 5.1;
    addEvent(s, 'custody', actorFor('warehouse'), phaseText(s, 'warehouse'));
  }
  sim.id = s.id;
  sim.timer = setInterval(() => {
    const cur = byId(sim.id);
    if (!cur || !tick(cur)) stopSim();
    if (cur && cur.minute % 5 === 0) save();
    refresh();
  }, TICK_MS[sim.speed]);
  refresh();
}
function stopSim() {
  if (sim.timer) clearInterval(sim.timer);
  sim.timer = null; sim.id = null; save();
}
const isRunning = s => sim.id === s.id && !!sim.timer;

// ---------- share snapshot (QR) ----------
function b64url(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return decodeURIComponent(escape(atob(str))); }
function snapshot(s) {
  const step = Math.max(1, Math.ceil(s.readings.length / 30));
  const r = s.readings.filter((_, i) => i % step === 0 || i === s.readings.length - 1).map(x => [x.m, Math.round(x.t * 10) / 10]);
  const ev = s.events.filter(e => e.type !== 'custody').slice(-3).map(e => [e.clock, e.type, e.text.length > 100 ? e.text.slice(0, 97).replace(/\s+\S*$/, '') + '…' : e.text]);
  const chain = verifyChain(s);
  return {
    i: s.id, p: s.product, l: s.lot, e: s.expiry, q: s.qty, u: s.unit, mn: s.min, mx: s.max, f: s.freeze ? 1 : 0,
    o: s.origin, d: s.destination, st: s.status, c: s.custody, pk: s.peak, lo: s.low, mo: s.minutesOut,
    k: s.readings.length ? Math.round(mkt(s.readings) * 10) / 10 : null, r, ev, h: chain.ok ? chain.head.slice(0, 16) : 'INVALID',
    n: s.events.length, at: clock(s.minute),
  };
}
function shareUrl(s) { return location.href.split('#')[0] + '#/v/' + b64url(JSON.stringify(snapshot(s))); }
function qrSvg(text) {
  try {
    const qr = qrcode(0, 'L'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = 2; let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR code for this passport"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
  } catch (e) {
    return '<div class="muted small">QR unavailable</div>';
  }
}

// ---------- icons (inline, stroke = currentColor) ----------
const ICON = {
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  alert: '<path d="M12 3l9.5 16.5h-19L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  play: '<path d="M7 5l12 7-12 7V5z"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function gauge(t, s) {
  const R = 52, C = 2 * Math.PI * R, arc = C * 0.75, lo = s.min - 6, hi = s.max + 8;
  const k = t == null ? 0 : Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
  const cls = t == null ? 'idle' : t > s.max ? 'hot' : t < s.min ? 'cold' : (s.pred ? 'warn' : 'ok');
  const bandA = (s.min - lo) / (hi - lo), bandB = (s.max - lo) / (hi - lo);
  return `<svg class="gauge ${cls}" viewBox="0 0 140 140" aria-hidden="true">
    <circle cx="70" cy="70" r="${R}" class="g-track" stroke-dasharray="${arc} ${C}" transform="rotate(135 70 70)"/>
    <circle cx="70" cy="70" r="${R}" class="g-band" stroke-dasharray="0 ${arc * bandA} ${arc * (bandB - bandA)} ${C}" transform="rotate(135 70 70)"/>
    <circle cx="70" cy="70" r="${R}" class="g-val" stroke-dasharray="${arc * k} ${C}" transform="rotate(135 70 70)"/>
  </svg>`;
}

// ---------- rendering primitives ----------
const cache = {};
function put(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  if (cache[id] === html && el.dataset.filled) return;
  cache[id] = html; el.dataset.filled = '1'; el.innerHTML = html;
}
function clearCache() { Object.keys(cache).forEach(k => delete cache[k]); }

const STATUS_CLASS = { Created: 'neutral', 'In transit': 'ok', Warning: 'warn', Quarantined: 'danger', Delivered: 'ok', Released: 'ok', Returned: 'neutral', Disposed: 'danger' };
const pill = st => `<span class="pill ${STATUS_CLASS[st] || 'neutral'}">${esc(st)}</span>`;
const tempClass = (t, s) => t == null ? '' : (t > s.max ? 'hot' : t < s.min ? 'cold' : '');

function chartSvg(s, readings, opts = {}) {
  const W = 640, H = 220, pl = 34, pr = 10, pt = 18, pb = 24;
  const peak = readings.length ? Math.max(...readings.map(r => r.t)) : s.max;
  const low = readings.length ? Math.min(...readings.map(r => r.t)) : s.min;
  const y0 = Math.floor(Math.min(s.min - 4, low - 1)), y1 = Math.ceil(Math.max(s.max + 6, peak + 1));
  const X = m => pl + (m / TRIP_END) * (W - pl - pr);
  const Y = t => pt + (1 - (t - y0) / (y1 - y0)) * (H - pt - pb);
  let g = '';
  for (let v = Math.ceil(y0 / 2) * 2; v <= y1; v += 2) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 6}" y="${Y(v) + 4}" class="axis" text-anchor="end">${v}°</text>`;
  g += `<rect x="${pl}" y="${Y(s.max)}" width="${W - pl - pr}" height="${Y(s.min) - Y(s.max)}" class="band"/>`;
  g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(s.max)}" y2="${Y(s.max)}" class="limit hot"/><line x1="${pl}" x2="${W - pr}" y1="${Y(s.min)}" y2="${Y(s.min)}" class="limit cold"/>`;
  if (s.freeze && y0 < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" class="limit freeze"/><text x="${W - pr - 4}" y="${Y(0) - 4}" class="axis freeze-t" text-anchor="end">0°C freeze</text>`;
  PHASES.forEach((p, i) => { if (i) g += `<line x1="${X(p.start)}" x2="${X(p.start)}" y1="${pt}" y2="${H - pb}" class="phase"/>`; g += `<text x="${X(p.start) + 4}" y="${pt - 5}" class="axis">${p.short}</text>`; });
  if (readings.length) {
    const pts = readings.map(r => `${X(r.m).toFixed(1)},${Y(r.t).toFixed(1)}`).join(' ');
    g += `<polygon points="${X(readings[0].m).toFixed(1)},${H - pb} ${pts} ${X(last(readings).m).toFixed(1)},${H - pb}" class="area"/>`;
    g += `<polyline points="${pts}" class="line"/>`;
    readings.forEach(r => { if (r.t > s.max || r.t < s.min) g += `<circle cx="${X(r.m).toFixed(1)}" cy="${Y(r.t).toFixed(1)}" r="2.6" class="${r.t > s.max ? 'dot-hot' : 'dot-cold'}"/>`; });
    const lr = last(readings);
    if (opts.pred) {
      const limit = opts.pred.dir === 'heat' ? s.max : s.min, m2 = Math.min(TRIP_END, lr.m + opts.pred.eta);
      g += `<line x1="${X(lr.m)}" y1="${Y(lr.t)}" x2="${X(m2)}" y2="${Y(limit)}" class="predline"/><circle cx="${X(m2)}" cy="${Y(limit)}" r="4" class="predpt"/>`;
    }
    g += `<circle cx="${X(lr.m)}" cy="${Y(lr.t)}" r="4.5" class="head ${tempClass(lr.t, s)}"/>`;
  }
  g += `<text x="${pl}" y="${H - 6}" class="axis">${clock(0)}</text><text x="${W - pr}" y="${H - 6}" class="axis" text-anchor="end">${clock(TRIP_END)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Temperature over the trip"><defs><linearGradient id="cgArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".28"/><stop offset="1" stop-color="#14b8a6" stop-opacity="0"/></linearGradient></defs>${g}</svg>`;
}

// ---------- pages ----------
function setNav(key) { document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === key)); }

function renderDashboard() {
  setNav('');
  $('#app').innerHTML = `
    <section class="hero2">
      <div class="hero2-main">
        <span class="chip-live"><span class="pulse"></span>Live cold-chain monitoring · Healthtech</span>
        <h1>Every vaccine carries its own <span class="grad">proof of safe handling</span>.</h1>
        <p class="hero2-lede">A <strong>Medicine Integrity Passport</strong> for every shipment: live temperature, custody at every handoff, early warnings before a breach, automatic quarantine and a ready-made evidence report for the pharmacist.</p>
        <div class="row gap">
          <a class="btn primary lg" href="#/p/${esc(state.shipments.find(s => s.status === 'Created')?.id || state.shipments[0]?.id || '')}">${icon('play')}Open live demo</a>
          <a class="btn lg" href="#/story">Watch the 1-min story</a>
          <a class="btn lg ghost" href="#/sim">${icon('cube')}3D truck tour</a>
        </div>
      </div>
      <div class="hero2-side">
        <div class="hstat"><span class="hstat-ic">${icon('thermo')}</span><div><span class="hstat-n">2–8°C</span><span class="hstat-l">cold chain for almost all vaccines (WHO)</span></div></div>
        <div class="hstat"><span class="hstat-ic">${icon('route')}</span><div><span class="hstat-n">~3 bn</span><span class="hstat-l">vaccine doses delivered by UNICEF each year</span></div></div>
        <div class="hstat"><span class="hstat-ic">${icon('shield')}</span><div><span class="hstat-n">Invisible</span><span class="hstat-l">freeze damage: a frozen vial can look perfectly normal</span></div></div>
      </div>
    </section>
    <section id="dash-kpis" class="kpis"></section>
    <section class="card">
      <div class="card-head"><h2>Shipments</h2><span class="muted small">Click a shipment to open its passport</span></div>
      <div id="dash-table"></div>
    </section>`;
  refreshDashboard();
}
function refreshDashboard() {
  const S = state.shipments;
  const count = f => S.filter(f).length;
  put('dash-kpis', `
    <div class="kpi"><span class="kpi-ic">${icon('box')}</span><div><span class="kpi-l">Shipments monitored</span><span class="kpi-n">${S.length}</span></div></div>
    <div class="kpi ok"><span class="kpi-ic">${icon('check')}</span><div><span class="kpi-l">In range right now</span><span class="kpi-n">${count(s => ['In transit', 'Delivered', 'Released', 'Created'].includes(s.status))}</span></div></div>
    <div class="kpi warn"><span class="kpi-ic">${icon('alert')}</span><div><span class="kpi-l">Early warnings</span><span class="kpi-n">${count(s => s.status === 'Warning')}</span></div></div>
    <div class="kpi danger"><span class="kpi-ic">${icon('lock')}</span><div><span class="kpi-l">On quarantine hold</span><span class="kpi-n">${count(s => s.status === 'Quarantined')}</span></div></div>`);
  put('dash-table', `<div class="table-wrap"><table class="tbl">
    <thead><tr><th>Passport</th><th>Medicine</th><th>Route</th><th>Temp</th><th>Custody</th><th>Status</th></tr></thead>
    <tbody>${S.map(s => {
      const t = s.readings.length ? last(s.readings).t : null;
      return `<tr onclick="location.hash='#/p/${esc(s.id)}'" tabindex="0" onkeydown="if(event.key==='Enter')location.hash='#/p/${esc(s.id)}'">
        <td class="mono">${esc(s.id)}${isRunning(s) ? ' <span class="live">live</span>' : ''}</td>
        <td><div>${esc(s.product)}</div><div class="muted small">Lot ${esc(s.lot)} · ${s.qty} ${esc(s.unit)}</div></td>
        <td class="small">${esc(s.origin)} → ${esc(s.destination)}</td>
        <td class="temp ${tempClass(t, s)}">${t == null ? '–' : fmt1(t) + '°C'}</td>
        <td class="small">${esc(s.custody)}</td>
        <td>${pill(s.status)}</td></tr>`;
    }).join('')}</tbody></table></div>`);
}

function renderNew() {
  setNav('new');
  const opts = PRODUCTS.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
  $('#app').innerHTML = `
    <section class="card narrow">
      <div class="card-head"><h2>Create a Medicine Integrity Passport</h2></div>
      <p class="muted">The sender creates the passport, picks the approved storage profile and links a sensor. A QR code is generated for every handoff.</p>
      <form id="newForm" novalidate>
        <div class="grid2">
          <label>Medicine<select name="preset" id="preset">${opts}</select></label>
          <label>Lot number<input name="lot" required value="LX-${Math.floor(10000 + Math.random() * 89999)}"></label>
          <label>Expiry<input name="expiry" required value="03/2027"></label>
          <label>Quantity<input name="qty" type="number" min="1" required value="240"></label>
          <label>Minimum °C<input name="min" type="number" step="0.5" required value="2"></label>
          <label>Maximum °C<input name="max" type="number" step="0.5" required value="8"></label>
          <label>From<input name="origin" required value="Jebel Ali"></label>
          <label>To<input name="destination" required value="Jumeirah Family Clinic"></label>
        </div>
        <label class="check"><input type="checkbox" name="freeze" checked> Freeze-sensitive product (flag any reading at or below 0°C)</label>
        <fieldset class="scen">
          <legend>Simulation scenario for this trip</legend>
          ${Object.entries(SCENARIOS).map(([k, v], i) => `<label class="scen-opt"><input type="radio" name="scenario" value="${k}" ${i === 1 ? 'checked' : ''}><span><strong>${esc(v.label)}</strong><span class="muted small">${esc(v.desc)}</span></span></label>`).join('')}
        </fieldset>
        <p id="formErr" class="err" role="alert"></p>
        <button class="btn primary" type="submit">Create passport</button>
      </form>
    </section>`;
  const f = $('#newForm');
  $('#preset').addEventListener('change', e => { const p = PRODUCTS[e.target.value]; f.min.value = p.min; f.max.value = p.max; f.freeze.checked = p.freeze; });
  f.addEventListener('input', () => { $('#formErr').textContent = ''; });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const p = PRODUCTS[fd.preset];
    const missing = ['lot', 'expiry', 'qty', 'origin', 'destination'].filter(k => !String(fd[k] || '').trim());
    if (missing.length) { $('#formErr').textContent = 'Fill in every field before creating the passport.'; return; }
    if (!(Number(fd.min) < Number(fd.max))) { $('#formErr').textContent = 'Minimum temperature must be lower than maximum.'; return; }
    const s = newShipment({ ...fd, product: p.name, unit: p.unit, freeze: !!fd.freeze });
    save();
    location.hash = '#/p/' + s.id;
  });
}

function renderPassport(id) {
  setNav('');
  const s = byId(id);
  if (!s) { $('#app').innerHTML = `<section class="card narrow"><h2>Passport not found</h2><p class="muted">It may have been reset. <a href="#/">Back to dashboard</a></p></section>`; return; }
  $('#app').innerHTML = `
    <div class="crumbs"><a href="#/">Dashboard</a> / <span class="mono">${esc(s.id)}</span></div>
    <div class="pp-head">
      <div class="pp-head-l"><span class="pp-ic">${icon('thermo')}</span><div><h1 class="pp-title">${esc(s.product)}</h1><div class="muted">Medicine Integrity Passport <span class="mono">${esc(s.id)}</span> · ${esc(s.origin)} → ${esc(s.destination)}</div></div></div>
      <div id="pp-status"></div>
    </div>
    <div class="pp-grid">
      <div class="col">
        <section class="card"><div id="pp-ident"></div></section>
        <section class="card"><div class="card-head"><h3>Scan passport</h3><span class="muted small">Opens on any phone</span></div><div id="pp-qr"></div></section>
        <section class="card"><div class="card-head"><h3>Tamper-evident record</h3></div><div id="pp-chain"></div></section>
      </div>
      <div class="col wide">
        <section class="card sim"><div id="pp-controls"></div></section>
        <section class="card"><div id="pp-monitor"></div><div id="pp-chart"></div><div id="pp-journey"></div></section>
        <section id="pp-reportwrap"><div id="pp-report"></div><div id="pp-decision"></div></section>
        <section class="card"><div class="card-head"><h3>Event log</h3><span class="muted small">Every reading, alert, handoff and decision</span></div><div id="pp-events"></div></section>
      </div>
    </div>`;
  const app = $('#app');
  app.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, cur = byId(id);
    if (act === 'start') startSim(cur);
    if (act === 'pause') { stopSim(); refresh(); }
    if (act === 'reset') { stopSim(); resetSim(cur); save(); clearCache(); refresh(); }
    if (act === 'speed') { sim.speed = Number(b.dataset.v); if (isRunning(cur) || sim.timer) startSim(cur); else refresh(); }
    if (act === 'fix') { logAction(cur, actorFor(PHASES[Math.max(0, cur.phase)].key), `Responded to alert: moved stock into validated fridge (${cur.min}–${cur.max}°C).`); save(); refresh(); }
    if (act === 'verify') { cur._verifyShown = Date.now(); refresh(); }
    if (act === 'tamper') {
      const idx = cur.events.findIndex(ev => ev.type === 'danger' || ev.type === 'alert');
      const target = idx >= 0 ? idx : Math.min(1, cur.events.length - 1);
      tamperBackup[cur.id] = { idx: target, text: cur.events[target].text };
      cur.events[target].text = cur.events[target].text.replace(/-?\d+(\.\d)?°C/, '6.9°C') + ' ';
      cur._verifyShown = Date.now(); refresh();
    }
    if (act === 'restore') { const b2 = tamperBackup[cur.id]; if (b2) { cur.events[b2.idx].text = b2.text; delete tamperBackup[cur.id]; } cur._verifyShown = Date.now(); refresh(); }
    if (act === 'download') downloadReport(cur);
    if (act === 'print') window.print();
    if (act === 'decide') {
      const name = $('#dName').value.trim(), role = $('#dRole').value, note = $('#dNote').value.trim();
      if (!name) { $('#dErr').textContent = 'Enter the assessor\'s name to record a decision.'; $('#dName').focus(); return; }
      decide(cur, b.dataset.v, name, role, note); refresh();
    }
  };
  app.onchange = e => {
    if (e.target.id === 'scenario') { const cur = byId(id); cur.scenario = e.target.value; save(); refresh(); }
  };
  app.oninput = e => { if (e.target.id === 'dName' && $('#dErr')) $('#dErr').textContent = ''; };
  clearCache();
  refreshPassport(s);
}

function refreshPassport(s) {
  const running = isRunning(s);
  const t = s.readings.length ? last(s.readings).t : null;
  put('pp-status', pill(s.status));

  put('pp-ident', `
    <dl class="kv">
      <dt>Medicine</dt><dd>${esc(s.product)}</dd>
      <dt>Lot</dt><dd class="mono">${esc(s.lot)}</dd>
      <dt>Expiry</dt><dd>${esc(s.expiry)}</dd>
      <dt>Quantity</dt><dd>${s.qty} ${esc(s.unit)}</dd>
      <dt>Storage profile</dt><dd>${s.min}–${s.max}°C${s.freeze ? ' · do not freeze' : ''}</dd>
      <dt>Sensor</dt><dd class="mono">${esc(s.sensor)} <span class="tag">simulated</span></dd>
      <dt>Custody now</dt><dd><strong>${esc(s.custody)}</strong></dd>
    </dl>`);

  const qrKey = `${s.events.length}|${s.status}|${Math.floor(s.minute / 10)}`;
  if (cache['qrkey'] !== qrKey || !cache['pp-qr']) {
    cache['qrkey'] = qrKey;
    const url = shareUrl(s);
    put('pp-qr', `<div class="qr">${qrSvg(url)}</div><a class="small" href="${esc(url)}" target="_blank" rel="noopener">Open phone view</a><p class="muted small">Snapshot at ${clock(s.minute)}. Deploy the site to scan from a phone.</p>`);
  }

  const chain = verifyChain(s), tampered = !!tamperBackup[s.id];
  put('pp-chain', `
    <p class="small muted">Each event is sealed with a SHA-256 hash of the one before it, so any edit after the fact breaks the chain.</p>
    <div class="chain ${chain.ok ? 'ok' : 'bad'}">
      ${chain.ok ? `<strong>Verified</strong> · ${chain.count} events · head <span class="mono">${chain.head.slice(0, 12)}…</span>` : `<strong>Tampering detected</strong> at event #${chain.at}. Record no longer trusted.`}
    </div>
    <div class="row gap small-gap">
      <button class="btn sm" data-act="verify">Verify chain</button>
      ${tampered ? '<button class="btn sm" data-act="restore">Undo tampering</button>' : '<button class="btn sm ghost" data-act="tamper">Simulate tampering</button>'}
    </div>`);

  const scen = SCENARIOS[s.scenario];
  const started = s.phase !== -1;
  put('pp-controls', `
    <div class="card-head"><h3>Trip simulation</h3><span class="tag">simulated sensor feed</span></div>
    <div class="ctrl-row">
      <label class="inline">Scenario
        <select id="scenario" ${started ? 'disabled' : ''}>${Object.entries(SCENARIOS).map(([k, v]) => `<option value="${k}" ${k === s.scenario ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      </label>
      <div class="seg" role="group" aria-label="Speed">${[1, 2, 4].map(v => `<button class="${sim.speed === v ? 'on' : ''}" data-act="speed" data-v="${v}">${v}×</button>`).join('')}</div>
      <div class="row gap small-gap">
        ${s.finished ? '' : running ? '<button class="btn" data-act="pause">Pause</button>' : `<button class="btn primary" data-act="start">${started ? 'Resume trip' : 'Start trip'}</button>`}
        <button class="btn ghost" data-act="reset">Reset</button>
      </div>
    </div>
    <p class="muted small scen-desc">${esc(scen.desc)}</p>`);

  const pred = s.pred;
  const fixable = started && !s.finished && s.correctedAt == null && (s.warningActive || s.quarantined);
  put('pp-monitor', `
    <div class="mon">
      <div class="mon-temp ${tempClass(t, s)}"><div class="gauge-wrap">${gauge(t, s)}<div class="gauge-c"><span class="mon-big">${t == null ? '–' : fmt1(t) + '°'}</span><span class="gauge-l">${s.min}–${s.max}°C</span></div></div><div class="mon-meta"><span class="kpi-l">Live temperature</span><span class="mon-when">${started ? clock(s.minute) + ' · ' + esc(PHASES[Math.max(0, s.phase)].label) : 'Trip not started'}</span>${isRunning(s) ? '<span class="chip-rec"><span class="pulse"></span>Streaming</span>' : ''}</div></div>
      <div class="mon-stats">
        <div><span class="muted small">Peak</span><span>${fmt1(s.peak)}°C</span></div>
        <div><span class="muted small">Low</span><span>${fmt1(s.low)}°C</span></div>
        <div><span class="muted small">Minutes out of range</span><span>${s.minutesOut}</span></div>
        <div><span class="muted small">Mean kinetic temp</span><span>${s.readings.length ? fmt1(mkt(s.readings)) + '°C' : '–'}</span></div>
      </div>
    </div>
    ${pred ? `<div class="alert warn"><strong>Early warning:</strong> predicted to cross ${pred.dir === 'heat' ? s.max : s.min}°C in about ${Math.max(1, Math.round(pred.eta))} min. ${esc(actorFor(PHASES[s.phase].key))} and supervisor alerted.</div>` : ''}
    ${s.quarantined ? `<div class="alert danger"><strong>Quarantine hold:</strong> excursion confirmed at ${clock(s.excursionMin)}. Do not use until a qualified assessor records a decision.</div>` : ''}
    ${s.status === 'Delivered' ? '<div class="alert ok"><strong>Delivered in range.</strong> Complete, verified record closed.</div>' : ''}
    ${fixable ? `<button class="btn action" data-act="fix">Respond: move to validated fridge</button>` : ''}`);

  put('pp-chart', chartSvg(s, s.readings, { pred }));

  const pct = Math.min(100, (s.minute / TRIP_END) * 100);
  put('pp-journey', `
    <div class="journey">
      <div class="track"><div class="fill" style="width:${pct}%"></div><div class="van ${tempClass(t, s)}" style="left:${pct}%"></div></div>
      <ol class="stops">${PHASES.map((p, i) => `<li class="${i < s.phase ? 'done' : i === s.phase ? 'now' : ''}"><span>${esc(p.label)}</span><span class="muted small">${esc(actorFor(p.key).split(' · ')[1] || actorFor(p.key))}</span></li>`).join('')}</ol>
    </div>`);

  put('pp-report', s.quarantined ? reportHtml(s) : '');
  put('pp-decision', s.quarantined ? decisionHtml(s) : '');

  const icon = { create: '＋', custody: '⇄', alert: '!', action: '✓', danger: '■', ok: '●', decision: '§', info: 'i' };
  put('pp-events', `<ol class="events">${s.events.slice().reverse().map(ev => `
    <li class="ev ${ev.type}"><span class="ev-ic" aria-hidden="true">${icon[ev.type] || '•'}</span>
      <div><div class="ev-top"><span class="mono small">${ev.clock}</span><span class="small muted">${esc(ev.actor)}</span></div><div>${esc(ev.text)}</div>
      <div class="mono tiny muted">#${ev.seq} · ${ev.hash.slice(0, 10)}…</div></div></li>`).join('')}</ol>`);
}

function reportData(s) {
  const exReadings = s.readings.filter(r => r.t > s.max || r.t < s.min);
  const lead = s.firstAlertMin != null && s.excursionMin != null ? s.excursionMin - s.firstAlertMin : null;
  const chain = verifyChain(s);
  return {
    passport: s.id, medicine: s.product, lot: s.lot, expiry: s.expiry, quantity: `${s.qty} ${s.unit}`, profile: `${s.min}–${s.max}°C${s.freeze ? ', freeze-sensitive' : ''}`,
    excursionStart: s.excursionMin != null ? clock(s.excursionMin) : '–', minutesOut: s.minutesOut,
    peak: fmt1(s.peak), low: fmt1(s.low), mktTrip: fmt1(mkt(s.readings)), worst: exReadings.length ? fmt1(exReadings.reduce((a, r) => Math.abs(r.t - 5) > Math.abs(a - 5) ? r.t : a, exReadings[0].t)) : '–',
    freezeExposure: s.freeze && s.low != null && s.low <= 0,
    custody: s.excursionCustody || '–', responsible: s.excursionActor || '–',
    alerts: s.alerts, firstAlert: s.firstAlertMin != null ? clock(s.firstAlertMin) : 'none', lead,
    actions: s.actions, chain: chain.ok ? `verified, ${chain.count} events, head ${chain.head.slice(0, 16)}` : `BROKEN at event #${chain.at}`,
  };
}
function reportHtml(s) {
  const d = reportData(s);
  return `<section class="card report">
    <div class="card-head"><h3>Excursion evidence report</h3><div class="row gap small-gap"><button class="btn sm" data-act="download">Download</button><button class="btn sm ghost" data-act="print">Print</button></div></div>
    <p class="muted small">Generated automatically from the passport. Answers the five questions: which medicine, what happened, where, who was responsible, and what was decided.</p>
    <div class="rep-grid">
      <div><span class="muted small">Which medicine</span><strong>${esc(d.medicine)}</strong><span class="small">Lot ${esc(d.lot)} · ${esc(d.quantity)} · exp ${esc(d.expiry)}</span></div>
      <div><span class="muted small">What happened</span><strong>${d.freezeExposure ? 'Freeze exposure' : Number(d.peak) > s.max ? 'Heat excursion' : 'Cold excursion'}</strong><span class="small">${d.minutesOut} min outside ${esc(d.profile)} · peak ${d.peak}°C · low ${d.low}°C · trip MKT ${d.mktTrip}°C</span></div>
      <div><span class="muted small">Where</span><strong>${esc(d.custody)}</strong><span class="small">Excursion confirmed ${d.excursionStart}</span></div>
      <div><span class="muted small">Who was responsible</span><strong>${esc(d.responsible)}</strong><span class="small">${d.alerts} early warning${d.alerts === 1 ? '' : 's'} sent${d.lead != null ? `, first at ${d.firstAlert} (${d.lead} min before breach)` : ''}</span></div>
      <div class="span2"><span class="muted small">Response actions</span>${d.actions.length ? d.actions.map(a => `<span class="small">${a.clock} · ${esc(a.actor)}: ${esc(a.text)}</span>`).join('') : '<span class="small danger-t">No corrective action was recorded after the warning.</span>'}</div>
      <div class="span2"><span class="muted small">Record integrity</span><span class="small mono">${esc(d.chain)}</span></div>
    </div>
  </section>`;
}
function decisionHtml(s) {
  if (s.decision) {
    const d = s.decision;
    return `<section class="card"><div class="card-head"><h3>Qualified decision</h3>${pill(s.status)}</div>
      <p><strong>${esc(d.label)}</strong> by ${esc(d.name)} (${esc(d.role)}) at ${d.clock}.</p>${d.note ? `<p class="muted">${esc(d.note)}</p>` : ''}</section>`;
  }
  return `<section class="card">
    <div class="card-head"><h3>Qualified decision</h3><span class="muted small">TempSure never decides on its own</span></div>
    <p class="muted small">Review the evidence with the manufacturer's stability data and local authority guidance, then record the outcome. It is sealed into the passport.</p>
    <div class="grid2">
      <label>Assessor name<input id="dName" placeholder="Dr. L. Haddad"></label>
      <label>Role<select id="dRole"><option>Pharmacist</option><option>Quality assurance</option><option>Manufacturer</option><option>Public-health authority</option></select></label>
    </div>
    <label>Rationale<textarea id="dNote" rows="2" placeholder="Manufacturer stability data reviewed; exposure exceeds allowance."></textarea></label>
    <p id="dErr" class="err" role="alert"></p>
    <div class="row gap small-gap">
      <button class="btn" data-act="decide" data-v="release">Release for use</button>
      <button class="btn" data-act="decide" data-v="return">Return to supplier</button>
      <button class="btn danger" data-act="decide" data-v="dispose">Dispose</button>
    </div>
  </section>`;
}
function downloadReport(s) {
  const d = reportData(s);
  const lines = [
    'TEMPSURE EXCURSION EVIDENCE REPORT', '='.repeat(36),
    `Passport: ${d.passport}`, `Medicine: ${d.medicine}`, `Lot: ${d.lot}   Expiry: ${d.expiry}   Quantity: ${d.quantity}`, `Storage profile: ${d.profile}`, '',
    'WHAT HAPPENED', `Excursion confirmed: ${d.excursionStart}`, `Minutes out of range: ${d.minutesOut}`, `Peak: ${d.peak}°C   Low: ${d.low}°C   Trip MKT: ${d.mktTrip}°C`, `Freeze exposure: ${d.freezeExposure ? 'YES' : 'no'}`, '',
    'WHERE / WHO', `Custody at excursion: ${d.custody}`, `Responsible party: ${d.responsible}`, `Early warnings: ${d.alerts} (first ${d.firstAlert}${d.lead != null ? `, ${d.lead} min before breach` : ''})`, '',
    'RESPONSE ACTIONS', ...(d.actions.length ? d.actions.map(a => `${a.clock} ${a.actor}: ${a.text}`) : ['None recorded']), '',
    'DECISION', s.decision ? `${s.decision.label} by ${s.decision.name} (${s.decision.role}) at ${s.decision.clock}. ${s.decision.note || ''}` : 'Pending qualified assessment', '',
    'FULL EVENT LOG', ...s.events.map(e => `#${e.seq} ${e.clock} [${e.type}] ${e.actor}: ${e.text}  (${e.hash.slice(0, 16)})`), '',
    'TEMPERATURE READINGS (minute, °C)', s.readings.map(r => `${clock(r.m)} ${r.t.toFixed(2)}`).join('\n'), '',
    `Record integrity: ${d.chain}`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${s.id}-evidence-report.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderShared(data) {
  setNav('');
  let d;
  try { d = JSON.parse(unb64url(data)); } catch (e) { $('#app').innerHTML = '<section class="card narrow"><h2>This passport link is damaged</h2><p class="muted">Scan the QR code again.</p></section>'; return; }
  const s = { min: d.mn, max: d.mx, freeze: !!d.f };
  const readings = (d.r || []).map(([m, t]) => ({ m, t }));
  const lt = readings.length ? last(readings).t : null;
  $('#app').innerHTML = `
    <section class="phone">
      <div class="card">
        <div class="card-head"><span class="muted small">Medicine Integrity Passport</span>${pill(d.st)}</div>
        <h1 class="pp-title">${esc(d.p)}</h1>
        <p class="muted mono small">${esc(d.i)} · Lot ${esc(d.l)} · Exp ${esc(d.e)} · ${d.q} ${esc(d.u)}</p>
        ${d.st === 'Quarantined' ? '<div class="alert danger"><strong>Do not use.</strong> This stock is on quarantine hold pending qualified assessment.</div>' : ''}
        ${d.st === 'Disposed' ? '<div class="alert danger"><strong>Do not use.</strong> This stock has been assessed and marked for disposal.</div>' : ''}
        ${['Delivered', 'Released'].includes(d.st) ? '<div class="alert ok"><strong>Safe handling verified.</strong> Stored within its approved range.</div>' : ''}
        <div class="mon-stats phone-stats">
          <div><span class="muted small">Now</span><span class="${tempClass(lt, s)}">${fmt1(lt)}°C</span></div>
          <div><span class="muted small">Range</span><span>${d.mn}–${d.mx}°C</span></div>
          <div><span class="muted small">Peak / low</span><span>${fmt1(d.pk)} / ${fmt1(d.lo)}°C</span></div>
          <div><span class="muted small">Mins out</span><span>${d.mo}</span></div>
        </div>
        ${chartSvg(s, readings)}
        <dl class="kv"><dt>Route</dt><dd>${esc(d.o)} → ${esc(d.d)}</dd><dt>Custody</dt><dd>${esc(d.c)}</dd><dt>MKT</dt><dd>${d.k == null ? '–' : fmt1(d.k) + '°C'}</dd><dt>Snapshot</dt><dd>${esc(d.at)}</dd></dl>
        <h3>Latest events</h3>
        <ol class="events">${(d.ev || []).slice().reverse().map(([c, type, text]) => `<li class="ev ${esc(type)}"><span class="ev-ic" aria-hidden="true">•</span><div><span class="mono small">${esc(c)}</span><div>${esc(text)}</div></div></li>`).join('')}</ol>
        <div class="chain ${d.h === 'INVALID' ? 'bad' : 'ok'} small">${d.h === 'INVALID' ? 'Record integrity could not be verified' : `Sealed record · ${d.n} events · <span class="mono">${esc(d.h)}…</span>`}</div>
      </div>
    </section>`;
}

function renderHow() {
  setNav('how');
  const steps = [
    ['Create the passport', 'The sender records the medicine, lot, expiry and quantity and picks its approved storage profile. A QR code is generated.'],
    ['Link a sensor', 'Any compatible reusable or disposable logger is linked. TempSure works alongside existing sensors, fridges and cold boxes.'],
    ['Track every handoff', 'Each custody change (warehouse, dock, driver, clinic) is scanned into the passport, so responsibility is always clear.'],
    ['Warn before a breach', 'TempSure reads the temperature trend and predicts when a limit will be crossed, alerting the person holding the stock while it can still be saved.'],
    ['Quarantine automatically', 'If an excursion is confirmed, the exact lot is placed on hold and the assessor is notified. Freeze exposure is flagged even when damage is invisible.'],
    ['Support the qualified decision', 'A ready-made evidence report goes to the pharmacist, manufacturer or authority. Their decision is sealed into a tamper-evident record.'],
  ];
  $('#app').innerHTML = `
    <section class="card narrow">
      <p class="eyebrow">How TempSure works</p>
      <h1>One continuous record from manufacturer to patient</h1>
      <p class="lede">Temperature loggers show that something changed. TempSure shows <em>which</em> medicine was affected, <em>who</em> had it, <em>what</em> was done and <em>what</em> was decided.</p>
      <ol class="how">${steps.map(([h, p], i) => `<li><span class="n">${i + 1}</span><div><strong>${h}</strong><p class="muted">${p}</p></div></li>`).join('')}</ol>
      <h2>What is real and what is simulated in this demo</h2>
      <ul class="plain">
        <li><strong>Simulated:</strong> the sensor feed. Four scenarios model a normal trip, a loading-dock near-miss, a cooling failure and a silent freeze in UAE summer conditions.</li>
        <li><strong>Working as built:</strong> the trend-based breach prediction, excursion detection, automatic quarantine, mean kinetic temperature, evidence report, qualified decision workflow, SHA-256 hash-chained audit log and the scannable QR passport.</li>
      </ul>
      <h2>Next steps</h2>
      <ul class="plain">
        <li>Connect real logger APIs and Bluetooth/NFC tags.</li>
        <li>Pilot on one UAE distributor-to-pharmacy home-delivery route (insulin and biologics).</li>
        <li>Link passports to national medicine track-and-trace serial numbers.</li>
        <li>Offline-first version for immunisation supply chains with unreliable connectivity.</li>
      </ul>
      <p class="muted small">TempSure does not decide whether an exposed medicine is safe. Viability decisions consider the time and size of the exposure and involve the manufacturer or public-health authority (CDC, WHO guidance).</p>
    </section>`;
}

// ---------- router ----------
function currentRoute() { return (location.hash || '#/').slice(2).split('/'); }
function route() {
  clearCache();
  const [page, arg] = currentRoute();
  const app = $('#app'); app.onclick = app.onchange = app.oninput = null;
  if (window.stopStory) window.stopStory();
  if (window.stopSim3d) window.stopSim3d();
  if (page === 'story' && window.renderStory) window.renderStory();
  else if (page === 'sim' && window.renderSim3d) window.renderSim3d();
  else if (page === 'p' && arg) renderPassport(arg);
  else if (page === 'v' && arg) renderShared(arg);
  else if (page === 'new') renderNew();
  else if (page === 'how') renderHow();
  else renderDashboard();
  window.scrollTo(0, 0);
}
function refresh() {
  const [page, arg] = currentRoute();
  if (page === 'p' && arg) { const s = byId(arg); if (s && $('#pp-ident')) refreshPassport(s); }
  else if (!page) refreshDashboard();
}

// ---------- seed data ----------
function runToEnd(s, scenario, decision) {
  s.scenario = scenario; resetSim(s);
  s.readings.push({ m: 0, t: 5.1 }); s.phase = 0; s.custody = custodyFor(s, 'warehouse'); s.status = 'In transit'; s.peak = s.low = 5.1;
  addEvent(s, 'custody', actorFor('warehouse'), phaseText(s, 'warehouse'));
  while (tick(s)) { /* run */ }
  if (decision) decide(s, ...decision);
}
function seed() {
  state = { seq: 135, shipments: [] };
  const a = newShipment({ product: PRODUCTS[3].name, unit: 'pens', lot: 'BX-55012', expiry: '11/2026', qty: 60, min: 2, max: 8, freeze: true, origin: 'Abu Dhabi (Mussafah)', destination: 'Khalifa City Pharmacy' });
  runToEnd(a, 'breach', ['dispose', 'Dr. R. Iyer', 'Pharmacist', 'Manufacturer confirmed exposure above 15°C exceeds stability allowance.']);
  const b = newShipment({ product: PRODUCTS[1].name, unit: 'vials', lot: 'HB-20931', expiry: '08/2027', qty: 500, min: 2, max: 8, freeze: true, origin: 'Jebel Ali', destination: 'Mirdif Health Centre' });
  runToEnd(b, 'freeze');
  const c = newShipment({ product: PRODUCTS[2].name, unit: 'vials', lot: 'MM-77410', expiry: '01/2027', qty: 300, min: 2, max: 8, freeze: false, origin: 'Dubai Healthcare City', destination: 'Al Barsha Pharmacy' });
  runToEnd(c, 'normal');
  newShipment({ product: PRODUCTS[0].name, unit: 'pens', lot: 'LX-24381', expiry: '03/2027', qty: 240, min: 2, max: 8, freeze: true, origin: 'Jebel Ali', destination: 'Jumeirah Family Clinic', scenario: 'near' });
  save();
}

// ---------- theme ----------
const THEME_KEY = 'tempsure.theme';
function applyTheme(t) { if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) { /* ignore */ }
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
}

// ---------- boot ----------
(function boot() {
  const tb = document.getElementById('themeBtn'); if (tb) tb.addEventListener('click', toggleTheme);
  const saved = load();
  if (saved && saved.shipments.length) state = saved; else seed();
  $('#resetAll').addEventListener('click', () => { stopSim(); try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } seed(); location.hash = '#/'; route(); });
  window.addEventListener('hashchange', route);
  route();
})();
