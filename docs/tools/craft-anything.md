# Craft Anything (project tool)

[Craft Anything](https://github.com/umor1234/craft-anything) studies a website, app or game with real
inspection tools (pages at every width, layout, colours, fonts, menus; in Deep mode also code and
files) and can have a coding agent build and check a new version against the original. It is a
desktop app, a CLI (`craft-anything-cli`) and an MCP server with ~320 tools. Licence: MIT or Apache-2.0.

For Design Master we use it to study the reference product (blankbuilder.app) and future targets
with evidence instead of guesswork, and to compare our build with the original.

It lives in this repo as a **git submodule** at `tools/craft-anything` (pinned commit; not copied).

## Set up on your computer (once)

1. Get the code (in a fresh clone use `--recurse-submodules`; in an existing clone run):

   ```bash
   git submodule update --init --depth 1 tools/craft-anything
   ```

2. Install Rust **1.97 or newer** (`rustup update`). On Debian/Ubuntu the desktop app also needs:

   ```bash
   sudo apt-get install build-essential libxkbcommon-dev libxkbcommon-x11-0 libwayland-dev libx11-dev libxrandr-dev libxi-dev libgl1-mesa-dev libgtk-3-dev
   ```

3. Install the CLI (puts `craft-anything-cli` on your PATH, in `~/.cargo/bin`). Keep this exact name: Claude Code
   finds the tool server by it.

   ```bash
   cargo install --locked --path tools/craft-anything/apps/craft-anything-cli
   ```

4. Check it:

   ```bash
   craft-anything-cli doctor
   ```

5. Optional, the desktop app:

   ```bash
   cargo run --release --manifest-path tools/craft-anything/Cargo.toml -p craft-anything
   ```

## Using it from Claude Code (MCP)

`.mcp.json` at the repo root registers the server for this project:

```json
{ "mcpServers": { "craft-anything": { "command": "craft-anything-cli", "args": ["mcp", "--project", ".craft/design-master.cany"] } } }
```

Open Claude Code in the repo folder and approve the `craft-anything` server when asked; its tools then appear as
`mcp__craft-anything__…`. Evidence, findings and the journal are kept in `.craft/` (git-ignored, stays on your machine).

- **Clean room** (default): only what a visitor can see (screenshots, visible text, measured layout, colours,
  fonts, opened menus). Nothing inside the target is read.
- **Deep mode** (for private study only): add `"--deep", "--all-tools"` to `args`, e.g.
  `["mcp", "--deep", "--all-tools", "--project", ".craft/design-master.cany"]`. Then it may read a site's
  JavaScript, a program's code and files.
- `craft-anything-cli setup` can also register it with your coding-agent apps globally.

## Useful commands

```bash
craft-anything-cli commands                                  # every tool, by toolset
craft-anything-cli capabilities                              # what this install can do
craft-anything-cli rebuild https://example.com "Recreate this website"   # full study → build → check
craft-anything-cli rebuild https://example.com "Make the header blue" --continue-in "<project folder>"
```

## Updating the tool

```bash
git -C tools/craft-anything fetch --depth 1 origin main && git -C tools/craft-anything checkout FETCH_HEAD
git add tools/craft-anything && git commit -m "Update Craft Anything"
cargo install --locked --path tools/craft-anything/apps/craft-anything-cli
```

## Notes
- Its own contributor rules (`tools/craft-anything/AGENTS.md`, `CLAUDE.md`) apply only when changing Craft
  Anything itself, not when using it.
- Building with a coding agent needs one signed in (e.g. `claude auth login`); `doctor` says what's missing.
- Use what it finds for **functions and behaviour**; Design Master's code, name, logo and assets stay our own.
