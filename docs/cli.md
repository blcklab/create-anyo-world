# CLI reference

```sh
npm create anyo-world@latest <project-name> -- [options]
```

| Option | Description |
| --- | --- |
| `--mode=atlas\|loader\|both` | Target host. Interactive default: `loader`; named command default: `atlas`. |
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
| `--avatars` | Include an empty world-owned avatar catalog. |
| `--animations` | Include an empty world-owned animation catalog. |
| `--force` | Overwrite starter files in an existing project directory. |
| `--version` | Print the CLI version. |
| `--help` | Show help. |

Use `--option=value` for options that take a value. Omit the project name for interactive setup. Choose Loader, Atlas or both; pressing Enter selects Loader unless geographic options are supplied. Atlas and both modes prompt for missing coordinates. For scripts, provide the name, mode and required coordinates explicitly. Unknown flags and extra positional arguments are rejected.

The Loader-only mode does not accept geographic flags. Use `--web-resolution` only with `--web-surface`. Be careful with `--force`: it can overwrite files you have edited. Use a new directory when trying a different starter.

Both character flags are independent and work with all modes. For setup and asset rules, see [World-owned characters](world-characters.md).
