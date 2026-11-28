<h1 align="center">Something Haunts Port Ashton</h1>

<p align="center"><em>A grey stretch of coast; a folder of reports nobody believed; and the slow suspicion that some of them were true.</em></p>

You are a detective who investigates paranormal reports across the Pacific Northwest, in an open, procedurally
generated coastal Washington. It is part PNW life and detective sim, part supernatural horror.

**In development.** So far the game is a title page, a generated port town to walk through and one car to drive; there is
no case to investigate yet. It is played in the browser at
[games.csarko.sh/portashton](https://games.csarko.sh/portashton), where the page says as much above Play until there is something to
play.

## Running it

You need Node 22 (see `engines` in `package.json`).

```
npm ci
npm run dev
```

`npm run dev` starts the game's development server and the dev client together, and serves the title page at
<http://localhost:5174/>. Press Play: you start at the door of the municipal building in a port town generated on the engine's
coast, with its streets, buildings, quay and piers to walk through (the buildings are walls). There is a car at the curb
near the office. Walk up to a door and click to get in; the first to the car sits at the wheel, and another player takes
a seat beside. Drive with W, A, S and D (forward, left, back for brake and reverse, right) and hold Space for the
handbrake, which lets the tail go: pull it into a turn to throw the car round, and let go of the wheel to bring it
straight. F turns the lights on and off, C looks behind while it is held, and V switches a cinematic view of the drive
on and off. Signs, trash cans, benches, pallets and mailboxes give way when the car is driven into them: they slow it, fall over,
and stand back up a little later. A building, a parked vehicle, a dumpster or a utility pole stops it; a building is
left with a mark where it was struck, and a parked vehicle or a dumpster is marked, rocked and shoved a little, for a
while. It will not go faster than
10 m/s in the town's streets yet, nor than 15 m/s on the highway and past the town. Click again to get out once it is
nearly stopped and there is room beside it on ground at the car's level; the car can only be got into when it is nearly
stopped too. Typing `/carhome` in the command bar puts the car back at the office (only
the host can). The town's people answer you: drive at one and they dive out of the way, roll, get up and tell you what they
think of you; walk into one and they are knocked back a step and annoyed; walk past and most greet the detective; and
two who stand, sit or walk together can be overheard. That is all there is to do yet. Two browser tabs can join each other through the dev server.

The towns the game generates can be looked at as maps at <http://localhost:5174/town.html> (a contact sheet of twelve is at
`/town.html?sheet=12&from=1`). That page is for development and is not part of the build.

Other scripts: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (the client and tools suites).

## Built on

[`@csarkosh/engine`](https://github.com/csarkosh/engine), the browser game engine under the sister game
[Day Hike](https://games.csarko.sh/dayhike): TypeScript, drawing with Babylon Lite on WebGPU, WebRTC netcode between
peers and a deterministic simulation. [`ARCHITECTURE.md`](ARCHITECTURE.md) says how the game sits on it.

## Licence

GPL-3.0-only; see [`LICENSE`](LICENSE). The works of others the game and the engine carry are credited under their own
licences in [`CREDITS.md`](CREDITS.md) and in the engine's, and on the game's Credits screen.
