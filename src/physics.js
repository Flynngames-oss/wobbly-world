import * as CANNON from "cannon-es";

/**
 * Sets up a shared cannon-es physics world: gravity, a static ground plane,
 * and the materials used by players and sandbox props.
 */
export function createPhysicsWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  // NaiveBroadphase checks every pair every step. SAPBroadphase is faster at scale, but its
  // incremental sort can miss collision pairs for a step or more right after a body is
  // teleported a long distance (e.g. entering/exiting a vehicle, or the debug teleport used
  // by tests) — with well under 100 bodies in this game, the O(n^2) cost is irrelevant and
  // correctness after a teleport matters more.
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;

  const groundMat = new CANNON.Material("ground");
  const propMat = new CANNON.Material("prop");
  const playerMat = new CANNON.Material("player");

  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, playerMat, { friction: 0.9, restitution: 0.0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, propMat, { friction: 0.55, restitution: 0.25 }));
  world.addContactMaterial(new CANNON.ContactMaterial(propMat, propMat, { friction: 0.4, restitution: 0.2 }));
  world.addContactMaterial(new CANNON.ContactMaterial(propMat, playerMat, { friction: 0.4, restitution: 0.3 }));

  const groundBody = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  return { world, groundBody, groundMat, propMat, playerMat };
}

export { CANNON };
