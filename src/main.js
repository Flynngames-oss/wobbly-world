import * as THREE from "three";
import { buildWorld } from "./world.js";
import { createCharacter } from "./character.js";
import { connect } from "./network.js";
import { createVehicleMesh } from "./vehicle.js";
import {
  BIOMES, BUSINESSES, JOBS, VEHICLES, biomeAt,
  CREATIONS_ZONE, CREATION_TOOLS, inCreationsZone,
} from "./worldConfig.js";
import { createPhysicsWorld, CANNON } from "./physics.js";
import { buildProp, randomBlockColor } from "./sandboxProps.js";

// Opt-in debug hook (only active with ?debug=1) used by the automated smoke test
// to exercise the sandbox build flow without walking across the whole map.
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1";

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
const creationsPanelEl = document.getElementById("creationsPanel");
const toolRowEl = document.getElementById("toolRow");

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

  // ---------------- Physics world ----------------
  const physics = createPhysicsWorld();

  // ---------------- Local player ----------------
  const PLAYER_RADIUS = 0.55;
  const myChar = createCharacter(myName);
  scene.add(myChar.group);

  const playerBody = new CANNON.Body({
    mass: 6,
    material: physics.playerMat,
    shape: new CANNON.Sphere(PLAYER_RADIUS),
    position: new CANNON.Vec3(0, PLAYER_RADIUS, 0),
    linearDamping: 0.25,
    angularDamping: 0.9,
    fixedRotation: true,
    // The player body must never go to sleep: cannon-es freezes both position AND velocity
    // integration for a sleeping body (Body.integrate() bails out entirely), and while asleep
    // it only auto-wakes via a contact with another awake dynamic body — resting on the
    // (static) ground doesn't count. Direct property writes like the debug teleport() or the
    // explosion/spring/fan impulses (which mutate .velocity directly rather than going through
    // applyImpulse) don't call wakeUp() either, so a player who stood still long enough to fall
    // asleep would get "launched" with a velocity that never actually moves them.
    allowSleep: false,
  });
  playerBody.updateMassProperties();
  physics.world.addBody(playerBody);

  let grounded = false;
  // Scanning world.contacts after each step (rather than reacting to the 'collide' event)
  // because cannon-es only dispatches 'collide' when a contact pair first forms, not on every
  // step a resting contact persists — an event-flag approach reads "grounded" for one frame on
  // landing and then silently goes stale while the player is calmly standing still.
  function updateGrounded() {
    grounded = false;
    for (const c of physics.world.contacts) {
      if (c.bi !== playerBody && c.bj !== playerBody) continue;
      const normalY = c.bi === playerBody ? -c.ni.y : c.ni.y;
      if (normalY > 0.5) { grounded = true; break; }
    }
  }

  const player = { x: 0, y: 0, z: 0, ry: 0 };
  let myId = null;
  let myMoney = 0;
  let myVehicleId = null;

  // Ragdoll "tumble" mode: physics fully owns rotation while flying/bouncing/exploding.
  let tumbling = false;
  let tumbleUntil = 0;
  function startTumble(ms) {
    if (!tumbling) {
      tumbling = true;
      playerBody.fixedRotation = false;
      playerBody.updateMassProperties();
    }
    tumbleUntil = Math.max(tumbleUntil, performance.now() + ms);
  }
  function endTumble() {
    tumbling = false;
    const q = playerBody.quaternion;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    playerBody.quaternion.setFromEuler(0, yaw, 0);
    playerBody.angularVelocity.set(0, 0, 0);
    playerBody.fixedRotation = true;
    playerBody.updateMassProperties();
    player.ry = yaw;
  }

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

  // ---------------- Crazy Creations: tool selection ----------------
  let selectedTool = CREATION_TOOLS[0].id;
  function buildToolRow() {
    toolRowEl.innerHTML = "";
    for (const t of CREATION_TOOLS) {
      const el = document.createElement("div");
      el.className = "toolIcon" + (t.id === selectedTool ? " selected" : "");
      el.textContent = t.icon;
      el.title = `${t.name} [${t.key}]`;
      el.addEventListener("click", () => selectTool(t.id));
      toolRowEl.appendChild(el);
    }
  }
  function selectTool(id) {
    selectedTool = id;
    buildToolRow();
  }
  buildToolRow();

  // ---------------- Input ----------------
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyE") handleInteract();
    if (e.code === "KeyF") placeSelectedTool();
    const toolByKey = CREATION_TOOLS.find((t) => t.key === e.key);
    if (toolByKey) selectTool(toolByKey.id);
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

  // ---------------- Sandbox props (Crazy Creations) ----------------
  const sandboxProps = new Map(); // id -> entry
  const flashes = [];
  let lastPropSync = 0;

  function addSandboxProp(p) {
    if (sandboxProps.has(p.id)) return;
    const built = buildProp(p.type, physics, { x: p.x, y: p.y, z: p.z, ry: p.ry, color: p.color ?? undefined });
    if (!built) return;
    built.mesh.position.set(p.x, p.y, p.z);
    built.mesh.rotation.y = p.ry || 0;
    scene.add(built.mesh);

    const isMine = p.ownerId === myId;
    const entry = {
      id: p.id, type: p.type, mesh: built.mesh, body: built.body,
      dynamic: built.dynamic, isSpring: built.isSpring, isFan: built.isFan,
      isMine, fuseAt: p.type === "bomb" ? performance.now() + 2200 : null,
      target: { x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw },
    };

    if (built.body) {
      if (!isMine && built.dynamic) {
        built.body.type = CANNON.Body.KINEMATIC;
        built.body.mass = 0;
        built.body.updateMassProperties();
      }
      physics.world.addBody(built.body);
      if (built.isSpring) {
        built.body.addEventListener("collide", (e) => onSpringCollide(entry, e));
      }
    }
    sandboxProps.set(p.id, entry);
  }

  function removeSandboxProp(id, explode) {
    const entry = sandboxProps.get(id);
    if (!entry) return;
    if (explode) spawnExplosionFlash(entry.mesh.position.clone());
    scene.remove(entry.mesh);
    if (entry.body) physics.world.removeBody(entry.body);
    sandboxProps.delete(id);
  }

  const SPRING_LAUNCH = 15;
  function onSpringCollide(entry, e) {
    const other = e.body;
    if (other === playerBody) {
      if (other.velocity.y < 2) other.velocity.y = SPRING_LAUNCH;
      startTumble(900);
      return;
    }
    for (const p of sandboxProps.values()) {
      if (p.isMine && p.dynamic && p.body === other) {
        if (other.velocity.y < 2) other.velocity.y = SPRING_LAUNCH * 0.8;
        return;
      }
    }
  }

  const FAN_LIFT = 9, FAN_RADIUS = 2.3, FAN_HEIGHT = 16;
  function applyFanForces(dt) {
    for (const entry of sandboxProps.values()) {
      if (!entry.isFan) continue;
      const bg = entry.mesh.userData.bladeGroup;
      if (bg) bg.rotation.y += dt * 14;
      const fx = entry.mesh.position.x, fz = entry.mesh.position.z, fy = entry.mesh.position.y;
      const candidates = [];
      if (!myVehicleId) candidates.push(playerBody);
      for (const p of sandboxProps.values()) if (p.isMine && p.dynamic) candidates.push(p.body);
      for (const b of candidates) {
        const dx = b.position.x - fx, dz = b.position.z - fz, dy = b.position.y - fy;
        if (dy < -0.3 || dy > FAN_HEIGHT) continue;
        if (Math.hypot(dx, dz) > FAN_RADIUS) continue;
        if (b.velocity.y < FAN_LIFT) b.velocity.y = FAN_LIFT;
        if (b === playerBody && !tumbling) startTumble(300);
      }
    }
  }

  const BOMB_RADIUS = 7, BOMB_STRENGTH = 18;
  function explodeBomb(entry) {
    const pos = entry.body.position;
    const candidates = [{ body: playerBody, isPlayer: true }];
    for (const p of sandboxProps.values()) {
      if (p.id !== entry.id && p.isMine && p.dynamic) candidates.push({ body: p.body, isPlayer: false });
    }
    for (const c of candidates) {
      const dx = c.body.position.x - pos.x, dy = c.body.position.y - pos.y, dz = c.body.position.z - pos.z;
      const dist = Math.hypot(dx, dy, dz) || 0.001;
      if (dist > BOMB_RADIUS) continue;
      const falloff = 1 - dist / BOMB_RADIUS;
      const strength = BOMB_STRENGTH * falloff;
      const nx = dx / dist, ny = Math.max(dy / dist + 0.4, 0.3), nz = dz / dist;
      c.body.velocity.x += nx * strength;
      c.body.velocity.y += ny * strength;
      c.body.velocity.z += nz * strength;
      if (c.isPlayer) startTumble(1500);
    }
    spawnExplosionFlash(new THREE.Vector3(pos.x, pos.y, pos.z));
    scene.remove(entry.mesh);
    physics.world.removeBody(entry.body);
    sandboxProps.delete(entry.id);
    net.send("propExploded", { id: entry.id });
  }

  function spawnExplosionFlash(position) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa63c, transparent: true, opacity: 0.85 })
    );
    mesh.position.copy(position);
    scene.add(mesh);
    flashes.push({ mesh, born: performance.now() });
  }
  function updateFlashes() {
    const now = performance.now();
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const t = (now - f.born) / 350;
      if (t >= 1) { scene.remove(f.mesh); flashes.splice(i, 1); continue; }
      f.mesh.scale.setScalar(1 + t * 7);
      f.mesh.material.opacity = 0.85 * (1 - t);
    }
  }

  function placeSelectedTool() {
    if (!inCreationsZone(player.x, player.z)) {
      showToast("Head to 🛠️ Crazy Creations to build");
      return;
    }
    const dist = 2.4;
    const px = player.x + Math.sin(player.ry) * dist;
    const pz = player.z + Math.cos(player.ry) * dist;
    const py = player.y + 2.2;
    const color = selectedTool === "block" ? randomBlockColor() : null;
    net.send("spawnProp", { propType: selectedTool, x: px, y: py, z: pz, ry: player.ry, color });
  }

  function updateSandboxProps(dt, now) {
    for (const entry of [...sandboxProps.values()]) {
      if (entry.type === "bomb" && entry.isMine && entry.fuseAt && now >= entry.fuseAt) {
        explodeBomb(entry);
        continue;
      }
      if (entry.dynamic && entry.body) {
        if (entry.isMine) {
          entry.mesh.position.copy(entry.body.position);
          entry.mesh.quaternion.copy(entry.body.quaternion);
        } else {
          entry.mesh.position.lerp(
            new THREE.Vector3(entry.target.x, entry.target.y, entry.target.z),
            1 - Math.pow(0.001, dt)
          );
          if (entry.target.qx !== undefined) {
            const q = new THREE.Quaternion(entry.target.qx, entry.target.qy, entry.target.qz, entry.target.qw);
            entry.mesh.quaternion.slerp(q, 1 - Math.pow(0.001, dt));
          }
          entry.body.position.set(entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z);
          entry.body.quaternion.copy(entry.mesh.quaternion);
        }
      }
    }

    if (now - lastPropSync > 150) {
      lastPropSync = now;
      const list = [];
      for (const entry of sandboxProps.values()) {
        if (!entry.isMine || !entry.dynamic || !entry.body) continue;
        if (entry.body.sleepState === CANNON.Body.SLEEPING) continue;
        list.push({
          id: entry.id,
          x: entry.body.position.x, y: entry.body.position.y, z: entry.body.position.z,
          qx: entry.body.quaternion.x, qy: entry.body.quaternion.y, qz: entry.body.quaternion.z, qw: entry.body.quaternion.w,
        });
      }
      if (list.length) net.send("propsMoved", { list });
    }
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
      for (const p of msg.sandboxProps || []) addSandboxProp(p);
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
        physics.world.removeBody(playerBody);
        player.x = ent.mesh.position.x; player.z = ent.mesh.position.z; player.y = 0;
      } else {
        if (myVehicleId === ent.data.id) {
          // I just exited this vehicle
          myVehicleId = null;
          myChar.group.visible = true;
          player.x = ent.mesh.position.x + 2; player.z = ent.mesh.position.z; player.y = 0;
          playerBody.position.set(player.x, PLAYER_RADIUS + 0.5, player.z);
          playerBody.velocity.set(0, 0, 0);
          playerBody.angularVelocity.set(0, 0, 0);
          physics.world.addBody(playerBody);
        }
        ent.target = { x: msg.vehicle.x, y: msg.vehicle.y, z: msg.vehicle.z, ry: msg.vehicle.ry };
      }
    },
    chat(msg) { showToast(`${msg.name}: ${msg.text}`); },
    propSpawned(msg) { addSandboxProp(msg.prop); },
    propsMoved(msg) {
      for (const item of msg.list) {
        const p = sandboxProps.get(item.id);
        if (!p || p.isMine) continue;
        p.target = { x: item.x, y: item.y, z: item.z, qx: item.qx, qy: item.qy, qz: item.qz, qw: item.qw };
      }
    },
    propExploded(msg) { removeSandboxProp(msg.id, true); },
    propRemoved(msg) { removeSandboxProp(msg.id, false); },
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
  const MOVE_SPEED = 6.2;
  const JUMP_VEL = 8.2;
  let lastNetSend = 0;
  let clock = new THREE.Clock();
  let playerMoving = false;
  let jumpedThisFrame = false;

  function updateCamera(targetX, targetY, targetZ) {
    const cx = targetX - Math.sin(camYaw) * Math.cos(camPitch) * camDist;
    const cy = targetY + 1.6 + Math.sin(camPitch) * camDist;
    const cz = targetZ - Math.cos(camYaw) * Math.cos(camPitch) * camDist;
    camera.position.set(cx, cy, cz);
    camera.lookAt(targetX, targetY + 1.4, targetZ);
  }

  function applyPlayerInput(dt) {
    jumpedThisFrame = false;
    if (tumbling) { playerMoving = false; return; }

    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const moving = forward !== 0 || strafe !== 0;
    playerMoving = moving;

    let vx = 0, vz = 0;
    if (moving) {
      const moveAngle = Math.atan2(strafe, forward) + camYaw;
      player.ry = lerpAngle(player.ry, moveAngle, 1 - Math.pow(0.0001, dt));
      vx = Math.sin(moveAngle) * MOVE_SPEED;
      vz = Math.cos(moveAngle) * MOVE_SPEED;

      // Camera eases in behind the player automatically while walking,
      // unless the player is actively steering it with the mouse.
      if (!dragging) camYaw = lerpAngle(camYaw, player.ry, 1 - Math.pow(0.002, dt));
    }
    playerBody.velocity.x = vx;
    playerBody.velocity.z = vz;

    if (keys.has("Space") && grounded) {
      playerBody.velocity.y = JUMP_VEL;
      jumpedThisFrame = true;
    }
  }

  function syncPlayerFromPhysics(dt) {
    const half = 338;
    if (playerBody.position.x > half) playerBody.position.x = half;
    if (playerBody.position.x < -half) playerBody.position.x = -half;
    if (playerBody.position.z > half) playerBody.position.z = half;
    if (playerBody.position.z < -half) playerBody.position.z = -half;
    if (playerBody.position.y < -20) {
      playerBody.position.set(0, PLAYER_RADIUS + 1, 0);
      playerBody.velocity.set(0, 0, 0);
    }

    player.x = playerBody.position.x;
    player.y = Math.max(0, playerBody.position.y - PLAYER_RADIUS);
    player.z = playerBody.position.z;

    if (tumbling) {
      myChar.group.position.set(player.x, player.y, player.z);
      myChar.group.quaternion.copy(playerBody.quaternion);
      const speed = playerBody.velocity.length();
      if (grounded && speed < 2.2 && performance.now() > tumbleUntil) endTumble();
    } else {
      myChar.group.quaternion.identity();
      myChar.group.position.set(player.x, player.y, player.z);
      myChar.group.rotation.y = player.ry;
    }

    myChar.setWobble(dt, grounded, playerMoving && !tumbling, jumpedThisFrame);

    updateCamera(player.x, player.y, player.z);

    const now = performance.now();
    if (now - lastNetSend > 80) {
      lastNetSend = now;
      const anim = (playerMoving && !tumbling) ? "walk" : "idle";
      net.send("move", { x: player.x, y: player.y, z: player.z, ry: player.ry, anim });
    }
  }

  let tickCount = 0;
  function tick() {
    requestAnimationFrame(tick);
    tickCount++;
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();

    if (myVehicleId) {
      driveVehicleInput(dt);
    } else {
      applyPlayerInput(dt); // uses `grounded` as computed at the end of the previous frame
    }
    applyFanForces(dt);

    physics.world.step(1 / 60, dt, 6);

    if (myVehicleId) {
      driveVehiclePostStep(dt);
    } else {
      updateGrounded(); // reflects contacts from the step that just completed
      syncPlayerFromPhysics(dt);
    }

    updateSandboxProps(dt, now);
    updateFlashes();

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

    // HUD: biome/zone + interaction prompt
    const inZone = inCreationsZone(player.x, player.z);
    creationsPanelEl.classList.toggle("hidden", !inZone);
    const biomeKey = biomeAt(player.x, player.z);
    biomePanelEl.textContent = inZone ? CREATIONS_ZONE.name : (biomeKey ? BIOMES[biomeKey].name : "The Wilds");
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

  let vehYaw = 0;
  function driveVehicleInput(dt) {
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
  }

  function driveVehiclePostStep() {
    const ent = vehicleEntities.get(myVehicleId);
    if (!ent) return;
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

  if (DEBUG) {
    window.__WOBBLY_DEBUG__ = {
      teleport(x, z) { playerBody.position.set(x, PLAYER_RADIUS + 2, z); playerBody.velocity.set(0, 0, 0); playerBody.wakeUp(); },
      selectTool,
      placeSelectedTool,
      getPropCount() { return sandboxProps.size; },
      getPropTypes() { return [...sandboxProps.values()].map((p) => p.type); },
      getPlayerPos() { return { x: player.x, y: player.y, z: player.z }; },
      isTumbling() { return tumbling; },
      getTumbleDiag() {
        return {
          grounded, tumbling,
          speed: playerBody.velocity.length(),
          y: playerBody.position.y,
          vy: playerBody.velocity.y,
          angSpeed: playerBody.angularVelocity.length(),
          msUntilTumbleEnd: tumbleUntil - performance.now(),
          tickCount,
          bodiesInWorld: physics.world.bodies.length,
          playerInWorld: physics.world.bodies.includes(playerBody),
          sleepState: playerBody.sleepState,
          bodyType: playerBody.type,
          mass: playerBody.mass,
          fixedRotation: playerBody.fixedRotation,
        };
      },
    };
  }
}
