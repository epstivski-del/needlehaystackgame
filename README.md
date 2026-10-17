# NEEDLE IN A HAYSTACK

A competitive first-person 3D multiplayer scavenger hunt that runs in the browser. Dig through a huge hay field, dodge decoys,
use a metal detector, and claim the hidden needle before your friends do. 2–12 players per room, private rooms with invite links,
five game modes, and an offline practice mode.

## How it is built
| Part | Where | Notes |
|---|---|---|
| Authoritative game engine | `public/shared/engine.js` | Rooms, lobby, host controls, modes, searching, pickups, scoring, timers, detector. Pure ES module. |
| Deterministic world generator | `public/shared/world.js` | Seeded arena (piles, bales, barns, fences, props), collision, reachability checks for needle placement. |
| Server | `server/` | Plain Node 22, **no npm dependencies**: static files, `/health`, and a hand-written RFC 6455 WebSocket at `/ws`. |
| 3D client | `public/js/` | Three.js (instanced hay), first-person controller, HUD, procedural WebAudio sound, lobby/results UI. |
| Practice mode | same engine in the browser | Runs the exact server engine locally; needs no connection and never touches online state. |

Clients only send intents (move, search, pick up). The server decides search outcomes, pickups, scores, timers and winners.
Hidden object coordinates never leave the server until a player has dug the needle up themselves, and the detector sends only
a quantised signal strength.

## Run locally
```
node server/index.js        # http://localhost:3000
npm test                    # engine + real-socket integration tests
```
Invite links look like `https://<host>/r/ABCDE`. The client connects to `wss://<same host>/ws` automatically.

## Deploy (Railway)
Connect this repo to a Railway service. `railway.json` sets the start command and the `/health` check. No environment variables are required
(`PORT` is provided by Railway; optional `MIN_ROUND_SECONDS`, default 30). Railway terminates TLS, so browsers use HTTPS/WSS.
Use a single instance: room state lives in that process's memory.

## Controls
WASD move · Shift sprint · Space jump · E search / pick up · Click scatter hay · Q metal detector · Tab scoreboard · Esc pause.

## Known limits
- Rooms are held in memory: a server restart ends active rooms (players see a reconnect banner, then a clear error).
- Progression is per room session only (cosmetics unlock by needles found in that session). There is no account system or database.
- Avatars are simple low-poly figures.
