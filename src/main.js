import * as THREE from "three";
import { buildWorld } from "./world.js";
import { createCharacter } from "./character.js";
import { connect } from "./network.js";
import { createVehicleMesh } from "./vehicle.js";
import { BIOMES, BUSINESSES, JOBS, VEHICLES, biomeAt } from "./worldConfig.js";

// ---------------- DOM ----------------
const loginEl = document.getElementById("login");
const nameInput = document.getElementById("nameInput");
const joinBtn = document.getElementById("joinBtn");
const hudEl = document.getElementById("hud");
const moneyValueEl = document.getElementById("moneyValue");
const biomePanelEl = document.getElementById("biomePanel");
const promptPanelEl = document.getElementById("promptPanel");
const playerListItemsEl = document.getElementById("playerListItems");
const toastEl = document.getElementById("toast");

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2500);
}

joinBtn.addEventListener("click", tryJoin);
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tryJoin(); });
function tryJoin() {
  const name = nameInput.value.trim() || `Wobbler${Math.floor(Math.random() * 1000)}`;
  loginEl.style.display = "none";
  hudEl.classList.remove("hidden");
  startGame(name);
}

// ---------------- Label helper (canvas sprite for icons/labels above markers) ----------------
function makeLabelSprite(text, opts = {}) {
  const { fontSize = 34, padding = 12, bg = "rgba(0,0,0,0.55)", color = "#fff" } = opts;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `bold ${fontSize}px Arial`;
  const w = Math.ceil(ctx.measureText(text).width) + padding * 2;
  const h = fontSize + padding * 2;
  canvas.width = w; canvas.height = h;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, w, h, 12);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(w / 40, h / 40, 1);
  sprite.renderOrder = 999;
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------- Main game ----------------
function startGame(myName) {
  const canvasHolder = document.body;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 800);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  canvasHolder.appendChild(renderer.domElement);

  buildWorld(scene);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------- Local player ----------------
  const myChar = createCharacter(myName);
  scene.add(myChar.group);
  const player = { x: 0, y: 0, z: 0, ry: 0, vy: 0, grounded: true };
  let myId = null;
  let myMoney = 0;
  let myVehicleId = null;

  // ---------------- Camera control (third-person orbit) ----------------
  let camYaw = 0, camPitch = 0.35, camDist = 8;
  let dragging = false, lastPX = 0, lastPY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { dragging = true; lastPX = e.clientX; lastPY = e.clientY; });
  window.addEventListener("pointerup", () => { dragging = false; });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    camYaw -= dx * 0.005;
    camPitch = THREE.MathUtils.clamp(camPitch - dy * 0.005, 0.08, 1.2);
  });
  renderer.domElement.addEventListener("wheel", (e) => {
    camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.01, 3.5, 20);
  }, { passive: true });

  // ---------------- Input ----------------
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyE") handleInteract();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // ---------------- Markers: businesses ----------------
  const businessMarkers = new Map(); // id -> { data, group, label }
  for (const b of BUSINESSES) {
    const group = new THREE.Group();
    group.position.set(b.pos.x, 0, b.pos.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    post.position.y = 1.1;
    group.add(post);
    const label = makeLabelSprite(`${b.icon} ${b.name} — $${b.cost}`);
    label.position.y = 2.8;
    group.add(label);
    scene.add(group);
    businessMarkers.set(b.id, { data: { ...b, ownerName: null }, group, label, baseText: `${b.icon} ${b.name}` });
  }
  function refreshBusinessLabel(id) {
    const m = businessMarkers.get(id);
    if (!m) return;
    const text = m.data.ownerName
      ? `${m.baseText} — owned by ${m.data.ownerName} (+$${m.data.income}/5s)`
      : `${m.baseText} — $${m.data.cost}`;
    const newLabel = makeLabelSprite(text, m.data.ownerName ? { bg: "rgba(20,120,60,0.75)" } : {});
    newLabel.position.copy(m.label.position);
    m.group.remove(m.label);
    m.group.add(newLabel);
    m.label = newLabel;
  }

  // ---------------- Markers: jobs ----------------
  const jobMarkers = new Map();
  for (const j of JOBS) {
    const group = new THREE.Group();
    group.position.set(j.pos.x, 0, j.pos.z);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color: 0xffd23c, emissive: 0x553300 }));
    diamond.position.y = 1.4;
    group.add(diamond);
    const label = makeLabelSprite(`⭐ ${j.name} (+$${j.reward})`, { bg: "rgba(150,110,0,0.75)" });
    label.position.y = 2.4;
    group.add(label);
    scene.add(group);
    jobMarkers.set(j.id, { data: j, group, diamond, cooldownUntil: 0 });
  }

  // ---------------- Vehicles ----------------
  const vehicleEntities = new Map(); // id -> { data, mesh, driverId, target:{x,y,z,ry} }
  for (const v of VEHICLES) {
    const mesh = createVehicleMesh(v);
    mesh.position.set(v.pos.x, 0, v.pos.z);
    scene.add(mesh);
    vehicleEntities.set(v.id, { data: v, mesh, driverId: null, target: { x: v.pos.x, y: 0, z: v.pos.z, ry: 0 } });
  }

  // ---------------- Remote players ----------------
  const remotePlayers = new Map(); // id -> { name, char, target:{x,y,z,ry}, vehicleId, nameTagEl, moving }

  function addNameTag(text) {
    const el = document.createElement("div");
    el.className = "nametag";
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  function addRemotePlayer(p) {
    const char = createCharacter(p.name);
    scene.add(char.group);
    const nameTagEl = addNameTag(p.name);
    remotePlayers.set(p.id, {
      name: p.name, char, vehicleId: p.vehicleId || null,
      target: { x: p.x, y: p.y, z: p.z, ry: p.ry }, moving: false, nameTagEl,
    });
    char.group.visible = !p.vehicleId;
    refreshPlayerList();
  }
  function removeRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    scene.remove(rp.char.group);
    rp.nameTagEl.remove();
    remotePlayers.delete(id);
    refreshPlayerList();
  }
  function refreshPlayerList() {
    const names = [myName, ...[...remotePlayers.values()].map((r) => r.name)];
    playerListItemsEl.innerHTML = names.map((n) => `<div>${n === myName ? "★ " : ""}${escapeHtml(n)}</div>`).join("");
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------------- Networking ----------------
  const net = connect(myName, {
    init(msg) {
      myId = msg.id;
      myMoney = msg.money;
      moneyValueEl.textContent = Math.round(myMoney);
      for (const p of msg.players) addRemotePlayer(p);
      for (const b of msg.businesses) {
        const m = businessMarkers.get(b.id);
        if (m) { m.data.ownerName = b.ownerName; m.data.ownerId = b.ownerId; refreshBusinessLabel(b.id); }
      }
      for (const v of msg.vehicles) {
        const ent = vehicleEntities.get(v.id);
        if (ent) {
          ent.driverId = v.driverId;
          ent.mesh.position.set(v.x, v.y, v.z);
          ent.mesh.rotation.y = v.ry;
          ent.target = { x: v.x, y: v.y, z: v.z, ry: v.ry };
        }
      }
    },
    playerJoined(msg) { addRemotePlayer(msg.player); showToast(`${msg.player.name} joined`); },
    playerLeft(msg) {
      const rp = remotePlayers.get(msg.id);
      if (rp) showToast(`${rp.name} left`);
      removeRemotePlayer(msg.id);
    },
    playerMoved(msg) {
      const rp = remotePlayers.get(msg.id);
      if (!rp) return;
      rp.target.x = msg.x; rp.target.y = msg.y; rp.target.z = msg.z; rp.target.ry = msg.ry;
      rp.moving = msg.anim === "walk";
    },
    playerVehicleChange(msg) {
      const rp = remotePlayers.get(msg.id);
      if (!rp) return;
      rp.vehicleId = msg.vehicleId;
      rp.char.group.visible = !msg.vehicleId;
    },
    businessUpdate(msg) {
      const m = businessMarkers.get(msg.business.id);
      if (!m) return;
      m.data.ownerName = msg.business.ownerName;
      m.data.ownerId = msg.business.ownerId;
      refreshBusinessLabel(msg.business.id);
    },
    moneyUpdate(msg) { myMoney = msg.money; moneyValueEl.textContent = Math.round(myMoney); },
    actionResult(msg) { showToast(msg.reason); },
    vehicleUpdate(msg) {
      const ent = vehicleEntities.get(msg.vehicle.id);
      if (!ent) return;
      ent.driverId = msg.vehicle.driverId;
      if (ent.driverId === myId) {
        myVehicleId = ent.data.id;
        myChar.group.visible = false;
        player.x = ent.mesh.position.x; player.z = ent.mesh.position.z; player.y = 0;
      } else {
        if (myVehicleId === ent.data.id) {
          // I just exited this vehicle
          myVehicleId = null;
          myChar.group.visible = true;
          player.x = ent.mesh.position.x + 2; player.z = ent.mesh.position.z; player.y = 0;
        }
        ent.target = { x: msg.vehicle.x, y: msg.vehicle.y, z: msg.vehicle.z, ry: msg.vehicle.ry };
      }
    },
    chat(msg) { showToast(`${msg.name}: ${msg.text}`); },
    __close() { showToast("Disconnected from server"); },
  });

  // ---------------- Interaction ----------------
  let currentPrompt = null; // { type, id, text }

  function nearestInteractable() {
    const px = player.x, pz = player.z;
    let best = null, bestDist = 4.2;

    if (myVehicleId) {
      return { type: "exitVehicle", id: myVehicleId, text: "[E] Exit vehicle" };
    }

    for (const [id, m] of businessMarkers) {
      const d = Math.hypot(px - m.group.position.x, pz - m.group.position.z);
      if (d < bestDist) {
        bestDist = d;
        best = m.data.ownerName
          ? { type: "none", id, text: `${m.data.icon} ${m.data.name} — owned by ${m.data.ownerName}` }
          : { type: "buyBusiness", id, text: `[E] Buy ${m.data.name} — $${m.data.cost}` };
      }
    }
    for (const [id, m] of jobMarkers) {
      const d = Math.hypot(px - m.group.position.x, pz - m.group.position.z);
      if (d < bestDist) {
        bestDist = d;
        best = { type: "completeJob", id, text: `[E] Start ${m.data.name} (+$${m.data.reward})` };
      }
    }
    for (const [id, ent] of vehicleEntities) {
      if (ent.driverId) continue;
      const d = Math.hypot(px - ent.mesh.position.x, pz - ent.mesh.position.z);
      if (d < bestDist) { bestDist = d; best = { type: "enterVehicle", id, text: "[E] Enter vehicle" }; }
    }
    return best;
  }

  function handleInteract() {
    if (!currentPrompt) return;
    if (currentPrompt.type === "buyBusiness") net.send("buyBusiness", { businessId: currentPrompt.id });
    else if (currentPrompt.type === "completeJob") net.send("completeJob", { jobId: currentPrompt.id });
    else if (currentPrompt.type === "enterVehicle") net.send("enterVehicle", { vehicleId: currentPrompt.id });
    else if (currentPrompt.type === "exitVehicle") net.send("exitVehicle", {});
  }

  // ---------------- Game loop ----------------
  const GRAVITY = -22;
  const MOVE_SPEED = 6.2;
  const JUMP_VEL = 8.2;
  let lastNetSend = 0;
  let clock = new THREE.Clock();

  function updateCamera(targetX, targetY, targetZ) {
    const cx = targetX - Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    const cy = targetY + 1.6 + Math.sin(camPitch) * camDist;
    const cz = targetZ - Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.set(cx, cy, cz);
    camera.lookAt(targetX, targetY + 1.4, targetZ);
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (myVehicleId) {
      driveVehicle(dt);
    } else {
      walkPlayer(dt);
    }

    // interpolate remote players
    for (const rp of remotePlayers.values()) {
      const g = rp.char.group;
      g.position.x = THREE.MathUtils.lerp(g.position.x, rp.target.x, 1 - Math.pow(0.001, dt));
      g.position.z = THREE.MathUtils.lerp(g.position.z, rp.target.z, 1 - Math.pow(0.001, dt));
      g.position.y = rp.target.y;
      g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rp.target.ry, 1 - Math.pow(0.001, dt));
      rp.char.setWobble(dt, true, rp.moving, false);
    }

    // interpolate remote-driven vehicles
    for (const ent of vehicleEntities.values()) {
      if (ent.driverId && ent.driverId !== myId) {
        ent.mesh.position.x = THREE.MathUtils.lerp(ent.mesh.position.x, ent.target.x, 1 - Math.pow(0.001, dt));
        ent.mesh.position.z = THREE.MathUtils.lerp(ent.mesh.position.z, ent.target.z, 1 - Math.pow(0.001, dt));
        ent.mesh.rotation.y = THREE.MathUtils.lerp(ent.mesh.rotation.y, ent.target.ry, 1 - Math.pow(0.001, dt));
      }
    }

    // nametags projection (no tag for self — avoids clutter)
    for (const rp of remotePlayers.values()) updateNameTag(rp.char.tagAnchor, rp.nameTagEl);

    // HUD: biome + interaction prompt
    const biomeKey = biomeAt(player.x, player.z);
    biomePanelEl.textContent = biomeKey ? BIOMES[biomeKey].name : "The Wilds";
    currentPrompt = nearestInteractable();
    if (currentPrompt && currentPrompt.type !== "none") {
      promptPanelEl.textContent = currentPrompt.text;
      promptPanelEl.classList.remove("hidden");
    } else if (currentPrompt && currentPrompt.type === "none") {
      promptPanelEl.textContent = currentPrompt.text;
      promptPanelEl.classList.remove("hidden");
    } else {
      promptPanelEl.classList.add("hidden");
    }

    renderer.render(scene, camera);
  }

  function updateNameTag(anchor, el) {
    if (!el) return;
    const v = new THREE.Vector3();
    anchor.getWorldPosition(v);
    v.project(camera);
    if (v.z > 1) { el.style.display = "none"; return; }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.display = "block";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function walkPlayer(dt) {
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const moving = forward !== 0 || strafe !== 0;

    if (moving) {
      const moveAngle = Math.atan2(strafe, forward) + camYaw;
      const targetRy = moveAngle;
      player.ry = lerpAngle(player.ry, targetRy, 1 - Math.pow(0.0001, dt));
      player.x += Math.sin(moveAngle) * MOVE_SPEED * dt;
      player.z += Math.cos(moveAngle) * MOVE_SPEED * dt;

      // Camera eases in behind the player automatically while walking,
      // unless the player is actively steering it with the mouse.
      if (!dragging) {
        camYaw = lerpAngle(camYaw, player.ry, 1 - Math.pow(0.002, dt));
      }
    }

    let jumped = false;
    if (keys.has("Space") && player.grounded) {
      player.vy = JUMP_VEL;
      player.grounded = false;
      jumped = true;
    }

    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; }

    const half = 338;
    player.x = THREE.MathUtils.clamp(player.x, -half, half);
    player.z = THREE.MathUtils.clamp(player.z, -half, half);

    myChar.group.position.set(player.x, player.y, player.z);
    myChar.group.rotation.y = player.ry;
    myChar.setWobble(dt, player.grounded, moving, jumped);

    updateCamera(player.x, player.y, player.z);

    const now = performance.now();
    if (now - lastNetSend > 80) {
      lastNetSend = now;
      net.send("move", { x: player.x, y: player.y, z: player.z, ry: player.ry, anim: moving ? "walk" : "idle" });
    }
  }

  let vehYaw = 0;
  function driveVehicle(dt) {
    const ent = vehicleEntities.get(myVehicleId);
    if (!ent) { myVehicleId = null; return; }
    const throttle = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const steer = (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0);
    const SPEED = 16, TURN = 2.0;

    if (throttle !== 0) {
      vehYaw += steer * TURN * dt * throttle;
      ent.mesh.position.x += Math.sin(vehYaw) * SPEED * dt * throttle;
      ent.mesh.position.z += Math.cos(vehYaw) * SPEED * dt * throttle;

      // Camera eases in behind the vehicle automatically while driving,
      // unless the player is actively steering it with the mouse.
      if (!dragging) {
        camYaw = lerpAngle(camYaw, vehYaw, 1 - Math.pow(0.002, dt));
      }
    }
    ent.mesh.rotation.y = vehYaw;

    const half = 338;
    ent.mesh.position.x = THREE.MathUtils.clamp(ent.mesh.position.x, -half, half);
    ent.mesh.position.z = THREE.MathUtils.clamp(ent.mesh.position.z, -half, half);

    updateCamera(ent.mesh.position.x, ent.mesh.position.y, ent.mesh.position.z);

    const now = performance.now();
    if (now - lastNetSend > 60) {
      lastNetSend = now;
      net.send("vehicleMove", { x: ent.mesh.position.x, y: ent.mesh.position.y, z: ent.mesh.position.z, ry: vehYaw });
    }
  }

  function lerpAngle(a, b, t) {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  myChar.group.position.set(0, 0, 0);
  requestAnimationFrame(tick);
}
