# JSON world authoring

New projects start with a World 0.9 document at `world.anyo.json`. You can edit it directly and use the [Anyo](https://github.com/blcklab/anyo) world format for materials, geometry, entities and resources. Keep asset paths relative to the document that declares them.

## Modular worlds

To start with a reusable Object 0.1 example:

```sh
npm create anyo-world@latest my-world -- --mode=loader --modular
```

This adds `models/centerpiece.anyo.json`. The root world references the object with an import:

```json
{
  "imports": {
    "centerpiece": {
      "src": "./models/centerpiece.anyo.json"
    }
  }
}
```

The snippet shows the imports property only; it is not a complete world. Use the generated scene as a working example. Imported materials and compositions are scoped by Anyo.

## Validation

```sh
npm run validate
```

The generated project uses `@blcklab/anyo` to inspect the world and resolve imports. It also checks the project manifest, optional Atlas manifest and repository Web Surface references. Local tooling only loads object imports within the project directory; it does not fetch remote object imports implicitly.

## Bundling

```sh
npm run bundle
```

The result is `dist/world.anyo.json`. It resolves local object imports into a deterministic document without an imports map, keeping external assets separate and rewriting local resource paths relative to the bundle. It does not overwrite the root `world.anyo.json`.

Commit the source world and its imported objects, not the generated `dist/` folder by default. The root world is still the normal repository entry.
