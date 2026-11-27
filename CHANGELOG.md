# Changelog

## 0.7.0

- Stable generator release for Anyo World Loader 0.7.0 and World 0.9. Includes optional world-owned avatars and animation catalogs, nullable avatar defaults, portable Loader/Atlas modes, modular objects and Web Surface starters.
- Pin Anyo tooling in generated manifests and let npm create the project lockfile; preserve existing lockfiles when regenerating. Improve interactive setup, preview links and documentation.
- Make regression tests portable across Windows and Linux: invoke npm through Node, handle symlink privileges explicitly, and await development server shutdown.
- No changes to the runtime dependency pins or world contract.

## 0.7.0-rc.3

- Offer an interactive target choice, with Loader as the interactive default while preserving named-command compatibility.
- Reject unknown valued options and extra project names. Print next steps after scaffolding.
- Use the current Loader development port (4173) in preview links and generated documentation.
- Include a starter lockfile for reproducible tooling installs.
- Simplify the optional Web Surface starter and improve keyboard focus.
- Refresh user guides, static hosting instructions and release checks without changing the world contract or dependency pins.

## 0.7.0-rc.2

- Avatar catalog `default: null` starts in first person; existing named defaults remain valid. New avatar scaffolds declare null explicitly. Requires the updated Loader.

## 0.7.0-rc.1

- Optional world-owned avatar and animation catalogs, generated validation and documentation.
- Preserve root entry, dependency pins, existing modes and default scaffold.
- Candidate only; browser and live GitHub acceptance pending.

## 0.6.1

- Create World 0.9 projects with `anyo.project.json` for authoring tools.
- Start with a single JSON file or use `--modular` to add reusable Object 0.1 documents.
- Validate and bundle worlds using Anyo core `0.11.0-rc.37`.
- Preview local worlds in Anyo World Loader `0.6.0-rc.1` using the URL printed by the dev server.
- Keep Atlas placement and repository Web Surface support.
- Restrict the dev server to public project files and add a `check` command to generated worlds.
- Add user guides and support a simple tag-based release workflow.
