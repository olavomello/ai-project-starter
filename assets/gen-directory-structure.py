#!/usr/bin/env python3
"""Generate a dark, VS-Code-Explorer-style SVG of the ai-project-starter
directory structure, with a one-line description after each entry.

Pure stdlib, no dependencies — edit the TREE list below when the template's
top-level layout changes, then regenerate:

    python3 assets/gen-directory-structure.py

Writes assets/directory-structure.svg, embedded in the root README."""

FONT_UI = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
FONT_MONO = "'SF Mono', 'Cascadia Code', Consolas, 'Courier New', monospace"

# Palette
BG = "#11131a"
PANEL = "#171a23"
HEADER_BG = "#1c2030"
BORDER = "#2a2e3d"
TEXT = "#e7e9ee"
MUTED = "#8b93a7"
GUIDE = "#323749"
FOLDER = "#6ea8ff"
FOLDER_DARK = "#3f6fc9"
FILE = "#9aa5b8"
ACCENT = "#52c7b8"
ROW_ALT = "#191c27"

ROW_H = 27
INDENT = 22
BASE_X = 34
ICON_SIZE = 13
NAME_X_OFFSET = 24
DESC_X = 430

# Tree data: each node is (name, description, children)
#   children = None        -> file
#   children = []          -> folder, contents not expanded in this view
#   children = [node, ...] -> folder, expanded with the listed children
TREE = [
    ("README.md", "Structured project README, ends with “Powered by AIS”", None),
    ("AGENTS.md", "Rules for all agents — tool-agnostic, always loaded", None),
    ("AGENT_TEAM.md", "How agents create and coordinate other agents", None),
    ("CLAUDE.md", "One line: @AGENTS.md — never edited further", None),
    ("VERSION", "SemVer 2.0.0 source of truth, one line", None),
    ("CHANGELOG.md", "Keep a Changelog, starts with [Unreleased]", None),
    ("PROMPTS.md", "Prompt library for bootstrapping via an agent", None),
    ("scripts", None, [
        ("gate.sh", "One command: format, lint, types, tests, version gate", None),
        ("agent-team.sh", "Create agents, worktrees, PRs; classify and check", None),
        ("ai-log.mjs", "Record one execution (Node, cross-platform)", None),
        ("ai-report.mjs", "Aggregate the log into ai-dash/data.json", None),
        ("adr.mjs", "Create / list / link Architecture Decision Records", None),
        ("mod.mjs", "Toggle the optional starter-hud session mod", None),
        ("skills.mjs", "List, create and validate skills; records usage", None),
        ("ai-dash.mjs", "Local server for ai-dash/, incl. the Settings API", None),
    ]),
    ("ai-dash", "Static monitoring dashboard — zero-config Vercel deploy", []),
    ("docs", None, [
        ("tasks.md", "Fixed task taxonomy used by the execution log", None),
        ("model-prices.json", "You fill this in — cost stays blank until you do", None),
        ("agents", "Roster; ships with sys-init-starter, the one-time bootstrap agent", []),
        ("guides", "Loaded on demand: security, efficiency, delegation, claude-code", []),
        ("repo-map.md, decisions.md", "Committed agent cache — map + durable decisions", None),
        ("adr", "Architecture Decision Records, one file per decision", []),
    ]),
    (".claude", None, [
        ("skills/semver-release", "Release workflow: bump, changelog, tag, version gate", []),
        ("skills/photo-generation", "Photorealistic images, routed to OpenAI", []),
        ("settings.json", "Hooks: protect VERSION/CHANGELOG, block force-push", None),
        ("hooks", "The hook scripts settings.json calls", []),
        ("rules/security.md", "Auto-loads the security guide on a matching path", None),
    ]),
    (".agents", "Local runtime state (git-ignored): worktrees, locks, log", []),
    (".github/workflows/gate.yml", "CI: runs the gate on every push / PR", None),
    (".mcp.json.example", "Scaffolding for project-scoped MCP servers", None),
]


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def folder_icon(x, y):
    """A small flat folder icon, top-left corner at (x, y)."""
    w, h = ICON_SIZE + 2, ICON_SIZE
    return f'''
    <path d="M{x},{y+3} a2,2 0 0 1 2,-2 h4 l2,2 h{w-10} a2,2 0 0 1 2,2 v{h-5} a2,2 0 0 1 -2,2 h-{w-2} a2,2 0 0 1 -2,-2 z"
          fill="{FOLDER}" stroke="{FOLDER_DARK}" stroke-width="0.75"/>'''


def file_icon(x, y):
    """A small flat file icon with folded corner, top-left at (x, y)."""
    w, h = ICON_SIZE - 2, ICON_SIZE + 2
    fold = 4
    return f'''
    <path d="M{x},{y} h{w-fold} l{fold},{fold} v{h-fold} h-{w} z"
          fill="none" stroke="{FILE}" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M{x+w-fold},{y} v{fold} h{fold}" fill="none" stroke="{FILE}" stroke-width="1.1" stroke-linejoin="round"/>'''


rows = []       # list of dicts: depth, name, desc, is_folder, y (filled later)
guide_spans = []  # (x, y_top, y_bottom) for vertical connector lines


def walk(nodes, depth):
    start_idx = len(rows)
    for (name, desc, children) in nodes:
        is_folder = children is not None
        has_visible_children = bool(children)
        rows.append({
            "depth": depth, "name": name, "desc": desc or "",
            "is_folder": is_folder, "has_children": has_visible_children,
        })
        if children:
            walk(children, depth + 1)
    return start_idx, len(rows) - 1


walk(TREE, 0)

# second pass: compute y, and guide spans per folder block
y_cursor = 0
for r in rows:
    r["y"] = y_cursor
    y_cursor += ROW_H


def compute_guides(nodes, depth, y_index_ref):
    """y_index_ref is a mutable [int] pointer into the flattened rows list,
    advanced in the same order as `walk` produced it."""
    for (name, desc, children) in nodes:
        my_index = y_index_ref[0]
        y_index_ref[0] += 1
        if children:
            child_start = y_index_ref[0]
            compute_guides(children, depth + 1, y_index_ref)
            child_end = y_index_ref[0] - 1
            x_guide = BASE_X + (depth + 1) * INDENT - 11
            y_top = rows[child_start]["y"] + ROW_H / 2
            y_bottom = rows[child_end]["y"] + ROW_H / 2
            guide_spans.append((x_guide, y_top, y_bottom))


compute_guides(TREE, 0, [0])

CONTENT_H = y_cursor
HEADER_H = 64
PAD_BOTTOM = 22
WIDTH = 900
HEIGHT = HEADER_H + CONTENT_H + PAD_BOTTOM

svg_parts = []
svg_parts.append(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}"
     viewBox="0 0 {WIDTH} {HEIGHT}" font-family="{FONT_UI}">
  <defs>
    <linearGradient id="hdr" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{HEADER_BG}"/>
      <stop offset="1" stop-color="{PANEL}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="{WIDTH}" height="{HEIGHT}" rx="12" fill="{BG}"/>
  <rect x="0" y="0" width="{WIDTH}" height="{HEIGHT}" rx="12" fill="none" stroke="{BORDER}" stroke-width="1"/>
''')

# Header bar — looks like a file-explorer / editor title bar
svg_parts.append(f'''
  <path d="M0,12 a12,12 0 0 1 12,-12 h{WIDTH-24} a12,12 0 0 1 12,12 v{HEADER_H-12} h-{WIDTH} z" fill="url(#hdr)"/>
  <line x1="0" y1="{HEADER_H}" x2="{WIDTH}" y2="{HEADER_H}" stroke="{BORDER}" stroke-width="1"/>
  <circle cx="26" cy="22" r="5.5" fill="#ff5f57"/>
  <circle cx="44" cy="22" r="5.5" fill="#febc2e"/>
  <circle cx="62" cy="22" r="5.5" fill="#28c840"/>
  <text x="{BASE_X}" y="46" fill="{TEXT}" font-size="15" font-weight="600">ai-project-starter</text>
  <text x="{BASE_X+170}" y="46" fill="{MUTED}" font-size="12.5">— Directory Explorer</text>
  <text x="{WIDTH-28}" y="46" fill="{MUTED}" font-size="11.5" text-anchor="end">what a new project gets</text>
''')

body_y0 = HEADER_H

# Column divider + "Description" label
svg_parts.append(f'''
  <line x1="{DESC_X-14}" y1="{body_y0+6}" x2="{DESC_X-14}" y2="{body_y0+CONTENT_H-4}" stroke="{BORDER}" stroke-width="1"/>
''')

# Alternating row stripes
for i, r in enumerate(rows):
    if i % 2 == 1:
        svg_parts.append(
            f'<rect x="1" y="{body_y0+r["y"]}" width="{WIDTH-2}" height="{ROW_H}" fill="{ROW_ALT}"/>'
        )

# Guide lines (drawn before icons so icons sit on top)
for (x_guide, y_top, y_bottom) in guide_spans:
    svg_parts.append(
        f'<line x1="{x_guide}" y1="{body_y0+y_top}" x2="{x_guide}" y2="{body_y0+y_bottom}" '
        f'stroke="{GUIDE}" stroke-width="1"/>'
    )

for r in rows:
    depth, name, desc, is_folder, y = r["depth"], r["name"], r["desc"], r["is_folder"], r["y"]
    has_children = r["has_children"]
    row_y = body_y0 + y
    mid_y = row_y + ROW_H / 2
    x0 = BASE_X + depth * INDENT

    if is_folder:
        if has_children:
            # chevron (expanded, pointing down) — only when children are shown
            cx, cy = x0 - 2, mid_y
            svg_parts.append(
                f'<path d="M{cx-3},{cy-3} L{cx+3},{cy-3} L{cx},{cy+3} Z" fill="{MUTED}"/>'
            )
        icon_x, icon_y = x0 + 10, mid_y - ICON_SIZE / 2
        svg_parts.append(folder_icon(icon_x, icon_y))
        name_color = TEXT
        name_weight = "600"
        display_name = name + "/"
    else:
        icon_x, icon_y = x0 + 10, mid_y - ICON_SIZE / 2 - 1
        svg_parts.append(file_icon(icon_x, icon_y))
        name_color = TEXT
        name_weight = "400"
        display_name = name

    name_x = x0 + 10 + NAME_X_OFFSET
    svg_parts.append(
        f'<text x="{name_x}" y="{mid_y+4}" fill="{name_color}" font-size="13" '
        f'font-weight="{name_weight}" font-family="{FONT_MONO}">{esc(display_name)}</text>'
    )
    if desc:
        svg_parts.append(
            f'<text x="{DESC_X}" y="{mid_y+4}" fill="{MUTED}" font-size="12.5">{esc(desc)}</text>'
        )

svg_parts.append("</svg>")

import os
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "directory-structure.svg")
with open(out_path, "w") as f:
    f.write("".join(svg_parts))

print(f"wrote {out_path} ({WIDTH}x{HEIGHT}, {len(rows)} rows)")
