# create-anyo-world

Create JSON-first 3D world projects for [Anyo](https://github.com/blcklab/anyo), Anyo World Loader, and Atlas. Start with a single world file, or organize a larger world into reusable objects. The CLI has no runtime dependencies.

## Getting started

Use Node.js 20 or newer. Run `npm create anyo-world@latest` for interactive setup, or specify a name and options:

```sh
npm create anyo-world@latest my-world -- --mode=loader
cd my-world
npm install
npm run dev
```

Your world is available at `http://127.0.0.1:4174/world.anyo.json`.

To see it in 3D, start Anyo World Loader separately and open the preview URL printed by the dev server. Edit `world.anyo.json`, then refresh the Loader. See [local development](docs/local-development.md) for the full setup.

## Choose a project

| Mode | Use it for |
| --- | --- |
| `loader` | Standalone worlds without a geographic location |
| `atlas` (named command default) | Worlds placed on a real map |
| `both` | Geographic worlds intended for both Atlas and World Loader |

The interactive setup defaults to Loader. Existing named commands without `--mode` retain the Atlas default.

Add `--modular` to start with a reusable Anyo object, or `--web-surface=dashboard` to include an interactive HTML/CSS/JS application.

## Project commands

Run these inside your generated world:

| Command | What it does |
| --- | --- |
| `npm run dev` | Serve JSON and assets locally |
| `npm run validate` | Check world, imports and repository metadata |
| `npm run bundle` | Write a single bundled world to `dist/world.anyo.json` |
| `npm run check` | Validate and bundle |

Add `--avatars` and/or `--animations` to include optional character catalogs, with no bundled binary assets.

## Documentation

- [Getting started](docs/getting-started.md)
- [CLI options](docs/cli.md)
- [Project structure and manifests](docs/project-structure.md)
- [Local development](docs/local-development.md)
- [JSON world authoring](docs/world-authoring.md)
- [Web Surfaces](docs/web-surfaces.md)
- [Publishing a world repository](docs/publishing-worlds.md)
- [World-owned characters](docs/world-characters.md)

## Contributing

Clone the repository, run `npm ci`, then `npm run check`. To try the generator from source, run `npm run dev -- my-world --mode=loader`.

## License

[MIT](LICENSE)
