import * as THREE from "three";
import { BIOMES, WORLD_HALF_SIZE } from "./worldConfig.js";

function box(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}
function cone(r, h, color) {
  const geo = new THREE.ConeGeometry(r, h, 8);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}
function cyl(r1, r2, h, color) {
  const geo = new THREE.CylinderGeometry(r1, r2, h, 8);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}
function sphere(r, color) {
  const geo = new THREE.SphereGeometry(r, 10, 8);
  const mat = new THREE.MeshLambertMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

function rand(min, max) { return min + Math.random() * (max - min); }

function scatterCircle(count, radius) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return pts;
}

function addShadow(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

function buildTree(x, z, group) {
  const t = new THREE.Group();
  const trunk = addShadow(cyl(0.25, 0.35, 1.6, 0x6b4a2f));
  trunk.position.y = 0.8;
  const leaves = addShadow(cone(1.3, 2.4, 0x2f7d3c));
  leaves.position.y = 2.4;
  t.add(trunk, leaves);
  t.position.set(x, 0, z);
  group.add(t);
}

function buildPalm(x, z, group) {
  const t = new THREE.Group();
  const trunk = addShadow(cyl(0.18, 0.28, 2.6, 0x8a6b3f));
  trunk.rotation.z = rand(-0.08, 0.08);
  trunk.position.y = 1.3;
  t.add(trunk);
  for (let i = 0; i < 5; i++) {
    const frond = addShadow(cone(0.35, 1.8, 0x2f9d4c));
    frond.rotation.z = Math.PI / 2.3;
    frond.rotation.y = (i / 5) * Math.PI * 2;
    frond.position.set(0, 2.6, 0);
    t.add(frond);
  }
  t.position.set(x, 0, z);
  group.add(t);
}

function buildPine(x, z, group) {
  const t = new THREE.Group();
  const trunk = addShadow(cyl(0.2, 0.3, 1.2, 0x5a4028));
  trunk.position.y = 0.6;
  t.add(trunk);
  for (let i = 0; i < 3; i++) {
    const tier = addShadow(cone(1.1 - i * 0.28, 1.4, 0x2f6d4c));
    tier.position.y = 1.4 + i * 1.0;
    t.add(tier);
  }
  const snowCap = addShadow(cone(0.5, 0.5, 0xf5fbff));
  snowCap.position.y = 3.6;
  t.add(snowCap);
  t.position.set(x, 0, z);
  group.add(t);
}

function buildCactus(x, z, group) {
  const t = new THREE.Group();
  const body = addShadow(cyl(0.35, 0.4, 2.0, 0x3f8f4f));
  body.position.y = 1.0;
  t.add(body);
  const arm = addShadow(cyl(0.2, 0.22, 1.0, 0x3f8f4f));
  arm.position.set(0.45, 1.3, 0);
  arm.rotation.z = Math.PI / 2.5;
  t.add(arm);
  t.position.set(x, 0, z);
  group.add(t);
}

function buildBuilding(x, z, group) {
  const w = rand(4, 8), d = rand(4, 8), h = rand(6, 22);
  const colors = [0x9aa0a8, 0x7c8792, 0xb0a898, 0x8f97a3];
  const b = addShadow(box(w, h, d, colors[Math.floor(rand(0, colors.length))]));
  b.position.set(x, h / 2, z);
  group.add(b);
}

function buildBarn(x, z, group) {
  const t = new THREE.Group();
  const base = addShadow(box(4, 3, 5, 0xa23c2e));
  base.position.y = 1.5;
  const roofGeo = new THREE.ConeGeometry(3.6, 2, 4);
  const roof = addShadow(new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0x5c3a2a })));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 4;
  t.add(base, roof);
  t.position.set(x, 0, z);
  group.add(t);
}

function buildPyramid(x, z, group) {
  const geo = new THREE.ConeGeometry(3, 4, 4);
  const m = addShadow(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8b56a })));
  m.rotation.y = Math.PI / 4;
  m.position.set(x, 2, z);
  group.add(m);
}

const BIOME_BUILDERS = {
  city: (group, center, radius) => {
    for (const p of scatterCircle(14, radius * 0.8)) buildBuilding(center.x + p.x, center.z + p.z, group);
  },
  desert: (group, center, radius) => {
    for (const p of scatterCircle(16, radius * 0.85)) buildCactus(center.x + p.x, center.z + p.z, group);
    buildPyramid(center.x + radius * 0.5, center.z - radius * 0.5, group);
    buildPyramid(center.x + radius * 0.35, center.z - radius * 0.3, group);
  },
  snow: (group, center, radius) => {
    for (const p of scatterCircle(18, radius * 0.85)) buildPine(center.x + p.x, center.z + p.z, group);
  },
  tropical: (group, center, radius) => {
    for (const p of scatterCircle(18, radius * 0.85)) buildPalm(center.x + p.x, center.z + p.z, group);
  },
  farmland: (group, center, radius) => {
    for (const p of scatterCircle(10, radius * 0.6)) buildTree(center.x + p.x, center.z + p.z, group);
    buildBarn(center.x + radius * 0.4, center.z + radius * 0.4, group);
    buildBarn(center.x - radius * 0.3, center.z - radius * 0.3, group);
  },
};

export function buildWorld(scene) {
  // Base wilderness ground
  const groundGeo = new THREE.PlaneGeometry(WORLD_HALF_SIZE * 2, WORLD_HALF_SIZE * 2);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x6f9e58 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const propsGroup = new THREE.Group();
  scene.add(propsGroup);

  for (const [key, b] of Object.entries(BIOMES)) {
    const patchGeo = new THREE.CircleGeometry(b.radius, 48);
    const patchMat = new THREE.MeshLambertMaterial({ color: b.color });
    const patch = new THREE.Mesh(patchGeo, patchMat);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(b.center.x, 0.02, b.center.z);
    patch.receiveShadow = true;
    scene.add(patch);

    const builder = BIOME_BUILDERS[key];
    if (builder) builder(propsGroup, b.center, b.radius);
  }

  // Sky
  scene.background = new THREE.Color(0x9fd3f0);
  scene.fog = new THREE.Fog(0x9fd3f0, 140, 420);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(120, 180, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -300;
  sun.shadow.camera.right = 300;
  sun.shadow.camera.top = 300;
  sun.shadow.camera.bottom = -300;
  sun.shadow.camera.far = 500;
  scene.add(sun);

  return { ground };
}
