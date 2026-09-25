'use strict';
/*
 * TempSure 3D story mode (Three.js, vendored in vendor/three.min.js).
 * Same story as the 2D "See it in action" page, rendered in 3D:
 * a refrigerated truck crosses Dubai carrying four medicine boxes.
 * The insulin starts warming; in one ending the driver moves it to
 * the backup fridge, in the other nobody acts and it is locked.
 */
(function () {
  const END = 56, DRIVE_SPEED = 3.2; // world units per second while driving
  const BOXES = [
    { name: 'Insulin', sub: 'diabetes', color: 0x7c3aed },
    { name: 'Measles', sub: 'vaccine', color: 0x0891b2 },
    { name: 'Hepatitis B', sub: 'vaccine', color: 0xdb2777 },
    { name: 'Arthritis', sub: 'biologic', color: 0xca8a04 },
  ];
  const SLOT_X = 0.55, SLOT_Z = [-0.9, 0.25, 1.4, 2.55];
  const CRATE = { w: 0.95, h: 0.85, d: 0.85 };
  const BED_Y = 0.8;                 // cargo floor height
  const FRIDGE = { x: -0.78, z: 3.32, w: 0.86, d: 0.9, h: 2.15 };
  const AISLE_X = -0.15;

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
  function totalDistance(mode) { let d = 0; for (let t = 0; t < END; t += 0.01) d += moveFactor(mode, t) * DRIVE_SPEED * 0.01; return d; }

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
  const tempHex = v => v > 8 ? '#dc2626' : v > 7 ? '#f59e0b' : '#16a34a';
  const tempInt = v => v > 8 ? 0xdc2626 : v > 7 ? 0xf59e0b : 0x16a34a;

  // ---------- choreography ----------
  // driver position in cargo-local coordinates (x, z), walking the aisle
  function driverPose(t) {
    if (S.mode !== 'save' || t < 23 || t > 33.5) return null;
    let x = AISLE_X, z, walking = false, face = Math.PI; // face -Z by default
    if (t < 25.8) { z = lerp(4.05, -0.85, ease((t - 23) / 2.8)); walking = true; }
    else if (t < 26.6) z = -0.85;
    else if (t < 30.2) { z = lerp(-0.85, 2.95, ease((t - 26.6) / 3.6)); walking = true; face = 0; }
    else if (t < 31.0) z = 2.95;
    else { z = lerp(2.95, 4.05, ease((t - 31.0) / 2.5)); walking = true; face = Math.PI; }
    return { x, z, walking, face, carrying: t >= 26.6 && t < 30.4, alpha: clamp(Math.min(t - 23, 33.5 - t) * 1.5, 0, 1) };
  }
  // insulin crate position + where it is
  function insulinState(t) {
    const home = { x: SLOT_X, y: BED_Y, z: SLOT_Z[0], where: 'slot' };
    if (S.mode !== 'save') return home;
    const d = driverPose(t);
    if (d && d.carrying) {
      const fz = d.face === 0 ? 1 : -1;
      return { x: d.x, y: BED_Y + 0.45, z: d.z + 0.38 * fz, where: 'carried' };
    }
    if (t >= 30.4) return { x: FRIDGE.x, y: BED_Y + 0.58, z: FRIDGE.z, where: 'fridge' };
    return home;
  }
  const rearDoorOpen = t => S.mode === 'save' && t > 22.8 && t < 33.6;
  const fridgeDoorOpen = t => S.mode === 'save' && t > 28.8 && t < 31.6;

  // ---------- text sprites ----------
  function textSprite(lines, opts = {}) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: opts.depthTest !== false }));
    spr.userData.set = (txt, bg) => {
      const arr = Array.isArray(txt) ? txt : [txt];
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.font = `700 ${opts.px || 44}px system-ui, sans-serif`;
      const w = Math.max(...arr.map(s => ctx.measureText(s).width)) + (opts.pad || 28);
      const lh = (opts.px || 44) * 1.25, h = lh * arr.length + 14;
      cv.width = Math.ceil(w); cv.height = Math.ceil(h);
      ctx.font = `700 ${opts.px || 44}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (bg !== null) {
        ctx.fillStyle = bg || 'rgba(255,255,255,.9)';
        const r = 16; ctx.beginPath();
        ctx.moveTo(r, 0); ctx.arcTo(cv.width, 0, cv.width, cv.height, r); ctx.arcTo(cv.width, cv.height, 0, cv.height, r); ctx.arcTo(0, cv.height, 0, 0, r); ctx.arcTo(0, 0, cv.width, 0, r); ctx.fill();
      }
      ctx.fillStyle = opts.fg || '#ffffff';
      arr.forEach((s, i) => ctx.fillText(s, cv.width / 2, lh * i + lh / 2 + 7));
      spr.material.map.needsUpdate = true;
      spr.scale.set(cv.width / cv.height * (opts.h || 0.55), opts.h || 0.55, 1);
    };
    spr.userData.set(lines, opts.bg);
    return spr;
  }

  function tempTag() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 56;
    const ctx = cv.getContext('2d');
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    spr.scale.set(0.9, 0.39, 1);
    let shown = '';
    spr.userData.setTemp = v => {
      const label = v.toFixed(1) + '°C';
      if (label === shown) return; shown = label;
      ctx.clearRect(0, 0, 128, 56);
      ctx.fillStyle = tempHex(v);
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.arcTo(128, 0, 128, 56, 14); ctx.arcTo(128, 56, 0, 56, 14); ctx.arcTo(0, 56, 0, 0, 14); ctx.arcTo(0, 0, 128, 0, 14); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 64, 29);
      spr.material.map.needsUpdate = true;
    };
    return spr;
  }

  // ---------- builders ----------
  const mat = (c, o) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  function facadeTexture(tint, floors, cols) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = tint; c.fillRect(0, 0, 128, 256);
    c.fillStyle = 'rgba(70,95,115,.55)';
    for (let y = 0; y < floors; y++) for (let x = 0; x < cols; x++) c.fillRect(10 + x * (108 / cols), 12 + y * (232 / floors), (108 / cols) * 0.62, (232 / floors) * 0.55);
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    return tex;
  }

  function makeBuilding(seed, texs, rng) {
    const w = 4 + rng() * 5, h = 5 + rng() * 16, d = 4 + rng() * 4;
    const g = new THREE.Group();
    const side = new THREE.MeshLambertMaterial({ map: texs[seed % texs.length] });
    const top = mat(0x8b98a3);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, side, side]));
    g.children[0].position.y = h / 2;
    if (rng() > 0.72) { const ant = box(0.25, 3, 0.25, mat(0x6b7280)); ant.position.set(w / 4, h + 1.5, 0); g.add(ant); }
    g.userData.h = h;
    return g;
  }

  function makePalm() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.6, 6), mat(0x8b6b43));
    trunk.position.y = 1.3; trunk.rotation.z = 0.06; g.add(trunk);
    for (let i = 0; i < 5; i++) {
      const fr = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5), new THREE.MeshLambertMaterial({ color: 0x3f8f4f, side: THREE.DoubleSide }));
      const a = i / 5 * Math.PI * 2;
      fr.position.set(Math.cos(a) * 0.7, 2.75, Math.sin(a) * 0.7);
      fr.rotation.set(-0.5, a, 0.45, 'YXZ');
      g.add(fr);
    }
    return g;
  }

  function makePerson(shirt, pants = 0x1f2937) {
    const g = new THREE.Group();
    const legL = new THREE.Group(), legR = new THREE.Group();
    for (const [leg, sx] of [[legL, -0.12], [legR, 0.12]]) {
      const m = box(0.2, 0.78, 0.22, mat(pants)); m.position.y = -0.39;
      leg.add(m); leg.position.set(sx, 0.8, 0); g.add(leg);
    }
    const torso = box(0.52, 0.68, 0.3, mat(shirt)); torso.position.y = 1.16; g.add(torso);
    const armL = new THREE.Group(), armR = new THREE.Group();
    for (const [arm, sx] of [[armL, -0.34], [armR, 0.34]]) {
      const m = box(0.13, 0.62, 0.15, mat(shirt)); m.position.y = -0.3;
      arm.add(m); arm.position.set(sx, 1.46, 0); g.add(arm);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(0xc68a5a)); head.position.y = 1.72; g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(pants)); cap.position.y = 1.75; g.add(cap);
    g.userData = { legL, legR, armL, armR };
    return g;
  }

  function makeCrate(i) {
    const g = new THREE.Group();
    const body = box(CRATE.w, CRATE.h, CRATE.d, mat(0xf8fafc));
    body.position.y = CRATE.h / 2;
    const band = box(CRATE.w + 0.02, 0.16, CRATE.d + 0.02, mat(BOXES[i].color));
    band.position.y = CRATE.h - 0.1;
    const rim = box(CRATE.w + 0.04, 0.06, CRATE.d + 0.04, new THREE.MeshBasicMaterial({ color: 0x16a34a }));
    rim.position.y = 0.03;
    g.add(body, band, rim);
    const label = textSprite([BOXES[i].name, BOXES[i].sub], { h: 0.42, px: 40, bg: 'rgba(255,255,255,.92)', fg: '#16201d' });
    label.position.set(0, CRATE.h / 2 + 0.05, CRATE.d / 2 + 0.02);
    g.add(label);
    g.userData.rim = rim;
    return g;
  }

  function makeTruck() {
    const g = new THREE.Group();
    // chassis + cab (front is -Z)
    const chassis = box(2.4, 0.28, 8.2, mat(0x374151)); chassis.position.set(0, 0.62, 0.3); g.add(chassis);
    const cab = box(2.3, 1.9, 1.8, mat(0x0f766e)); cab.position.set(0, 1.85, -3.25); g.add(cab);
    const shield = box(1.9, 0.75, 0.06, mat(0xcffafe, { emissive: 0x223a3f })); shield.position.set(0, 2.25, -4.12); g.add(shield);
    const bumper = box(2.35, 0.3, 0.2, mat(0x115e59)); bumper.position.set(0, 0.85, -4.2); g.add(bumper);
    const light1 = box(0.3, 0.18, 0.06, new THREE.MeshBasicMaterial({ color: 0xfde68a })); light1.position.set(0.85, 1.2, -4.16); g.add(light1);
    const light2 = light1.clone(); light2.position.x = -0.85; g.add(light2);
    // cargo: floor, left wall (-X), roof, front wall. +X side is the cutaway.
    const fl = box(2.6, 0.14, 6.1, mat(0x94a3b8)); fl.position.set(0, BED_Y - 0.07, 1.1); g.add(fl);
    const wallL = box(0.1, 2.55, 6.1, mat(0x0f766e)); wallL.position.set(-1.3, BED_Y + 1.27, 1.1); g.add(wallL);
    const roof = box(2.6, 0.12, 6.1, mat(0x0f766e)); roof.position.set(0, BED_Y + 2.6, 1.1); g.add(roof);
    const wallF = box(2.6, 2.55, 0.1, mat(0x0f766e)); wallF.position.set(0, BED_Y + 1.27, -1.95); g.add(wallF);
    // rear door (slides open)
    const rear = box(2.55, 2.5, 0.08, mat(0x115e59)); rear.position.set(0, BED_Y + 1.25, 4.15); g.add(rear);
    g.userData.rear = rear;
    // cooling unit + failed vent above the insulin slot
    const cool = box(1.1, 0.35, 0.8, mat(0x94a3b8)); cool.position.set(0.4, BED_Y + 2.82, -0.9); g.add(cool);
    const coolTxt = textSprite('COOLING', { h: 0.22, px: 40, bg: null, fg: '#0f172a' });
    coolTxt.position.set(0.4, BED_Y + 2.86, -0.44); g.add(coolTxt);
    const vent = box(0.5, 0.08, 0.5, mat(0x94a3b8)); vent.position.set(SLOT_X, BED_Y + 2.5, SLOT_Z[0]); g.add(vent);
    g.userData.vent = vent;
    const ventTxt = textSprite('vent failed', { h: 0.24, px: 40, bg: '#c2410c', fg: '#fff' });
    ventTxt.position.set(SLOT_X, BED_Y + 2.32, SLOT_Z[0]); ventTxt.visible = false; g.add(ventTxt);
    g.userData.ventTxt = ventTxt;
    // heat wisps (shown while the vent is failed)
    const wisps = [];
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.5), new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      w.position.set(SLOT_X - 0.25 + i * 0.25, BED_Y + 2.1, SLOT_Z[0]); w.visible = false; g.add(w); wisps.push(w);
    }
    g.userData.wisps = wisps;
    // interior light
    const inner = new THREE.PointLight(0xe0f2fe, 0.9, 9); inner.position.set(0, BED_Y + 2.3, 1.2); g.add(inner);
    // wheels
    g.userData.wheels = [];
    for (const [x, z] of [[-1.3, -3.3], [1.3, -3.3], [-1.3, 1.2], [1.3, 1.2], [-1.3, 3.7], [1.3, 3.7]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 18), mat(0x111827));
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.55, z); g.add(w); g.userData.wheels.push(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 12), mat(0x9ca3af));
      hub.rotation.z = Math.PI / 2; hub.position.set(x, 0.55, z); g.add(hub);
    }
    // driver silhouette in the cab
    const pilot = makePerson(0x2563eb); pilot.scale.setScalar(0.8); pilot.position.set(-0.5, 1.35, -3.3); g.add(pilot);
    return g;
  }

  function makeFridge() {
    const g = new THREE.Group();
    const body = box(FRIDGE.w, FRIDGE.h, FRIDGE.d, mat(0xffffff));
    body.position.y = FRIDGE.h / 2; g.add(body);
    // glass front on the aisle (+X) side
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(FRIDGE.d - 0.18, FRIDGE.h - 0.55), new THREE.MeshLambertMaterial({ color: 0x9ecfff, transparent: true, opacity: 0.3 }));
    glass.rotation.y = Math.PI / 2; glass.position.set(FRIDGE.w / 2 + 0.005, FRIDGE.h / 2 + 0.12, 0); g.add(glass);
    const shelf = box(FRIDGE.w - 0.1, 0.04, FRIDGE.d - 0.1, mat(0xbfdbfe)); shelf.position.y = 0.55; g.add(shelf);
    const door = new THREE.Group();
    const dp = box(0.04, FRIDGE.h - 0.4, FRIDGE.d - 0.14, mat(0xe2e8f0)); dp.position.set(0, 0, -(FRIDGE.d - 0.14) / 2 + 0.07);
    door.add(dp); door.position.set(FRIDGE.w / 2 + 0.02, FRIDGE.h / 2 + 0.05, FRIDGE.d / 2 - 0.07); g.add(door);
    g.userData.door = door;
    const txt = textSprite(['BACKUP', 'FRIDGE'], { h: 0.42, px: 44, bg: '#1d4ed8', fg: '#fff' });
    txt.position.set(0, FRIDGE.h + 0.3, 0); g.add(txt);
    return g;
  }

  function makeClinic() {
    const g = new THREE.Group();
    const b = box(7, 4.6, 3, mat(0xffffff)); b.position.y = 2.3; g.add(b);
    const roof = box(7.2, 0.5, 3.2, mat(0x16a34a)); roof.position.y = 4.85; g.add(roof);
    const cross1 = box(0.4, 1.6, 0.1, mat(0x16a34a)); cross1.position.set(0, 3.1, 1.56); g.add(cross1);
    const cross2 = box(1.5, 0.4, 0.1, mat(0x16a34a)); cross2.position.set(0, 3.1, 1.56); g.add(cross2);
    const door = box(1.3, 2.2, 0.12, mat(0x9ca3af)); door.position.set(0, 1.1, 1.52); g.add(door);
    const txt = textSprite('Clinic', { h: 0.5, px: 46, bg: '#16a34a', fg: '#fff' }); txt.position.set(0, 4.35, 1.6); g.add(txt);
    return g;
  }

  function makeWarehouse() {
    const g = new THREE.Group();
    const b = box(9, 5.5, 4, mat(0xe5e7eb)); b.position.y = 2.75; g.add(b);
    const roof = box(9.2, 0.5, 4.2, mat(0x0f766e)); roof.position.y = 5.7; g.add(roof);
    for (let i = 0; i < 3; i++) { const sh = box(1.8, 4, 0.12, mat(0x9ca3af)); sh.position.set(-3 + i * 3, 2, 2.02); g.add(sh); }
    const txt = textSprite('Medicine warehouse', { h: 0.5, px: 42, bg: '#0f766e', fg: '#fff' }); txt.position.set(0, 5.15, 2.1); g.add(txt);
    return g;
  }

  // ---------- scene ----------
  function buildScene(container) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf2e3c8, 45, 170);
    const camera = new THREE.PerspectiveCamera(46, 1.92, 0.1, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(0xbfe3f7);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // sky dome (vertical gradient)
    const skyc = document.createElement('canvas'); skyc.width = 4; skyc.height = 256;
    const sg = skyc.getContext('2d'), grad = sg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#8ecfee'); grad.addColorStop(0.62, '#bfe3f7'); grad.addColorStop(1, '#fdf1dc');
    sg.fillStyle = grad; sg.fillRect(0, 0, 4, 256);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 16, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(skyc), side: THREE.BackSide, fog: false }));
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0xd8c49a, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
    sun.position.set(16, 30, 14); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16; sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
    sun.shadow.camera.far = 90; sun.shadow.bias = -0.0005;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);

    // ground + road
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(0xe6d4ae));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const road = box(9, 0.04, 500, mat(0x4b5563)); road.position.set(0.6, 0.02, -100); road.receiveShadow = true; scene.add(road);
    const curbL = box(0.4, 0.12, 500, mat(0xd6d3cb)); curbL.position.set(-4.1, 0.06, -100); scene.add(curbL);
    const curbR = box(0.4, 0.12, 500, mat(0xd6d3cb)); curbR.position.set(5.3, 0.06, -100); scene.add(curbR);

    // road dashes (recycled)
    const dashes = [];
    for (let i = 0; i < 40; i++) {
      const d = box(0.16, 0.05, 1.6, new THREE.MeshBasicMaterial({ color: 0xf5f5f4 }));
      d.position.set(0.6, 0.05, -140 + i * 4); scene.add(d); dashes.push(d);
    }

    // buildings both sides (recycled pool)
    const rng = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const texs = [facadeTexture('#e7d8c1', 7, 4), facadeTexture('#dccbb0', 9, 5), facadeTexture('#cfd8df', 12, 6)];
    const buildings = [];
    for (let i = 0; i < 26; i++) {
      const left = i % 3 !== 0;
      const b = makeBuilding(i, texs, rng);
      b.position.set(left ? -(8 + rng() * 10) : 12 + rng() * 12, 0, -150 + i * 8 + rng() * 5);
      scene.add(b); buildings.push(b);
    }
    // palms along the left sidewalk
    const palms = [];
    for (let i = 0; i < 10; i++) { const p = makePalm(); p.position.set(-5.6, 0, -140 + i * 20 + rng() * 8); scene.add(p); palms.push(p); }

    // sun disc + heat label
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfbbf24, fog: false }));
    sunMesh.position.set(-30, 32, -110); scene.add(sunMesh);
    const heat = textSprite('Outside: 44°C', { h: 1.6, px: 52, bg: 'rgba(255,255,255,.85)', fg: '#b45309' });
    heat.position.set(-30, 25.5, -110); scene.add(heat);

    // truck + cargo
    const truck = makeTruck(); scene.add(truck);
    truck.traverse(o => { if (o.isMesh) { o.castShadow = true; } });

    const crates = [], tags = [];
    for (let i = 0; i < 4; i++) {
      const c = makeCrate(i); c.position.set(SLOT_X, BED_Y, SLOT_Z[i]);
      truck.add(c); crates.push(c);
      const tag = tempTag(); tag.position.set(SLOT_X, BED_Y + CRATE.h + 0.42, SLOT_Z[i]);
      truck.add(tag); tags.push(tag);
    }

    const fridge = makeFridge(); fridge.position.set(FRIDGE.x, BED_Y, FRIDGE.z); truck.add(fridge);
    const fridgeDoor = fridge.userData.door;

    // do-not-use ribbon for the fail ending
    const ribbon = box(CRATE.w + 0.08, 0.2, CRATE.d + 0.08, new THREE.MeshBasicMaterial({ color: 0xdc2626 }));
    ribbon.visible = false; ribbon.position.y = CRATE.h / 2; crates[0].add(ribbon);
    const ribbonTxt = textSprite('DO NOT USE', { h: 0.22, px: 40, bg: '#dc2626', fg: '#fff' });
    ribbonTxt.visible = false; ribbonTxt.position.set(0, CRATE.h / 2 + 0.4, 0); crates[0].add(ribbonTxt);

    // driver + nurse
    const driver = makePerson(0x2563eb); driver.visible = false; truck.add(driver);
    const nurse = makePerson(0x16a34a, 0x374151); nurse.visible = false; nurse.position.set(4.2, 0, -9); scene.add(nurse);
    const phone = box(0.16, 0.26, 0.04, mat(0x111827)); phone.visible = false;
    nurse.add(phone); phone.position.set(0.45, 1.3, 0.15);
    // scan beam
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.6 }));
    beam.visible = false; scene.add(beam);

    const clinic = makeClinic(); clinic.position.set(10, 0, 0); scene.add(clinic);
    const warehouse = makeWarehouse(); warehouse.position.set(-11, 0, -8); scene.add(warehouse);

    return { scene, camera, renderer, truck, crates, tags, fridge, fridgeDoor, driver, nurse, phone, beam, clinic, warehouse, dashes, buildings, palms, ribbon, ribbonTxt, wisps: truck.userData.wisps, vent: truck.userData.vent, ventTxt: truck.userData.ventTxt, rear: truck.userData.rear, wheels: truck.userData.wheels };
  }

  // ---------- per-frame update ----------
  function updateScene(t) {
    const R = S.refs, mode = S.mode, moving = moveFactor(mode, t) > 0;

    // scroll world: scenery moves +Z as the truck "drives" toward -Z
    const step = moving && S.playing ? DRIVE_SPEED * S.dt * S.speed : 0;
    for (const d of R.dashes) { d.position.z += step; if (d.position.z > 40) d.position.z -= 180; }
    for (const b of R.buildings) { b.position.z += step; if (b.position.z > 55) b.position.z -= 190; }
    for (const p of R.palms) { p.position.z += step; if (p.position.z > 45) p.position.z -= 190; }
    for (const w of R.wheels) w.rotation.x += step / 0.55;

    // warehouse slides away; clinic slides in as the trip ends
    R.warehouse.position.z = -8 + S.traveled * 1.0;
    R.clinic.position.z = -12 - S.total + S.traveled;
    const nurseReady = t >= 44;
    R.clinic.visible = R.clinic.position.z > -90;

    // truck bob while driving
    R.truck.position.y = moving && S.playing ? Math.abs(Math.sin(t * 9)) * 0.05 : 0;

    // temperatures -> crate rim color + tag
    for (let i = 0; i < 4; i++) {
      const v = boxTemp(i, mode, t);
      R.crates[i].userData.rim.material.color.setHex(tempInt(v));
      R.tags[i].userData.setTemp(v);
    }

    // vent failure visuals
    const broken = t >= 14;
    R.vent.material.color.setHex(broken ? 0xf97316 : 0x94a3b8);
    R.ventTxt.visible = broken && t < 34;
    R.wisps.forEach((w, i) => {
      w.visible = broken && !((S.mode === 'save') && insulinState(t).where === 'fridge');
      if (w.visible) { w.position.y = BED_Y + 2.15 + Math.sin(t * 5 + i * 2) * 0.15; w.material.opacity = 0.35 + 0.25 * Math.sin(t * 7 + i); }
    });

    // insulin position (slot -> carried -> fridge)
    const ins = insulinState(t);
    R.crates[0].position.set(ins.x, ins.y, ins.z);
    R.tags[0].position.set(ins.x, ins.y + CRATE.h + 0.42, ins.z);
    const inFridge = ins.where === 'fridge';
    R.tags[0].scale.set(0.9 * (inFridge ? 0.75 : 1), 0.39 * (inFridge ? 0.75 : 1), 1);

    // doors
    R.rear.position.z = rearDoorOpen(t) ? 4.55 : 4.15;
    R.rear.rotation.y = rearDoorOpen(t) ? -0.9 : 0;
    R.fridgeDoor.rotation.y = fridgeDoorOpen(t) ? 2.4 : 0;

    // driver
    const d = driverPose(t);
    if (d) {
      R.driver.visible = true;
      R.driver.position.set(d.x, BED_Y, d.z);
      R.driver.rotation.y = d.face;
      const sw = d.walking ? Math.sin(t * 9) * 0.5 : 0;
      R.driver.userData.legL.rotation.x = sw; R.driver.userData.legR.rotation.x = -sw;
      if (d.carrying) { R.driver.userData.armL.rotation.x = -1.3; R.driver.userData.armR.rotation.x = -1.3; }
      else { R.driver.userData.armL.rotation.x = -sw * 0.7; R.driver.userData.armR.rotation.x = sw * 0.7; }
    } else R.driver.visible = false;

    // do-not-use lock in fail mode
    const locked = mode === 'fail' && t >= 26.5;
    R.ribbon.visible = locked;
    R.ribbonTxt.visible = locked;

    // nurse + scan beam near the end
    if (nurseReady) {
      R.nurse.visible = true;
      const a = clamp((t - 44.5) / 1.5, 0, 1);
      R.nurse.position.set(lerp(4.6, 3.2, ease(a)), 0, -8.5);
      R.nurse.rotation.y = -0.6;
      R.phone.visible = t > 45.5;
      if (t > 45.5 && t < 52) {
        R.beam.visible = true;
        const from = new THREE.Vector3(3.2 + 0.4, 1.3, -8.4);
        const crateW = new THREE.Vector3(); R.crates[0].getWorldPosition(crateW); crateW.y += 0.45;
        const mid = from.clone().add(crateW).multiplyScalar(0.5);
        R.beam.position.copy(mid);
        const len = from.distanceTo(crateW);
        R.beam.scale.set(1 + 0.4 * Math.sin(t * 10), len, 1 + 0.4 * Math.sin(t * 10));
        R.beam.lookAt(crateW); R.beam.rotateX(Math.PI / 2);
        R.beam.material.opacity = 0.45 + 0.25 * Math.sin(t * 8);
        R.beam.material.color.setHex(mode === 'fail' ? 0xdc2626 : 0x22c55e);
      } else R.beam.visible = false;
    } else { R.nurse.visible = false; R.beam.visible = false; }

    // camera: gentle drift + user orbit
    const yaw = S.cam.yaw + Math.sin(t * 0.12) * 0.05;
    const tgt = new THREE.Vector3(0, 1.7, 0.9);
    S.refs.camera.position.set(
      tgt.x + Math.sin(yaw) * Math.cos(S.cam.pitch) * S.cam.dist,
      tgt.y + Math.sin(S.cam.pitch) * S.cam.dist,
      tgt.z + Math.cos(yaw) * Math.cos(S.cam.pitch) * S.cam.dist
    );
    S.refs.camera.lookAt(tgt);
  }

  // ---------- overlay (captions + phone) ----------
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
      $('#s3-cap').innerHTML = `<span class="st-step">Step ${idx + 1} of ${list.length}</span><strong>${list[idx][1]}</strong><span>${list[idx][2]}</span>`;
      $('#s3-dots').innerHTML = list.map((_, i) => `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}"></span>`).join('');
    }
    const ph = phoneHtml(t);
    if (S.lastPhone !== ph) { S.lastPhone = ph; $('#s3-phone').innerHTML = ph; $('#s3-phone').classList.toggle('show', !!ph); }
    $('#s3-bar').style.width = (clamp(t / END, 0, 1) * 100).toFixed(1) + '%';
    $('#s3-play').textContent = S.playing ? 'Pause' : (t >= END ? 'Watch again' : 'Play');
  }

  // ---------- loop ----------
  function frame(now) {
    if (!S) return;
    const dt = Math.min(0.05, (now - (S.last || now)) / 1000); S.last = now; S.dt = dt;
    if (S.playing) {
      S.t += dt * S.speed;
      S.traveled += moveFactor(S.mode, S.t) * DRIVE_SPEED * dt * S.speed;
      if (S.t >= END) { S.t = END; S.playing = false; }
    }
    updateScene(S.t);
    S.refs.renderer.render(S.refs.scene, S.refs.camera);
    updateOverlay();
    S.raf = requestAnimationFrame(frame);
  }
  function resize() {
    if (!S) return;
    const w = S.wrap.clientWidth || 900, h = w * 0.52;
    S.refs.renderer.setSize(w, Math.round(h));
    S.refs.camera.aspect = w / h; S.refs.camera.updateProjectionMatrix();
  }
  function restart(mode) {
    S.mode = mode || S.mode; S.t = 0; S.traveled = 0; S.total = totalDistance(S.mode);
    S.capIdx = -1; S.lastPhone = null; S.playing = true;
    document.querySelectorAll('[data-mode3]').forEach(b => b.classList.toggle('on', b.dataset.mode3 === S.mode));
  }

  window.stopSim3d = function () {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    window.removeEventListener('resize', resize);
    if (S.camMove) window.removeEventListener('pointermove', S.camMove);
    if (S.camUp) window.removeEventListener('pointerup', S.camUp);
    try { S.refs.renderer.dispose(); } catch (e) { /* ignore */ }
    S = null;
  };

  window.renderSim3d = function () {
    window.stopSim3d();
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === 'sim'));
    if (!window.THREE) {
      $('#app').innerHTML = `<section class="card narrow"><h2>3D library did not load</h2><p class="muted">Check that <code>vendor/three.min.js</code> exists. You can still <a href="#/story">watch the 2D version</a>.</p></section>`;
      return;
    }
    $('#app').innerHTML = `
      <section class="story">
        <div class="story-head">
          <div><p class="eyebrow">See it in 3D</p><h1>Inside the truck: how TempSure protects medicine</h1>
          <p class="lede">A 3D look inside the refrigerated truck. Four boxes, live temperatures, a failed vent, and one human decision that saves the insulin. Drag to look around.</p></div>
        </div>
        <div class="stage" id="s3-wrap">
          <div id="s3-holder"></div>
          <div id="s3-phone" class="st-phone" aria-live="polite"></div>
          <div class="s3-hint">Drag to look around · scroll to zoom</div>
          <div class="st-progress"><div id="s3-bar"></div></div>
        </div>
        <div class="st-under">
          <div id="s3-cap" class="st-cap" aria-live="polite"></div>
          <div id="s3-dots" class="st-dots" aria-hidden="true"></div>
        </div>
        <div class="st-controls">
          <button class="btn primary" id="s3-play">Pause</button>
          <button class="btn" id="s3-restart">Restart</button>
          <div class="seg" role="group" aria-label="Choose an ending">
            <button data-mode3="save" class="on">Someone acts</button>
            <button data-mode3="fail">What if nobody acts?</button>
          </div>
          <div class="seg" role="group" aria-label="Speed"><button data-sp3="1" class="on">1×</button><button data-sp3="2">2×</button></div>
          <a class="btn ghost" href="#/story">Prefer 2D? Open the flat version</a>
        </div>
        <div class="st-legend">
          <span><i style="background:#16a34a"></i>Safe (2–7°C)</span>
          <span><i style="background:#f59e0b"></i>Warming, warning sent (7–8°C)</span>
          <span><i style="background:#dc2626"></i>Too warm, locked (above 8°C)</span>
        </div>
        <div class="st-cta">
          <a class="btn" href="#/p/${(state.shipments.find(s => s.product.startsWith('Insulin')) || state.shipments[0] || {}).id || ''}">Now see the real dashboard for this trip →</a>
        </div>
      </section>`;

    const wrap = $('#s3-wrap'), holder = $('#s3-holder');
    let refs;
    try { refs = buildScene(holder); }
    catch (e) {
      $('#s3-wrap').innerHTML = '<div class="s3-fallback"><p><strong>3D is not available in this browser.</strong></p><p><a href="#/story">Watch the 2D version instead →</a></p></div>';
      return;
    }

    S = { wrap, refs, mode: 'save', t: 0, traveled: 0, total: totalDistance('save'), speed: 1, playing: true, dt: 0, cam: { yaw: 0.62, pitch: 0.32, dist: 10.5 } };

    // drag-to-orbit + wheel zoom
    let dragging = false, px = 0, py = 0;
    const dom = refs.renderer.domElement;
    dom.style.touchAction = 'none'; dom.style.cursor = 'grab';
    dom.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; dom.style.cursor = 'grabbing'; });
    S.camMove = e => {
      if (!dragging || !S) return;
      S.cam.yaw = clamp(S.cam.yaw - (e.clientX - px) * 0.005, -0.4, 1.6);
      S.cam.pitch = clamp(S.cam.pitch + (e.clientY - py) * 0.004, 0.08, 0.9);
      px = e.clientX; py = e.clientY;
    };
    S.camUp = () => { dragging = false; if (dom) dom.style.cursor = 'grab'; };
    window.addEventListener('pointermove', S.camMove);
    window.addEventListener('pointerup', S.camUp);
    dom.addEventListener('wheel', e => { e.preventDefault(); if (S) S.cam.dist = clamp(S.cam.dist + e.deltaY * 0.01, 6, 22); }, { passive: false });

    restart('save'); resize();
    window.addEventListener('resize', resize);
    $('#s3-play').onclick = () => { if (S.t >= END) restart(); else S.playing = !S.playing; };
    $('#s3-restart').onclick = () => restart();
    document.querySelectorAll('[data-mode3]').forEach(b => { b.onclick = () => restart(b.dataset.mode3); });
    document.querySelectorAll('[data-sp3]').forEach(b => { b.onclick = () => { S.speed = Number(b.dataset.sp3); document.querySelectorAll('[data-sp3]').forEach(x => x.classList.toggle('on', x === b)); }; });
    S.raf = requestAnimationFrame(frame);
  };
})();
