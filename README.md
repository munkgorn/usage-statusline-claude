# usage-statusline-claude

A compact, two‑line **status line for [Claude Code](https://docs.claude.com/en/docs/claude-code)** styled after [Powerlevel10k](https://github.com/romkatv/powerlevel10k): a lean directory/branch header, then a single usage row showing your live **5‑hour + weekly limits**, **context‑window** fill, and current **model / effort** — all as truecolor mini‑bars right in the prompt.

```
 ~/Documents/code/usage-statusline-claude   main *3
 ■■□□□ 42%    □□□□□ 8%    ■□□□□ 21%    Opus 4.8 (1M context) xhigh
```

> **Line 1** is a Powerlevel10k‑style header: an Apple logo, a folder icon + the full working directory (last segment bold), then a git‑branch icon + branch name + `*N` dirty‑file count.
>
> **Line 2** is a single compact usage row — **context window**, **5‑hour limit**, and **7‑day limit**, each shown as a Nerd Font icon (gauge / clock / calendar) + a 5‑cell mini‑bar + percentage — followed by the **model name and effort level**. The context segment always shows, even at **0%** on a fresh session, and shifts color (cyan → yellow → red) as it fills.
>
> The icons are [Nerd Font](https://www.nerdfonts.com/) glyphs, so they only render if your terminal uses a Nerd Font (see [Requirements](#requirements)). The bars are colored (truecolor / 24‑bit) in a real terminal; the example above is plain text.

## Features

- **Usage limits** — reads your live **5‑hour** and **7‑day** utilization straight from the status payload Claude Code provides, shown as compact mini‑bars + percentage (clock / calendar icons).
- **Context window** — reads the context‑window fill Claude Code reports and shifts color (cyan → yellow → red) as it fills. Always visible, even at 0% on a brand‑new session.
- **Powerlevel10k‑style header** — an Apple logo, a folder icon with the **full** working directory (last path segment bold), and a git‑branch icon with the current branch and a `*N` dirty‑file count.
- **One‑line usage row** — context, 5‑hour, and 7‑day usage plus the model name + effort level all live on a single lean line below the header.
- **Color‑coded effort** — the effort label mirrors the CLI `/effort` palette: `low` gold, `medium` green, `high` periwinkle, `xhigh` a violet label with a lavender shimmer that sweeps across, and `max` a soft rainbow that flows over the letters. (Ultracode mode reports as `xhigh`, so it shows the xhigh shimmer.) The animation steps roughly once per second (a status line can't repaint as smoothly as the CLI's own renderer — see [`refreshInterval`](#manual-install)).
- **No network, no tokens** — everything is read from the JSON Claude Code pipes in on stdin: no API calls, no OAuth token, no caching, no daemons — just one Bash script.

## Requirements

- **Claude Code**
- `bash`, `jq`, `awk` (jq is the only non‑standard one — install via `brew install jq` or `apt install jq`). `perl` or GNU `date` is optional — it only lets the effort animation tick faster than once per second.
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
       "command": "bash ~/.claude/statusline.sh",
       "refreshInterval": 1
     }
   }
   ```

   `refreshInterval: 1` re-runs the script every second so the animated **effort** label keeps moving while the session is idle. Drop it if you don't want the per-second refresh.

3. Restart Claude Code (or start a new session). The status line appears at the bottom of the prompt.

## How it works

On each render, Claude Code pipes a JSON payload (model, cwd, git, usage, context, …) into the script over stdin. The script then:

1. Builds the Powerlevel10k‑style header from `workspace.current_dir` and `git`.
2. Reads the **5‑hour / 7‑day** limits from `rate_limits` and the **context‑window** fill from `context_window` in the payload.
3. Assembles the compact usage row — context, 5‑hour, 7‑day mini‑bars + the model name and effort level.

No network calls and no token — everything comes from the JSON Claude Code already provides. (`rate_limits` is populated for Claude.ai Pro/Max sessions after the first API response; the usage bars are simply hidden when it isn't present.)

## Customize

Open `~/.claude/statusline.sh` and tweak:

- **Colors** — the `'\033[38;2;R;G;B'm` truecolor escapes near the top and in each section (e.g. `path_col`, `last_col`, `branch_col`, `dirty_col` for the header; `orange_*` / `green_*` for the usage mini‑bars).
- **Icons** — the `p_apple` / `p_folder` / `p_branch` (header) and `i_ctx` / `i_5h` / `i_7d` (usage row) `printf` hex escapes. Swap in other Nerd Font codepoints (encoded as UTF‑8 bytes, e.g. `printf '\xef\x84\xa6'`) if you prefer different glyphs.
- **Mini‑bar width** — `mini_w=5` (the number of cells in each usage/context bar).
- **Effort colors / animation** — the `render_effort` function (per‑level colors, the `xhigh` shimmer, and the `max` rainbow). The animation speed is set by the `now_ms` divisors inside it.
- **Context thresholds** — the `50 / 85` percent breakpoints that drive the context color (cyan → yellow → red).

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` and delete `~/.claude/statusline.sh`.

## License

[MIT](LICENSE)
