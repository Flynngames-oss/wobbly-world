import * as THREE from "three";
import * as CANNON from "cannon-es";

const BLOCK_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xff6fae];

export function randomBlockColor() {
  return BLOCK_COLORS[Math.floor(Math.random() * BLOCK_COLORS.length)];
}

function addShadow(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/**
 * Builds the Three.js mesh + cannon-es body for a sandbox prop.
 * Returns { mesh, body, dynamic, isSpring, isFan } or null for an unknown type.
 */
export function buildProp(type, physics, opts) {
  const { x, y, z, ry = 0, color } = opts;
  const { propMat } = physics;

  if (type === "block") {
    const size = 0.8;
    const mesh = addShadow(new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshLambertMaterial({ color: color ?? randomBlockColor() })
    ));
    const body = new CANNON.Body({
      mass: 8,
      material: propMat,
      shape: new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)),
      position: new CANNON.Vec3(x, y, z),
      angularDamping: 0.4,
      linearDamping: 0.05,
    });
    body.quaternion.setFromEuler(0, ry, 0);
    return { mesh, body, dynamic: true, type };
  }

  if (type === "barrel") {
    const group = new THREE.Group();
    const bodyMesh = addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14),
      new THREE.MeshLambertMaterial({ color: color ?? 0x8a5a2f })
    ));
    group.add(bodyMesh);
    const ringTop = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 14), new THREE.MeshLambertMaterial({ color: 0x3a2a1a })));
    ringTop.position.y = 0.42;
    group.add(ringTop);
    const ringBot = ringTop.clone();
    ringBot.position.y = -0.42;
    group.add(ringBot);
    const body = new CANNON.Body({
      mass: 10,
      material: propMat,
      shape: new CANNON.Cylinder(0.42, 0.42, 1.05, 14),
      position: new CANNON.Vec3(x, y, z),
      angularDamping: 0.5,
      linearDamping: 0.05,
    });
    body.quaternion.setFromEuler(0, ry, 0);
    return { mesh: group, body, dynamic: true, type };
  }

  if (type === "bomb") {
    const group = new THREE.Group();
    const ball = addShadow(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshLambertMaterial({ color: 0x1a1a1a })));
    group.add(ball);
    const fuse = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })));
    fuse.position.y = 0.55;
    group.add(fuse);
    const body = new CANNON.Body({
      mass: 3,
      material: propMat,
      shape: new CANNON.Sphere(0.4),
      position: new CANNON.Vec3(x, y, z),
      angularDamping: 0.3,
      linearDamping: 0.02,
    });
    return { mesh: group, body, dynamic: true, type };
  }

  if (type === "spring") {
    const group = new THREE.Group();
    const base = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 14), new THREE.MeshLambertMaterial({ color: 0x555555 })));
    base.position.y = 0.09;
    group.add(base);
    const coil = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 10), new THREE.MeshLambertMaterial({ color: 0xe74c3c })));
    coil.position.y = 0.4;
    group.add(coil);
    const pad = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 14), new THREE.MeshLambertMaterial({ color: 0xf1c40f })));
    pad.position.y = 0.7;
    group.add(pad);
    const body = new CANNON.Body({
      mass: 0,
      material: propMat,
      shape: new CANNON.Cylinder(0.55, 0.6, 0.85, 14),
      position: new CANNON.Vec3(x, y + 0.4, z),
    });
    body.quaternion.setFromEuler(0, ry, 0);
    return { mesh: group, body, dynamic: false, isSpring: true, type };
  }

  if (type === "fan") {
    const group = new THREE.Group();
    const base = addShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x666666 })));
    base.position.y = 0.45;
    group.add(base);
    const bladeGroup = new THREE.Group();
    bladeGroup.position.y = 1.0;
    for (let i = 0; i < 4; i++) {
      const blade = addShadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.05), new THREE.MeshLambertMaterial({ color: 0x3498db })));
      blade.rotation.z = (Math.PI / 2) * i;
      bladeGroup.add(blade);
    }
    group.add(bladeGroup);
    group.userData.bladeGroup = bladeGroup;
    group.position.set(x, y, z);
    group.rotation.y = ry;
    // No physics body — the fan is a manual force zone handled by the game loop.
    return { mesh: group, body: null, dynamic: false, isFan: true, type };
  }

  return null;
}
