# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-line **status line for Claude Code**, styled after Powerlevel10k. The entire product is one Bash script (`statusline.sh`, ~160 lines) plus an installer (`install.sh`). No build step, no dependencies beyond `bash` / `jq` / `awk`.

## Run / test

The script takes the Claude Code status payload as JSON on **stdin** and prints two lines to stdout. There is no test suite — verify by piping a sample payload:

```bash
echo '{"workspace":{"current_dir":"/x"},"model":{"display_name":"Opus 4.8 (1M context)","id":"x"},"effort":{"level":"xhigh"},"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":27},"seven_day":{"used_percentage":46}}}' | bash statusline.sh | cat -v
```

Pipe through `cat -v` to confirm the ANSI escapes and the UTF-8 bytes of the Nerd Font glyphs are intact. Test edge cases explicitly: empty stdin (prints `Claude`), missing `rate_limits` (bars should fall back to the cache), and `context_window` absent (context segment still renders at 0%).

## Two copies must stay in sync

This project lives as **two files**:

- **Deployed/live:** `~/.claude/statusline.sh` — wired via `~/.claude/settings.json` `statusLine`. The user edits and visually tests here first.
- **Published repo:** this directory (`statusline.sh`).

After changing the deployed file, copy it back: `cp ~/.claude/statusline.sh ./statusline.sh`, update `README.md` if layout/requirements changed, then commit. The user pushes directly to `main` for this personal repo.

## Hard constraints when editing the script

- **Never paste raw Nerd Font / Unicode glyphs into Edit/Write** — they get stripped to empty. Generate them with `printf '\xNN\xNN\xNN'` (UTF-8 bytes). Glyphs in use: apple `\xef\x85\xb9`, folder `\xef\x81\xbc`, branch `\xef\x90\x98`, gauge/ctx `\xef\x83\xa4`, clock/5h `\xef\x80\x97`, calendar/7d `\xef\x81\xb3`. The mini-bar's `■`/`□` are plain geometric Unicode and survive Edit fine.
- **macOS bash 3.2 target** — `printf '\xHH'` works, `\u` does not. No bash-4 features (associative arrays, `${var^^}`, etc.).
- Colors are truecolor (24-bit) `\033[38;2;R;G;B'm` escapes, set inline per section.

## Data flow / architecture

Everything is read from the stdin JSON — **no network, no OAuth/curl/keychain, no transcript parsing** (all of that was removed; do not reintroduce it). The mapping:

- Header (line 1) ← `.workspace.current_dir` (fallback `.cwd`) + live `git` calls against that dir for branch + dirty count.
- Context fill ← `.context_window.used_percentage`, fallback computed from `current_usage` tokens / `context_window_size`. Color shifts cyan → yellow → red at the `50` / `85` percent breakpoints. Always rendered, even at 0%.
- 5-hour / 7-day usage ← `.rate_limits.five_hour.used_percentage` / `.seven_day.used_percentage`.
- Model + effort ← `.model.display_name` + `.effort.level`.

Full payload schema: https://code.claude.com/docs/en/statusline

### rate_limits caching (important)

`.rate_limits` is **absent on fresh sessions** and until the first API response. To stop the 5h/7d bars from vanishing at session start, the script caches the last-known values to `/tmp/claude/statusline-rate.cache` and reuses them when the field is missing. Keep this behavior if you touch the usage section.

### Effort label

`render_effort` uses a **static** color per level, matched to the CLI `/effort` palette: low=gold, medium=green, high=periwinkle, xhigh=violet (#A17BF8), max=magenta (#E278CD). Do **not** re-add animation — statusLine's minimum refresh is ~1s (~1fps), which made earlier animated versions look janky. Note **Ultracode is not detectable** here: it reports as `effort.level: "xhigh"`, so it shows the same violet; there is no ultracode/workflows field in the payload.
