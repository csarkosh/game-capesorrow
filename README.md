# Cape Sorrow

A game built on [`@csarkosh/engine`](https://github.com/csarkosh/engine) at release 0.2.2, started from the engine's empty game.

```
npm install --legacy-peer-deps
npm run dev:server   # in one terminal
npm run dev          # in another
```

The first install needs `--legacy-peer-deps`: with no lockfile yet, npm (10.9.9 was tried) fails in its own peer resolution without it. It writes `package-lock.json`, after which a plain `npm install` works.

| Script | What it does |
| --- | --- |
| `npm run dev` | Serves the game on a dev server. |
| `npm run dev:server` | The game's server, one process with its rooms in memory. |
| `npm run dev:client` | The same as `npm run dev`. |
| `npm run build` | Builds the game into `dist/`. |
| `npm run typecheck` | `tsc` over the game. |
| `npm test` | The game's tests. |

## Playing together

Run `npm run dev:server` in one terminal and `npm run dev` in another. The page reaches the server through the dev server's proxy (`/ws` and `/t`, to `localhost:8080`), so two browser tabs, or two machines reaching the dev server, can join each other.

`game.json` says which origins may reach the server (http://localhost:5174 to begin with); extend its `allowedOrigins` when the game has a site. `Dockerfile`, `server.package.json` and `.dockerignore` are for the server's image.
