# The former path

The game was called Cape Sorrow and lived at `games.csarko.sh/capesorrow` until 2026-11-27. Published
articles still link there. This folder retires that path. It is deployed once, after the game is live at
`/portashton`, so that every old address sends visitors to the new one.

The deploy owns `/capesorrow` only. It replaces the old build there with `dist/index.html` and adds two
301 redirects (`/capesorrow` and `/capesorrow/**` to `/portashton/`). Hosting applies redirects before it
serves files, so the page in `dist/` is only a fallback. Run from the repository root (dry run first):

```bash
node node_modules/@csarkosh/engine/tools/site/deploy.mjs --project fps-csarko --site fps-csarko \
  --path /capesorrow --dir tools/deploy/former-path/dist --rules tools/deploy/former-path/rules.json \
  --message "capesorrow moved to /portashton" --dry-run
```

Then run the same command without `--dry-run`. Check that
`curl -sI https://games.csarko.sh/capesorrow/` answers 301 with `location: /portashton/`.
