# usage-statusline-claude

A rich, multi-line **status line for [Claude Code](https://docs.claude.com/en/docs/claude-code)** that shows your live **usage limits** (5‑hour + weekly), **context‑window** consumption, and your current **model / directory / git branch** — all rendered with truecolor progress bars and a Powerlevel10k‑style header right in the prompt.

```
 ~/Documents/code/usage-statusline-claude   main *3

Context  ▆▆▆▆▆▆▆▆▆▆▆▆  42%  84k/200k  |  Opus 4.8 (1M context) xhigh
Current  ▆▆▆▆▆▆▆▆▆▆▆▆   8%  Resets in 3h 12m
Weekly   ▆▆▆▆▆▆▆▆▆▆▆▆  21%  Resets in 4d 6h
```

> The first line is a **Powerlevel10k‑style header**: an Apple logo, a folder icon + the full working directory (last segment bold), then a git‑branch icon + branch name + `*N` dirty‑file count. Those icons are [Nerd Font](https://www.nerdfonts.com/) glyphs, so they only render if your terminal uses a Nerd Font (see [Requirements](#requirements)). The `Context` line always shows — even at **0%** on a fresh session — and carries the model name + effort level at its end. The bars are colored (truecolor / 24‑bit) in a real terminal; the example above is plain text.

## Features

- **Usage limits** — pulls your live **5‑hour (`Current`)** and **7‑day (`Weekly`)** utilization from the Claude OAuth usage endpoint, with a "resets in" countdown. Responses are cached for 60s so it stays snappy.
- **Context window** — reads the active session transcript and shows how full the context window is, with escalating hints (`→ wrap up + /save`, `→ /handoff soon`, `→ STOP · /handoff now`). Auto‑detects the **1M context** window. Always visible, even at 0% on a brand‑new session.
- **Powerlevel10k‑style header** — an Apple logo, a folder icon with the **full** working directory (last path segment bold), and a git‑branch icon with the current branch and a `*N` dirty‑file count. The model name + effort level sit at the end of the `Context` line.
- **Zero config tokens** — reads your Claude Code OAuth token automatically from the macOS Keychain, the Linux secret store, `~/.claude/.credentials.json`, or `$CLAUDE_CODE_OAUTH_TOKEN`.
- **Fast & self‑contained** — a single Bash script, no daemons, with on‑disk caching for both usage and context lookups.

## Requirements

- **Claude Code**
- `bash`, `curl`, `jq`, `awk` (jq is the only non‑standard one — install via `brew install jq` or `apt install jq`)
- A **Nerd Font** for the header icons (Apple / folder / git‑branch glyphs). Install one — e.g. `brew install --cask font-meslo-lg-nerd-font` — and select it as your terminal font. Without a Nerd Font the icons show as boxes (□); everything else still works.
- macOS or Linux

## Install

### Quick install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/munkgorn/usage-statusline-claude/main/install.sh | bash
```

This copies `statusline.sh` to `~/.claude/statusline.sh`, makes it executable, and wires up the `statusLine` entry in `~/.claude/settings.json` (your existing settings are preserved and backed up).

### Manual install

1. Download the script into your Claude config directory:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/munkgorn/usage-statusline-claude/main/statusline.sh \
     -o ~/.claude/statusline.sh
   chmod +x ~/.claude/statusline.sh
   ```

2. Add this to `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "bash ~/.claude/statusline.sh"
     }
   }
   ```

3. Restart Claude Code (or start a new session). The status line appears at the bottom of the prompt.

## How it works

On each render, Claude Code pipes a JSON payload (model, cwd, transcript path, …) into the script over stdin. The script then:

1. Builds the Powerlevel10k‑style header from `workspace.current_dir` and `git`.
2. Fetches usage from `https://api.anthropic.com/api/oauth/usage` using your OAuth token (cached at `/tmp/claude/statusline-usage-cache.json` for 60s).
3. Parses the last usage record in the session transcript to estimate context‑window fill (cached per‑transcript), and appends the model name + effort level to that line.

No data leaves your machine except the authenticated usage request to Anthropic's own API.

## Customize

Open `~/.claude/statusline.sh` and tweak:

- **Colors** — the `'\033[38;2;R;G;B'm` truecolor escapes near the top and in each section (e.g. `path_col`, `last_col`, `branch_col`, `dirty_col` for the header).
- **Header icons** — the `p_apple` / `p_folder` / `p_branch` `printf` hex escapes. Swap in other Nerd Font codepoints (encoded as UTF‑8 bytes, e.g. `printf '\xef\x84\xa6'`) if you prefer different glyphs.
- **Bar width** — `bar_width=12` (usage bars) and the `12` passed to `build_bar` for the context bar.
- **Cache TTL** — `cache_max_age=60` (seconds).
- **Context thresholds** — the `50 / 70 / 85` percent breakpoints that drive the color and the `/handoff` hints.

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` and delete `~/.claude/statusline.sh`.

## License

[MIT](LICENSE)
