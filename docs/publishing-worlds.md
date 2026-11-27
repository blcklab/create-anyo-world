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

## Static hosting

GitHub Pages is optional. You may also serve the repository's public world files from any HTTPS static host that supports cross-origin requests from your Loader. Publish `anyo.project.json`, `world.anyo.json`, the assets, imported objects and registered Web Surface applications, retaining their relative directory layout. Include `atlas.world.json` when needed.

In World Loader, enter the hosted directory in **World URL**, or use `?registryRoot=` with the URL-encoded directory. The host must serve the real binary files, not Git LFS pointer text. Do not expose secrets, local development records or `node_modules/`. The project dev server is only for local development.

Before publishing, confirm that you have permission to distribute every asset. Test the branch and a pinned tag in the Loader; a successful local build does not establish CDN or browser compatibility.
