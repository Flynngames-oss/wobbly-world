import * as THREE from "three";

// Deterministic color per player id/name so everyone sees the same colors.
export function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
}

/**
 * Builds a squishy blocky "wobbly" character out of primitives.
 * Returns { group, parts, setWobble(t, verticalVel, moveSpeed), setWalking(bool) }
 */
export function createCharacter(name) {
  const color = colorForName(name);

  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffd9b3 });

  const root = new THREE.Group(); // squash/stretch applies here
  group.add(root);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), bodyMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), skinMat);
  head.position.y = 1.95;
  head.castShadow = true;
  root.add(head);

  // simple eyes for character
  const eyeGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.15, 1.98, 0.38);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.15, 1.98, 0.38);
  root.add(eyeL, eyeR);

  function limb(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true;
    return m;
  }

  const armL = limb(0.24, 0.75, 0.24, skinMat);
  const armR = limb(0.24, 0.75, 0.24, skinMat);
  const pivotArmL = new THREE.Group(); pivotArmL.position.set(-0.52, 1.55, 0); pivotArmL.add(armL); armL.position.y = -0.35;
  const pivotArmR = new THREE.Group(); pivotArmR.position.set(0.52, 1.55, 0); pivotArmR.add(armR); armR.position.y = -0.35;
  root.add(pivotArmL, pivotArmR);

  const legL = limb(0.28, 0.8, 0.28, bodyMat);
  const legR = limb(0.28, 0.8, 0.28, bodyMat);
  const pivotLegL = new THREE.Group(); pivotLegL.position.set(-0.22, 0.65, 0); pivotLegL.add(legL); legL.position.y = -0.4;
  const pivotLegR = new THREE.Group(); pivotLegR.position.set(0.22, 0.65, 0); pivotLegR.add(legR); legR.position.y = -0.4;
  root.add(pivotLegL, pivotLegR);

  // Name tag anchor (world position projected to screen by caller)
  const tagAnchor = new THREE.Object3D();
  tagAnchor.position.y = 2.5;
  group.add(tagAnchor);

  let walkT = 0;
  let squash = 0; // current squash amount, eased back to 0
  let prevY = 0;

  function setWobble(dt, isGrounded, isMoving, jumpImpulse) {
    if (jumpImpulse) squash = -0.35; // stretch up on jump
    if (!isGrounded) {
      squash = THREE.MathUtils.lerp(squash, 0.12, dt * 6); // slight squash mid-air falling
    } else {
      squash = THREE.MathUtils.lerp(squash, 0, dt * 10);
    }
    const s = 1 + squash;
    root.scale.set(1 - squash * 0.4, s, 1 - squash * 0.4);

    if (isMoving && isGrounded) {
      walkT += dt * 8;
    } else {
      walkT = THREE.MathUtils.lerp(walkT, Math.round(walkT / Math.PI) * Math.PI, dt * 10);
    }
    const swing = Math.sin(walkT) * 0.6;
    pivotLegL.rotation.x = swing;
    pivotLegR.rotation.x = -swing;
    pivotArmL.rotation.x = -swing * 0.8;
    pivotArmR.rotation.x = swing * 0.8;

    // gentle idle wobble of torso/head for the "wobbly" charm
    const idle = Math.sin(performance.now() * 0.003) * 0.03;
    torso.rotation.z = idle;
    head.rotation.z = idle * 1.5;
  }

  return { group, root, setWobble, tagAnchor, color };
}
