# CLI reference

```sh
npm create anyo-world@latest <project-name> -- [options]
```

| Option | Description |
| --- | --- |
| `--mode=atlas\|loader\|both` | Target host. Default: `atlas`. |
| `--title=<name>` | Display title. Defaults to the project name. |
| `--lat=<latitude>` | Latitude in degrees, from -90 to 90. Required for Atlas and both modes. |
| `--lng=<longitude>` | Longitude in degrees, from -180 to 180. Required for Atlas and both modes. |
| `--zoom=<3-20>` | Preferred Atlas map zoom. Default: 20. |
| `--osm=<type/id>` | Exact OpenStreetMap building binding, such as `way/9200000033`. |
| `--github=<owner/repo>` | Repository used to build host links. |
| `--ref=<git-ref>` | Simple branch, tag or commit name for repository links. |
| `--modular` | Include an Object 0.1 example in `models/`. |
| `--web-surface[=<app-id>]` | Include a browser app. Without an ID, uses `dashboard`. |
| `--web-resolution=<quality>` | `360p`, `540p`, `720p` or `1080p`. Default: `hd` (720p). |
| `--force` | Overwrite starter files in an existing project directory. |
| `--version` | Print the CLI version. |
| `--help` | Show help. |

Use `--option=value` for options that take a value. Omit a project name to be prompted for one. Atlas also prompts for missing coordinates.

The Loader-only mode does not accept geographic flags. Use `--web-resolution` only with `--web-surface`. Be careful with `--force`: it can overwrite files you have edited. Use a new directory when trying a different starter.
