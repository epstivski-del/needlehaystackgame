# FLOCK RUSH

A competitive 3D multiplayer sheepdog game that runs in the browser. Every player is a dog with a pen on the edge of a big
field. Bark, dash and howl to scare the flock into your pen, steal sheep from rivals' pens, and watch out for thunderstorms
that make the whole flock bolt. 1–12 players per room, private rooms with invite links, three modes, and an offline practice mode.

## Modes
- **Roundup**: every dog has its own pen. Most sheep value in your pen when time runs out wins. Hold 60% of the flock for 8 seconds and you win instantly.
- **Team Roundup**: two teams, one pen each.
- **Stampede**: a bigger, jumpier flock with constant thunderstorms.
- **Practice**: solo, offline, same engine running in your browser.

Black sheep are worth 2, the golden sheep in the middle is worth 5. Bark (click) startles sheep in a cone ahead of you, dash (Space)
barges through the flock and stuns rival dogs, howl (Q) frightens everything nearby. Sprint with Shift; mud slows everyone down.

## How it is built
| Part | Where | Notes |
|---|---|---|
| Authoritative game engine | `public/shared/engine.js` | Rooms, lobby, host controls, modes, movement validation, abilities, scoring, timers, storms, domination. Pure ES module. |
| Field generator | `public/shared/field.js` | Seeded, point-symmetric arena (pens, bales, troughs, rails, mud) so no pen is favoured. Clients rebuild it from the seed. |
| Sheep simulation | `public/shared/sim.js` | Deterministic fixed-step flock AI: fleeing, flocking, panic, mud, collisions, pen settling. |
| Server | `server/` | Plain Node 22: static files, `/health`, and a hand-written RFC 6455 WebSocket at `/ws`. Three.js is installed with the app and served from the game's own origin. |
| 3D client | `public/js/` | Three.js (instanced sheep), third-person dog controller, HUD, minimap, procedural WebAudio, lobby/results UI. |

Clients report where their dog is and ask for actions (bark, dash, howl). The server validates speed and collisions, runs the sheep,
and decides scores and winners.

## Run locally
```
npm install                 # installs three.js (only needed for the 3D client)
node server/index.js        # http://localhost:3000
npm test                    # engine + real-socket integration tests
python3 test/e2e/browser.py # headless-browser tests (Three.js stubbed; needs Playwright)
```
Invite links look like `https://<host>/r/ABCDE`. The client connects to `wss://<same host>/ws` automatically.

## Deploy (Railway)
Connect this repo to a Railway service. `railway.json` sets the start command and the `/health` check. No environment variables are required
(`PORT` is provided by Railway; optional `MIN_ROUND_SECONDS`, default 30). Railway terminates TLS, so browsers use HTTPS/WSS.
Use a single instance: room state lives in that process's memory.
