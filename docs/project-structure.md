# Project structure

A generated repository has the following layout:

```text
my-world/
├── anyo.project.json
├── world.anyo.json
├── assets/
├── web-surface/
├── scripts/
│   ├── dev.mjs
│   ├── validate.mjs
│   ├── bundle.mjs
│   └── anyo-documents.mjs
├── package.json
├── package-lock.json  # created by npm install
├── .gitignore
└── README.md
```

Atlas and both modes also create `atlas.world.json`. The `--modular` flag adds `models/`, and `--web-surface` creates an application beneath `web-surface/`.

## World file

`world.anyo.json` is the main World 0.9 document and the entry point for World Loader. Keep it at the repository root. It contains the scene, materials, entities and other authored world data.

## Project manifest

`anyo.project.json` helps authoring tools locate the world and its folders. A standalone world can still be loaded without this manifest.

```json
{
  "schema": "anyo-project@1",
  "id": "my-world",
  "title": "My World",
  "world": "./world.anyo.json",
  "directories": {
    "assets": "./assets/",
    "webSurfaces": "./web-surface/"
  }
}
```

Atlas and both projects include the additional `manifests` property:

```json
{
  "atlas": "./atlas.world.json"
}
```

Keep editor-session state in `.anyo/`, which is ignored by Git. The project manifest does not store rendering backends or editor state, or require a particular Web Surface framework.

## Atlas manifest

`atlas.world.json` holds geographic placement and map identity. Use an exact OSM building ID when the world should replace a specific building. Without one, Atlas can discover the world near its coordinates without claiming an arbitrary building.

Atlas worlds include map entrance/exit components and an authored entrance selector. The building opening defines the actual door geometry. Loader-only worlds do not need these geographic fields.

## Schemas

The generator's repository contracts are available in [`contracts/`](../contracts/). The world and native object schemas belong to the Anyo core package, rather than being duplicated here.

New projects pin the Anyo validation tooling in `package.json`. Run `npm install` to create your project’s lockfile from npm registry metadata, then commit it and use `npm ci` for reproducible installations. Regenerating with `--force` leaves existing lockfiles untouched; run `npm install` if the manifest has changed.
