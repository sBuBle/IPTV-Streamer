"""Builds design/figcraft/iptv-design.figcraft with FigCraft, then renders it and exports component code.

Usage (from the repo root):
  python design/figcraft/build_design.py            # write the script, run it, render, export code
  python design/figcraft/build_design.py --script   # only write iptv-design.commands.json
FIGCRAFT_CLI overrides the CLI path.

Pages: Tokens (colour/number variables, text/paint/effect styles), Components (Icons, Button, Badge,
NavItem, SearchInput, ChannelCard, CountryRow, Chip, TabBar) and Screens (Home 1440x1000,
Browse 1440x1000, Player 1440x900, Mobile Home 390x844). Placeholder channels are generic, no brands.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CLI = os.environ.get("FIGCRAFT_CLI", r"C:\Program Files (x86)\FigCraft\figcraft-cli.exe")
FILE = os.path.join(HERE, "iptv-design.figcraft")
SCRIPT = os.path.join(HERE, "iptv-design.commands.json")
HERO = os.path.join(ROOT, "public", "brand", "hero-art.png").replace("\\", "/")
ICONS_DIR = os.path.join(ROOT, "public", "brand", "icons").replace("\\", "/")

# ---------------------------------------------------------------- tokens
INK, SURF, CARD, CARD_H = "#12111d", "#17161f", "#1c1b2b", "#25243a"
LINE, LINE2 = "#ffffff0f", "#ffffff1a"
TXT, MUT, SUB = "#f4f3fa", "#a19fb6", "#6f6d87"
VIO, LIL, COR, LIVE, OK = "#8b5cf6", "#a78bfa", "#f43f5e", "#fb7185", "#34d399"
GRAD = {"type": "linearGradient", "stops": [VIO, COR], "from": [0, 0], "to": [1, 1]}
FONT = "Inter"

COLORS = [  # name, value, note
    ("color/bg/ink", INK, "App background"), ("color/bg/surface", SURF, "Sidebar, bars"),
    ("color/bg/card", CARD, "Cards, inputs"), ("color/bg/card-hover", CARD_H, "Hovered cards"),
    ("color/line/hairline", LINE, "1px borders, white 6%"), ("color/line/strong", LINE2, "Inputs, glass, white 10%"),
    ("color/text/primary", TXT, "Headings, labels"), ("color/text/muted", MUT, "Secondary text"),
    ("color/text/subtle", SUB, "Hints, placeholders"), ("color/accent/violet", VIO, "Brand, focus"),
    ("color/accent/lilac", LIL, "Active icons, links"), ("color/accent/coral", COR, "Brand, favourites"),
    ("color/status/live", LIVE, "LIVE badge"), ("color/status/ok", OK, "Online, success"),
]
SPACING = [4, 8, 12, 16, 24, 32]
RADII = [("sm", 8), ("md", 12), ("lg", 16), ("full", 999)]
TYPE = [  # style name, size, weight, line height, letter spacing, sample
    ("Display/48", 48, "Bold", "110%", "-2%", "Live TV, worldwide"),
    ("Display/36", 36, "Bold", "115%", "-1.5%", "Browse by country"),
    ("Display/28", 28, "Bold", "120%", "-1%", "Popular now"),
    ("Body/16", 16, "Regular", "150%", "0%", "Thousands of free channels from 190+ countries."),
    ("Body/14", 14, "Regular", "145%", "0%", "News · United Kingdom · English"),
    ("Body/12", 12, "Regular", "140%", "0%", "Updated 2 minutes ago"),
    ("Label/14", 14, "SemiBold", "120%", "0%", "Start watching"),
    ("Caption/11", 11, "Bold", "100%", "6%", "LIVE"),
]

# 24 x 24 icons, stroke paths ("F:" = filled)
def circle(cx, cy, r):
    return f"M{cx - r} {cy} A{r} {r} 0 1 0 {cx + r} {cy} A{r} {r} 0 1 0 {cx - r} {cy} Z"

ICONS = {
    "home": ["M3 10 L12 3 L21 10 L21 20 C21 20.6 20.6 21 20 21 L4 21 C3.4 21 3 20.6 3 20 Z", "M9 21 L9 13 L15 13 L15 21"],
    "globe": [circle(12, 12, 9.5), "M2.5 12 L21.5 12",
              "M12 2.5 C14.8 5.2 15.8 8.6 15.8 12 C15.8 15.4 14.8 18.8 12 21.5 C9.2 18.8 8.2 15.4 8.2 12 C8.2 8.6 9.2 5.2 12 2.5 Z"],
    "grid": ["M4 4 L10 4 L10 10 L4 10 Z", "M14 4 L20 4 L20 10 L14 10 Z", "M4 14 L10 14 L10 20 L4 20 Z",
             "M14 14 L20 14 L20 20 L14 20 Z"],
    "list": ["M8.5 6 L21 6", "M8.5 12 L21 12", "M8.5 18 L21 18", "F:" + circle(4, 6, 1.3), "F:" + circle(4, 12, 1.3),
             "F:" + circle(4, 18, 1.3)],
    "heart": ["M12 20.5 L4.6 13.3 C2.6 11.3 2.6 8.1 4.6 6.1 C6.6 4.1 9.8 4.1 11.8 6.1 L12 6.3 L12.2 6.1 C14.2 4.1 17.4 4.1 "
              "19.4 6.1 C21.4 8.1 21.4 11.3 19.4 13.3 Z"],
    "heart-filled": ["F:M12 20.5 L4.6 13.3 C2.6 11.3 2.6 8.1 4.6 6.1 C6.6 4.1 9.8 4.1 11.8 6.1 L12 6.3 L12.2 6.1 C14.2 "
                     "4.1 17.4 4.1 19.4 6.1 C21.4 8.1 21.4 11.3 19.4 13.3 Z"],
    "history": [circle(12, 12, 9), "M12 7 L12 12 L15.5 14"],
    "settings": [circle(12, 12, 3.2), "M12 2.5 L12 5.5", "M12 18.5 L12 21.5", "M2.5 12 L5.5 12", "M18.5 12 L21.5 12",
                 "M5.3 5.3 L7.4 7.4", "M16.6 16.6 L18.7 18.7", "M5.3 18.7 L7.4 16.6", "M16.6 7.4 L18.7 5.3"],
    "info": [circle(12, 12, 9), "M12 16 L12 11.5", "M12 8 L12.01 8"],
    "search": [circle(11, 11, 7), "M20.5 20.5 L16 16"],
    "play": ["F:M7.5 4.8 C7.5 4 8.4 3.5 9.1 3.9 L19.4 10.9 C20 11.3 20 12.7 19.4 13.1 L9.1 20.1 C8.4 20.5 7.5 20 7.5 "
             "19.2 Z"],
    "pause": ["F:M6 4 L10 4 L10 20 L6 20 Z", "F:M14 4 L18 4 L18 20 L14 20 Z"],
    "volume": ["M11 5 L6 9 L2.5 9 L2.5 15 L6 15 L11 19 Z", "M15.5 8.5 C17.5 10.5 17.5 13.5 15.5 15.5",
               "M18.5 5.5 C22 9 22 15 18.5 18.5"],
    "maximize": ["M15 3 L21 3 L21 9", "M9 21 L3 21 L3 15", "M21 3 L14 10", "M3 21 L10 14"],
    "pip": ["M3 5 L21 5 L21 19 L3 19 Z", "F:M12 12 L19 12 L19 17 L12 17 Z"],
    "chevron-right": ["M9 6 L15 12 L9 18"],
    "chevron-left": ["M15 6 L9 12 L15 18"],
    "share": [circle(18, 5, 2.5), circle(6, 12, 2.5), circle(18, 19, 2.5), "M8.2 10.8 L15.8 6.2", "M8.2 13.2 L15.8 17.8"],
    "user": [circle(12, 8, 4), "M4 21 C4 16.6 7.6 14 12 14 C16.4 14 20 16.6 20 21"],
    "more": ["F:" + circle(5, 12, 1.6), "F:" + circle(12, 12, 1.6), "F:" + circle(19, 12, 1.6)],
    "plus": ["M12 5 L12 19", "M5 12 L19 12"],
    "tv": ["M3 7 L21 7 L21 19 L3 19 Z", "M8 3 L12 7 L16 3"],
}

# ---------------------------------------------------------------- script builder
S, _n = [], [0]


def R(name, field=None):
    return {"$ref": name, "field": field} if field else {"$ref": name}


def step(cmd, params, name=None):
    d = {"command": cmd, "params": params}
    if name:
        d["as"] = name
    S.append(d)
    return R(name) if name else None


def uid(p="n"):
    _n[0] += 1
    return f"{p}{_n[0]}"


def F(parent=None, name="Frame", x=0, y=0, w=None, h=None, **props):
    props.setdefault("fills", [])
    p = {"name": name, "x": x, "y": y, "props": props, "select": False}
    if w is not None:
        p["width"] = w
    if h is not None:
        p["height"] = h
    if parent is not None:
        p["parent"] = parent
    return step("frame.create", p, uid("f"))


def _sizing(props):
    # a given width/height means a fixed size on that axis; otherwise hug the content
    props.setdefault("sizingH", "fixed" if "w" in props else "hug")
    props.setdefault("sizingV", "fixed" if "h" in props else "hug")


def row(parent, name="Row", gap=8, **props):
    _sizing(props)
    return F(parent, name, layout="horizontal", gap=gap, crossAlign=props.pop("crossAlign", "center"), **props)


def col(parent, name="Column", gap=8, **props):
    _sizing(props)
    return F(parent, name, layout="vertical", gap=gap, **props)


def spacer(parent, axis="h"):
    return F(parent, "Spacer", w=1, h=1, **({"sizingH": "fill"} if axis == "h" else {"sizingV": "fill"}))


def T(parent, text, size=14, style="Regular", color=TXT, name=None, width=None, **props):
    pr = {"fontFamily": FONT, "fontStyle": style, "fontSize": size, "fills": [color], **props}
    p = {"text": text, "x": 0, "y": 0, "props": pr, "select": False}
    if parent is not None:
        p["parent"] = parent
    if name:
        p["name"] = name
    if width:
        p["width"] = width
    return step("text.create", p, uid("t"))


def setp(ref, **props):
    step("node.set", {"id": ref, **props})


ICON = {}


def icon_components(parent_x, parent_y):
    """One 24x24 component per icon; x/y 0 keeps each path at its own 24-grid coordinates."""
    label("Icons", parent_x, parent_y - 28)
    for i, (name, paths) in enumerate(ICONS.items()):
        fr = F(None, f"Icon/{name}", x=parent_x + i * 40, y=parent_y, w=24, h=24)
        for d in paths:
            fill = d.startswith("F:")
            props = {"fill": "#ffffff", "stroke": "none"} if fill else {
                "fill": "none", "stroke": "#ffffff", "strokeWeight": 2, "strokeCap": "round", "strokeJoin": "round"}
            props["constraints"] = {"horizontal": "scale", "vertical": "scale"}
            step("vector.create", {"path": d[2:] if fill else d, "x": 0, "y": 0, "parent": fr, "props": props,
                                   "select": False})
        ICON[name] = step("component.create", {"ids": [fr]}, uid("ic"))


def inst(component, parent=None, name=None, **props):
    p = {"component": component}
    if parent is not None:
        p["parent"] = parent
    r = step("instance.create", p, uid("i"))
    if name or props:
        setp(r, **({"name": name} if name else {}), **props)
    return r


def icon(parent, name, size=20, opacity=1.0, lname="icon"):
    r = inst(ICON[name], parent, lname, width=size, height=size, opacity=opacity)
    return r


def find(root, name, typ=None):
    p = {"root": root, "name": name}
    if typ:
        p["type"] = typ
    return R(step("node.find", p, uid("q"))["$ref"], "ids/0")


def set_text(root, lname, text):
    step("text.set", {"id": find(root, lname, "TEXT"), "text": text})


def swap_icon(root, lname, name):
    step("instance.swap", {"ids": [find(root, lname, "INSTANCE")], "component": ICON[name]})


def variant_set(variants, name, x, y, gap=16, horizontal=False):
    """variants: [(variantName, builder(frame_ref))] -> component set ref."""
    refs = []
    for i, (vname, build) in enumerate(variants):
        dx, dy = (i * gap, 0) if horizontal else (0, i * gap)
        fr = build(x + dx, y + dy, vname)
        step("component.create", {"ids": [fr]})
        refs.append(fr)
    s = step("component.combineVariants", {"ids": refs}, uid("set"))
    step("object.rename", {"ids": [s], "name": name})
    return s


def label(text, x, y):
    t = T(None, text, 13, "SemiBold", SUB)
    setp(t, x=x, y=y)


# ================================================================ PAGE 1: Tokens
step("page.rename", {"name": "Tokens"})
step("page.setBackground", {"color": "#0d0c15"})
step("variable.createCollection", {"name": "Tokens"})
for n, v, _ in COLORS:
    step("variable.create", {"collection": "Tokens", "name": n, "type": "color", "value": v})
for s in SPACING:
    step("variable.create", {"collection": "Tokens", "name": f"space/{s}", "type": "number", "value": s})
for n, v in RADII:
    step("variable.create", {"collection": "Tokens", "name": f"radius/{n}", "type": "number", "value": v})
for n, v, *_ in [("font/display", FONT), ("font/body", FONT)]:
    step("variable.create", {"collection": "Tokens", "name": n, "type": "string", "value": v})


def V(name):
    return {"$var": name}


page = F(None, "Tokens", 0, 0, w=1440, fills=[INK], layout="vertical", padding=64, gap=56, sizingV="hug")
hdr = col(page, "Header", 8)
T(hdr, "IPTV Streamer — design tokens", 36, "Bold", TXT, letterSpacing="-1.5%")
T(hdr, "Night/violet palette, Inter type scale, 8px grid. Variables live in the “Tokens” collection.", 16,
  "Regular", MUT)


def section(parent, title, gap=16):
    s = col(parent, title, gap, sizingH="fill")
    T(s, title, 20, "SemiBold", TXT)
    return s


sec = section(page, "Color")
grid = F(sec, "Swatches", layout="horizontal", wrap=True, gap=16, crossGap=24, sizingH="fill", sizingV="hug")
for n, v, note in COLORS + [("Brand gradient", None, "135° violet → coral")]:
    c = col(grid, n, 8, w=184)
    sw = F(c, "swatch", w=184, h=88, cornerRadius=12, strokes=[LINE2], strokeWeight=1, fills=[v or GRAD])
    if v is not None:
        step("node.set", {"id": sw, "fill": V(n)})  # bound to the colour variable
    else:
        step("style.create", {"type": "paint", "name": "Brand/Gradient", "from": sw})
    T(c, n.replace("color/", ""), 13, "SemiBold", TXT)
    T(c, (v or "#8b5cf6 → #f43f5e").upper(), 12, "SemiBold", MUT)
    T(c, note, 12, "Regular", SUB)

sec = section(page, "Type scale — Inter")
for name, size, weight, lh, ls, sample in TYPE:
    r = row(sec, name, 32, crossAlign="center")
    meta = col(r, "meta", 2, w=200)
    T(meta, name, 13, "SemiBold", LIL)
    T(meta, f"{size}/{lh} · {weight} · {ls}", 12, "Regular", SUB)
    t = T(r, sample, size, weight, TXT, lineHeight=lh, letterSpacing=ls)
    step("style.create", {"type": "text", "name": name, "from": t})

sec = section(page, "Spacing — 8px grid (4 for tight pairs)")
r = row(sec, "bars", 32, crossAlign="max")
for s in SPACING:
    c = col(r, f"space/{s}", 8, crossAlign="center")
    F(c, "bar", w=s, h=48, fills=[GRAD], cornerRadius=2)
    T(c, str(s), 12, "SemiBold", MUT)

sec = section(page, "Radius")
r = row(sec, "radii", 32)
for n, v in RADII:
    c = col(r, f"radius/{n}", 8, crossAlign="center")
    F(c, "shape", w=96 if n != "full" else 160, h=64, fills=[CARD], strokes=[LINE2], strokeWeight=1, cornerRadius=v)
    T(c, f"{n} · {v}", 12, "SemiBold", MUT)

sec = section(page, "Effects")
r = row(sec, "effects", 48, padding=[8, 8, 24, 8])
GLOW = [{"type": "dropShadow", "color": "#8b5cf673", "offset": [0, 8], "radius": 24, "spread": -4}]
LIFT = [{"type": "dropShadow", "color": "#00000066", "offset": [0, 12], "radius": 32, "spread": -8}]
for n, eff, fills in (("Glow/Primary", GLOW, [GRAD]), ("Shadow/Card hover", LIFT, [CARD_H])):
    c = col(r, n, 12, crossAlign="center")
    b = F(c, "sample", w=200, h=72, fills=fills, cornerRadius=14, effects=eff)
    step("style.create", {"type": "effect", "name": n, "from": b})
    T(c, n, 12, "SemiBold", MUT)

# ================================================================ PAGE 2: Components
pc = step("page.add", {"name": "Components"}, "page_components")
step("page.select", {"id": pc})
step("page.setBackground", {"color": "#0d0c15"})
icon_components(0, 40)

# ---- Button: Primary (gradient glow), Secondary (glass), Ghost
BTN = {
    "Primary": dict(fills=[GRAD], effects=GLOW, label=TXT, iop=1.0),
    "Secondary": dict(fills=["#ffffff0f"], strokes=["#ffffff1f"], strokeWeight=1,
                      effects=[{"type": "backgroundBlur", "radius": 16}], label=TXT, iop=1.0),
    "Ghost": dict(fills=[], label=MUT, iop=0.7),
}


def build_button(kind):
    def b(x, y, vname):
        cfg = dict(BTN[kind])
        lab, iop = cfg.pop("label"), cfg.pop("iop")
        fr = F(None, vname, x, y, h=44, layout="horizontal", gap=8, padding=[0, 20, 0, 18], crossAlign="center",
               sizingH="hug", cornerRadius=12, **cfg)
        icon(fr, "play", 18, iop)
        T(fr, "Start watching", 14, "SemiBold", lab, name="label")
        return fr
    return b


label("Button", 0, 112)
BUTTON = variant_set([(f"Variant={k}", build_button(k)) for k in BTN], "Button", 0, 140, gap=64)

# ---- Badge: Live, Neutral, Accent
def build_badge(kind):
    def b(x, y, vname):
        fill, col_, txt, bold = {"Live": ("#f43f5e26", LIVE, "LIVE", "Bold"),
                                 "Neutral": ("#ffffff0f", MUT, "128 channels", "SemiBold"),
                                 "Accent": ("#8b5cf62e", LIL, "HD", "Bold")}[kind]
        fr = F(None, vname, x, y, h=22, layout="horizontal", gap=6, padding=[0, 8, 0, 8], crossAlign="center",
               sizingH="hug", cornerRadius=999, fills=[fill])
        if kind == "Live":
            F(fr, "dot", w=6, h=6, fills=[LIVE], cornerRadius=3, effects=[
                {"type": "dropShadow", "color": "#fb7185b3", "offset": [0, 0], "radius": 6}])
        T(fr, txt, 11, bold, col_, name="label", letterSpacing="4%" if kind != "Neutral" else "0%")
        return fr
    return b


label("Badge", 280, 112)
BADGE = variant_set([(f"Variant={k}", build_badge(k)) for k in ("Live", "Neutral", "Accent")], "Badge", 280, 140,
                    gap=40)

# ---- NavItem: Default / Active
def build_nav(state):
    def b(x, y, vname):
        active = state == "Active"
        fr = F(None, vname, x, y, w=208, h=40, layout="horizontal", gap=12, padding=[0, 12, 0, 12],
               crossAlign="center", cornerRadius=10, fills=["#8b5cf61f"] if active else [])
        if active:
            bar = F(fr, "indicator", w=3, h=20, fills=[GRAD], cornerRadius=2)
            setp(bar, absolute=True, x=0, y=10)
        icon(fr, "home", 20, 1.0 if active else 0.55)
        T(fr, "Home", 14, "SemiBold" if active else "Regular", TXT if active else MUT, name="label")
        return fr
    return b


label("NavItem", 480, 112)
NAV = variant_set([(f"State={s}", build_nav(s)) for s in ("Default", "Active")], "NavItem", 480, 140, gap=56)

# ---- SearchInput
label("SearchInput", 760, 112)
si = F(None, "SearchInput", 760, 140, w=480, h=44, layout="horizontal", gap=10, padding=[0, 12, 0, 14],
       crossAlign="center", cornerRadius=12, fills=[CARD], strokes=["#ffffff14"], strokeWeight=1)
icon(si, "search", 18, 0.5)
T(si, "Search channels, countries, categories", 14, "Regular", SUB, name="placeholder", sizingH="fill")
kbd = row(si, "kbd", 0, padding=[2, 7, 2, 7], cornerRadius=6, strokes=[LINE2], strokeWeight=1)
T(kbd, "/", 12, "SemiBold", MUT)
SEARCH = step("component.create", {"ids": [si]}, "c_search")

# ---- ChannelCard: Default / Hover
def build_card(state):
    def b(x, y, vname):
        hover = state == "Hover"
        fr = F(None, vname, x, y, w=272, h=80, layout="horizontal", gap=12, padding=12, crossAlign="center",
               cornerRadius=14, fills=[CARD_H if hover else CARD], strokes=["#8b5cf666" if hover else LINE],
               strokeWeight=1, effects=LIFT if hover else [])
        logo = F(fr, "logo", w=56, h=56, cornerRadius=12, clip=True, layout="horizontal", mainAlign="center",
                 crossAlign="center", fills=[{"type": "linearGradient", "stops": ["#6366f1", "#8b5cf6"],
                                              "from": [0, 0], "to": [1, 1]}])
        T(logo, "WN", 18, "Bold", "#ffffff", name="initials", letterSpacing="-2%")
        ov = F(logo, "play-overlay", w=56, h=56, fills=["#12111db3"], layout="horizontal", mainAlign="center",
               crossAlign="center", visible=hover)
        setp(ov, absolute=True, x=0, y=0)
        icon(ov, "play", 22, 1.0)
        info = col(fr, "info", 6, sizingH="fill")
        T(info, "World News 24", 14, "SemiBold", TXT, name="title", sizingH="fill", maxLines=1)
        meta = row(info, "meta-row", 8)
        inst(BADGE, meta, "badge")
        T(meta, "News · UK", 12, "Regular", MUT, name="group")
        icon(fr, "heart", 20, 1.0 if hover else 0.45, lname="fav")
        return fr
    return b


label("ChannelCard", 0, 360)
CARDC = variant_set([(f"State={s}", build_card(s)) for s in ("Default", "Hover")], "ChannelCard", 0, 388, gap=104)

# ---- CountryRow: Default / Hover
def build_country(state):
    def b(x, y, vname):
        hover = state == "Hover"
        fr = F(None, vname, x, y, w=368, h=56, layout="horizontal", gap=12, padding=[0, 14, 0, 16],
               crossAlign="center", cornerRadius=12, fills=[CARD_H if hover else CARD],
               strokes=["#8b5cf666" if hover else LINE], strokeWeight=1)
        F(fr, "flag", w=28, h=20, cornerRadius=4, fills=[{"type": "linearGradient", "stops": ["#3b82f6", "#ef4444"],
                                                         "from": [0, 0.5], "to": [1, 0.5]}],
          strokes=["#ffffff26"], strokeWeight=1)
        T(fr, "United Kingdom", 14, "SemiBold", TXT, name="country", sizingH="fill")
        b_ = inst(BADGE, fr, "count")
        step("instance.setProperties", {"ids": [b_], "properties": {"Variant": "Neutral"}})
        icon(fr, "chevron-right", 18, 0.9 if hover else 0.35, lname="chevron")
        return fr
    return b


label("CountryRow", 320, 360)
COUNTRY = variant_set([(f"State={s}", build_country(s)) for s in ("Default", "Hover")], "CountryRow", 320, 388,
                      gap=80)

# ---- Chip (tabs / filters): Default / Active
def build_chip(state):
    def b(x, y, vname):
        active = state == "Active"
        fr = F(None, vname, x, y, h=36, layout="horizontal", gap=6, padding=[0, 16, 0, 16], crossAlign="center",
               sizingH="hug", cornerRadius=999, fills=[GRAD] if active else ["#ffffff0a"],
               strokes=[] if active else [LINE2], strokeWeight=1, effects=GLOW if active else [])
        T(fr, "All", 13, "SemiBold" if active else "Regular", "#ffffff" if active else MUT, name="label")
        return fr
    return b


label("Chip", 740, 360)
CHIP = variant_set([(f"State={s}", build_chip(s)) for s in ("Default", "Active")], "Chip", 740, 388, gap=56)

# ---- TabBar (mobile)
label("TabBar", 860, 360)
tb = F(None, "TabBar", 860, 388, w=390, h=84, layout="horizontal", padding=[10, 8, 26, 8], crossAlign="min",
       fills=["#17161ff2"], strokes=[LINE], strokeTopWeight=1, strokeAlign="inside",
       effects=[{"type": "backgroundBlur", "radius": 20}])
for i, (nm, ic) in enumerate((("Home", "home"), ("Browse", "globe"), ("Search", "search"), ("Favorites", "heart"),
                              ("More", "more"))):
    it = col(tb, f"tab-{nm.lower()}", 4, sizingH="fill", crossAlign="center")
    if i == 0:
        F(it, "pill", w=20, h=3, fills=[GRAD], cornerRadius=2)
    else:
        F(it, "pill", w=20, h=3, fills=[])
    icon(it, ic, 24, 1.0 if i == 0 else 0.5)
    T(it, nm, 11, "SemiBold" if i == 0 else "Regular", TXT if i == 0 else SUB, name="tab-label")
TABBAR = step("component.create", {"ids": [tb]}, "c_tabbar")

# ================================================================ PAGE 3: Screens
ps = step("page.add", {"name": "Screens"}, "page_screens")
step("page.select", {"id": ps})
step("page.setBackground", {"color": "#0d0c15"})

CHANNELS = [  # name, initials, group, gradient
    ("World News 24", "WN", "News · UK", ("#6366f1", "#8b5cf6")),
    ("Sport One", "S1", "Sports · ES", ("#f97316", "#f43f5e")),
    ("Cinema Classics", "CC", "Movies · FR", ("#a855f7", "#ec4899")),
    ("Kids Planet", "KP", "Kids · BR", ("#22c55e", "#14b8a6")),
    ("Music Wave", "MW", "Music · DE", ("#ec4899", "#f43f5e")),
    ("Science Now", "SN", "Science · JP", ("#0ea5e9", "#6366f1")),
    ("Travel & Taste", "TT", "Travel · IT", ("#f59e0b", "#f97316")),
    ("Business Daily", "BD", "Business · USA", ("#64748b", "#6366f1")),
    ("Comedy Club", "CO", "Comedy · CA", ("#eab308", "#f97316")),
    ("Nature HD", "NH", "Outdoor · NO", ("#10b981", "#0ea5e9")),
    ("Doc Channel", "DC", "Docs · UK", ("#8b5cf6", "#0ea5e9")),
    ("Weather 24/7", "W7", "Weather · AU", ("#38bdf8", "#818cf8")),
]


def card(parent, ch, hover=False, fill=False):
    name, ini, group, (g0, g1) = ch
    c = inst(CARDC, parent)
    if hover:
        step("instance.setProperties", {"ids": [c], "properties": {"State": "Hover"}})
    if fill:
        setp(c, sizingH="fill")
    set_text(c, "title", name)
    set_text(c, "initials", ini)
    set_text(c, "group", group)
    step("node.set", {"id": find(c, "logo", "FRAME"),
                      "fills": [{"type": "linearGradient", "stops": [g0, g1], "from": [0, 0], "to": [1, 1]}]})
    return c


def button(parent, kind, text, ic):
    b = inst(BUTTON, parent)
    step("instance.setProperties", {"ids": [b], "properties": {"Variant": kind}})
    set_text(b, "label", text)
    swap_icon(b, "icon", ic)
    return b


def badge(parent, kind, text=None):
    b = inst(BADGE, parent)
    step("instance.setProperties", {"ids": [b], "properties": {"Variant": kind}})
    if text:
        set_text(b, "label", text)
    return b


def chip(parent, text, active=False):
    c = inst(CHIP, parent)
    if active:
        step("instance.setProperties", {"ids": [c], "properties": {"State": "Active"}})
    set_text(c, "label", text)
    return c


def logo_tile(parent, size=32):
    t = F(parent, "logo-mark", w=size, h=size, cornerRadius=size * 0.25, fills=[GRAD], layout="horizontal",
          mainAlign="center", crossAlign="center", effects=GLOW)
    icon(t, "play", size * 0.5, 1.0)
    return t


def sidebar(parent, active):
    sb = F(parent, "Sidebar", w=240, layout="vertical", gap=4, padding=[24, 16, 24, 16], sizingV="fill",
           fills=[SURF], strokes=[LINE], strokeRightWeight=1, strokeAlign="inside")
    brand = row(sb, "brand", 12, padding=[0, 8, 24, 8])
    logo_tile(brand, 32)
    T(brand, "IPTV Streamer", 16, "Bold", TXT, letterSpacing="-1%")
    T(sb, "WATCH", 11, "Bold", SUB, letterSpacing="8%")
    for nm, ic in (("Home", "home"), ("Browse countries", "globe"), ("Categories", "grid"), ("Playlists", "list"),
                   ("Favorites", "heart"), ("History", "history")):
        n = inst(NAV, sb)
        if nm == active:
            step("instance.setProperties", {"ids": [n], "properties": {"State": "Active"}})
        set_text(n, "label", nm)
        swap_icon(n, "icon", ic)
    spacer(sb, "v")
    # now-playing mini card
    np_ = col(sb, "now-playing", 10, sizingH="fill", padding=12, cornerRadius=14, fills=[CARD], strokes=[LINE],
              strokeWeight=1)
    top = row(np_, "np-top", 8)
    badge(top, "Live")
    T(top, "Now playing", 12, "Regular", MUT)
    T(np_, "World News 24", 14, "SemiBold", TXT)
    bar = F(np_, "progress", h=4, sizingH="fill", fills=["#ffffff14"], cornerRadius=2, layout="horizontal")
    F(bar, "value", w=120, h=4, fills=[GRAD], cornerRadius=2)
    F(sb, "gap", w=1, h=12)
    for nm, ic in (("Settings", "settings"), ("About", "info")):
        n = inst(NAV, sb)
        set_text(n, "label", nm)
        swap_icon(n, "icon", ic)
    return sb


def section_header(parent, title, action="See all"):
    h = row(parent, f"{title} header", 12, sizingH="fill")
    T(h, title, 20, "SemiBold", TXT, letterSpacing="-0.5%")
    spacer(h)
    if action:  # text link with a trailing chevron
        a = row(h, "action", 4)
        T(a, action, 14, "SemiBold", LIL)
        icon(a, "chevron-right", 16, 0.8)
    return h


def topbar(parent, placeholder="Search channels, countries, categories"):
    tb_ = row(parent, "Topbar", 12, sizingH="fill")
    s = inst(SEARCH, tb_)
    set_text(s, "placeholder", placeholder)
    spacer(tb_)
    button(tb_, "Secondary", "Add playlist", "plus")
    av = F(tb_, "avatar", w=40, h=40, cornerRadius=20, fills=["#ffffff0f"], strokes=[LINE2], strokeWeight=1,
           layout="horizontal", mainAlign="center", crossAlign="center")
    icon(av, "user", 20, 0.8)
    return tb_


def hero_bg(fr, overlay_from=(0, 0.5), overlay_to=(1, 0.5)):
    step("image.place", {"path": HERO, "target": fr, "mode": "crop"})
    step("fill.add", {"ids": [fr], "paint": {"type": "linearGradient",
                                             "stops": ["#12111df5", "#12111dcc", "#12111d1a"],
                                             "from": list(overlay_from), "to": list(overlay_to)}})


# ---------------- Home 1440 x 1000
home = F(None, "screen-home", 0, 0, w=1440, h=1000, fills=[INK], layout="horizontal", clip=True)
sidebar(home, "Home")
main = col(home, "Main", 32, sizingH="fill", sizingV="fill", padding=[24, 32, 32, 32])
topbar(main)
hero = F(main, "Hero", h=296, sizingH="fill", cornerRadius=20, clip=True, fills=[INK], layout="vertical", gap=16,
         padding=[40, 48, 40, 48], mainAlign="center", strokes=[LINE], strokeWeight=1)
hero_bg(hero)
badge(hero, "Live", "LIVE · 12,480 CHANNELS")
T(hero, "Live TV from every\ncorner of the world", 48, "Bold", TXT, lineHeight="110%", letterSpacing="-2%")
T(hero, "Free, public channels from 190+ countries — news, sport, movies and more.", 16, "Regular", MUT)
br = row(hero, "actions", 12, padding=[8, 0, 0, 0])
button(br, "Primary", "Start watching", "play")
button(br, "Secondary", "Browse countries", "globe")

sec = col(main, "Continue watching", 16, sizingH="fill")
section_header(sec, "Continue watching")
r = row(sec, "cards", 16, sizingH="fill")
for ch in CHANNELS[:4]:
    card(r, ch, fill=True)

sec = col(main, "Popular now", 16, sizingH="fill")
section_header(sec, "Popular now")
g = F(sec, "grid", layout="horizontal", wrap=True, gap=16, crossGap=16, sizingH="fill", sizingV="hug")
for i, ch in enumerate(CHANNELS[4:12]):
    card(g, ch, hover=(i == 1))

sec = col(main, "Categories", 16, sizingH="fill")
section_header(sec, "Browse by category")
r = row(sec, "categories", 12, sizingH="fill")
for cat, n in (("news", "1,204"), ("sports", "642"), ("movies", "910"), ("music", "488"), ("kids", "236"),
               ("documentary", "318")):
    c = row(r, f"cat-{cat}", 12, sizingH="fill", padding=[10, 12, 10, 10], cornerRadius=14, fills=[CARD],
            strokes=[LINE], strokeWeight=1)
    im = step("file.import", {"path": f"{ICONS_DIR}/cat-{cat}.svg", "x": 0, "y": 0}, uid("imp"))
    step("node.reparent", {"ids": [im], "parent": c})
    setp(im, name=f"icon-{cat}")
    step("transform.scale", {"ids": [im], "factor": 40 / 48})
    tc = col(c, "text", 2)
    T(tc, cat.capitalize(), 14, "SemiBold", TXT)
    T(tc, f"{n} channels", 12, "Regular", MUT)

# ---------------- Browse 1440 x 1000
browse = F(None, "screen-browse", 1540, 0, w=1440, h=1000, fills=[INK], layout="horizontal", clip=True)
sidebar(browse, "Browse countries")
main = col(browse, "Main", 32, sizingH="fill", sizingV="fill", padding=[32, 32, 32, 32])
hd = row(main, "Header", 24, sizingH="fill", crossAlign="max")
tc = col(hd, "titles", 8, sizingH="fill")
T(tc, "Browse by country", 36, "Bold", TXT, letterSpacing="-1.5%")
T(tc, "198 countries · 12,480 live channels. Pick a country to see what’s on.", 16, "Regular", MUT)
s = inst(SEARCH, hd)
setp(s, width=360)
set_text(s, "placeholder", "Filter countries")
r = row(main, "regions", 8)
for i, reg in enumerate(("All", "Europe", "Asia", "Americas", "Africa", "Middle East", "Oceania")):
    chip(r, reg, i == 0)

FEAT = [("United States", "2,140", ("#3b82f6", "#ef4444")), ("India", "1,320", ("#f97316", "#22c55e")),
        ("France", "860", ("#2563eb", "#ef4444")), ("Brazil", "740", ("#22c55e", "#eab308"))]
sec = col(main, "Featured", 16, sizingH="fill")
section_header(sec, "Most channels", None)
r = row(sec, "featured", 16, sizingH="fill")
for nm, n, (a, b_) in FEAT:
    c = col(r, f"feat-{nm}", 12, sizingH="fill", h=148, padding=20, cornerRadius=16, mainAlign="max",
            fills=[CARD, {"type": "linearGradient", "stops": [a + "40", b_ + "14"], "from": [0, 0], "to": [1, 1]}],
            strokes=[LINE2], strokeWeight=1, clip=True)
    setp(c, sizingV="fixed")
    F(c, "flag", w=40, h=28, cornerRadius=5, fills=[{"type": "linearGradient", "stops": [a, b_], "from": [0, 0.5],
                                                      "to": [1, 0.5]}], strokes=["#ffffff33"], strokeWeight=1)
    T(c, nm, 20, "Bold", TXT, letterSpacing="-0.5%")
    badge(c, "Neutral", f"{n} channels")

COUNTRIES = [("United Kingdom", "512", ("#1d4ed8", "#dc2626")), ("Germany", "430", ("#111827", "#eab308")),
             ("Italy", "388", ("#16a34a", "#dc2626")), ("Spain", "352", ("#dc2626", "#eab308")),
             ("Mexico", "301", ("#16a34a", "#dc2626")), ("Japan", "288", ("#f8fafc", "#dc2626")),
             ("Canada", "274", ("#dc2626", "#f8fafc")), ("Turkey", "262", ("#dc2626", "#f8fafc")),
             ("South Korea", "240", ("#f8fafc", "#2563eb")), ("Netherlands", "226", ("#dc2626", "#1d4ed8")),
             ("Argentina", "214", ("#7dd3fc", "#f8fafc")), ("Poland", "198", ("#f8fafc", "#dc2626")),
             ("Israel", "184", ("#f8fafc", "#2563eb")), ("Australia", "176", ("#1d4ed8", "#dc2626")),
             ("Portugal", "160", ("#16a34a", "#dc2626")), ("Greece", "152", ("#2563eb", "#f8fafc")),
             ("Sweden", "141", ("#2563eb", "#eab308")), ("Egypt", "133", ("#dc2626", "#111827"))]
sec = col(main, "All countries", 16, sizingH="fill")
section_header(sec, "All countries", "Sort: most channels")
g = F(sec, "grid", layout="horizontal", wrap=True, gap=16, crossGap=12, sizingH="fill", sizingV="hug")
for i, (nm, n, (a, b_)) in enumerate(COUNTRIES):
    c = inst(COUNTRY, g)
    if i == 4:
        step("instance.setProperties", {"ids": [c], "properties": {"State": "Hover"}})
    setp(c, width=368)
    set_text(c, "country", nm)
    set_text(c, "label", f"{n} channels")
    step("node.set", {"id": find(c, "flag", "FRAME"),
                      "fills": [{"type": "linearGradient", "stops": [a, b_], "from": [0, 0.5], "to": [1, 0.5]}]})

# ---------------- Player 1440 x 900
player = F(None, "screen-player", 3080, 0, w=1440, h=900, fills=[INK], layout="vertical", clip=True)
tb_ = row(player, "Topbar", 16, sizingH="fill", h=64, padding=[0, 24, 0, 16], fills=[SURF], strokes=[LINE],
          strokeBottomWeight=1, strokeAlign="inside")
setp(tb_, sizingV="fixed")
button(tb_, "Ghost", "Back", "chevron-left")
crumbs = row(tb_, "breadcrumb", 8)
T(crumbs, "News", 14, "Regular", MUT)
T(crumbs, "/", 14, "Regular", SUB)
T(crumbs, "World News 24", 14, "SemiBold", TXT)
spacer(tb_)
s = inst(SEARCH, tb_)
setp(s, width=320)
set_text(s, "placeholder", "Search channels")
logo_tile(tb_, 32)

body = row(player, "Body", 24, sizingH="fill", sizingV="fill", padding=[24, 24, 24, 24], crossAlign="min")
left = col(body, "Watch", 16, sizingH="fill")
video = F(left, "Video", w=1008, h=567, cornerRadius=16, clip=True, fills=["#000000"])
step("image.place", {"path": HERO, "target": video, "mode": "crop"})
step("fill.add", {"ids": [video], "paint": {"type": "linearGradient", "stops": ["#12111d00", "#12111d00", "#12111de6"],
                                            "from": [0.5, 0], "to": [0.5, 1]}})
tl = row(video, "video-badges", 8)
setp(tl, absolute=True, x=20, y=20)
badge(tl, "Live")
badge(tl, "Accent", "1080p")
pb = F(video, "big-play", w=80, h=80, cornerRadius=40, fills=["#ffffff26"], strokes=["#ffffff40"], strokeWeight=1,
       layout="horizontal", mainAlign="center", crossAlign="center",
       effects=[{"type": "backgroundBlur", "radius": 20}] + GLOW)
setp(pb, absolute=True, x=464, y=243)
icon(pb, "play", 32, 1.0)
ctl = row(video, "controls", 16, w=1008, h=64, padding=[0, 20, 0, 20], sizingH="fixed")
setp(ctl, absolute=True, x=0, y=503, sizingV="fixed")
icon(ctl, "pause", 22, 1.0)
icon(ctl, "volume", 22, 0.9)
vol = F(ctl, "volume-bar", w=80, h=4, fills=["#ffffff33"], cornerRadius=2, layout="horizontal")
F(vol, "value", w=56, h=4, fills=["#ffffff"], cornerRadius=2)
lv = row(ctl, "live", 6)
F(lv, "dot", w=8, h=8, cornerRadius=4, fills=[LIVE])
T(lv, "LIVE", 12, "Bold", TXT, letterSpacing="6%")
spacer(ctl)
T(ctl, "Auto · 1080p", 12, "SemiBold", MUT)
icon(ctl, "pip", 22, 0.9)
icon(ctl, "maximize", 22, 0.9)

info = row(left, "Channel info", 16, sizingH="fill", h=96, padding=[0, 20, 0, 20], cornerRadius=16, fills=[CARD],
           strokes=[LINE], strokeWeight=1)
setp(info, sizingV="fixed")
lt = F(info, "logo", w=56, h=56, cornerRadius=12, layout="horizontal", mainAlign="center", crossAlign="center",
       fills=[{"type": "linearGradient", "stops": ["#6366f1", "#8b5cf6"], "from": [0, 0], "to": [1, 1]}])
T(lt, "WN", 18, "Bold", "#ffffff")
ic_ = col(info, "titles", 6, sizingH="fill")
T(ic_, "World News 24", 20, "Bold", TXT, letterSpacing="-0.5%")
m = row(ic_, "meta", 8)
badge(m, "Live")
T(m, "News · United Kingdom · English · 24/7 headlines", 13, "Regular", MUT)
button(info, "Secondary", "Favorite", "heart")
button(info, "Secondary", "Share", "share")
button(info, "Ghost", "More", "more")

sched = row(left, "Schedule", 16, sizingH="fill")
for t_, title, now in (("Now · 14:00", "Midday Headlines", True), ("15:00", "Markets Today", False),
                        ("16:00", "World Report", False), ("17:00", "Weather & Travel", False)):
    c = col(sched, title, 4, sizingH="fill", padding=[12, 16, 12, 16], cornerRadius=12,
            fills=["#8b5cf61f" if now else CARD], strokes=["#8b5cf659" if now else LINE], strokeWeight=1)
    T(c, t_, 12, "SemiBold" if now else "Regular", LIL if now else SUB)
    T(c, title, 14, "SemiBold", TXT)

right = col(body, "Up next", 12, w=360)
h = row(right, "header", 8, sizingH="fill")
T(h, "Up next", 16, "SemiBold", TXT)
spacer(h)
badge(h, "Neutral", "News · 24")
for i, ch in enumerate([CHANNELS[0], CHANNELS[10], CHANNELS[7], CHANNELS[5], CHANNELS[11], CHANNELS[1],
                        CHANNELS[2]]):
    card(right, ch, hover=(i == 1), fill=True)

# ---------------- Mobile Home 390 x 844
mob = F(None, "screen-mobile-home", 4620, 0, w=390, h=844, fills=[INK], layout="vertical", clip=True,
        cornerRadius=0)
st = row(mob, "status-bar", 0, w=390, h=44, padding=[0, 28, 0, 32], sizingH="fixed", mainAlign="spaceBetween")
setp(st, sizingV="fixed")
T(st, "9:41", 15, "SemiBold", TXT)
bat = row(st, "battery", 4)
F(bat, "signal", w=18, h=11, cornerRadius=2, fills=["#ffffffcc"])
F(bat, "cell", w=24, h=12, cornerRadius=3, strokes=["#ffffffb3"], strokeWeight=1)
hd = row(mob, "header", 12, sizingH="fill", padding=[8, 16, 8, 16])
logo_tile(hd, 32)
T(hd, "IPTV Streamer", 17, "Bold", TXT, letterSpacing="-1%")
spacer(hd)
sb_ = F(hd, "search-button", w=40, h=40, cornerRadius=20, fills=["#ffffff0f"], strokes=[LINE2], strokeWeight=1,
        layout="horizontal", mainAlign="center", crossAlign="center")
icon(sb_, "search", 20, 0.85)
content = col(mob, "content", 24, sizingH="fill", sizingV="fill", padding=[8, 16, 0, 16], clip=True)
setp(content, sizingV="fill")
mh = F(content, "Hero", h=196, sizingH="fill", cornerRadius=20, clip=True, fills=[INK], layout="vertical", gap=10,
       padding=20, mainAlign="max", strokes=[LINE], strokeWeight=1)
hero_bg(mh, (0.5, 1), (0.5, 0))
badge(mh, "Live", "LIVE · 12,480 CHANNELS")
T(mh, "Live TV, worldwide", 26, "Bold", TXT, letterSpacing="-1.5%")
button(mh, "Primary", "Start watching", "play")
r = row(content, "chips", 8)
for i, nm in enumerate(("All", "News", "Sports", "Movies", "Music", "Kids")):
    chip(r, nm, i == 0)
sec = col(content, "Continue watching", 12, sizingH="fill")
section_header(sec, "Continue watching", None)
r = row(sec, "cards", 12)
for ch in CHANNELS[:2]:
    card(r, ch)
sec = col(content, "Popular", 12, sizingH="fill")
section_header(sec, "Popular now", None)
for ch in CHANNELS[4:7]:
    card(sec, ch, fill=True)
tbi = inst(TABBAR, mob)
setp(tbi, absolute=True, x=0, y=760)

# ---------------------------------------------------------------- write + run
json.dump([{"command": "command.batch", "params": {"label": "Build IPTV design", "commands": S}}],
          open(SCRIPT, "w", encoding="utf-8"), indent=1)
print(f"wrote {len(S)} steps to {os.path.relpath(SCRIPT, ROOT)}")
if "--script" in sys.argv:
    sys.exit(0)


def run(*args):
    r = subprocess.run([CLI, *args], capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        sys.exit(f"figcraft-cli {args[0]} failed:\n{r.stdout[-3000:]}\n{r.stderr[-3000:]}")
    return r.stdout


run("run", SCRIPT, "--out", FILE)
print("saved", os.path.relpath(FILE, ROOT))

renders = os.path.join(HERE, "renders")
os.makedirs(renders, exist_ok=True)
run("export", FILE, "--page", "Screens", "--out", renders, "--format", "png")
for pg in ("Tokens", "Components"):
    run("render", FILE, "--page", pg, "--out", os.path.join(renders, f"page-{pg.lower()}.png"))
print("rendered", ", ".join(sorted(os.listdir(renders))))

# component code + tokens
code = os.path.join(HERE, "code")
os.makedirs(code, exist_ok=True)
q = []
for nm in ("Button", "ChannelCard", "CountryRow"):
    q.append({"command": "node.find", "params": {"name": nm, "type": "COMPONENT_SET", "limit": 1}, "as": f"f{nm}"})
    q.append({"command": "inspect.componentCode", "params": {"id": {"$ref": f"f{nm}", "field": "ids/0"},
                                                             "language": "react"}})
    q.append({"command": "inspect.code", "params": {"id": {"$ref": f"f{nm}", "field": "ids/0"},
                                                    "language": "tailwind"}})
q.append({"command": "variable.export", "params": {"format": "css"}})
q.append({"command": "variable.export", "params": {"format": "tailwind"}})
qp = os.path.join(HERE, "renders", "_code.json")
json.dump([{"command": "page.select", "params": {"index": 1}},
           {"command": "command.batch", "params": {"commands": q}}], open(qp, "w"))
out = run("run", qp, "--in", FILE)
os.remove(qp)
res = [json.loads(l) for l in out.splitlines() if l.startswith("{")][-1]["result"]
for i, nm in enumerate(("Button", "ChannelCard", "CountryRow")):
    react, tw = res[i * 3 + 1], res[i * 3 + 2]
    open(os.path.join(code, f"{nm}.tsx"), "w", encoding="utf-8").write(
        f"// Generated by FigCraft (inspect.componentCode, react) from iptv-design.figcraft.\n{react['definition']}")
    open(os.path.join(code, f"{nm}.tailwind.jsx"), "w", encoding="utf-8").write(
        f"// Generated by FigCraft (inspect.code, tailwind) from iptv-design.figcraft.\n{tw['code']}")
open(os.path.join(code, "tokens.css"), "w", encoding="utf-8").write(res[-2]["text"])
open(os.path.join(code, "tokens.tailwind.css"), "w", encoding="utf-8").write(res[-1]["text"])
print("code:", ", ".join(sorted(os.listdir(code))))
