"""Writes VectorCraft command lists for the page banners and empty-state art.

Usage:  python generate_pages.py <outdir>
Then for each <name>.commands.json:
  vectorcraft-cli run --commands <name>.commands.json --export public/brand/pages/<name>.svg
"""
import json, math, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
VIO, COR, INK, LIL = "#8b5cf6", "#f43f5e", "#12111d", "#a78bfa"


def C(cmd, **p):
    return {"command": cmd, "params": p}


def nostroke():
    return C("paint.setStroke", none=True)


def glow(x, y, w, h, color, op, mid=None):
    stops = [{"offset": 0, "color": color, "opacity": op}]
    if mid:
        stops.append({"offset": mid[0], "color": color, "opacity": mid[1]})
    stops.append({"offset": 1, "color": color, "opacity": 0})
    return [C("shape.ellipse", x=x - w / 2, y=y - h / 2, width=w, height=h),
            C("paint.setFill", gradient={"kind": "radial", "stops": stops, "aspect": h / w * 100}), nostroke()]


def grad(angle=-30):
    return {"kind": "linear", "angle": angle, "stops": [{"offset": 0, "color": VIO}, {"offset": 1, "color": COR}]}


def stroke(weight, op, color=None, gradient=None):
    s = C("paint.setStroke", gradient=gradient) if gradient else C("paint.setStroke", color=color or LIL)
    return [C("paint.setFill", none=True), s, C("stroke.set", weight=weight, cap="round", join="round"),
            C("transparency.set", opacity=op)]


def ring(cx, cy, r, weight, op, gradient=None, color=None):
    return [C("shape.ellipse", x=cx - r, y=cy - r, width=2 * r, height=2 * r)] + stroke(weight, op, color, gradient)


def line(x1, y1, x2, y2, weight, op, color=None):
    return [C("shape.line", x1=x1, y1=y1, x2=x2, y2=y2)] + stroke(weight, op, color)


def path(d, fill=None, fill_grad=None, op=100, closed=True):
    f = C("paint.setFill", gradient=fill_grad) if fill_grad else C("paint.setFill", color=fill or "#ffffff")
    return [C("path.create", d=d, closed=closed), f, nostroke(), C("transparency.set", opacity=op)]


def rect(x, y, w, h, r=0, fill=None, fill_grad=None, op=100):
    f = C("paint.setFill", gradient=fill_grad) if fill_grad else C("paint.setFill", color=fill or "#ffffff")
    return [C("shape.rectangle", x=x, y=y, width=w, height=h, radius=r), f, nostroke(), C("transparency.set", opacity=op)]


def heart_d(cx, cy, s):
    # heart centred at (cx, cy), width ~2s
    return (f"M{cx} {cy + s * 0.9} C{cx - s * 1.2} {cy + s * 0.1} {cx - s * 1.1} {cy - s * 0.9} {cx - s * 0.5} {cy - s * 0.9} "
            f"C{cx - s * 0.15} {cy - s * 0.9} {cx} {cy - s * 0.6} {cx} {cy - s * 0.45} "
            f"C{cx} {cy - s * 0.6} {cx + s * 0.15} {cy - s * 0.9} {cx + s * 0.5} {cy - s * 0.9} "
            f"C{cx + s * 1.1} {cy - s * 0.9} {cx + s * 1.2} {cy + s * 0.1} {cx} {cy + s * 0.9} Z")


# ---------- banners: 1600 x 320, motif on the right, calm left ----------
W, H = 1600, 320
MX, MY = 1240, 160  # motif centre


def banner_base(name, accent=VIO, second=COR):
    L = [C("file.new", width=W, height=H, units="Pixels", name=name),
         C("shape.rectangle", x=0, y=0, width=W, height=H), C("paint.setFill", color=INK), nostroke()]
    L += glow(MX, MY, 1100, 520, accent, 0.45, (0.35, 0.15))
    L += glow(MX + 180, MY + 120, 700, 360, second, 0.35, (0.4, 0.1))
    # faint dotted grid across the art side
    for gx in range(760, W, 40):
        L += line(gx, 0, gx, H, 1, 6)
    for gy in range(20, H, 40):
        L += line(700, gy, W, gy, 1, 6)
    return L


def banner_finish(L):
    L += [C("shape.rectangle", x=0, y=0, width=1100, height=H),
          C("paint.setFill", gradient={"kind": "linear", "angle": 0, "stops": [
              {"offset": 0, "color": INK, "opacity": 1}, {"offset": 0.5, "color": INK, "opacity": 0.9},
              {"offset": 1, "color": INK, "opacity": 0}]}), nostroke()]
    L += [C("shape.rectangle", x=0, y=H - 70, width=W, height=70),
          C("paint.setFill", gradient={"kind": "linear", "angle": -90, "stops": [
              {"offset": 0, "color": INK, "opacity": 0}, {"offset": 1, "color": INK, "opacity": 0.85}]}), nostroke()]
    return L


banners = {}

# Favorites: a big gradient heart with orbiting small hearts
L = banner_base("Favorites banner", COR, VIO)
for r, op in ((110, 30), (160, 18), (215, 10)):
    L += ring(MX, MY, r, 1.5, op, gradient=grad())
L += glow(MX, MY, 300, 300, COR, 0.5)
L += path(heart_d(MX, MY + 4, 62), fill_grad=grad(-45))
L += path(heart_d(MX, MY + 4, 62), fill_grad={"kind": "linear", "angle": -90, "stops": [
    {"offset": 0, "color": "#ffffff", "opacity": 0.3}, {"offset": 0.5, "color": "#ffffff", "opacity": 0}]})
for ang, rr, s, op in ((200, 160, 14, 80), (320, 110, 10, 70), (20, 215, 12, 55), (120, 215, 9, 45), (250, 215, 8, 40)):
    a = math.radians(ang)
    L += path(heart_d(MX + rr * math.cos(a), MY + rr * math.sin(a), s), fill="#fda4af", op=op)
banners["favorites"] = banner_finish(L)

# History: clock dial with tick marks and a sweeping hand, plus a timeline
L = banner_base("Watch history banner")
for i in range(60):
    a = math.radians(i * 6)
    r0 = 92 if i % 5 == 0 else 100
    L += line(MX + r0 * math.cos(a), MY + r0 * math.sin(a), MX + 108 * math.cos(a), MY + 108 * math.sin(a),
              2.5 if i % 5 == 0 else 1.2, 80 if i % 5 == 0 else 40, "#ffffff")
L += ring(MX, MY, 125, 3, 90, gradient=grad())
L += ring(MX, MY, 170, 1.2, 25, gradient=grad())
L += [C("path.create", d=f"M{MX} {MY} L{MX} {MY - 70}")] + stroke(5, 95, "#ffffff")
L += [C("path.create", d=f"M{MX} {MY} L{MX + 50} {MY + 28}")] + stroke(5, 95, "#ffffff")
L += [C("path.create", d=f"M{MX + 125} {MY} A125 125 0 0 0 {MX} {MY - 125}")] + stroke(6, 100, gradient=grad())
L += [C("shape.ellipse", x=MX - 8, y=MY - 8, width=16, height=16), C("paint.setFill", color="#ffffff"), nostroke()]
for i, x in enumerate(range(780, 1060, 56)):
    L += [C("shape.ellipse", x=x - 5, y=MY - 5, width=10, height=10), C("paint.setFill", color=LIL), nostroke(),
          C("transparency.set", opacity=30 + i * 12)]
L += line(760, MY, 1100, MY, 1.5, 30)
banners["history"] = banner_finish(L)

# Countries: wireframe globe with meridians and a glowing pin
L = banner_base("Browse by country banner")
R = 130
L += glow(MX, MY, 2 * R + 80, 2 * R + 80, VIO, 0.35)
L += ring(MX, MY, R, 2.5, 90, gradient=grad())
for k in range(1, 4):  # meridians as ellipses
    w = R * math.cos(math.radians(k * 25))
    L += [C("shape.ellipse", x=MX - w, y=MY - R, width=2 * w, height=2 * R)] + stroke(1.3, 45, LIL)
for k in (-2, -1, 0, 1, 2):  # parallels
    y = MY + k * R * 0.38
    half = math.sqrt(max(R * R - (y - MY) ** 2, 0))
    L += [C("shape.ellipse", x=MX - half, y=y - half * 0.18, width=2 * half, height=half * 0.36)] + stroke(1.3, 40, LIL)
L += line(MX, MY - R, MX, MY + R, 1.3, 45)
L += ring(MX, MY, R + 40, 1, 20, gradient=grad())
px, py = MX + 48, MY - 50
L += glow(px, py, 90, 90, COR, 0.7)
L += path(f"M{px} {py + 26} C{px - 18} {py + 4} {px - 18} {py - 18} {px} {py - 18} C{px + 18} {py - 18} {px + 18} {py + 4} {px} {py + 26} Z", fill_grad=grad(-60))
L += [C("shape.ellipse", x=px - 6, y=py - 6, width=12, height=12), C("paint.setFill", color="#ffffff"), nostroke()]
banners["countries"] = banner_finish(L)

# Settings: concentric control dials with knobs and slider tracks
L = banner_base("Settings banner")
for r, op, wgt in ((60, 95, 3), (100, 55, 2), (140, 30, 1.5)):
    L += ring(MX, MY, r, wgt, op, gradient=grad())
for i in range(24):  # notches
    a = math.radians(i * 15)
    L += line(MX + 66 * math.cos(a), MY + 66 * math.sin(a), MX + 78 * math.cos(a), MY + 78 * math.sin(a), 2, 50, "#ffffff")
a = math.radians(-50)
L += [C("shape.ellipse", x=MX + 100 * math.cos(a) - 9, y=MY + 100 * math.sin(a) - 9, width=18, height=18),
      C("paint.setFill", color="#ffffff"), nostroke()]
L += [C("path.create", d=f"M{MX} {MY} L{MX + 40 * math.cos(a)} {MY + 40 * math.sin(a)}")] + stroke(6, 100, "#ffffff")
for j, (y, pos) in enumerate(((95, 0.7), (160, 0.35), (225, 0.55))):
    x0, x1 = 820, 1040
    L += line(x0, y, x1, y, 4, 25, "#ffffff")
    L += [C("path.create", d=f"M{x0} {y} L{x0 + (x1 - x0) * pos} {y}")] + stroke(4, 100, gradient=grad(0))
    L += [C("shape.ellipse", x=x0 + (x1 - x0) * pos - 9, y=y - 9, width=18, height=18), C("paint.setFill", color="#ffffff"), nostroke()]
banners["settings"] = banner_finish(L)

# About: the broadcast mark, large, with rings
L = banner_base("About banner")
for n, r in enumerate((80, 120, 165, 215, 270)):
    L += ring(MX, MY, r, 2 if n < 2 else 1.3, max(15, 80 - n * 15), gradient=grad())
L += glow(MX, MY, 260, 260, "#c084fc", 0.5)
L += rect(MX - 48, MY - 48, 96, 96, 22, fill_grad=grad(-45))
L += path(f"M{MX - 10} {MY - 22} L{MX - 10} {MY + 22} L{MX + 24} {MY} Z", fill="#ffffff")
banners["about"] = banner_finish(L)

# Playlist: stacked list cards with an equalizer
L = banner_base("Playlist banner")
for i in range(4):
    y = 70 + i * 50
    L += rect(1040, y, 380, 38, 10, fill="#ffffff", op=10 + (3 - i) * 4)
    L += rect(1052, y + 9, 20, 20, 5, fill_grad=grad(-45), op=90 - i * 15)
    L += rect(1086, y + 14, 140 + (i % 2) * 60, 10, 5, fill="#ffffff", op=55 - i * 10)
for k, hgt in enumerate((40, 80, 120, 70, 150, 95, 60, 110, 45)):
    x = 1460 + k * 14
    L += rect(x, MY + 90 - hgt, 8, hgt, 4, fill_grad={"kind": "linear", "angle": -90, "stops": [
        {"offset": 0, "color": COR}, {"offset": 1, "color": VIO}]}, op=85)
banners["playlist"] = banner_finish(L)

# Category: tile mosaic in category tints
L = banner_base("Category banner")
tints = ["#38bdf8", "#34d399", "#f43f5e", "#f59e0b", VIO, "#f472b6"]
k = 0
for row in range(3):
    for col in range(5):
        x, y = 1000 + col * 96 + (row % 2) * 30, 48 + row * 80
        op = 18 + ((row * 5 + col) * 37) % 55
        L += rect(x, y, 80, 64, 14, fill=tints[k % len(tints)], op=op)
        k += 1
L += rect(1222, 120, 96, 78, 16, fill_grad=grad(-45))
L += path("M1258 140 L1258 178 L1288 159 Z", fill="#ffffff")
banners["category"] = banner_finish(L)

for name, cmds in banners.items():
    json.dump(cmds, open(os.path.join(out, f"banner-{name}.commands.json"), "w"), indent=1)

# ---------- empty-state illustrations: 320 x 200, transparent ----------
EW, EH, ECX, ECY = 320, 200, 160, 100


def empty_base(name):
    return [C("file.new", width=EW, height=EH, units="Pixels", name=name)] + glow(ECX, ECY, 300, 190, VIO, 0.35)


empties = {}
# TV screen with a dashed "no signal"
L = empty_base("Empty: no channels")
L += rect(90, 45, 140, 96, 14, fill="#ffffff", op=10)
L += [C("shape.rectangle", x=90, y=45, width=140, height=96, radius=14)] + stroke(3, 80, gradient=grad())
L += line(140, 160, 180, 160, 4, 60, "#ffffff")
for i in range(5):
    L += line(108 + i * 24, 93, 120 + i * 24, 93, 3, 50, "#ffffff")
L += path(f"M{ECX - 9} {ECY - 24} L{ECX - 9} {ECY - 8} L{ECX + 5} {ECY - 16} Z", fill="#ffffff", op=80)
empties["empty-channels"] = L

# Heart outline with sparkles
L = empty_base("Empty: no favorites")
L += [C("path.create", d=heart_d(ECX, ECY + 4, 48), closed=True)] + stroke(3.5, 85, gradient=grad(-45))
for x, y, s in ((95, 55, 6), (232, 70, 8), (220, 150, 5)):
    L += line(x - s, y, x + s, y, 2, 70, "#fda4af") + line(x, y - s, x, y + s, 2, 70, "#fda4af")
empties["empty-favorites"] = L

# Clock with a dotted trail
L = empty_base("Empty: no history")
L += ring(ECX, ECY, 52, 3.5, 85, gradient=grad())
L += [C("path.create", d=f"M{ECX} {ECY} L{ECX} {ECY - 30} M{ECX} {ECY} L{ECX + 22} {ECY + 12}")] + stroke(4, 90, "#ffffff")
for i in range(5):
    a = math.radians(200 + i * 22)
    L += [C("shape.ellipse", x=ECX + 78 * math.cos(a) - 3, y=ECY + 78 * math.sin(a) - 3, width=6, height=6),
          C("paint.setFill", color=LIL), nostroke(), C("transparency.set", opacity=20 + i * 15)]
empties["empty-history"] = L

# Magnifier over a grid (no results)
L = empty_base("Empty: no results")
for i in range(3):
    for j in range(2):
        L += rect(92 + i * 46, 62 + j * 42, 38, 32, 8, fill="#ffffff", op=8)
L += ring(ECX + 8, ECY - 6, 34, 4, 90, gradient=grad())
L += line(ECX + 33, ECY + 19, ECX + 58, ECY + 44, 7, 90, "#ffffff")
empties["empty-search"] = L

for name, cmds in empties.items():
    json.dump(cmds, open(os.path.join(out, f"{name}.commands.json"), "w"), indent=1)

print("wrote", len(banners) + len(empties), "command files to", out)
