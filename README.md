# usage-statusline-claude

A compact, two‑line **status line for [Claude Code](https://docs.claude.com/en/docs/claude-code)** styled after [Powerlevel10k](https://github.com/romkatv/powerlevel10k): a lean directory/branch/model header, then a usage row of **mini progress bars** for your live **5‑hour + weekly limits** (with a reset countdown) and **context‑window** fill (with a live token count) — each bar **colored by how full it is**, right in the prompt.

```
 ~/Documents/code/usage-statusline-claude   main *3    Opus 4.8 (1M context) xhigh
 ctx(420k/1m) ███▍░░░░░ 42%    5h(2h13m) ▋░░░░░░░  8%    week(4d 6h) █▋░░░░░░ 21%
```

> **Line 1** is a Powerlevel10k‑style header: an Apple logo, a folder icon + the full working directory (last segment bold), a git‑branch icon + branch name + `*N` dirty‑file count, then an orange **Claude (Anthropic) mark** with the **model name and effort level**.
>
> **Line 2** is the usage row — **context window** (`ctx`), **5‑hour limit** (`5h`), and **7‑day limit** (`week`). Each segment is a Nerd Font icon (gauge / clock / calendar) + a text label + a dim detail in parentheses + a **mini progress bar** + the percentage. The bars fill in **1/8‑cell steps** (`█` full, `▌` partial, `░` track), so small moves are still visible, and the fill + percentage are **colored by level** — green under 40%, lime under 60%, amber under 75%, orange under 90%, red above. The detail in parentheses is a **countdown to reset** for the two rate limits (e.g. `2h13m`, `4d 6h`) and a **used / total token count** for the context (e.g. `420k/1m`). The context segment always shows, even at **0%** on a fresh session.
>
> The leading glyphs are [Nerd Font](https://www.nerdfonts.com/) icons, so they only render if your terminal uses a Nerd Font (see [Requirements](#requirements)); the bars and the `ctx` / `5h` / `week` labels are plain Unicode and render everywhere. Everything is colored (truecolor / 24‑bit) in a real terminal; the example above is plain text.

## Features

- **Usage limits** — reads your live **5‑hour** and **7‑day** utilization straight from the status payload Claude Code provides, each shown as an icon + bar + percentage (clock / calendar icons) with a dim **countdown to when the window resets** (`2h13m` / `4d 6h`), computed from the `resets_at` epoch in the payload.
- **Context window** — reads the context‑window fill Claude Code reports, with a dim **used / total token count** (e.g. `420k/1m`) beside the label. Always visible, even at 0% on a brand‑new session.
- **Sub‑cell progress bars** — each bar is 8 cells wide and fills in **1/8‑cell increments** (`█` `▌` `░`), so a 3% context still renders a visible sliver and a 98% week doesn't look full. A bar never reads empty while usage is non‑zero, and never reads full below 100%.
- **Color‑coded levels** — the bar fill and its percentage are colored by how full they are: **green** under 40%, **lime** under 60%, **amber** under 75%, **orange** under 90%, **red** above.
- **Powerlevel10k‑style header** — an Apple logo, a folder icon with the **full** working directory (last path segment bold), a git‑branch icon with the current branch and a `*N` dirty‑file count, then the model name + effort level.
- **One‑line usage row** — context (`ctx`), 5‑hour (`5h`), and 7‑day (`week`) usage, each an icon + label + detail + bar + percentage, on a single lean line below the header.
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
3. Assembles the usage row — context, 5‑hour and 7‑day bars + percentages, colored by level, with a reset countdown / token count in each label.

No network calls and no token — everything comes from the JSON Claude Code already provides. (`rate_limits` only appears for Claude.ai Pro/Max sessions after the first API response, so the last‑known 5h/7d percentages **and their reset times** are cached in `/tmp/claude/statusline-rate.cache` and reused at session start; the segments are only hidden until usage has been seen at least once. Because `resets_at` is an absolute timestamp, the countdown stays accurate even when computed from the cache.)

## Customize

Open `~/.claude/statusline.sh` and tweak:

- **Colors** — the `'\033[38;2;R;G;B'm` truecolor escapes near the top and in each section (e.g. `path_col`, `last_col`, `branch_col`, `dirty_col` for the header; the green → red values inside `level_color` for the bars; `track_col` for the unfilled part of each bar).
- **Bar width** — `bar_width` (default `8`); `render_bar` also takes a per‑call width as its second argument.
- **Bar glyphs** — `b_full` / `b_track` and the `b_p1`…`b_p7` partial cells. Swap them for `▰`/`▱`, `●`/`○`, `━`, or anything else — drop the partials (leave them empty) if you want whole‑cell steps only.
- **Icons** — the `p_apple` / `p_folder` / `p_branch` / `p_claude` (header) and `i_ctx` / `i_5h` / `i_7d` (usage row) `printf` hex escapes. Swap in other Nerd Font codepoints (encoded as UTF‑8 bytes, e.g. `printf '\xef\x84\xa6'`) if you prefer different glyphs — and tweak `claude_col` for the mark's color.
- **Effort colors** — the per‑level colors in the `render_effort` function.
- **Level thresholds** — the `40 / 60 / 75 / 90` percent breakpoints in `level_color` that drive the green → lime → amber → orange → red color of every bar.

## Uninstall

Remove the `statusLine` block from `~/.claude/settings.json` and delete `~/.claude/statusline.sh`.

## License

[MIT](LICENSE)
