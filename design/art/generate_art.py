"""Writes VectorCraft command lists for the category icons, fallbacks and OG image.

Usage:  python design/art/generate_art.py design/art
        python design/art/export_art.py            (runs vectorcraft-cli on every command list)
Targets (relative to the repo root):
  cat-<id>          -> public/brand/icons/cat-<id>.svg      (48 x 48)
  channel-fallback  -> public/brand/channel-fallback.svg    (96 x 96)
  stream-error      -> public/brand/stream-error.svg        (480 x 270, transparent)
  og-image          -> public/og-image.svg + public/og-image.png (1200 x 630)
"""
import colorsys, json, math, os, random, re, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
VIO, COR, INK, LIL = "#8b5cf6", "#f43f5e", "#12111d", "#a78bfa"


def C(cmd, **p):
    return {"command": cmd, "params": p}


def nostroke():
    return C("paint.setStroke", none=True)


def nofill():
    return C("paint.setFill", none=True)


def lin(angle, *stops):
    return {"kind": "linear", "angle": angle, "stops": [
        {"offset": o, "color": c, **({"opacity": a} if a is not None else {})} for o, c, a in stops]}


def glow(x, y, w, h, color, op, mid=None):
    stops = [{"offset": 0, "color": color, "opacity": op}]
    if mid:
        stops.append({"offset": mid[0], "color": color, "opacity": mid[1]})
    stops.append({"offset": 1, "color": color, "opacity": 0})
    return [C("shape.ellipse", x=x - w / 2, y=y - h / 2, width=w, height=h),
            C("paint.setFill", gradient={"kind": "radial", "stops": stops, "aspect": h / w * 100}), nostroke()]


def stroked(d, weight, color="#ffffff", op=100, gradient=None, closed=False):
    s = C("paint.setStroke", gradient=gradient) if gradient else C("paint.setStroke", color=color)
    return [C("path.create", d=d, closed=closed), nofill(), s,
            C("stroke.set", weight=weight, cap="round", join="round"), C("transparency.set", opacity=op)]


def filled(d, color="#ffffff", op=100, gradient=None):
    f = C("paint.setFill", gradient=gradient) if gradient else C("paint.setFill", color=color)
    return [C("path.create", d=d, closed=True), f, nostroke(), C("transparency.set", opacity=op)]


def circle(cx, cy, r):
    return f"M{cx - r} {cy} A{r} {r} 0 1 0 {cx + r} {cy} A{r} {r} 0 1 0 {cx - r} {cy} Z"


def move(d, dx, dy, s=1.0):
    """Scale by s, then translate an absolute SVG path (M L C Q A H V Z only)."""
    res, cmd, i = [], None, 0
    for tok in re.findall(r"[MLCQAHVZ]|-?\d*\.?\d+(?:e-?\d+)?", d):
        if tok.isalpha():
            cmd, i = tok, 0
            res.append(tok)
            continue
        v = float(tok)
        if cmd == "A":
            k = i % 7
            if k in (0, 1):
                v *= s
            elif k == 5:
                v = v * s + dx
            elif k == 6:
                v = v * s + dy
        elif cmd == "H":
            v = v * s + dx
        elif cmd == "V":
            v = v * s + dy
        else:
            v = v * s + (dx if i % 2 == 0 else dy)
        res.append(f"{v:.3f}".rstrip("0").rstrip("."))
        i += 1
    return " ".join(res)


# ---------- glyphs on a 24 x 24 grid (stroke paths; "F:" prefix = filled) ----------
G = {
    "news": ["M4 5 L17 5 L17 19 L6 19 C4.9 19 4 18.1 4 17 Z", "M17 9 L20 9 L20 17 C20 18.1 19.1 19 18 19 L6 19",
             "M7.5 9 L13.5 9", "M7.5 12 L13.5 12", "M7.5 15 L11 15"],
    "sports": [circle(12, 12, 9), "M12 3 C8.5 7 8.5 17 12 21", "M12 3 C15.5 7 15.5 17 12 21", "M3 12 L21 12"],
    "movies": ["M4 5 L20 5 L20 19 L4 19 Z", "M8 5 L8 19", "M16 5 L16 19", "M4 9.7 L8 9.7", "M4 14.3 L8 14.3",
               "M16 9.7 L20 9.7", "M16 14.3 L20 14.3"],
    "music": ["M9 17.5 L9 6 L19 4 L19 15.5", circle(6.5, 17.5, 2.5), circle(16.5, 15.5, 2.5)],
    "kids": ["M12 3 C15.6 3 18 5.8 18 9 C18 12.8 14.6 16 12 16 C9.4 16 6 12.8 6 9 C6 5.8 8.4 3 12 3 Z",
             "M12 16 L12 17.5", "M12 17.5 C10.5 19 13.5 20 12 21.5"],
    "entertainment": ["M12 3 L14.6 8.6 L20.6 9.2 L16 13.3 L17.4 19.2 L12 16.1 L6.6 19.2 L8 13.3 L3.4 9.2 L9.4 8.6 Z"],
    "documentary": ["M3 7 L15 7 L15 17 L3 17 Z", "M15 10.5 L21 7 L21 17 L15 13.5"],
    "general": ["M3 7.5 L21 7.5 L21 18.5 L3 18.5 Z", "M8 3 L12 7.5 L16 3", "M9 21 L15 21"],
    "lifestyle": ["M5 19 C5 10 10 5 20 4 C19 14 14 19 5 19 Z", "M5 19 L13 11"],
    "religious": ["M12 3 C14 6 16 8 16 11 C16 13.2 14.2 15 12 15 C9.8 15 8 13.2 8 11 C8 8 10 6 12 3 Z",
                  "M12 15 L12 21", "M8.5 21 L15.5 21"],
    "education": ["M2 9 L12 4 L22 9 L12 14 Z", "M6 11 L6 16 C6 17.5 9 19 12 19 C15 19 18 17.5 18 16 L18 11",
                  "M22 9 L22 14"],
    "business": ["M3 8 L21 8 L21 19 L3 19 Z", "M8.5 8 L8.5 5 L15.5 5 L15.5 8", "M3 13 L21 13"],
    "comedy": [circle(12, 12, 9), "M8 14 C9.5 16.5 14.5 16.5 16 14", "M9 9.5 L9 10", "M15 9.5 L15 10"],
    "cooking": ["M4.5 11 L19.5 11 L18 19 L6 19 Z", "M2.5 11 L21.5 11", "M9 7.5 C8.2 6.5 9.8 5.5 9 4",
                "M15 7.5 C14.2 6.5 15.8 5.5 15 4"],
    "travel": ["M21 3.5 L3 10.5 L10.5 13.5 L13.5 21 Z", "M10.5 13.5 L21 3.5"],
    "weather": ["M7 18.5 C4.8 18.5 3 16.7 3 14.5 C3 12.3 4.8 10.5 7 10.5 C7.5 7.7 9.9 5.5 13 5.5 C16.3 5.5 19 8.2 "
                "19 11.5 C20.7 11.5 22 13 22 14.9 C22 16.8 20.4 18.5 18.5 18.5 Z"],
    "series": ["M4 8.5 L20 8.5 L20 19.5 L4 19.5 Z", "M6.5 5.5 L17.5 5.5", "M9 2.5 L15 2.5",
               "F:M10.5 11.5 L10.5 16.5 L14.5 14 Z"],
    "culture": ["M3 10 L12 4 L21 10 Z", "M6 10 L6 17.5", "M10 10 L10 17.5", "M14 10 L14 17.5", "M18 10 L18 17.5",
                "M4 17.5 L20 17.5", "M3 21 L21 21"],
    "science": ["M9 3 L15 3", "M10 3 L10 9 L4.6 18.4 C4 19.6 4.7 21 6 21 L18 21 C19.3 21 20 19.6 19.4 18.4 L14 9 L14 3",
                "M7.2 15 L16.8 15"],
    "animation": ["M11 2.5 L12.9 8.6 L19 10.5 L12.9 12.4 L11 18.5 L9.1 12.4 L3 10.5 L9.1 8.6 Z",
                  "M18.5 15 L19.3 17.2 L21.5 18 L19.3 18.8 L18.5 21 L17.7 18.8 L15.5 18 L17.7 17.2 Z"],
    "classic": [circle(12, 12, 9), circle(12, 7.2, 1.7), circle(16.8, 12, 1.7), circle(12, 16.8, 1.7),
                circle(7.2, 12, 1.7), "F:" + circle(12, 12, 0.9)],
    "family": [circle(9, 8, 3), "M3 20 C3 16.5 5.7 14 9 14 C12.3 14 15 16.5 15 20",
               "M16 5.2 C18.6 5.6 18.6 10.4 16 10.8", "M17.5 14.3 C19.8 15 21 17.2 21 20"],
    "legislative": ["M12 3.5 L12 20.5", "M7 20.5 L17 20.5", "M4.5 7 L19.5 7", "M4.5 7 L2 13 C2.5 15 6.5 15 7 13 Z",
                    "M19.5 7 L17 13 C17.5 15 21.5 15 22 13 Z"],
    "outdoor": ["M2 20 L9 8 L13 14 L16 10 L22 20 Z", circle(18, 5.5, 2)],
    "relax": ["M20 14.5 C18.9 15 17.7 15.2 16.5 15.2 C12 15.2 8.8 12 8.8 7.5 C8.8 6.3 9 5.1 9.5 4 C6.2 5.2 4 8.3 4 "
              "12 C4 16.4 7.6 20 12 20 C15.7 20 18.8 17.8 20 14.5 Z"],
    "shop": ["M5 8 L19 8 L18 21 L6 21 Z", "M9 11 L9 7 C9 5.3 10.3 4 12 4 C13.7 4 15 5.3 15 7 L15 11"],
    "auto": ["M3 16.5 L3 12 L5.5 6.8 C5.8 6.1 6.4 5.8 7.1 5.8 L16.9 5.8 C17.6 5.8 18.2 6.1 18.5 6.8 L21 12 L21 16.5 Z",
             "M3 12 L21 12", "M5.5 16.5 L5.5 19 L8.5 19 L8.5 16.5", "M15.5 16.5 L15.5 19 L18.5 19 L18.5 16.5",
             "F:" + circle(7, 14.3, 1), "F:" + circle(17, 14.3, 1)],
}
CATS = ["news", "sports", "movies", "music", "kids", "entertainment", "documentary", "general", "lifestyle",
        "religious", "education", "business", "comedy", "cooking", "travel", "weather", "series", "culture",
        "science", "animation", "classic", "family", "legislative", "outdoor", "relax", "shop", "auto"]
assert set(CATS) == set(G)


def hexc(h, l, s):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, l, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def cat_colors(i):
    """Hue for category i: indigo (238) .. coral (350), spread so list neighbours differ."""
    n = len(CATS)
    t = (i * 7 % n) / (n - 1)
    h0 = 238 + t * 112
    return hexc(h0, 0.63, 0.86), hexc(h0 + 28, 0.56, 0.84)


def tile(L, x, y, size, rad, c0, c1):
    """Rounded gradient tile with a soft top highlight and a hairline."""
    L += [C("shape.rectangle", x=x, y=y, width=size, height=size, radius=rad),
          C("paint.setFill", gradient=lin(-45, (0, c0, None), (1, c1, None))), nostroke()]
    L += [C("shape.rectangle", x=x, y=y, width=size, height=size, radius=rad),
          C("paint.setFill", gradient=lin(-90, (0, "#ffffff", 0.22), (0.55, "#ffffff", 0))), nostroke()]
    L += [C("shape.rectangle", x=x + 0.5, y=y + 0.5, width=size - 1, height=size - 1, radius=rad - 0.5), nofill(),
          C("paint.setStroke", color="#ffffff"), C("stroke.set", weight=1), C("transparency.set", opacity=14)]
    return L


def glyph(L, name, dx, dy, s=1.0, weight=2.0):
    for d in G[name]:
        if d.startswith("F:"):
            L += filled(move(d[2:], dx, dy, s))
        else:
            L += stroked(move(d, dx, dy, s), weight)
    return L


jobs = {}  # name -> (commands, [export targets])

# ---------- category icons: 48 x 48 ----------
for i, cat in enumerate(CATS):
    c0, c1 = cat_colors(i)
    L = [C("file.new", width=48, height=48, units="Pixels", name=f"Category: {cat}")]
    tile(L, 0, 0, 48, 12, c0, c1)
    glyph(L, cat, 12, 12, 1.0, 2.0)
    jobs[f"cat-{cat}"] = (L, [f"public/brand/icons/cat-{cat}.svg"])

# ---------- channel fallback: 96 x 96 ----------
L = [C("file.new", width=96, height=96, units="Pixels", name="Channel logo fallback"),
     C("shape.rectangle", x=0, y=0, width=96, height=96, radius=20), C("paint.setFill", color="#1c1b2b"), nostroke(),
     C("shape.rectangle", x=0, y=0, width=96, height=96, radius=20),
     C("paint.setFill", gradient=lin(-45, (0, VIO, 0.22), (1, COR, 0.10))), nostroke(),
     C("shape.rectangle", x=0.5, y=0.5, width=95, height=95, radius=19.5), nofill(),
     C("paint.setStroke", color="#ffffff"), C("stroke.set", weight=1), C("transparency.set", opacity=10)]
L += stroked("M26 40 L70 40 C72.2 40 74 41.8 74 44 L74 68 C74 70.2 72.2 72 70 72 L26 72 C23.8 72 22 70.2 22 68 L22 44 "
             "C22 41.8 23.8 40 26 40 Z", 3, op=70)
L += stroked("M40 79 L56 79", 3, op=45)
L += filled("M44.5 50.5 L44.5 61.5 L54 56 Z", op=70)
grad = lin(-45, (0, LIL, None), (1, "#fb7185", None))
for r, op in ((9, 100), (16, 70)):
    a = math.radians(50)
    L += stroked(f"M{48 - r * math.cos(a):.2f} {32 - r * math.sin(a):.2f} A{r} {r} 0 0 1 "
                 f"{48 + r * math.cos(a):.2f} {32 - r * math.sin(a):.2f}", 3, gradient=grad, op=op)
L += [C("shape.ellipse", x=45.5, y=29.5, width=5, height=5), C("paint.setFill", gradient=grad), nostroke()]
jobs["channel-fallback"] = (L, ["public/brand/channel-fallback.svg"])

# ---------- stream unavailable: 480 x 270, transparent ----------
W, H = 480, 270
L = [C("file.new", width=W, height=H, units="Pixels", name="Stream unavailable")]
L += glow(240, 135, 440, 250, VIO, 0.30, (0.45, 0.12))
L += glow(300, 170, 240, 160, COR, 0.22)
sx, sy, sw, sh = 150, 62, 180, 120          # the screen
L += [C("shape.rectangle", x=sx, y=sy, width=sw, height=sh, radius=16), C("paint.setFill", color="#1c1b2b"), nostroke(),
      C("transparency.set", opacity=85)]
rnd = random.Random(7)
for _ in range(150):                         # static noise inside the screen
    w = rnd.choice((3, 4, 6, 8))
    x, y = rnd.uniform(sx + 12, sx + sw - 12 - w), rnd.uniform(sy + 12, sy + sh - 14)
    L += [C("shape.rectangle", x=round(x, 1), y=round(y, 1), width=w, height=2), C("paint.setFill", color="#ffffff"),
          nostroke(), C("transparency.set", opacity=rnd.choice((6, 10, 16, 24)))]
# a crack across the glass
L += stroked(f"M{sx + 40} {sy} L{sx + 62} {sy + 38} L{sx + 50} {sy + 56} L{sx + 84} {sy + 92} L{sx + 76} {sy + sh}", 2,
             op=55)
L += [C("shape.rectangle", x=sx, y=sy, width=sw, height=sh, radius=16), nofill(),
      C("paint.setStroke", gradient=lin(-35, (0, VIO, None), (1, COR, None))), C("stroke.set", weight=3)]
L += stroked(f"M{240 - 26} {sy + sh + 22} L{240 + 26} {sy + sh + 22}", 4, op=55)
L += stroked(f"M240 {sy + sh} L240 {sy + sh + 22}", 4, op=55)
# broken signal: arcs with a slash, upper right
bx, by = 352, 70
for r, op in ((10, 100), (20, 75), (30, 50)):
    a = math.radians(45)
    L += stroked(f"M{bx - r * math.cos(a):.2f} {by - r * math.sin(a) + 24:.2f} A{r} {r} 0 0 1 "
                 f"{bx + r * math.cos(a):.2f} {by - r * math.sin(a) + 24:.2f}", 4, color=LIL, op=op)
L += [C("shape.ellipse", x=bx - 4, y=by + 20, width=8, height=8), C("paint.setFill", color=LIL), nostroke()]
L += stroked(f"M{bx - 24} {by - 14} L{bx + 24} {by + 34}", 4.5, color=COR)
for x, y, s in ((118, 92, 6), (126, 196, 4), (372, 196, 5)):   # sparks
    L += stroked(f"M{x - s} {y} L{x + s} {y}", 2, color="#fda4af", op=70)
    L += stroked(f"M{x} {y - s} L{x} {y + s}", 2, color="#fda4af", op=70)
jobs["stream-error"] = (L, ["public/brand/stream-error.svg"])

# ---------- OG image: 1200 x 630 ----------
W, H = 1200, 630
L = [C("file.new", width=W, height=H, units="Pixels", name="IPTV Streamer social preview"),
     C("shape.rectangle", x=0, y=0, width=W, height=H), C("paint.setFill", color=INK), nostroke()]
L += glow(880, 300, 1200, 860, VIO, 0.50, (0.35, 0.18))
L += glow(980, 440, 760, 560, COR, 0.40, (0.4, 0.12))
for gx in range(560, W, 48):
    L += stroked(f"M{gx} 0 L{gx} {H}", 1, color=LIL, op=6)
for gy in range(30, H, 48):
    L += stroked(f"M520 {gy} L{W} {gy}", 1, color=LIL, op=6)
cx, cy = 930, 315
for k, r in enumerate((90, 140, 195, 255, 320)):
    L += [C("shape.ellipse", x=cx - r, y=cy - r, width=2 * r, height=2 * r), nofill(),
          C("paint.setStroke", gradient=lin(-30, (0, VIO, None), (1, COR, None))),
          C("stroke.set", weight=2 if k < 2 else 1.3), C("transparency.set", opacity=max(14, 75 - k * 15))]
L += glow(cx, cy, 300, 300, "#c084fc", 0.55)
# the logo mark, large, at the rings' centre (same geometry as public/brand/logo-mark.svg)
s, ox, oy = 2.4, cx - 32 * 2.4, cy - 32 * 2.4
L += [C("shape.rectangle", x=ox, y=oy, width=64 * s, height=64 * s, radius=14 * s),
      C("paint.setFill", gradient=lin(-45, (0, VIO, None), (1, COR, None))), nostroke(),
      C("shape.rectangle", x=ox, y=oy, width=64 * s, height=64 * s, radius=14 * s),
      C("paint.setFill", gradient=lin(-90, (0, "#ffffff", 0.18), (0.55, "#ffffff", 0))), nostroke()]
L += filled(move("M26.5 27.068 L26.5 36.932 C26.5 39.977 27.809 40.723 30.427 39.168 L38.735 34.236 C41.245 32.745 "
                 "41.245 31.255 38.735 29.764 L30.427 24.832 C27.809 23.277 26.5 24.023 26.5 27.068 Z", ox, oy, s))
for d, op in (("M45.108 22.149 C49.631 27.938 49.631 36.062 45.108 41.851", 100),
              ("M19.892 41.851 C15.369 36.062 15.369 27.938 19.892 22.149", 100),
              ("M50.624 17.84 C57.125 26.161 57.125 37.839 50.624 46.16", 65),
              ("M14.376 46.16 C7.875 37.839 7.875 26.161 14.376 17.84", 65)):
    L += stroked(move(d, ox, oy, s), 3.6 * s, op=op)
# calm left side for the words
L += [C("shape.rectangle", x=0, y=0, width=760, height=H),
      C("paint.setFill", gradient=lin(0, (0, INK, 1), (0.55, INK, 0.92), (1, INK, 0))), nostroke()]
L += [C("shape.rectangle", x=96, y=214, width=56, height=6, radius=3),
      C("paint.setFill", gradient=lin(0, (0, VIO, None), (1, COR, None))), nostroke()]
L += [C("text.create", x=92, y=320, text="IPTV Streamer", size=84, font="Inter", style="Bold", color="#ffffff")]
L += [C("text.create", x=96, y=384, text="Live TV, worldwide", size=36, font="Inter", style="Regular",
        color="#c4b5fd")]
L += [C("text.create", x=96, y=470, text="Free channels from 190+ countries", size=22, font="Inter",
        style="Regular", color="#8f8ca8")]
jobs["og-image"] = (L, ["public/og-image.svg", "public/og-image.png"])

for name, (cmds, targets) in jobs.items():
    json.dump(cmds, open(os.path.join(out, f"{name}.commands.json"), "w"), indent=1)
json.dump({k: v[1] for k, v in jobs.items()}, open(os.path.join(out, "targets.json"), "w"), indent=1)
print("wrote", len(jobs), "command files to", out)
