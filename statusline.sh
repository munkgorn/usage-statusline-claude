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

# Progress bar 7/8 of a cell tall, optically centered on the text. The lower
# block glyphs (▆) grow up from the very bottom of the cell — below the baseline,
# inside the descender space — so a bar drawn with them reads as dropped.
# Instead: reverse video (ESC[7m) paints the cell in the bar color and flips the
# glyph to the terminal's own background, so ▁ becomes a 1/8 notch cut out of the
# BOTTOM, leaving a 7/8 bar spanning 1/8..8/8.
# Vertical placement has exactly two settings, because one glyph can only notch
# one edge: ▁ (this one) sits high, ▔ sits one eighth lower. There is nothing in
# between — a 6/8 bar floating clear of both edges would need two notches in one
# cell, which a terminal cannot draw.
# The filled run is colored by level; the remainder is the same shape in gray.
# Sub-cell (1/8-wide) partials were dropped along with the full block: the
# half-width variants only exist at full height, and mixing them made the bar
# look ragged. One cell = 100/w percent, rounded to nearest.
rev='\033[7m'
b_full=$(printf '\xe2\x96\x81')     # U+2581 lower one-eighth block, used as the notch
b_track=$b_full                     # same shape as the fill, only dimmer, so the
                                    # track reads as one even gray rail
track_col='\033[38;2;108;114;128m'   # gray track — light enough not to read as a black slab
bar_width=8
render_bar() {
    local p=$1 w=${2:-$bar_width} i=0 full out=""
    [ "$p" -lt 0 ] 2>/dev/null && p=0
    [ "$p" -gt 100 ] 2>/dev/null && p=100
    full=$(( (p * w + 50) / 100 ))
    # Never render an empty bar for non-zero usage, nor a full bar below 100%.
    [ "$p" -gt 0 ] && [ "$full" -eq 0 ] && full=1
    [ "$p" -lt 100 ] && [ "$full" -ge "$w" ] && full=$(( w - 1 ))
    out="${rev}$(level_color "$p")"
    while [ "$i" -lt "$full" ]; do out+="$b_full"; i=$(( i + 1 )); done
    out+="${reset}${rev}${track_col}"
    while [ "$i" -lt "$w" ]; do out+="$b_track"; i=$(( i + 1 )); done
    out+="${reset}"
    printf '%s' "$out"
}

# ---- Width tiers (Claude Code v2.1.153+ exports COLUMNS before running us) ----
# Narrowing wraps segments onto extra rows (see pack_lines) rather than dropping
# them, so these tiers only shrink the bars — and, on a genuinely tiny terminal,
# drop the parenthetical details that would wrap every single segment.
cols=${COLUMNS:-0}
narrow=0; show_detail=1; show_pace=1; bar_w=$bar_width
if [ "$cols" -gt 0 ] 2>/dev/null && [ "$cols" -lt 55 ]; then
    narrow=1; show_detail=0; show_pace=0; bar_w=4
elif [ "$cols" -gt 0 ] 2>/dev/null && [ "$cols" -lt 100 ]; then
    bar_w=6
fi

# Pack segments into as many rows as the terminal width needs, greedily: keep
# filling the current row, start a new one when the next segment would overflow.
# Every segment carries a precomputed display width, because ${#s} counts neither
# ANSI escapes (zero columns) nor the multi-byte Nerd Font glyphs (one column)
# correctly. Args after the gap are text/width pairs. cols=0 (older Claude Code,
# which does not export COLUMNS) means "unknown width" and packs onto one row.
pack_lines() {
    local gap=$1 gw=$2 out="" cur="" cur_w=0 t w
    shift 2
    while [ "$#" -gt 1 ]; do
        t=$1; w=$2; shift 2
        [ -z "$t" ] && continue
        if [ -z "$cur" ]; then
            cur=$t; cur_w=$w
        elif [ "$cols" -gt 0 ] 2>/dev/null && [ $(( cur_w + gw + w )) -gt "$cols" ]; then
            out+="$cur"$'\n'; cur=$t; cur_w=$w
        else
            cur+="${gap}${t}"; cur_w=$(( cur_w + gw + w ))
        fi
    done
    printf '%s%s' "$out" "$cur"
}

# Format a Unix epoch (BSD date takes -r, GNU date takes -d @).
epoch_fmt() { date -r "$1" +"$2" 2>/dev/null || date -d "@$1" +"$2" 2>/dev/null; }

# Wall-clock time a window resets at: "15:00" today, "01:00 nextday" tomorrow,
# "00:00 Mon20Jul" beyond that. Callers pass today's / tomorrow's YYYYMMDD so
# the comparison costs no extra `date` calls per segment.
fmt_reset_at() {
    local target=${1%%.*} today=$2 tomorrow=$3 hm day
    hm=$(epoch_fmt "$target" '%H:%M')
    [ -z "$hm" ] && return
    day=$(epoch_fmt "$target" '%Y%m%d')
    if [ "$day" = "$today" ]; then
        printf '%s' "$hm"
    elif [ "$day" = "$tomorrow" ]; then
        printf '%s nextday' "$hm"
    else
        printf '%s %s' "$hm" "$(epoch_fmt "$target" '%a%d%b')"
    fi
}

# Compact a token count for display: "850", "12k", "100k", "1m", "1.5m".
fmt_tokens() {
    awk "BEGIN{v=$1; if(v>=1000000){x=v/1000000; if(x==int(x))printf\"%dm\",x; else printf\"%.1fm\",x} else if(v>=1000)printf\"%dk\",v/1000; else printf\"%d\",v}" 2>/dev/null
}

# Pace: how far ahead of / behind an even burn you are inside a usage window.
# Compares the percentage used against the fraction of the window elapsed, so
# "down 23%" means you have spent 23 points less than a steady burn would have.
a_up=$(printf '\xe2\x86\x91')     # U+2191
a_down=$(printf '\xe2\x86\x93')   # U+2193
render_pace() {
    local used=$1 resets=${2%%.*} window=$3 now=$4 elapsed expected delta col arrow
    [ -n "$resets" ] || return
    [ "$resets" -gt 0 ] 2>/dev/null || return
    elapsed=$(( window - (resets - now) ))
    [ "$elapsed" -lt 0 ] && elapsed=0
    [ "$elapsed" -gt "$window" ] && elapsed=$window
    expected=$(( elapsed * 100 / window ))
    delta=$(( used - expected ))
    # Deadband: a couple of points either way is noise, not a trend.
    [ "$delta" -lt 3 ] && [ "$delta" -gt -3 ] && return
    if [ "$delta" -lt 0 ]; then
        arrow=$a_down; delta=$(( 0 - delta ))
        col='\033[38;2;80;200;120m'            # under the line — green
    else
        arrow=$a_up
        if [ "$delta" -lt 10 ]; then
            col='\033[38;2;150;155;165m'       # roughly on pace — gray
        elif [ "$delta" -lt 25 ]; then
            col='\033[38;2;235;150;80m'        # running hot — orange
        else
            col='\033[38;2;225;85;70m'         # way ahead of quota — red
        fi
    fi
    # Prefixed with its own display width (tab-separated, so the segment's own
    # leading space survives) — leading space + arrow + digits + percent sign.
    printf '%s\t%s' "$(( 3 + ${#delta} ))" " ${col}${arrow}${delta}%${reset}"
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
# In a Claude worktree session the work happens in .worktree.path; show that
# instead whenever cwd sits outside it (e.g. still the original checkout).
wt_path=$(echo "$input" | jq -r '.worktree.path // empty')
if [ -n "$wt_path" ] && [ -d "$wt_path" ]; then
    case "$cwd/" in "$wt_path"/*) ;; *) cwd=$wt_path ;; esac
fi
# Linked worktree (any `git worktree add`, not only Claude's): the payload says
# so via .workspace.git_worktree; older Claude Code lacks it, so also ask git —
# a linked worktree's git dir lives under <main>/.git/worktrees/<name>.
is_wt=0
if [ -n "$wt_path" ] || [ -n "$(echo "$input" | jq -r '.workspace.git_worktree // empty')" ]; then
    is_wt=1
elif [ -d "$cwd" ]; then
    case "$(git -C "$cwd" rev-parse --absolute-git-dir 2>/dev/null)" in */worktrees/*) is_wt=1 ;; esac
fi
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

# Worktree: file-tree glyph instead of the folder, and the last segment in amber.
dir_glyph="${path_col}${p_folder}"
if [ "$is_wt" -eq 1 ]; then
    dir_glyph='\033[38;2;230;170;80m'"$(printf '\xf3\xb0\x99\x85')"   # nf-md-file_tree (U+F0645)
    last_col='\033[1;38;2;230;170;80m'  # bold amber last segment
fi

# Header segments: path, git, model. Each is built with its display width so the
# packer can wrap them; a segment is never split across rows.
h_dir="${white}${p_apple}${reset} ${dir_glyph}${reset} "
if [ "$narrow" -eq 1 ] || [ -z "$dir_parent" ]; then
    h_dir+="${last_col}${dir_last}${reset}"
    w_dir=$(( 4 + ${#dir_last} ))          # apple + space + folder + space
else
    h_dir+="${path_col}${dir_parent}/${reset}${last_col}${dir_last}${reset}"
    w_dir=$(( 4 + ${#dir_parent} + 1 + ${#dir_last} ))
fi

h_git=""; w_git=0
if [ -n "$branch" ]; then
    h_git="${branch_col}${p_branch} ${branch}${reset}"
    w_git=$(( 2 + ${#branch} ))            # branch glyph + space + name
    if [ "$dirty_count" -gt 0 ] 2>/dev/null; then
        h_git+=" ${dirty_col}*${dirty_count}${reset}"
        w_git=$(( w_git + 2 + ${#dirty_count} ))
    fi
fi

h_model=""; w_model=0
if [ -n "$model_name" ]; then
    h_model="${claude_col}${p_claude}${reset} ${white}${model_name}${reset}"
    w_model=$(( 2 + ${#model_name} ))      # Claude mark + space + name
    if [ -n "$effort_level" ]; then
        h_model+=" $(render_effort "$effort_level")"
        w_model=$(( w_model + 1 + ${#effort_level} ))
    fi
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
today_ymd=$(epoch_fmt "$now_epoch" '%Y%m%d')
tomorrow_ymd=$(epoch_fmt $(( now_epoch + 86400 )) '%Y%m%d')

# Each segment: icon + label(detail) + bar + percentage + pace, all level-colored,
# built alongside its display width for the packer. The two rate-limit segments
# are dropped entirely while they still read 0%.
# label_w counts the icon (1) + space + the label text.
build_usage_seg() {
    local pct=$1 icon=$2 label=$3 detail=$4 resets=$5 window=$6
    local txt w pace pace_w
    txt="$(level_color "$pct")${icon} ${label}${reset}"
    w=$(( 2 + ${#label} ))
    if [ -n "$detail" ]; then
        txt+="${dim}(${detail})${reset}"
        w=$(( w + 2 + ${#detail} ))
    fi
    txt+=" $(render_bar "$pct" "$bar_w") $(level_color "$pct")$(printf '%2d' "$pct")%${reset}"
    w=$(( w + 1 + bar_w + 1 + 3 ))
    if [ "$show_pace" -eq 1 ]; then
        pace=$(render_pace "$pct" "$resets" "$window" "$now_epoch")
        if [ -n "$pace" ]; then
            pace_w=${pace%%	*}
            txt+="${pace#*	}"
            w=$(( w + pace_w ))
        fi
    fi
    printf '%s\t%s' "$w" "$txt"
}

# A window's parenthetical detail, empty when it should not be shown.
ctx_detail=""
[ "$show_detail" -eq 1 ] && [ "$ctx_window_size" -gt 0 ] 2>/dev/null &&
    ctx_detail="$(fmt_tokens "$ctx_used_tokens")/$(fmt_tokens "$ctx_window_size")"
fh_detail=""
[ "$show_detail" -eq 1 ] && [ -n "$fhr" ] && [ "${fhr%%.*}" -gt 0 ] 2>/dev/null &&
    fh_detail="$(fmt_reset_at "$fhr" "$today_ymd" "$tomorrow_ymd")"
sd_detail=""
[ "$show_detail" -eq 1 ] && [ -n "$sdr" ] && [ "${sdr%%.*}" -gt 0 ] 2>/dev/null &&
    sd_detail="$(fmt_reset_at "$sdr" "$today_ymd" "$tomorrow_ymd")"

seg=$(build_usage_seg "$context_pct" "$i_ctx" "ctx" "$ctx_detail" "" 0)
w_ctx=${seg%%	*}; s_ctx=${seg#*	}

s_5h=""; w_5h=0
if [ -n "$five_hour_pct" ] && [ "$five_hour_pct" -gt 0 ] 2>/dev/null; then
    seg=$(build_usage_seg "$five_hour_pct" "$i_5h" "5h" "$fh_detail" "$fhr" 18000)
    w_5h=${seg%%	*}; s_5h=${seg#*	}
fi

s_7d=""; w_7d=0
if [ -n "$seven_day_pct" ] && [ "$seven_day_pct" -gt 0 ] 2>/dev/null; then
    seg=$(build_usage_seg "$seven_day_pct" "$i_7d" "week" "$sd_detail" "$sdr" 604800)
    w_7d=${seg%%	*}; s_7d=${seg#*	}
fi

printf "%b" "$(pack_lines "  " 2 "$h_dir" "$w_dir" "$h_git" "$w_git" "$h_model" "$w_model")"
printf "\n"
printf "%b" "$(pack_lines "   " 3 "$s_ctx" "$w_ctx" "$s_5h" "$w_5h" "$s_7d" "$w_7d")"

exit 0
