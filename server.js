const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, game: "World Snake Arena" }));

const PORT = process.env.PORT || 3000;
const ARENA = 2400;
const TICK_MS = 50;
const MAX_PLAYERS = 60;
const FOOD_COUNT = 260;
const players = new Map();
let foods = [];

const COLORS = ["#ffffff", "#ffcc33", "#ff5c8a", "#8d65ff", "#31e0cf", "#ff914d", "#9be15d"];

function rand(min, max) { return Math.random() * (max - min) + min; }
function makeFood() {
  return { id: Math.random().toString(36).slice(2), x: rand(-ARENA/2, ARENA/2), y: rand(-ARENA/2, ARENA/2), size: rand(5, 9), color: COLORS[Math.floor(Math.random()*COLORS.length)] };
}
function makeBody(x, y) {
  return Array.from({ length: 18 }, (_, i) => ({ x: x - i * 13, y }));
}
function cleanName(value) {
  const name = String(value || "Player").replace(/[<>]/g, "").trim().slice(0, 16);
  return name || "Player";
}
function spawnPlayer(id, name) {
  const x = rand(-ARENA/2 + 150, ARENA/2 - 150);
  const y = rand(-ARENA/2 + 150, ARENA/2 - 150);
  players.set(id, {
    id, name, color: COLORS[Math.floor(Math.random()*COLORS.length)],
    x, y, angle: rand(0, Math.PI*2), targetAngle: 0, boost: false,
    body: makeBody(x, y), score: 0, alive: true
  });
}
foods = Array.from({ length: FOOD_COUNT }, makeFood);

io.on("connection", (socket) => {
  socket.emit("welcome", { arena: ARENA, maxPlayers: MAX_PLAYERS });

  socket.on("join", (data) => {
    if (players.has(socket.id)) return;
    if (players.size >= MAX_PLAYERS) {
      socket.emit("join-error", "The arena is full. Please try again later.");
      return;
    }
    const name = cleanName(data && data.name);
    spawnPlayer(socket.id, name);
    socket.emit("joined", { id: socket.id, name });
  });

  socket.on("steer", (data) => {
    const p = players.get(socket.id);
    if (!p || !data) return;
    const a = Number(data.angle);
    if (Number.isFinite(a)) p.targetAngle = a;
    p.boost = Boolean(data.boost);
  });

  socket.on("disconnect", () => players.delete(socket.id));
});

function updatePlayer(p) {
  const turn = Math.atan2(Math.sin(p.targetAngle - p.angle), Math.cos(p.targetAngle - p.angle));
  p.angle += Math.max(-0.10, Math.min(0.10, turn));
  const speed = p.boost && p.score >= 20 ? 4.1 : 2.55;
  if (p.boost && p.score >= 20) p.score = Math.max(0, p.score - 0.12);

  p.x += Math.cos(p.angle) * speed;
  p.y += Math.sin(p.angle) * speed;

  p.body.unshift({ x: p.x, y: p.y });
  const wantedLength = Math.min(100, 18 + Math.floor(p.score / 10));
  if (p.body.length > wantedLength) p.body.length = wantedLength;

  for (let i = 1; i < p.body.length; i++) {
    const prev = p.body[i-1], part = p.body[i];
    const dx = prev.x - part.x, dy = prev.y - part.y;
    const d = Math.hypot(dx, dy);
    if (d > 13) {
      part.x += dx / d * (d - 13);
      part.y += dy / d * (d - 13);
    }
  }
}

function resetPlayer(p) {
  p.score = 0;
  p.x = rand(-ARENA/2 + 150, ARENA/2 - 150);
  p.y = rand(-ARENA/2 + 150, ARENA/2 - 150);
  p.angle = rand(0, Math.PI*2);
  p.targetAngle = p.angle;
  p.body = makeBody(p.x, p.y);
  p.boost = false;
}

function gameTick() {
  const list = Array.from(players.values());
  for (const p of list) updatePlayer(p);

  for (const p of list) {
    // Arena boundary
    if (Math.abs(p.x) > ARENA/2 || Math.abs(p.y) > ARENA/2) {
      resetPlayer(p);
      io.to(p.id).emit("respawn", { reason: "You reached the arena edge!" });
      continue;
    }

    // Eat food
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (Math.hypot(p.x - f.x, p.y - f.y) < 18) {
        foods.splice(i, 1);
        foods.push(makeFood());
        p.score += 10;
      }
    }

    // Hit another player's body (ignore the first few segments)
    let hit = false;
    for (const other of list) {
      if (other.id === p.id) continue;
      for (let i = 4; i < other.body.length; i += 2) {
        if (Math.hypot(p.x - other.body[i].x, p.y - other.body[i].y) < 15) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      resetPlayer(p);
      io.to(p.id).emit("respawn", { reason: "Another snake hit you!" });
    }
  }

  const publicPlayers = Array.from(players.values()).map(p => ({
    id: p.id, name: p.name, color: p.color, x: p.x, y: p.y,
    angle: p.angle, body: p.body, score: Math.floor(p.score)
  }));
  const leaderboard = publicPlayers
    .slice().sort((a,b) => b.score - a.score).slice(0, 10)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
  io.emit("state", {
    players: publicPlayers,
    foods,
    leaderboard,
    online: players.size,
    arena: ARENA
  });
}
setInterval(gameTick, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`World Snake Arena running on port ${PORT}`);
});
