# Getting started

Install Node.js 20 or newer. Run `npm create anyo-world@latest` to choose a target interactively, or create a standalone world with:

```sh
npm create anyo-world@latest my-world -- --mode=loader
cd my-world
npm install
npm run check
npm run dev
```

Open the preview link printed in the terminal after starting Anyo World Loader separately. The local server hosts the JSON and assets; the Loader renders the world. See [local development](local-development.md).

## Make it yours

Open `world.anyo.json` in your editor and change the starter scene. You can keep the entire world in this file. Add models, images or audio to `assets/` and refer to them using relative paths. Run `npm run validate` to catch invalid data.

## Choose a different starter

For a world with reusable native objects:

```sh
npm create anyo-world@latest modular-world -- --mode=loader --modular
```

For an Atlas world, supply latitude and longitude:

```sh
npm create anyo-world@latest map-world -- --mode=atlas --lat=14.556201 --lng=121.024261
```

For both Atlas and World Loader, use `--mode=both` with coordinates. Atlas remains the default for named commands without `--mode` for historical compatibility. Interactive setup defaults to Loader. For a standalone scene, explicitly choose `--mode=loader`.

See the [CLI reference](cli.md) for all options.
