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

# Compact p10k-style segmented bar (filled ■ / empty □).
build_mini() {
    local pct=$1 width=$2 cf=$3 ce=$4
    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100
    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))
    local fs="" es="" i
    for ((i=0; i<filled; i++)); do fs+="■"; done
    for ((i=0; i<empty; i++)); do es+="□"; done
    printf "${cf}${fs}${ce}${es}${reset}"
}

# --- Animated effort label (mirrors the CLI /effort colors) ---
# Millisecond clock for time-based gradients (date %N -> perl -> seconds).
# STATUSLINE_NOW_MS overrides it for deterministic frame testing.
now_ms() {
    [ -n "$STATUSLINE_NOW_MS" ] && { echo "$STATUSLINE_NOW_MS"; return; }
    local t
    t=$(date +%s%N 2>/dev/null)
    if [ "${#t}" -ge 16 ] 2>/dev/null; then
        echo $(( t / 1000000 )); return
    fi
    perl -MTime::HiRes -e 'printf("%d", Time::HiRes::time()*1000)' 2>/dev/null && return
    echo $(( $(date +%s) * 1000 ))
}

# HSV (h: any int mod 360, s,v: 0-100) -> "R;G;B".
hsv_rgb() {
    local h=$(( ( $1 % 360 + 360 ) % 360 )) s=$2 v=$3
    local Vf=$(( v * 255 / 100 ))
    local Cf=$(( Vf * s / 100 ))
    local m=$(( Vf - Cf ))
    local seg=$(( h / 60 )) rem=$(( h % 60 )) Xf
    if [ $(( seg % 2 )) -eq 0 ]; then Xf=$(( Cf * rem / 60 )); else Xf=$(( Cf * (60 - rem) / 60 )); fi
    local r g b
    case "$seg" in
        0) r=$Cf; g=$Xf; b=0 ;;
        1) r=$Xf; g=$Cf; b=0 ;;
        2) r=0; g=$Cf; b=$Xf ;;
        3) r=0; g=$Xf; b=$Cf ;;
        4) r=$Xf; g=0; b=$Cf ;;
        *) r=$Cf; g=0; b=$Xf ;;
    esac
    printf '%d;%d;%d' $(( r + m )) $(( g + m )) $(( b + m ))
}

# Render the effort level in its signature color/animation (matched to the CLI /effort GIFs).
render_effort() {
    local level="$1"
    [ -z "$level" ] && return
    local n=${#level} i ch d out="" ms
    ms=$(now_ms)

    case "$level" in
        low)    printf '\033[1;38;2;214;160;60m%s\033[0m'  "$level" ;;  # gold
        medium) printf '\033[1;38;2;110;195;110m%s\033[0m' "$level" ;;  # green
        high)   printf '\033[1;38;2;150;155;235m%s\033[0m' "$level" ;;  # periwinkle
        xhigh)
            # violet base (#A17BF8) with a soft lavender shimmer sweeping across
            local pos=$(( ms / 600 % (n + 3) ))
            for ((i=0; i<n; i++)); do
                ch="${level:i:1}"; d=$(( i - pos )); [ $d -lt 0 ] && d=$(( -d ))
                case "$d" in
                    0) out+="\033[1;38;2;208;182;252m$ch" ;;
                    1) out+="\033[1;38;2;184;152;250m$ch" ;;
                    *) out+="\033[1;38;2;161;123;248m$ch" ;;
                esac
            done
            out+="\033[0m"; printf '%b' "$out" ;;
        max)
            # soft rainbow (S55 V90) flowing across the letters over time
            local phase=$(( ms / 25 % 360 ))
            for ((i=0; i<n; i++)); do
                out+="\033[1;38;2;$(hsv_rgb $(( phase + i * 80 )) 55 90)m${level:i:1}"
            done
            out+="\033[0m"; printf '%b' "$out" ;;
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
orange_filled='\033[38;2;220;100;60m'
orange_empty='\033[38;2;90;45;30m'
green_filled='\033[38;2;80;200;120m'
green_empty='\033[38;2;30;75;45m'
orange_text='\033[38;2;220;130;60m'
green_text='\033[38;2;80;200;120m'

five_hour_pct=""
seven_day_pct=""
fh=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
sd=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
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

# Context fill drives the bar color (cyan -> yellow -> red), even at 0%.
if [ "$context_pct" -lt 50 ]; then
    ctx_filled='\033[38;2;120;200;220m'; ctx_empty='\033[38;2;40;65;75m'; ctx_text='\033[38;2;120;200;220m'
elif [ "$context_pct" -lt 85 ]; then
    ctx_filled='\033[38;2;230;200;120m'; ctx_empty='\033[38;2;80;65;40m'; ctx_text='\033[38;2;230;200;120m'
else
    ctx_filled='\033[38;2;220;100;60m'; ctx_empty='\033[38;2;90;45;30m'; ctx_text='\033[38;2;220;100;60m'
fi

# ---- Compact single status line: context · 5h · 7d · model (p10k lean) ----
i_ctx=$(printf '\xef\x83\xa4')   # nf-fa-dashboard (U+F0E4) — context gauge
i_5h=$(printf '\xef\x80\x97')    # nf-fa-clock_o (U+F017) — 5-hour window
i_7d=$(printf '\xef\x81\xb3')    # nf-fa-calendar (U+F073) — 7-day window
mini_w=5

status_line="${ctx_text}${i_ctx}${reset} $(build_mini "$context_pct" "$mini_w" "$ctx_filled" "$ctx_empty") ${ctx_text}${context_pct_fmt}%${reset}"
if [ -n "$five_hour_pct" ]; then
    fhf=$(printf "%2d" "$five_hour_pct")
    status_line+="  ${orange_text}${i_5h}${reset} $(build_mini "$five_hour_pct" "$mini_w" "$orange_filled" "$orange_empty") ${orange_text}${fhf}%${reset}"
fi
if [ -n "$seven_day_pct" ]; then
    sdf=$(printf "%2d" "$seven_day_pct")
    status_line+="  ${green_text}${i_7d}${reset} $(build_mini "$seven_day_pct" "$mini_w" "$green_filled" "$green_empty") ${green_text}${sdf}%${reset}"
fi
if [ -n "$model_name" ]; then
    status_line+="${sep}${white}${model_name}${reset}"
    [ -n "$effort_level" ] && status_line+=" $(render_effort "$effort_level")"
fi

printf "%b" "$line0"
printf "\n"
printf "%b" "$status_line"

exit 0
