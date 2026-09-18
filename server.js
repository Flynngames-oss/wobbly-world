import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import {
  BUSINESSES, JOBS, VEHICLES, STARTING_MONEY, ECONOMY_TICK_MS,
} from "./src/worldConfig.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- Persistent-for-server-lifetime accounts (keyed by lowercase name) ----
/** @type {Map<string, {name:string, money:number}>} */
const accounts = new Map();

function getOrCreateAccount(name) {
  const key = name.toLowerCase();
  if (!accounts.has(key)) {
    accounts.set(key, { name, money: STARTING_MONEY });
  }
  return accounts.get(key);
}

// ---- Live business state ----
const businesses = new Map(
  BUSINESSES.map((b) => [b.id, { ...b, ownerKey: null, ownerName: null }])
);

// ---- Live vehicle state ----
const vehicles = new Map(
  VEHICLES.map((v) => [v.id, { ...v, driverId: null, x: v.pos.x, y: 0, z: v.pos.z, ry: 0 }])
);

// ---- Job cooldowns per account key ----
const jobCooldowns = new Map(); // accountKey -> { jobId: timestamp }

// ---- Live connected players ----
/** @type {Map<string, {ws, id, name, accountKey, x:number,y:number,z:number,ry:number,anim:string,vehicleId:string|null}>} */
const players = new Map();

let nextId = 1;

function send(ws, type, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(type, payload, exceptId = null) {
  const msg = JSON.stringify({ type, ...payload });
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry,
    anim: p.anim, vehicleId: p.vehicleId, money: accounts.get(p.accountKey)?.money ?? 0,
  };
}

function publicBusiness(b) {
  return { id: b.id, ownerId: b.ownerKey, ownerName: b.ownerName };
}

function publicVehicle(v) {
  return { id: v.id, driverId: v.driverId, x: v.x, y: v.y, z: v.z, ry: v.ry };
}

wss.on("connection", (ws) => {
  let player = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const name = String(msg.name || "Wobbler").slice(0, 16).trim() || "Wobbler";
      const account = getOrCreateAccount(name);
      const id = String(nextId++);
      player = {
        ws, id, name: account.name, accountKey: name.toLowerCase(),
        x: 0, y: 0, z: 0, ry: 0, anim: "idle", vehicleId: null,
      };
      players.set(id, player);

      send(ws, "init", {
        id,
        money: account.money,
        players: [...players.values()].filter((p) => p.id !== id).map(publicPlayer),
        businesses: [...businesses.values()].map(publicBusiness),
        vehicles: [...vehicles.values()].map(publicVehicle),
        jobs: JOBS.map((j) => ({ id: j.id })),
      });
      broadcast("playerJoined", { player: publicPlayer(player) }, id);
      return;
    }

    if (!player) return; // must join first

    switch (msg.type) {
      case "move": {
        if (player.vehicleId) return; // can't walk-move while driving
        player.x = msg.x; player.y = msg.y; player.z = msg.z; player.ry = msg.ry; player.anim = msg.anim || "idle";
        broadcast("playerMoved", { id: player.id, x: player.x, y: player.y, z: player.z, ry: player.ry, anim: player.anim }, player.id);
        break;
      }

      case "buyBusiness": {
        const b = businesses.get(msg.businessId);
        const account = accounts.get(player.accountKey);
        if (!b || !account) break;
        if (b.ownerKey) { send(ws, "actionResult", { ok: false, reason: "Already owned" }); break; }
        if (account.money < b.cost) { send(ws, "actionResult", { ok: false, reason: "Not enough money" }); break; }
        account.money -= b.cost;
        b.ownerKey = player.accountKey;
        b.ownerName = account.name;
        send(ws, "moneyUpdate", { money: account.money });
        broadcast("businessUpdate", { business: publicBusiness(b) });
        send(ws, "actionResult", { ok: true, reason: `Bought ${b.name}!` });
        break;
      }

      case "completeJob": {
        const job = JOBS.find((j) => j.id === msg.jobId);
        const account = accounts.get(player.accountKey);
        if (!job || !account) break;
        const cds = jobCooldowns.get(player.accountKey) || {};
        const now = Date.now();
        if (cds[job.id] && now - cds[job.id] < job.cooldownMs) {
          const remaining = Math.ceil((job.cooldownMs - (now - cds[job.id])) / 1000);
          send(ws, "actionResult", { ok: false, reason: `Job on cooldown (${remaining}s)` });
          break;
        }
        cds[job.id] = now;
        jobCooldowns.set(player.accountKey, cds);
        account.money += job.reward;
        send(ws, "moneyUpdate", { money: account.money });
        send(ws, "actionResult", { ok: true, reason: `${job.name}: +$${job.reward}` });
        break;
      }

      case "enterVehicle": {
        const v = vehicles.get(msg.vehicleId);
        if (!v) break;
        if (v.driverId && v.driverId !== player.id) { send(ws, "actionResult", { ok: false, reason: "Vehicle taken" }); break; }
        // free any vehicle this player was already driving
        for (const other of vehicles.values()) if (other.driverId === player.id) other.driverId = null;
        v.driverId = player.id;
        player.vehicleId = v.id;
        broadcast("vehicleUpdate", { vehicle: publicVehicle(v) });
        broadcast("playerVehicleChange", { id: player.id, vehicleId: v.id });
        break;
      }

      case "exitVehicle": {
        const v = vehicles.get(player.vehicleId);
        if (v) {
          v.driverId = null;
          player.x = v.x + 2; player.z = v.z; player.y = 0;
          broadcast("vehicleUpdate", { vehicle: publicVehicle(v) });
        }
        player.vehicleId = null;
        broadcast("playerVehicleChange", { id: player.id, vehicleId: null });
        break;
      }

      case "vehicleMove": {
        const v = vehicles.get(player.vehicleId);
        if (!v || v.driverId !== player.id) break;
        v.x = msg.x; v.y = msg.y; v.z = msg.z; v.ry = msg.ry;
        broadcast("vehicleUpdate", { vehicle: publicVehicle(v) }, player.id);
        break;
      }

      case "chat": {
        const text = String(msg.text || "").slice(0, 140);
        if (text) broadcast("chat", { id: player.id, name: player.name, text });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!player) return;
    for (const v of vehicles.values()) {
      if (v.driverId === player.id) { v.driverId = null; broadcast("vehicleUpdate", { vehicle: publicVehicle(v) }); }
    }
    players.delete(player.id);
    broadcast("playerLeft", { id: player.id });
  });
});

// ---- Economy tick: pay out passive business income to owners (even if offline) ----
setInterval(() => {
  for (const b of businesses.values()) {
    if (!b.ownerKey) continue;
    const account = accounts.get(b.ownerKey);
    if (!account) continue;
    account.money += b.income;
  }
  // push fresh money totals to any connected owners
  for (const p of players.values()) {
    const account = accounts.get(p.accountKey);
    if (account) send(p.ws, "moneyUpdate", { money: account.money });
  }
}, ECONOMY_TICK_MS);

server.listen(PORT, () => {
  console.log(`Wobbly World server listening on http://localhost:${PORT}`);
});
