# Publishing a world repository

Your world is a regular Git repository. You do not need to publish it as an npm package.

1. Run `npm install` and `npm run check` in your world folder.
2. Commit the root JSON files, assets, imported objects, scripts, `package.json` and lockfile. Include any Web Surface app's browser-ready files.
3. Push to a public GitHub repository accessible to your host.

Do not commit `node_modules/`, `.anyo/`, secrets, or the root `dist/` folder by default. Keep `world.anyo.json` at the root. For Atlas, keep `atlas.world.json` there too.

## Open the published world

In World Loader, open the repository route:

```text
/OWNER/REPOSITORY
```

For a stable version, push a Git tag and include its ref in the route:

```text
/OWNER/REPOSITORY?ref=v1.0.0
```

If you scaffolded with `--github=OWNER/REPOSITORY`, the generator includes the relevant links in your README. Atlas projects also receive local and repository manifest links when applicable.
