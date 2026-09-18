// Shared world config — imported by both server (Node ESM) and client bundle.
// Single source of truth for biome layout, businesses, job pads, and vehicles.

export const BIOMES = {
  city:      { name: "Downtown City",   color: 0x8a8f96, center: { x: 0,    z: 0    }, radius: 95 },
  desert:    { name: "Dusty Desert",    color: 0xdcc27a, center: { x: 240,  z: 0    }, radius: 95 },
  snow:      { name: "Frostpeak",       color: 0xf2f6fa, center: { x: -240, z: 0    }, radius: 95 },
  tropical:  { name: "Palm Cove",       color: 0x4fae6a, center: { x: 0,    z: 240  }, radius: 95 },
  farmland:  { name: "Green Acres",     color: 0xb7a45c, center: { x: 0,    z: -240 }, radius: 95 },
};

// helper to offset a point from a biome center
function off(biome, dx, dz) {
  const c = BIOMES[biome].center;
  return { x: c.x + dx, z: c.z + dz };
}

export const BUSINESSES = [
  { id: "city_shop",     biome: "city",     name: "Corner Shop",     icon: "🏪", cost: 300,  income: 2,   pos: off("city", 30, 20) },
  { id: "city_club",     biome: "city",     name: "Night Club",      icon: "🎧", cost: 900,  income: 7,   pos: off("city", -35, -15) },
  { id: "desert_gas",    biome: "desert",   name: "Gas Station",     icon: "⛽", cost: 400,  income: 3,   pos: off("desert", 25, 25) },
  { id: "desert_mine",   biome: "desert",   name: "Mining Co.",      icon: "⛏️", cost: 950,  income: 7.5, pos: off("desert", -30, -20) },
  { id: "snow_lodge",    biome: "snow",     name: "Ski Lodge",       icon: "🏔️", cost: 550,  income: 4,   pos: off("snow", 30, 20) },
  { id: "snow_icecream", biome: "snow",     name: "Ice Cream Parlor",icon: "🍦", cost: 350,  income: 2.5, pos: off("snow", -25, -25) },
  { id: "tropical_bar",  biome: "tropical", name: "Beach Bar",       icon: "🍹", cost: 450,  income: 3.5, pos: off("tropical", 25, 25) },
  { id: "tropical_surf", biome: "tropical", name: "Surf Shop",       icon: "🏄", cost: 650,  income: 5,   pos: off("tropical", -30, -20) },
  { id: "farm_stand",    biome: "farmland", name: "Farm Stand",      icon: "🥕", cost: 250,  income: 2,   pos: off("farmland", 25, 20) },
  { id: "farm_silo",     biome: "farmland", name: "Grain Silo",      icon: "🌾", cost: 750,  income: 5.5, pos: off("farmland", -30, -25) },
];

export const JOBS = [
  { id: "job_city",     biome: "city",     name: "Courier Run",   reward: 60, cooldownMs: 18000, pos: off("city", 0, -45) },
  { id: "job_desert",   biome: "desert",   name: "Scrap Hauling", reward: 70, cooldownMs: 18000, pos: off("desert", 0, -45) },
  { id: "job_snow",     biome: "snow",     name: "Snow Plowing",  reward: 65, cooldownMs: 18000, pos: off("snow", 0, -45) },
  { id: "job_tropical", biome: "tropical", name: "Fishing Trip",  reward: 65, cooldownMs: 18000, pos: off("tropical", 0, 45) },
  { id: "job_farmland", biome: "farmland", name: "Crop Picking",  reward: 55, cooldownMs: 18000, pos: off("farmland", 0, 45) },
];

export const VEHICLES = [
  { id: "car_city_1",    type: "car",   color: 0xd23c3c, pos: off("city", 0, 40) },
  { id: "car_city_2",    type: "car",   color: 0x2e6fd2, pos: off("city", 10, 40) },
  { id: "buggy_desert",  type: "buggy", color: 0xe0a53c, pos: off("desert", 0, 40) },
  { id: "truck_snow",    type: "truck", color: 0x3c8fd2, pos: off("snow", 0, 40) },
];

export const STARTING_MONEY = 400;
export const ECONOMY_TICK_MS = 5000; // pay out passive business income every 5s
export const WORLD_HALF_SIZE = 340; // ground plane extends -340..340 on x/z

// ---- Crazy Creations: a physics sandbox zone, tucked away from the biomes ----
export const CREATIONS_ZONE = { name: "🛠️ Crazy Creations", center: { x: 240, z: 240 }, radius: 42 };

export const CREATION_TOOLS = [
  { id: "block", name: "Block", icon: "🧱", key: "1" },
  { id: "spring", name: "Spring", icon: "🌀", key: "2" },
  { id: "fan", name: "Fan", icon: "🌬️", key: "3" },
  { id: "bomb", name: "Bomb", icon: "💣", key: "4" },
  { id: "barrel", name: "Barrel", icon: "🛢️", key: "5" },
];

export const MAX_SANDBOX_PROPS = 40;

export function distXZ(x1, z1, x2, z2) {
  return Math.hypot(x1 - x2, z1 - z2);
}

export function inCreationsZone(x, z) {
  return distXZ(x, z, CREATIONS_ZONE.center.x, CREATIONS_ZONE.center.z) <= CREATIONS_ZONE.radius;
}

export function biomeAt(x, z) {
  let best = null;
  let bestDist = Infinity;
  for (const [key, b] of Object.entries(BIOMES)) {
    const dx = x - b.center.x, dz = z - b.center.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= b.radius && d < bestDist) { best = key; bestDist = d; }
  }
  return best; // null = wilderness between biomes
}
