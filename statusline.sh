#!/bin/bash
set -f

input=$(cat)

if [ -z "$input" ]; then
    printf "Claude"
    exit 0
fi

white='\033[38;2;220;220;220m'
dim='\033[2m'
reset='\033[0m'

sep=" ${dim}|${reset} "

# Clamp/round any number to an integer percentage 0..100.
to_pct() { awk "BEGIN{v=$1; if(v<0)v=0; if(v>100)v=100; printf \"%.0f\", v}" 2>/dev/null; }

# Color a value by fill level: green (calm) -> amber -> red (full).
level_color() {
    local p=$1
    [ "$p" -lt 0 ] 2>/dev/null && p=0
    if [ "$p" -lt 50 ]; then
        printf '\033[38;2;80;200;120m'    # green
    elif [ "$p" -lt 85 ]; then
        printf '\033[38;2;230;200;120m'   # amber
    else
        printf '\033[38;2;220;100;60m'    # red
    fi
}

# --- Effort label (static colors matched to the CLI /effort palette) ---
render_effort() {
    local level="$1"
    [ -z "$level" ] && return
    case "$level" in
        low)    printf '\033[1;38;2;214;160;60m%s\033[0m'  "$level" ;;  # gold
        medium) printf '\033[1;38;2;110;195;110m%s\033[0m' "$level" ;;  # green
        high)   printf '\033[1;38;2;150;155;235m%s\033[0m' "$level" ;;  # periwinkle
        xhigh)  printf '\033[1;38;2;161;123;248m%s\033[0m' "$level" ;;  # violet (#A17BF8)
        max)    printf '\033[1;38;2;226;120;205m%s\033[0m' "$level" ;;  # magenta (#E278CD)
        *)      printf '\033[2m%s\033[0m' "$level" ;;
    esac
}

# ---- Directory + git (Powerlevel10k-style first line) ----
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[ -z "$cwd" ] && cwd=$(pwd)
cwd_display="${cwd/#$HOME/~}"
# Split into parent path + last segment so the last dir can be bolded.
dir_last="${cwd_display##*/}"
dir_parent="${cwd_display%/*}"
[ "$dir_parent" = "$cwd_display" ] && dir_parent=""

branch=""
dirty_count=0
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$branch" ] && dirty_count=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
fi

model_name=$(echo "$input" | jq -r '.model.display_name // empty')
effort_level=$(echo "$input" | jq -r '.effort.level // empty')

# Glyphs are built from printf hex escapes so the UTF-8 bytes survive editing.
p_apple=$(printf '\xef\x85\xb9')   # nf-fa-apple (U+F179)
p_folder=$(printf '\xef\x81\xbc')  # nf-fa-folder_open (U+F07C)
p_branch=$(printf '\xef\x90\x98')  # oct git-branch (U+F418)

path_col='\033[38;2;94;195;215m'        # cyan path
last_col='\033[1;38;2;120;175;255m'     # bold blue last segment
branch_col='\033[38;2;120;200;120m'     # green branch
dirty_col='\033[38;2;120;200;120m'      # green *N

line0="${white}${p_apple}${reset} "
line0+="${path_col}${p_folder}${reset} "
if [ -n "$dir_parent" ]; then
    line0+="${path_col}${dir_parent}/${reset}${last_col}${dir_last}${reset}"
else
    line0+="${last_col}${dir_last}${reset}"
fi
if [ -n "$branch" ]; then
    line0+="  ${branch_col}${p_branch} ${branch}${reset}"
    if [ "$dirty_count" -gt 0 ] 2>/dev/null; then
        line0+=" ${dirty_col}*${dirty_count}${reset}"
    fi
fi

# ---- Usage rate limits straight from the status payload ----
five_hour_pct=""
seven_day_pct=""
# rate_limits is absent until the first API response (and on a fresh session),
# so cache the last-known values and reuse them so the bars don't vanish.
rate_cache="/tmp/claude/statusline-rate.cache"
fh=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
sd=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
if [ -n "$fh" ] && [ -n "$sd" ]; then
    mkdir -p /tmp/claude 2>/dev/null && printf '%s %s\n' "$fh" "$sd" > "$rate_cache" 2>/dev/null
elif [ -f "$rate_cache" ]; then
    read -r fh sd < "$rate_cache" 2>/dev/null
fi
[ -n "$fh" ] && five_hour_pct=$(to_pct "$fh")
[ -n "$sd" ] && seven_day_pct=$(to_pct "$sd")

# ---- Context window straight from the status payload ----
# Prefer the reported percentage; fall back to current_usage / window size.
context_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -z "$context_pct" ]; then
    context_pct=$(echo "$input" | jq -r '
        (.context_window.context_window_size // 0) as $sz
        | (.context_window.current_usage // {}) as $u
        | (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0)) as $used
        | if $sz > 0 and $used > 0 then ($used * 100 / $sz) else 0 end')
fi
context_pct=$(to_pct "${context_pct:-0}")
context_pct_fmt=$(printf "%2d" "$context_pct")

# ---- Compact single status line: context · 5h · 7d · model (p10k lean) ----
# Minimal: just an icon + the percentage, colored by fill level (no bars).
i_ctx=$(printf '\xef\x83\xa4')   # nf-fa-dashboard (U+F0E4) — context gauge
i_5h=$(printf '\xef\x80\x97')    # nf-fa-clock_o (U+F017) — 5-hour window
i_7d=$(printf '\xef\x81\xb3')    # nf-fa-calendar (U+F073) — 7-day window

status_line="$(level_color "$context_pct")${i_ctx} ${context_pct_fmt}%${reset}"
if [ -n "$five_hour_pct" ]; then
    fhf=$(printf "%2d" "$five_hour_pct")
    status_line+="   $(level_color "$five_hour_pct")${i_5h} ${fhf}%${reset}"
fi
if [ -n "$seven_day_pct" ]; then
    sdf=$(printf "%2d" "$seven_day_pct")
    status_line+="   $(level_color "$seven_day_pct")${i_7d} ${sdf}%${reset}"
fi
if [ -n "$model_name" ]; then
    status_line+="${sep}${white}${model_name}${reset}"
    [ -n "$effort_level" ] && status_line+=" $(render_effort "$effort_level")"
fi

printf "%b" "$line0"
printf "\n"
printf "%b" "$status_line"

exit 0
