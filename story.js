'use strict';
/*
 * TempSure story mode: an animated, plain-language explainer.
 * A refrigerated truck carries four medicine boxes. One box starts warming.
 * Ending A (default): TempSure warns the driver, who moves it to the backup fridge.
 * Ending B ("what if nobody acts?"): the box overheats and TempSure locks it.
 */
(function () {
  const W = 1000, H = 520, END = 56, SPEED_PX = 90;
  const BOXES = [
    { name: 'Insulin', sub: 'diabetes', color: '#7c3aed' },
    { name: 'Measles', sub: 'vaccine', color: '#0891b2' },
    { name: 'Hepatitis B', sub: 'vaccine', color: '#db2777' },
    { name: 'Arthritis', sub: 'biologic', color: '#ca8a04' },
  ];
  const SLOT_X = [312, 382, 452, 522], BOX_W = 58, BOX_H = 48, FLOOR = 392;
  const FRIDGE = { x: 596, y: 246, w: 56, h: 146 };

  const CAPTIONS = {
    save: [
      [0, 'Meet the cargo', 'Insulin and vaccines must stay between 2°C and 8°C, like the inside of your fridge. Each box has a small sensor. TempSure reads it every minute.'],
      [4, 'On the road', 'The truck drives across Dubai. It is 44°C outside, but inside every box is cool and green.'],
      [14, 'Something is wrong', 'A cooling vent next to the insulin has failed. Its temperature is creeping up. It is still safe, but heading the wrong way.'],
      [22, 'TempSure warns early', 'TempSure sees the trend and alerts the driver\'s phone before the insulin gets too warm: "too warm in about 6 minutes".'],
      [24, 'A person acts', 'The driver stops and moves the insulin into the backup fridge. TempSure records who did what, and when.'],
      [34, 'Crisis avoided', 'The insulin cools back down to a safe temperature. The journey continues.'],
      [44, 'Safe at the clinic', 'The nurse scans the box. The record proves it stayed safe the whole way, so patients get medicine that works.'],
    ],
    fail: [
      [0, 'Meet the cargo', 'Insulin and vaccines must stay between 2°C and 8°C, like the inside of your fridge. Each box has a small sensor. TempSure reads it every minute.'],
      [4, 'On the road', 'The truck drives across Dubai. It is 44°C outside, but inside every box is cool and green.'],
      [14, 'Something is wrong', 'A cooling vent next to the insulin has failed. Its temperature is creeping up.'],
      [22, 'The warning is missed', 'TempSure alerts the driver, then the supervisor. This time nobody responds.'],
      [25, 'Too warm', 'The insulin passes 8°C. It may no longer work, and you cannot tell by looking at it. TempSure locks it: do not use.'],
      [30, 'The evidence is kept', 'A report goes to the pharmacist automatically: which box, how warm, for how long, and who had it.'],
      [44, 'Stopped at the clinic', 'The nurse scans the boxes. The damaged insulin never reaches a patient. The other three boxes are fine and can be used.'],
    ],
  };

  let S = null; // runtime state

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * clamp(k, 0, 1);
  const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

  function moveFactor(mode, t) {
    const legs = mode === 'save' ? [[4, 22], [34, 44]] : [[4, 44]];
    for (const [a, b] of legs) if (t >= a && t < b) return clamp(Math.min(t - a, b - t), 0, 1);
    return 0;
  }
  function totalDistance(mode) { let d = 0; for (let t = 0; t < END; t += 0.01) d += moveFactor(mode, t) * SPEED_PX * 0.01; return d; }

  function insulinTemp(mode, t) {
    if (t < 14) return 5.0 + 0.1 * Math.sin(t);
    if (t < 22) return 5.0 + (t - 14) / 8 * 2.2;
    if (mode === 'save') {
      if (t < 30) return 7.2 + (t - 22) / 8 * 0.5;
      return 5.0 + 2.7 * Math.exp(-(t - 30) / 1.8);
    }
    return Math.min(12.4, 7.2 + (t - 22) * 0.38);
  }
  function boxTemp(i, mode, t) { return i === 0 ? insulinTemp(mode, t) : 4.7 + 0.25 * Math.sin(t * 0.6 + i * 1.7); }
  const tempColor = v => v > 8 ? '#dc2626' : v > 7 ? '#f59e0b' : '#16a34a';

  // insulin box position (save mode) and driver choreography
  function insulinPos(t) {
    const home = { x: SLOT_X[0], y: FLOOR - BOX_H, s: 1, inFridge: false };
    if (S.mode !== 'save' || t < 26) return home;
    if (t < 30) { const k = ease((t - 26) / 4); return { x: lerp(SLOT_X[0] + 8, FRIDGE.x - 8, k), y: FLOOR - BOX_H - 40, s: 0.8, carried: true }; }
    return { x: FRIDGE.x + 7, y: FRIDGE.y + 102, s: 0.72, inFridge: true };
  }
  function driverState(t) {
    if (S.mode !== 'save' || t < 23 || t > 33.5) return null;
    let x, walking = false;
    if (t < 25.5) { x = lerp(270, SLOT_X[0] + 20, ease((t - 23) / 2.5)); walking = t > 23.3; }
    else if (t < 26) x = SLOT_X[0] + 20;
    else if (t < 30) { x = lerp(SLOT_X[0] + 20, FRIDGE.x - 16, ease((t - 26) / 4)); walking = true; }
    else if (t < 31) x = FRIDGE.x - 16;
    else { x = lerp(FRIDGE.x - 16, 270, ease((t - 31) / 2.5)); walking = true; }
    return { x, walking, carrying: t >= 26 && t < 30, alpha: clamp(Math.min(t - 23, 33.5 - t) * 2, 0, 1) };
  }

  // ---------- drawing ----------
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hash(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

  function drawBackground(ctx, t, off) {
    const sky = ctx.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, '#bfe3f7'); sky.addColorStop(1, '#fdf1dc');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, 420);
    // sun + heat label
    ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(900, 70, 38, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,.5)'; ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t * 0.2; ctx.beginPath(); ctx.moveTo(900 + Math.cos(a) * 48, 70 + Math.sin(a) * 48); ctx.lineTo(900 + Math.cos(a) * 60, 70 + Math.sin(a) * 60); ctx.stroke(); }
    rr(ctx, 818, 122, 164, 34, 17); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
    ctx.fillStyle = '#b45309'; ctx.font = '700 17px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Outside: 44°C', 900, 145);
    // far skyline (parallax 0.3)
    for (let i = -2; i < 14; i++) {
      const base = i * 110 - (off * 0.3) % 110 - ((Math.floor(off * 0.3 / 110)) * 0);
      const idx = i + Math.floor(off * 0.3 / 110), h = 90 + hash(idx) * 150, x = i * 110 - (off * 0.3) % 110;
      ctx.fillStyle = '#c9d6df'; ctx.fillRect(x, 420 - h, 84, h);
      if (hash(idx + 9) > 0.8) { ctx.fillRect(x + 38, 420 - h - 60, 8, 60); }
      void base;
    }
    // near buildings + palms (parallax 0.7)
    for (let i = -1; i < 9; i++) {
      const idx = i + Math.floor(off * 0.7 / 150), x = i * 150 - (off * 0.7) % 150, h = 60 + hash(idx + 3) * 70;
      ctx.fillStyle = hash(idx + 5) > 0.5 ? '#e7d8c1' : '#dccbb0'; ctx.fillRect(x, 420 - h, 100, h);
      ctx.fillStyle = 'rgba(80,110,130,.35)';
      for (let wy = 420 - h + 12; wy < 405; wy += 22) for (let wx = x + 12; wx < x + 90; wx += 26) ctx.fillRect(wx, wy, 14, 12);
      // palm
      const px = x + 125; ctx.strokeStyle = '#8b6b43'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(px, 422); ctx.quadraticCurveTo(px + 6, 380, px + 2, 350); ctx.stroke();
      ctx.strokeStyle = '#3f8f4f'; ctx.lineWidth = 5;
      for (const a of [-2.6, -2.1, -1.4, -0.9, -0.4]) { ctx.beginPath(); ctx.moveTo(px + 2, 350); ctx.quadraticCurveTo(px + 2 + Math.cos(a) * 20, 350 + Math.sin(a) * 20 - 6, px + 2 + Math.cos(a) * 36, 350 + Math.sin(a) * 30 + 10); ctx.stroke(); }
    }
    // road
    ctx.fillStyle = '#d6d3cb'; ctx.fillRect(0, 420, W, 14);
    ctx.fillStyle = '#4b5563'; ctx.fillRect(0, 434, W, 86);
    ctx.fillStyle = '#f5f5f4'; for (let x = -(off % 80); x < W; x += 80) ctx.fillRect(x, 476, 44, 5);
  }

  function drawBuilding(ctx, x, label, kind) {
    if (x > W + 20 || x < -280) return;
    const w = kind === 'clinic' ? 190 : 240, h = kind === 'clinic' ? 170 : 190, y = 420 - h;
    ctx.fillStyle = kind === 'clinic' ? '#ffffff' : '#e5e7eb'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = kind === 'clinic' ? '#16a34a' : '#0f766e'; ctx.fillRect(x, y, w, 30);
    ctx.fillStyle = '#fff'; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + 20);
    if (kind === 'clinic') { ctx.fillStyle = '#16a34a'; ctx.fillRect(x + w / 2 - 6, y + 50, 12, 40); ctx.fillRect(x + w / 2 - 20, y + 64, 40, 12); }
    else { ctx.fillStyle = '#9ca3af'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 20 + i * 72, y + 60, 56, 110); ctx.fillStyle = '#6b7280'; for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) ctx.fillRect(x + 20 + i * 72, y + 64 + j * 22, 56, 2); }
    ctx.fillStyle = '#a3a3a3'; ctx.fillRect(x + w / 2 - 22, 420 - 60, 44, 60);
  }

  function drawThermo(ctx, cx, top, v, big) {
    const h = big ? 70 : 52, tw = 12;
    rr(ctx, cx - tw / 2, top, tw, h, 6); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5; ctx.stroke();
    const k = clamp((v - 0) / 13, 0, 1), fillH = (h - 8) * k;
    ctx.fillStyle = tempColor(v); rr(ctx, cx - 3, top + h - 4 - fillH, 6, fillH + 4, 3); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, top + h + 6, 9, 0, 7); ctx.fillStyle = tempColor(v); ctx.fill(); ctx.strokeStyle = '#374151'; ctx.stroke();
    // 8°C limit tick
    const y8 = top + h - 4 - (h - 8) * (8 / 13); ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 8, y8); ctx.lineTo(cx + 15, y8); ctx.stroke();
    // value badge
    const label = v.toFixed(1) + '°C'; ctx.font = '700 13px system-ui, sans-serif';
    const bw = ctx.measureText(label).width + 12; rr(ctx, cx - bw / 2, top - 24, bw, 20, 10); ctx.fillStyle = tempColor(v); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, cx, top - 9);
  }

  function drawBadge(ctx, cx, y, v) {
    const label = v.toFixed(1) + '°C'; ctx.font = '700 12px system-ui, sans-serif';
    const bw = ctx.measureText(label).width + 10; rr(ctx, cx - bw / 2, y - 14, bw, 19, 9); ctx.fillStyle = tempColor(v); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, cx, y);
  }
  function drawBox(ctx, i, x, y, s, t, locked) {
    const b = BOXES[i], w = BOX_W * s, h = BOX_H * s, v = boxTemp(i, S.mode, t);
    ctx.save();
    rr(ctx, x, y, w, h, 5); ctx.fillStyle = '#f8fafc'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = tempColor(v); ctx.stroke();
    ctx.fillStyle = b.color; ctx.fillRect(x + 4 * s, y + 4 * s, w - 8 * s, 10 * s);
    ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.font = `700 ${Math.round(11 * s)}px system-ui, sans-serif`; ctx.fillText(b.name, x + w / 2, y + 28 * s);
    ctx.fillStyle = '#6b7280'; ctx.font = `${Math.round(10 * s)}px system-ui, sans-serif`; ctx.fillText(b.sub, x + w / 2, y + 40 * s);
    if (locked) {
      ctx.fillStyle = 'rgba(220,38,38,.9)'; rr(ctx, x - 12, y + h / 2 - 12, w + 24, 24, 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 11px system-ui, sans-serif'; ctx.fillText('DO NOT USE', x + w / 2, y + h / 2 + 4);
    }
    ctx.restore();
  }

  function drawPerson(ctx, x, feet, h, shirt, walking, t, carrying, alpha) {
    ctx.save(); ctx.globalAlpha = alpha ?? 1;
    const head = h * 0.13, bodyTop = feet - h + head * 2, hip = feet - h * 0.42, sw = walking ? Math.sin(t * 9) * 0.45 : 0;
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = h * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, hip); ctx.lineTo(x + Math.sin(sw) * h * 0.42, feet); ctx.moveTo(x, hip); ctx.lineTo(x - Math.sin(sw) * h * 0.42, feet); ctx.stroke();
    ctx.fillStyle = shirt; rr(ctx, x - h * 0.12, bodyTop, h * 0.24, hip - bodyTop + 4, h * 0.06); ctx.fill();
    ctx.strokeStyle = shirt; ctx.lineWidth = h * 0.06;
    ctx.beginPath();
    if (carrying) { ctx.moveTo(x, bodyTop + 6); ctx.lineTo(x + h * 0.22, bodyTop + h * 0.12); }
    else { ctx.moveTo(x, bodyTop + 6); ctx.lineTo(x - Math.sin(sw) * h * 0.25, hip + 4); ctx.moveTo(x, bodyTop + 6); ctx.lineTo(x + Math.sin(sw) * h * 0.25, hip + 4); }
    ctx.stroke();
    ctx.fillStyle = '#c68a5a'; ctx.beginPath(); ctx.arc(x, bodyTop - head, head, 0, 7); ctx.fill();
    ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(x, bodyTop - head - head * 0.35, head, Math.PI, 0); ctx.fill();
    ctx.restore();
  }

  function drawTruck(ctx, t, off, moving) {
    const bob = moving ? Math.sin(t * 14) * 1.2 : 0;
    ctx.save(); ctx.translate(0, bob);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(540, 448, 270, 10, 0, 0, 7); ctx.fill();
    // cab
    ctx.fillStyle = '#0f766e'; rr(ctx, 662, 290, 128, 124, 12); ctx.fill();
    ctx.fillStyle = '#cffafe'; rr(ctx, 700, 302, 76, 50, 8); ctx.fill();
    ctx.fillStyle = '#115e59'; ctx.fillRect(662, 390, 128, 24);
    ctx.fillStyle = '#fde68a'; ctx.fillRect(780, 372, 10, 12);
    // cargo body (cutaway)
    ctx.fillStyle = '#0f766e'; rr(ctx, 284, 200, 380, 214, 10); ctx.fill();
    ctx.fillStyle = '#e0f2fe'; ctx.fillRect(294, 212, 360, 184);
    ctx.fillStyle = '#bae6fd'; ctx.fillRect(294, 392, 360, 6);
    // cooling unit on roof
    ctx.fillStyle = '#94a3b8'; rr(ctx, 560, 180, 80, 24, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('COOLING', 600, 196);
    // cold air lines from main unit
    ctx.strokeStyle = 'rgba(59,130,246,.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const yy = 226 + ((t * 30 + i * 18) % 70); ctx.beginPath(); ctx.moveTo(520 - i * 40, yy); ctx.lineTo(540 - i * 40, yy + 6); ctx.stroke(); }
    // faulty vent near the back (above insulin)
    const broken = t >= 14;
    ctx.fillStyle = broken ? '#f97316' : '#94a3b8'; ctx.fillRect(310, 212, 60, 10);
    if (broken) {
      ctx.strokeStyle = 'rgba(249,115,22,.7)'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) { const x0 = 318 + i * 18, ph = t * 6 + i; ctx.beginPath(); for (let k = 0; k <= 16; k += 2) ctx.lineTo(x0 + Math.sin(ph + k / 4) * 4, 226 + k); ctx.stroke(); }
      ctx.fillStyle = '#c2410c'; ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('vent failed', 376, 222);
    }
    // backup fridge
    const f = FRIDGE, doorOpen = S.mode === 'save' && t > 28.5 && t < 31.5;
    rr(ctx, f.x, f.y, f.w, f.h, 6); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#dbeafe'; ctx.fillRect(f.x + 5, f.y + 30, f.w - 10, f.h - 36);
    ctx.fillStyle = '#1d4ed8'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BACKUP', f.x + f.w / 2, f.y + 14); ctx.fillText('FRIDGE', f.x + f.w / 2, f.y + 26);
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2; const sx = f.x + f.w / 2, sy = f.y + 52;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.beginPath(); ctx.moveTo(sx - Math.cos(a) * 9, sy - Math.sin(a) * 9); ctx.lineTo(sx + Math.cos(a) * 9, sy + Math.sin(a) * 9); ctx.stroke(); }
    if (!doorOpen) { ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2; ctx.strokeRect(f.x + 5, f.y + 30, f.w - 10, f.h - 36); ctx.fillStyle = '#64748b'; ctx.fillRect(f.x + 8, f.y + 90, 4, 22); }
    // back door when driver is inside
    const doorOpenBack = S.mode === 'save' && t > 22.8 && t < 33.6;
    ctx.fillStyle = '#115e59'; if (doorOpenBack) ctx.fillRect(250, 212, 34, 184); else ctx.fillRect(284, 212, 10, 184);
    // wheels
    for (const wx of [360, 600, 730]) {
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(wx, 420, 26, 0, 7); ctx.fill();
      ctx.fillStyle = '#9ca3af'; ctx.beginPath(); ctx.arc(wx, 420, 11, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 3; const a = off / 26;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(wx, 420); ctx.lineTo(wx + Math.cos(a + k * 2.09) * 11, 420 + Math.sin(a + k * 2.09) * 11); ctx.stroke(); }
    }
    ctx.restore();
    return bob;
  }

  function draw() {
    const { ctx, t, off, mode } = S;
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, t, off);
    drawBuilding(ctx, 20 - off, 'Medicine warehouse', 'warehouse');
    drawBuilding(ctx, S.dist + 810 - off, 'Clinic', 'clinic');
    const moving = moveFactor(mode, t) > 0;
    const bob = drawTruck(ctx, t, off, moving);
    ctx.save(); ctx.translate(0, bob);
    const locked = mode === 'fail' && t >= 26.5;
    // boxes 1..3
    for (let i = 1; i < 4; i++) { drawBox(ctx, i, SLOT_X[i], FLOOR - BOX_H, 1, t, false); drawThermo(ctx, SLOT_X[i] + BOX_W / 2, 270, boxTemp(i, mode, t)); }
    // insulin
    const p = insulinPos(t), vIns = boxTemp(0, mode, t);
    const d = driverState(t);
    if (!p.carried) {
      drawBox(ctx, 0, p.x, p.y, p.s, t, locked);
      if (p.inFridge) drawBadge(ctx, FRIDGE.x + FRIDGE.w / 2, FRIDGE.y + 88, vIns);
      else drawThermo(ctx, SLOT_X[0] + BOX_W / 2, 270, vIns);
    }
    if (d) {
      drawPerson(ctx, d.x, FLOOR, 104, '#2563eb', d.walking, t, d.carrying, d.alpha);
      if (p.carried) { drawBox(ctx, 0, d.x + 10, FLOOR - 92, 0.8, t, false); drawBadge(ctx, d.x + 33, FLOOR - 98, vIns); }
    }
    ctx.restore();
    // nurse at the clinic
    if (t >= 44.5) {
      const a = clamp((t - 44.5) * 2, 0, 1), nx = lerp(170, 215, ease((t - 44.5) / 1.5));
      drawPerson(ctx, nx, 470, 116, '#16a34a', t < 46, t, false, a);
      if (t > 46) {
        ctx.save(); ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 8); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(nx + 16, 392); ctx.lineTo(SLOT_X[0], 370); ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#111827'; rr(ctx, nx + 8, 382, 16, 26, 3); ctx.fill();
      }
    }
  }

  // ---------- HTML overlay (captions + phone) ----------
  function phoneHtml(t) {
    const m = S.mode;
    const card = (kind, title, body) => `<div class="ph-card ${kind}"><div class="ph-app"><span class="ph-dot"></span>TempSure</div><strong>${title}</strong><span>${body}</span></div>`;
    if (m === 'save') {
      if (t >= 22 && t < 27) return card('warn', 'Insulin is warming up', '7.2°C and rising. It will be too warm in about 6 minutes. Move it to the backup fridge.');
      if (t >= 27 && t < 33) return card('ok', 'Action recorded', 'Driver A. Rahman moved the insulin to the backup fridge. Time and name saved.');
      if (t >= 35 && t < 41) return card('ok', 'Back to safe', `Insulin is cooling down: ${insulinTemp(m, t).toFixed(1)}°C.`);
      if (t >= 46.5) return card('ok big', 'Scan result: safe to use', 'All 4 boxes stayed between 2°C and 8°C. 1 warning, fixed by the driver in 4 minutes.');
    } else {
      if (t >= 22 && t < 24.5) return card('warn', 'Insulin is warming up', '7.2°C and rising. It will be too warm in about 6 minutes. Move it to the backup fridge.');
      if (t >= 24.5 && t < 26.5) return card('warn', 'No response', 'The driver hasn\'t acted. The supervisor has been alerted.');
      if (t >= 26.5 && t < 32) return card('bad', 'Insulin locked: do not use', 'It went above 8°C. It may no longer work, even though it looks normal.');
      if (t >= 32 && t < 40) return card('bad', 'Report sent to pharmacist', 'Which box, how warm, for how long, and who had it. All recorded automatically.');
      if (t >= 46.5) return card('bad big', 'Scan result: do not use the insulin', 'It was too warm for about 20 minutes. A pharmacist is reviewing it. The other 3 boxes are safe to use.');
    }
    return '';
  }
  function updateOverlay() {
    const t = S.t, list = CAPTIONS[S.mode];
    let idx = 0; list.forEach((c, i) => { if (t >= c[0]) idx = i; });
    if (S.capIdx !== idx) {
      S.capIdx = idx;
      $('#st-cap').innerHTML = `<span class="st-step">Step ${idx + 1} of ${list.length}</span><strong>${list[idx][1]}</strong><span>${list[idx][2]}</span>`;
      $('#st-dots').innerHTML = list.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('');
    }
    const ph = phoneHtml(t);
    if (S.lastPhone !== ph) { S.lastPhone = ph; $('#st-phone').innerHTML = ph; $('#st-phone').classList.toggle('show', !!ph); }
    $('#st-bar').style.width = (clamp(t / END, 0, 1) * 100).toFixed(1) + '%';
    $('#st-play').textContent = S.playing ? 'Pause' : (t >= END ? 'Watch again' : 'Play');
  }

  // ---------- loop ----------
  function frame(now) {
    if (!S) return;
    const dt = Math.min(0.05, (now - (S.last || now)) / 1000); S.last = now;
    if (S.playing) {
      S.t += dt * S.speed;
      S.off += moveFactor(S.mode, S.t) * SPEED_PX * dt * S.speed;
      if (S.t >= END) { S.t = END; S.playing = false; }
    }
    draw(); updateOverlay();
    S.raf = requestAnimationFrame(frame);
  }
  function resize() {
    if (!S) return;
    const c = S.canvas, w = c.clientWidth, dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(w * H / W * dpr);
    S.ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
  }
  function restart(mode) {
    S.mode = mode || S.mode; S.t = 0; S.off = 0; S.dist = totalDistance(S.mode); S.capIdx = -1; S.lastPhone = null; S.playing = true;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  }

  // jump to a point in the story (used for testing and presenter shortcuts)
  window.storySeek = function (t, mode) {
    if (!S) return; if (mode && mode !== S.mode) restart(mode);
    S.t = clamp(t, 0, END); S.off = 0; for (let x = 0; x < S.t; x += 0.01) S.off += moveFactor(S.mode, x) * SPEED_PX * 0.01;
    S.playing = false; S.capIdx = -1; S.lastPhone = null;
  };
  window.stopStory = function () { if (S) { cancelAnimationFrame(S.raf); window.removeEventListener('resize', resize); S = null; } };

  window.renderStory = function () {
    window.stopStory();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === 'story'));
    $('#app').innerHTML = `
      <section class="story">
        <div class="story-head">
          <div><p class="eyebrow">See it in action</p><h1>How TempSure protects medicine on the road</h1>
          <p class="lede">No expertise needed. Watch a delivery truck carry four boxes of medicine, then see what happens when one of them starts getting too warm.</p></div>
        </div>
        <div class="stage">
          <canvas id="st-canvas" aria-label="Animated delivery truck carrying four medicine boxes with live thermometers"></canvas>
          <div id="st-phone" class="st-phone" aria-live="polite"></div>
          <div class="st-progress"><div id="st-bar"></div></div>
        </div>
        <div class="st-under">
          <div id="st-cap" class="st-cap" aria-live="polite"></div>
          <div id="st-dots" class="st-dots" aria-hidden="true"></div>
        </div>
        <div class="st-controls">
          <button class="btn primary" id="st-play">Pause</button>
          <button class="btn" id="st-restart">Restart</button>
          <div class="seg" role="group" aria-label="Choose an ending">
            <button data-mode="save" class="on">Someone acts</button>
            <button data-mode="fail">What if nobody acts?</button>
          </div>
          <div class="seg" role="group" aria-label="Speed"><button data-sp="1" class="on">1×</button><button data-sp="2">2×</button></div>
        </div>
        <div class="st-legend">
          <span><i style="background:#16a34a"></i>Safe (2–7°C)</span>
          <span><i style="background:#f59e0b"></i>Warming, warning sent (7–8°C)</span>
          <span><i style="background:#dc2626"></i>Too warm, locked (above 8°C)</span>
          <span><i class="tick"></i>Red mark on each thermometer = 8°C limit</span>
        </div>
        <div class="st-cta">
          <a class="btn" href="#/p/${(state.shipments.find(s => s.product.startsWith('Insulin')) || state.shipments[0] || {}).id || ''}">Now see the real dashboard for this trip →</a>
        </div>
      </section>`;
    const canvas = $('#st-canvas');
    S = { canvas, ctx: canvas.getContext('2d'), mode: 'save', t: 0, off: 0, speed: 1, playing: true };
    restart('save'); resize();
    window.addEventListener('resize', resize);
    $('#st-play').onclick = () => { if (S.t >= END) restart(); else S.playing = !S.playing; };
    $('#st-restart').onclick = () => restart();
    document.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => restart(b.dataset.mode); });
    document.querySelectorAll('[data-sp]').forEach(b => { b.onclick = () => { S.speed = Number(b.dataset.sp); document.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('on', x === b)); }; });
    S.raf = requestAnimationFrame(frame);
  };
})();
