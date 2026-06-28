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

iso_to_epoch() {
    local iso_str="$1"

    local epoch
    epoch=$(date -d "${iso_str}" +%s 2>/dev/null)
    if [ -n "$epoch" ]; then
        echo "$epoch"
        return 0
    fi

    local stripped="${iso_str%%.*}"
    stripped="${stripped%%Z}"
    stripped="${stripped%%+*}"
    stripped="${stripped%%-[0-9][0-9]:[0-9][0-9]}"

    if [[ "$iso_str" == *"Z"* ]] || [[ "$iso_str" == *"+00:00"* ]] || [[ "$iso_str" == *"-00:00"* ]]; then
        epoch=$(env TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
    else
        epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null)
    fi

    if [ -n "$epoch" ]; then
        echo "$epoch"
        return 0
    fi

    return 1
}

format_reset_time() {
    local iso_str="$1"
    local style="$2"
    [ -z "$iso_str" ] || [ "$iso_str" = "null" ] && return

    local epoch
    epoch=$(iso_to_epoch "$iso_str")
    [ -z "$epoch" ] && return

    case "$style" in
        time)
            date -j -r "$epoch" +"%l:%M %p" 2>/dev/null | sed 's/^ //' || \
            date -d "@$epoch" +"%l:%M %p" 2>/dev/null | sed 's/^ //'
            ;;
        datetime)
            date -j -r "$epoch" +"%b %-d, %l:%M %p" 2>/dev/null | sed 's/  / /g; s/^ //' || \
            date -d "@$epoch" +"%b %-d, %l:%M %p" 2>/dev/null | sed 's/  / /g; s/^ //'
            ;;
    esac
}

build_bar() {
    local pct=$1
    local width=$2
    local color_filled=${3:-'\033[38;2;221;129;97m'}
    local color_empty=${4:-'\033[38;2;80;60;50m'}
    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100

    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))

    local filled_str="" empty_str=""
    for ((i=0; i<filled; i++)); do filled_str+="▆"; done
    for ((i=0; i<empty; i++)); do empty_str+="▆"; done

    printf "${color_filled}${filled_str}${color_empty}${empty_str}${reset}"
}

# Compact p10k-style segmented bar (filled ■ / empty □) for the single status line.
build_mini() {
    local pct=$1
    local width=$2
    local cf=$3
    local ce=$4
    [ "$pct" -lt 0 ] 2>/dev/null && pct=0
    [ "$pct" -gt 100 ] 2>/dev/null && pct=100

    local filled=$(( pct * width / 100 ))
    local empty=$(( width - filled ))

    local fs="" es=""
    for ((i=0; i<filled; i++)); do fs+="■"; done
    for ((i=0; i<empty; i++)); do es+="□"; done

    printf "${cf}${fs}${ce}${es}${reset}"
}

format_relative_time() {
    local iso_str="$1"
    [ -z "$iso_str" ] || [ "$iso_str" = "null" ] && return

    local epoch
    epoch=$(iso_to_epoch "$iso_str")
    [ -z "$epoch" ] && return

    local now diff
    now=$(date +%s)
    diff=$(( epoch - now ))
    [ "$diff" -lt 0 ] && diff=0

    local days=$(( diff / 86400 ))
    local hours=$(( (diff % 86400) / 3600 ))
    local mins=$(( (diff % 3600) / 60 ))

    if [ "$days" -gt 0 ]; then
        printf "%dd %dh" "$days" "$hours"
    elif [ "$hours" -gt 0 ]; then
        printf "%dh %dm" "$hours" "$mins"
    else
        printf "%dm" "$mins"
    fi
}

format_tokens() {
    local num=$1
    if [ "$num" -ge 1000000 ]; then
        awk "BEGIN {printf \"%.1fm\", $num / 1000000}"
    elif [ "$num" -ge 1000 ]; then
        awk "BEGIN {printf \"%.0fk\", $num / 1000}"
    else
        printf "%d" "$num"
    fi
}

cyan='\033[38;2;120;200;220m'
yellow='\033[38;2;230;200;120m'
purple='\033[38;2;180;150;220m'

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
[ -z "$cwd" ] && cwd=$(pwd)
cwd_display="${cwd/#$HOME/~}"
# Split into parent path + last segment so the last dir can be bolded (p10k-style).
dir_last="${cwd_display##*/}"
dir_parent="${cwd_display%/*}"
if [ "$dir_parent" = "$cwd_display" ]; then
    dir_parent=""   # no slash present (e.g. "~" or a single segment)
fi

branch=""
dirty_count=0
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        dirty_count=$(git -C "$cwd" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    fi
fi

model_name=$(echo "$input" | jq -r '.model.display_name // empty')
effort_level=$(echo "$input" | jq -r '.effort.level // empty')

# --- Powerlevel10k-style first line ---
# Glyphs are built from printf hex escapes so the UTF-8 bytes survive editing.
p_apple=$(printf '\xef\x85\xb9')   # nf-fa-apple (U+F179)
p_folder=$(printf '\xef\x81\xbc')  # nf-fa-folder_open (U+F07C)
p_branch=$(printf '\xef\x90\x98')  # oct git-branch (U+F418), text-height

path_col='\033[38;2;94;195;215m'        # cyan path
last_col='\033[1;38;2;120;175;255m'     # bold blue last segment
branch_col='\033[38;2;120;200;120m'     # green branch
dirty_col='\033[38;2;120;200;120m'      # green *N (set to 220;200;120m for p10k-yellow)

line0="${white}${p_apple}${reset} "
# directory: cyan folder icon + path, last segment bold (p10k lean dir)
line0+="${path_col}${p_folder}${reset} "
if [ -n "$dir_parent" ]; then
    line0+="${path_col}${dir_parent}/${reset}${last_col}${dir_last}${reset}"
else
    line0+="${last_col}${dir_last}${reset}"
fi
# vcs: green branch glyph + name + dirty marker (p10k lean vcs)
if [ -n "$branch" ]; then
    line0+="  ${branch_col}${p_branch} ${branch}${reset}"
    if [ "$dirty_count" -gt 0 ] 2>/dev/null; then
        line0+=" ${dirty_col}*${dirty_count}${reset}"
    fi
fi



get_oauth_token() {
    local token=""

    if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
        echo "$CLAUDE_CODE_OAUTH_TOKEN"
        return 0
    fi

    if command -v security >/dev/null 2>&1; then
        local blob
        blob=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
        if [ -n "$blob" ]; then
            token=$(echo "$blob" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
            if [ -n "$token" ] && [ "$token" != "null" ]; then
                echo "$token"
                return 0
            fi
        fi
    fi

    local creds_file="${HOME}/.claude/.credentials.json"
    if [ -f "$creds_file" ]; then
        token=$(jq -r '.claudeAiOauth.accessToken // empty' "$creds_file" 2>/dev/null)
        if [ -n "$token" ] && [ "$token" != "null" ]; then
            echo "$token"
            return 0
        fi
    fi

    if command -v secret-tool >/dev/null 2>&1; then
        local blob
        blob=$(timeout 2 secret-tool lookup service "Claude Code-credentials" 2>/dev/null)
        if [ -n "$blob" ]; then
            token=$(echo "$blob" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
            if [ -n "$token" ] && [ "$token" != "null" ]; then
                echo "$token"
                return 0
            fi
        fi
    fi

    echo ""
}

cache_file="/tmp/claude/statusline-usage-cache.json"
cache_max_age=60
mkdir -p /tmp/claude

needs_refresh=true
usage_data=""

if [ -f "$cache_file" ]; then
    cache_mtime=$(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null)
    now=$(date +%s)
    cache_age=$(( now - cache_mtime ))
    if [ "$cache_age" -lt "$cache_max_age" ]; then
        needs_refresh=false
        usage_data=$(cat "$cache_file" 2>/dev/null)
    fi
fi

if $needs_refresh; then
    token=$(get_oauth_token)
    if [ -n "$token" ] && [ "$token" != "null" ]; then
        response=$(curl -s --max-time 5 \
            -H "Accept: application/json" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -H "anthropic-beta: oauth-2025-04-20" \
            -H "User-Agent: claude-statusline" \
            "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)
        if [ -n "$response" ] && echo "$response" | jq -e '.five_hour' >/dev/null 2>&1; then
            usage_data="$response"
            echo "$response" > "$cache_file"
        fi
    fi
    if [ -z "$usage_data" ] && [ -f "$cache_file" ]; then
        usage_data=$(cat "$cache_file" 2>/dev/null)
    fi
fi

# Colors for the usage mini-bars
orange_filled='\033[38;2;220;100;60m'
orange_empty='\033[38;2;90;45;30m'
green_filled='\033[38;2;80;200;120m'
green_empty='\033[38;2;30;75;45m'
orange_text='\033[38;2;220;130;60m'
green_text='\033[38;2;80;200;120m'

# Usage percentages (5-hour + 7-day) for the compact status line.
five_hour_pct=""
seven_day_pct=""
if [ -n "$usage_data" ] && echo "$usage_data" | jq -e . >/dev/null 2>&1; then
    five_hour_pct=$(echo "$usage_data" | jq -r '.five_hour.utilization // 0' | awk '{printf "%.0f", $1}')
    seven_day_pct=$(echo "$usage_data" | jq -r '.seven_day.utilization // 0' | awk '{printf "%.0f", $1}')
fi

# --- Context window usage (from current transcript) ---
context_line=""
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
model_id=$(echo "$input" | jq -r '.model.id // empty')

context_window=200000
if [[ "$model_id" == *"1m"* ]] || [[ "$model_id" == *"[1m]"* ]]; then
    context_window=1000000
fi

context_used=0
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    transcript_id=$(basename "$transcript_path" .jsonl)
    ctx_cache="/tmp/claude/statusline-ctx-${transcript_id}.cache"
    transcript_mtime=$(stat -f %m "$transcript_path" 2>/dev/null || stat -c %Y "$transcript_path" 2>/dev/null)

    cached_used=""
    if [ -f "$ctx_cache" ]; then
        cached_mtime=$(head -n1 "$ctx_cache" 2>/dev/null)
        if [ "$cached_mtime" = "$transcript_mtime" ]; then
            cached_used=$(sed -n '2p' "$ctx_cache" 2>/dev/null)
        fi
    fi

    if [ -n "$cached_used" ]; then
        context_used="$cached_used"
    else
        context_used=$(tail -n 500 "$transcript_path" 2>/dev/null \
            | jq -c 'select(.message.usage)' 2>/dev/null \
            | tail -n 1 \
            | jq -r '.message.usage | (.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)' 2>/dev/null)
        [ -z "$context_used" ] || [ "$context_used" = "null" ] && context_used=0
        printf "%s\n%s\n" "$transcript_mtime" "$context_used" > "$ctx_cache"
    fi
fi

# Context fill drives the bar color (cyan -> yellow -> red), even at 0%.
context_pct=$(awk "BEGIN {printf \"%.0f\", $context_used * 100 / $context_window}")
[ "$context_pct" -gt 100 ] && context_pct=100
context_pct_fmt=$(printf "%2d" "$context_pct")

if [ "$context_pct" -lt 50 ]; then
    ctx_filled='\033[38;2;120;200;220m'
    ctx_empty='\033[38;2;40;65;75m'
    ctx_text='\033[38;2;120;200;220m'
elif [ "$context_pct" -lt 85 ]; then
    ctx_filled='\033[38;2;230;200;120m'
    ctx_empty='\033[38;2;80;65;40m'
    ctx_text='\033[38;2;230;200;120m'
else
    ctx_filled='\033[38;2;220;100;60m'
    ctx_empty='\033[38;2;90;45;30m'
    ctx_text='\033[38;2;220;100;60m'
fi

# --- Compact single status line: context · 5h · 7d · model (p10k lean) ---
# Icons are printf hex escapes so the UTF-8 bytes survive editing.
i_ctx=$(printf '\xef\x83\xa4')   # nf-fa-dashboard (U+F0E4) — context gauge
i_5h=$(printf '\xef\x80\x97')    # nf-fa-clock_o (U+F017) — 5-hour window
i_7d=$(printf '\xef\x81\xb3')    # nf-fa-calendar (U+F073) — 7-day window
mini_w=5

status_line="${ctx_text}${i_ctx}${reset} $(build_mini "$context_pct" "$mini_w" "$ctx_filled" "$ctx_empty") ${ctx_text}${context_pct_fmt}%${reset}"
if [ -n "$five_hour_pct" ]; then
    five_hour_fmt=$(printf "%2d" "$five_hour_pct")
    status_line+="  ${orange_text}${i_5h}${reset} $(build_mini "$five_hour_pct" "$mini_w" "$orange_filled" "$orange_empty") ${orange_text}${five_hour_fmt}%${reset}"
fi
if [ -n "$seven_day_pct" ]; then
    seven_day_fmt=$(printf "%2d" "$seven_day_pct")
    status_line+="  ${green_text}${i_7d}${reset} $(build_mini "$seven_day_pct" "$mini_w" "$green_filled" "$green_empty") ${green_text}${seven_day_fmt}%${reset}"
fi
if [ -n "$model_name" ]; then
    status_line+="${sep}${white}${model_name}${reset}"
    [ -n "$effort_level" ] && status_line+=" ${dim}${effort_level}${reset}"
fi

printf "%b" "$line0"
printf "\n"
printf "%b" "$status_line"

exit 0
