# usage-statusline-claude

A compact, two‑line **status line for [Claude Code](https://docs.claude.com/en/docs/claude-code)** styled after [Powerlevel10k](https://github.com/romkatv/powerlevel10k): a lean directory/branch header, then a single minimal usage row showing your live **5‑hour + weekly limits** (with a reset countdown), **context‑window** fill, and current **model / effort** — each as a Nerd Font icon + a percentage whose **color** tells you the level, right in the prompt.

```
 ~/Documents/code/usage-statusline-claude   main *3
 ctx 42%    5h 8% 2h13m    week 21% 4d 6h    Opus 4.8 (1M context) xhigh
```

> **Line 1** is a Powerlevel10k‑style header: an Apple logo, a folder icon + the full working directory (last segment bold), then a git‑branch icon + branch name + `*N` dirty‑file count.
>
> **Line 2** is a single compact usage row — **context window** (`ctx`), **5‑hour limit** (`5h`), and **7‑day limit** (`week`), each shown as a Nerd Font icon (gauge / clock / calendar) + a short text label + a percentage — followed by the **model name and effort level**. There are no bars: each percentage is **colored by its fill level** (green → amber → red), so a glance at the color tells you how full each one is. The two rate‑limit segments also show a dim **countdown to reset** (e.g. `2h13m`, `4d 6h`). The context segment always shows, even at **0%** on a fresh session.
>
> The leading glyphs are [Nerd Font](https://www.nerdfonts.com/) icons, so they only render if your terminal uses a Nerd Font (see [Requirements](#requirements)); the `ctx` / `5h` / `week` text labels render everywhere. The percentages are colored (truecolor / 24‑bit) in a real terminal; the example above is plain text.

## Features

- **Usage limits** — reads your live **5‑hour** and **7‑day** utilization straight from the status payload Claude Code provides, shown as an icon + percentage (clock / calendar icons) colored by level, each with a dim **countdown to when the window resets** (`2h13m` / `4d 6h`), computed from the `resets_at` epoch in the payload.
- **Context window** — reads the context‑window fill Claude Code reports; the percentage shifts color (green → amber → red) as it fills. Always visible, even at 0% on a brand‑new session.
- **Color‑coded levels** — every usage percentage (context, 5‑hour, 7‑day) is colored by how full it is: **green** under 50%, **amber** under 85%, **red** above. No bars to read — the color is the gauge.
- **Powerlevel10k‑style header** — an Apple logo, a folder icon with the **full** working directory (last path segment bold), and a git‑branch icon with the current branch and a `*N` dirty‑file count.
- **One‑line usage row** — context (`ctx`), 5‑hour (`5h`), and 7‑day (`week`) usage — each an icon + text label + percentage — plus the model name + effort level, all on a single lean line below the header.
- **Color‑coded effort** — the effort label mirrors the CLI `/effort` palette: `low` gold, `medium` green, `high` periwinkle, `xhigh` violet, and `max` magenta. (Ultracode mode reports as `xhigh`, so it shows the same violet.)
- **No network, no tokens** — everything is read from the JSON Claude Code pipes in on stdin: no API calls, no OAuth token, no caching, no daemons — just one Bash script.

## Requirements

- **Claude Code**
- `bash`, `jq`, `awk` (jq is the only non‑standard one — install via `brew install jq` or `apt install jq`)
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

On each render, Claude Code pipes a JSON payload (model, cwd, git, usage, context, …) into the script over stdin. The script then:

1. Builds the Powerlevel10k‑style header from `workspace.current_dir` and `git`.
2. Reads the **5‑hour / 7‑day** limits (`used_percentage` + the `resets_at` epoch) from `rate_limits` and the **context‑window** fill from `context_window` in the payload.
3. Assembles the compact usage row — context, 5‑hour, 7‑day percentages (colored by level, with a reset countdown) + the model name and effort level.

No network calls and no token — everything comes from the JSON Claude Code already provides. (`rate_limits` only appears for Claude.ai Pro/Max sessions after the first API response, so the last‑known 5h/7d percentages **and their reset times** are cached in `/tmp/claude/statusline-rate.cache` and reused at session start; the segments are only hidden until usage has been seen at least once. Because `resets_at` is an absolute timestamp, the countdown stays accurate even when computed from the cache.)

## Customize

Open `~/.claude/statusline.sh` and tweak:

- **Colors** — the `'\033[38;2;R;G;B'm` truecolor escapes near the top and in each section (e.g. `path_col`, `last_col`, `branch_col`, `dirty_col` for the header; the green / amber / red values inside `level_color` for the usage percentages).
- **Icons** — the `p_apple` / `p_folder` / `p_branch` (header) and `i_ctx` / `i_5h` / `i_7d` (usage row) `printf` hex escapes. Swap in other Nerd Font codepoints (encoded as UTF‑8 bytes, e.g. `printf '\xef\x84\xa6'`) if you prefer different glyphs.
- **Effort colors** — the per‑level colors in the `render_effort` function.
- **Level thresholds** — the `50 / 85` percent breakpoints in `level_color` that drive the green → amber → red color of every usage percentage.

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` and delete `~/.claude/statusline.sh`.

## License

[MIT](LICENSE)
