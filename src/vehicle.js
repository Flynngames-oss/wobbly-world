import * as THREE from "three";

export function createVehicleMesh(config) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: config.color });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

  const scale = config.type === "truck" ? 1.3 : config.type === "buggy" ? 0.9 : 1;

  const bodyH = 0.6 * scale, bodyW = 1.6 * scale, bodyL = 3.2 * scale;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyL), bodyMat);
  body.position.y = 0.55 * scale;
  body.castShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.85, bodyH * 0.9, bodyL * 0.5), bodyMat);
  cabin.position.set(0, 0.55 * scale + bodyH * 0.75, -bodyL * 0.05);
  cabin.castShadow = true;
  group.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.35 * scale, 0.35 * scale, 0.3 * scale, 12);
  const wheelPositions = [
    [-bodyW / 2, 0.3 * scale, bodyL / 2 - 0.5 * scale],
    [bodyW / 2, 0.3 * scale, bodyL / 2 - 0.5 * scale],
    [-bodyW / 2, 0.3 * scale, -bodyL / 2 + 0.5 * scale],
    [bodyW / 2, 0.3 * scale, -bodyL / 2 + 0.5 * scale],
  ];
  for (const [x, y, z] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    wheel.castShadow = true;
    group.add(wheel);
  }

  return group;
}
