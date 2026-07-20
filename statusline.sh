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

# Clamp/round any number to an integer percentage 0..100.
to_pct() { awk "BEGIN{v=$1; if(v<0)v=0; if(v>100)v=100; printf \"%.0f\", v}" 2>/dev/null; }

# Color a value by fill level: green (calm) -> lime -> amber -> orange -> red (full).
level_color() {
    local p=$1
    [ "$p" -lt 0 ] 2>/dev/null && p=0
    if [ "$p" -lt 40 ]; then
        printf '\033[38;2;80;200;120m'    # green
    elif [ "$p" -lt 60 ]; then
        printf '\033[38;2;170;210;100m'   # lime
    elif [ "$p" -lt 75 ]; then
        printf '\033[38;2;230;200;120m'   # amber
    elif [ "$p" -lt 90 ]; then
        printf '\033[38;2;235;150;80m'    # orange
    else
        printf '\033[38;2;225;85;70m'     # red
    fi
}

# Progress bar with 1/8-cell precision: ████▌░░░
# The filled run is colored by level; the remainder is a dim ░ track.
b_full=$(printf '\xe2\x96\x88')     # U+2588 full block
b_track=$(printf '\xe2\x96\x91')    # U+2591 light shade
# Partial cells, 1/8 .. 7/8 of a cell wide (U+258F .. U+2589).
b_p1=$(printf '\xe2\x96\x8f'); b_p2=$(printf '\xe2\x96\x8e')
b_p3=$(printf '\xe2\x96\x8d'); b_p4=$(printf '\xe2\x96\x8c')
b_p5=$(printf '\xe2\x96\x8b'); b_p6=$(printf '\xe2\x96\x8a')
b_p7=$(printf '\xe2\x96\x89')
track_col='\033[38;2;68;72;80m'
bar_width=8
render_bar() {
    local p=$1 w=${2:-$bar_width} i=0 eighths full rem part="" out=""
    [ "$p" -lt 0 ] 2>/dev/null && p=0
    [ "$p" -gt 100 ] 2>/dev/null && p=100
    eighths=$(( p * w * 8 / 100 ))
    # Never render an empty bar for non-zero usage, nor a full bar below 100%.
    [ "$p" -gt 0 ] && [ "$eighths" -eq 0 ] && eighths=1
    [ "$p" -lt 100 ] && [ "$eighths" -ge $(( w * 8 )) ] && eighths=$(( w * 8 - 1 ))
    full=$(( eighths / 8 )); rem=$(( eighths % 8 ))
    case "$rem" in
        1) part=$b_p1 ;; 2) part=$b_p2 ;; 3) part=$b_p3 ;; 4) part=$b_p4 ;;
        5) part=$b_p5 ;; 6) part=$b_p6 ;; 7) part=$b_p7 ;;
    esac
    out="$(level_color "$p")"
    while [ "$i" -lt "$full" ]; do out+="$b_full"; i=$(( i + 1 )); done
    if [ -n "$part" ]; then out+="$part"; i=$(( i + 1 )); fi
    out+="${reset}${track_col}"
    while [ "$i" -lt "$w" ]; do out+="$b_track"; i=$(( i + 1 )); done
    out+="${reset}"
    printf '%s' "$out"
}

# Compact "time until reset" from a Unix-epoch target (e.g. "4d 6h", "2h13m", "47m").
fmt_remaining() {
    local target=${1%%.*} now=${2%%.*} s
    s=$(( target - now ))
    [ "$s" -lt 0 ] 2>/dev/null && s=0
    if [ "$s" -ge 86400 ]; then
        printf '%dd %dh' $(( s / 86400 )) $(( (s % 86400) / 3600 ))
    elif [ "$s" -ge 3600 ]; then
        printf '%dh%02dm' $(( s / 3600 )) $(( (s % 3600) / 60 ))
    else
        printf '%dm' $(( s / 60 ))
    fi
}

# Compact a token count for display: "850", "12k", "100k", "1m", "1.5m".
fmt_tokens() {
    awk "BEGIN{v=$1; if(v>=1000000){x=v/1000000; if(x==int(x))printf\"%dm\",x; else printf\"%.1fm\",x} else if(v>=1000)printf\"%dk\",v/1000; else printf\"%d\",v}" 2>/dev/null
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
p_claude=$(printf '\xef\x81\xa9')   # nf-fa-asterisk (U+F069) — Claude/Anthropic mark
claude_col='\033[38;2;217;119;87m'  # Claude orange (#D97757)

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
# Model + effort ride at the end of the header line.
if [ -n "$model_name" ]; then
    line0+="   ${claude_col}${p_claude}${reset} ${white}${model_name}${reset}"
    [ -n "$effort_level" ] && line0+=" $(render_effort "$effort_level")"
fi

# ---- Usage rate limits straight from the status payload ----
five_hour_pct=""
seven_day_pct=""
# rate_limits is absent until the first API response (and on a fresh session),
# so cache the last-known values (incl. the epoch reset times) and reuse them.
rate_cache="/tmp/claude/statusline-rate.cache"
fh=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
sd=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
fhr=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
sdr=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
if [ -n "$fh" ] && [ -n "$sd" ]; then
    mkdir -p /tmp/claude 2>/dev/null && printf '%s %s %s %s\n' "$fh" "$sd" "${fhr:-0}" "${sdr:-0}" > "$rate_cache" 2>/dev/null
elif [ -f "$rate_cache" ]; then
    read -r fh sd fhr sdr < "$rate_cache" 2>/dev/null
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

# Raw token usage for the gray "used/total" detail next to the percentage.
# Prefer the real token counts; if absent, derive used from the percentage.
ctx_pair=$(echo "$input" | jq -r '
    (.context_window.context_window_size // 0) as $sz
    | (.context_window.used_percentage // null) as $pct
    | (.context_window.current_usage // {}) as $u
    | (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0)) as $raw
    | (if $raw > 0 then $raw elif ($pct != null and $sz > 0) then ($pct * $sz / 100) else 0 end) as $used
    | "\($used | floor) \($sz)"' 2>/dev/null)
ctx_used_tokens=${ctx_pair%% *}; ctx_window_size=${ctx_pair##* }
[ -z "$ctx_used_tokens" ] && ctx_used_tokens=0
[ -z "$ctx_window_size" ] && ctx_window_size=0

# ---- Compact single status line: context · 5h · 7d · model (p10k lean) ----
# Minimal: just an icon + the percentage, colored by fill level (no bars).
i_ctx=$(printf '\xef\x83\xa4')   # nf-fa-dashboard (U+F0E4) — context gauge
i_5h=$(printf '\xef\x80\x97')    # nf-fa-clock_o (U+F017) — 5-hour window
i_7d=$(printf '\xef\x81\xb3')    # nf-fa-calendar (U+F073) — 7-day window

now_epoch=$(date +%s 2>/dev/null)

# Each segment: icon + label(detail) + bar + percentage, all level-colored.
status_line="$(level_color "$context_pct")${i_ctx} ctx${reset}"
[ "$ctx_window_size" -gt 0 ] 2>/dev/null && status_line+="${dim}($(fmt_tokens "$ctx_used_tokens")/$(fmt_tokens "$ctx_window_size"))${reset}"
status_line+=" $(render_bar "$context_pct")$(level_color "$context_pct")${context_pct_fmt}%${reset}"
if [ -n "$five_hour_pct" ]; then
    fhf=$(printf "%2d" "$five_hour_pct")
    status_line+="   $(level_color "$five_hour_pct")${i_5h} 5h${reset}"
    [ -n "$fhr" ] && [ "${fhr%%.*}" -gt 0 ] 2>/dev/null && status_line+="${dim}($(fmt_remaining "$fhr" "$now_epoch"))${reset}"
    status_line+=" $(render_bar "$five_hour_pct")$(level_color "$five_hour_pct")${fhf}%${reset}"
fi
if [ -n "$seven_day_pct" ]; then
    sdf=$(printf "%2d" "$seven_day_pct")
    status_line+="   $(level_color "$seven_day_pct")${i_7d} week${reset}"
    [ -n "$sdr" ] && [ "${sdr%%.*}" -gt 0 ] 2>/dev/null && status_line+="${dim}($(fmt_remaining "$sdr" "$now_epoch"))${reset}"
    status_line+=" $(render_bar "$seven_day_pct")$(level_color "$seven_day_pct")${sdf}%${reset}"
fi

printf "%b" "$line0"
printf "\n"
printf "%b" "$status_line"

exit 0
