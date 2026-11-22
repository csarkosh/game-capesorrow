# syntax=docker/dockerfile:1

# The game's server image: the engine's server package and the game's settings, and nothing else.
# It installs from server.package.json (copied in as package.json), which names only the server's
# release tarball, so the engine's own tarball is not in the image. No lockfile is shipped for it;
# a game that wants a pinned image commits one for it. Build with:  docker build -t my-game-server .

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The commit the image was built from, for the telemetry rows the process writes. An argument
# rather than a value set on the service: the service's environment belongs to whatever
# provisions it, and a value a deploy script set there would be a diff on every plan.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
COPY server.package.json package.json
RUN npm install --omit=dev --no-audit --no-fund
# Which game this server serves: the server reads `game.json` under its working directory.
COPY game.json /app/game.json
USER node
# Cloud Run injects PORT; 8080 is the default the server already falls back to.
ENV PORT=8080
CMD ["node", "node_modules/@csarkosh/engine-server/dist/index.js"]
