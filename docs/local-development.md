# Local development

Inside your generated world, install the tooling and start the server:

```sh
npm install
npm run dev
```

The default address is `http://127.0.0.1:4174/`. In Loader mode, the root serves `world.anyo.json`; in Atlas and both modes, it serves `atlas.world.json`. Both files are also accessible by their explicit paths when present.

## Preview in 3D

In a separate terminal, open your Anyo World Loader checkout and run its development server (install its dependencies first):

```sh
npm run dev
```

With the default Loader port 5173 and world port 4174, the preview URL is:

```text
http://localhost:5173/?registryRoot=http%3A%2F%2F127.0.0.1%3A4174%2F
```

The world server prints this URL when it starts. If the Loader uses a different port, update the first port in the URL. Edit the JSON or assets and refresh the Loader. The generator does not include a browser renderer or automatic live reload.

For Atlas, run your Atlas host separately and use the local manifest link in the generated README. Update its manifest URL if you change the world server port.

## Change the world port

```sh
npm run dev -- --port=4175
```

You can run more than one world on different ports. The server provides CORS and disables caching for development. It is for local testing, not a production web server.

## Check your work

```sh
npm run validate
npm run bundle
```

Or run both with `npm run check`. See [world authoring](world-authoring.md) for the difference between your source and bundled JSON.
