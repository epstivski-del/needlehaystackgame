# NIGHT SHIFT: The Last Bell

First-person horror-comedy in the browser. Solo, 2–12 player co-op, or Monster-vs-Survivors, set on a fictional campus
. Survive until sunrise, find the five Incidents, and ring out the Last Bell.
All characters and events are fictional.

## Run
```
npm install
npm start        # http://localhost:3000
npm test
```
Deployed on Railway (`railway.json`, health check `/health`). Invite links look like `/r/ABCDE`.

## Layout
- `server/` – static files, `/health`, hand-written WebSocket server, authoritative room hub
- `public/shared/sim.js` – game simulation (server, and in-browser for Practice)
- `public/shared/world.js` – campus layout, walls, gates, pathfinding
- `public/js/` – Three.js client (`view.js`, `models.js`, `tex.js`), UI, procedural audio, narration (`content.js`)

## Controls
WASD move · Shift sprint · C crouch · F flashlight · E interact/revive · Q or click throw · 1–6 items · H hide · B shop · T hat · V ping wheel · Esc pause
