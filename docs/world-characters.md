# World-owned characters

World Loader supports optional `avatars` and `animations` capabilities inside `anyo.project.json`. Generate a world with either or both flags. They create empty valid catalogs without bundling binary assets. Atlas and both modes also accept the flags (provide coordinates as usual).

```bash
npm create anyo-world@latest my-world -- --mode=loader --avatars --animations
```

For an existing character-enabled generated world, add the other catalog with its included helper:

```bash
node scripts/character-assets.mjs --avatars --animations
```

Add a self-contained VRM or GLB model to `assets/avatars/`. For example, after copying `pilot.vrm`:

```json
{
  "version": 1,
  "default": "pilot",
  "avatars": {
    "pilot": {
      "name": "Pilot",
      "src": "./pilot.vrm",
      "animations": "../animations/animations.json",
      "transform": { "autoFit": true, "targetHeight": 1.7 }
    }
  }
}
```

Add compatible VRMA files to `assets/animations/`, and edit `animations.json`. Example after copying `idle.vrma` and `wave.vrma`:

```json
{
  "version": 4,
  "clips": {
    "idle": { "src": "./idle.vrma", "format": "vrma" },
    "wave": { "src": "./wave.vrma", "format": "vrma" }
  },
  "actions": {
    "idle": { "clip": "idle", "mode": "locomotion" },
    "wave": { "clip": "wave", "mode": "emote" }
  }
}
```

Each avatar can reference its own catalog or use the shared world catalog. GLB supports a named `embeddedClip` instead of external VRMA retargeting. Model/clip paths are relative to their catalog; parent traversal must remain within the project root. No remote URLs, queries, fragments, external buffer/image URIs or symlinks. Export self-contained assets. Optional thumbnails may be PNG/JPEG/WebP up to 512 KiB; model max 64 MiB; clip max 16 MiB, aggregate 64 MiB per catalog. Local author validation checks catalog shape, format, reference containment, file existence and binary containers; it is not a full glTF validator or playback test. An explicit invalid embedded GLB clip fails author validation rather than silently falling back to static display.

```bash
npm run check
npm run dev
```

Start a compatible World Loader separately and use the printed registry-root preview URL. For repository loading, keep the root `anyo.project.json`, `world.anyo.json` and referenced assets together. GitHub Pages is optional. Test the actual model and animation playback in your target browser before publishing. Only publish assets you have permission to distribute.

Set `"default": null` to start without a playable character. Keep the avatar entries so visitors can choose one later. Existing named defaults still auto-load when no preference is saved. A nonempty catalog must explicitly declare null or an existing avatar ID. Use a Loader that supports nullable defaults. No binary files are loaded for an unselected playable avatar.
