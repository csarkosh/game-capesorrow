<h1 align="center">Cape Sorrow</h1>

<p align="center"><em>A grey stretch of coast; a folder of reports nobody believed; and the slow suspicion that some of them were true.</em></p>

You are a detective who investigates paranormal reports across the Pacific Northwest, in an open, procedurally
generated coastal Washington. It is part PNW life and detective sim, part supernatural horror.

**In development.** Nothing of the game exists yet beyond its title page. It will be played in the browser at
[games.csarko.sh/capesorrow](https://games.csarko.sh/capesorrow), where the page says as much until there is something to
play.

## Running it

You need Node 22 (see `engines` in `package.json`).

```
npm ci
npm run dev
```

`npm run dev` starts the game's development server and the dev client together, and serves the title page at
<http://localhost:5174/>. In development, Play starts the engine's empty game, a walkable yard, which stands in until the
game has a world of its own. Two browser tabs can join each other through the dev server.

Other scripts: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (the client and tools suites).

## Built on

[`@csarkosh/engine`](https://github.com/csarkosh/engine), the browser game engine under the sister game
[Day Hike](https://games.csarko.sh/dayhike): TypeScript, drawing with Babylon Lite on WebGPU, WebRTC netcode between
peers and a deterministic simulation. [`ARCHITECTURE.md`](ARCHITECTURE.md) says how the game sits on it.

## Licence

GPL-3.0-only; see [`LICENSE`](LICENSE). The works of others the game and the engine carry are credited under their own
licences in [`CREDITS.md`](CREDITS.md) and in the engine's, and on the game's Credits screen.
