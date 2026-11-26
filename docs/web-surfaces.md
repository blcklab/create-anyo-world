# Web Surfaces

A Web Surface lets a world reference a browser application. To scaffold one:

```sh
npm create anyo-world@latest research-room -- --mode=loader --web-surface=dashboard --web-resolution=full-hd
```

The project includes `web-surface/dashboard/` with `index.html`, `style.css`, `app.js`, an assets folder and `web-surface.json`:

```json
{
  "schema": "anyo-web-app@1",
  "id": "dashboard",
  "title": "Research Room Dashboard",
  "entry": "./index.html"
}
```

The generated world includes a matching Web Surface entity and a fallback SVG image. World Loader discovers the application by its ID under `web-surface/`.

## Use your preferred framework

The starter uses plain HTML, CSS and JavaScript. You can replace it with a built Vue, React, Porma or other browser app. Point the manifest at its browser-ready entry, such as `./dist/index.html`, and keep the entry within the app directory. Commit the files needed by the browser. Do not embed executable HTML in the world JSON.

## Resolution

| Option | Requested size |
| --- | --- |
| `360p` / `low` | 640 × 360 |
| `540p` / `balanced` | 960 × 540 |
| `720p` / `hd` (default) | 1280 × 720 |
| `1080p` / `full-hd` | 1920 × 1080 |

The runtime controls actual rendering and adaptive quality. Browser security and the host's sandbox rules still apply.
