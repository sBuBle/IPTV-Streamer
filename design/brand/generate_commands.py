import json, math, sys
out = sys.argv[1]
VIO, COR, INK = "#8b5cf6", "#f43f5e", "#12111d"
def C(cmd, **p): return {"command": cmd, "params": p}

# ---------- logo mark ----------
L = [C("file.new", width=64, height=64, units="Pixels", name="IPTV Streamer mark"),
     C("shape.rectangle", x=0, y=0, width=64, height=64, radius=14),
     C("paint.setFill", gradient={"kind":"linear","angle":-45,"stops":[{"offset":0,"color":VIO},{"offset":1,"color":COR}]}),
     C("paint.setStroke", none=True)]
# soft top highlight
L += [C("shape.rectangle", x=0, y=0, width=64, height=64, radius=14),
      C("paint.setFill", gradient={"kind":"linear","angle":-90,"stops":[{"offset":0,"color":"#ffffff","opacity":0.18},{"offset":0.55,"color":"#ffffff","opacity":0}]}),
      C("paint.setStroke", none=True)]
# rounded play triangle (corner radius r via tangent points)
P = [(26.5,22.5),(26.5,41.5),(42.5,32)]
r = 2.6
def unit(a,b):
    d = math.hypot(b[0]-a[0], b[1]-a[1]); return ((b[0]-a[0])/d, (b[1]-a[1])/d)
d = ""
segs = []
for i,p in enumerate(P):
    a, b = P[i-1], P[(i+1)%3]
    u1, u2 = unit(p,a), unit(p,b)
    ang = math.acos(u1[0]*u2[0]+u1[1]*u2[1])
    t = r/math.tan(ang/2)
    segs.append(((p[0]+u1[0]*t, p[1]+u1[1]*t), p, (p[0]+u2[0]*t, p[1]+u2[1]*t)))
f = lambda q: f"{q[0]:.3f} {q[1]:.3f}"
d = f"M{f(segs[0][2])}"
for s in segs[1:]+segs[:1]:
    d += f" L{f(s[0])} Q{f(s[1])} {f(s[2])}"
d += " Z"
L += [C("path.create", d=d, closed=True), C("paint.setFill", color="#ffffff"), C("paint.setStroke", none=True)]
# broadcast arcs on both sides: (( > ))
cx, cy = 32.5, 32
for rad, op in ((16, 100), (23, 65)):
    a = math.radians(38)
    dx, dy = rad*math.cos(a), rad*math.sin(a)
    for side in (1, -1):
        x0, x1 = cx+side*dx, cx+side*dx
        y0, y1 = (cy-dy, cy+dy) if side == 1 else (cy+dy, cy-dy)
        L += [C("path.create", d=f"M{x0:.3f} {y0:.3f} A{rad} {rad} 0 0 1 {x1:.3f} {y1:.3f}"),
              C("paint.setFill", none=True), C("paint.setStroke", color="#ffffff"),
              C("stroke.set", weight=3.6, cap="round", join="round"),
              C("transparency.set", opacity=op)]
json.dump(L, open(out+"/logo.json","w"), indent=1)

# ---------- hero ----------
W, H = 1600, 900
VX, VY = 1150, 540   # vanishing point / broadcast origin
Hh = [C("file.new", width=W, height=H, units="Pixels", name="IPTV Streamer hero"),
      C("shape.rectangle", x=0, y=0, width=W, height=H), C("paint.setFill", color=INK), C("paint.setStroke", none=True)]
def glow(x, y, w, h, color, op, mid=None):
    stops = [{"offset":0,"color":color,"opacity":op}]
    if mid: stops.append({"offset":mid[0],"color":color,"opacity":mid[1]})
    stops.append({"offset":1,"color":color,"opacity":0})
    return [C("shape.ellipse", x=x-w/2, y=y-h/2, width=w, height=h),
            C("paint.setFill", gradient={"kind":"radial","stops":stops,"aspect":h/w*100}), C("paint.setStroke", none=True)]
Hh += glow(1180, 420, 1500, 1100, VIO, 0.50, (0.35, 0.18))
Hh += glow(1300, 600, 900, 700, COR, 0.42, (0.4, 0.12))
Hh += glow(VX, VY, 360, 360, "#c084fc", 0.45)
# floor grid below the horizon
for i in range(-14, 15):
    xb = VX + i*150
    Hh += [C("shape.line", x1=VX, y1=VY, x2=xb, y2=H+200), C("paint.setStroke", color="#a78bfa"),
           C("stroke.set", weight=1), C("transparency.set", opacity=22)]
for k in range(1, 12):
    y = VY + 6*k*k
    if y > H: break
    Hh += [C("shape.line", x1=0, y1=y, x2=W, y2=y), C("paint.setStroke", color="#a78bfa"),
           C("stroke.set", weight=1), C("transparency.set", opacity=22)]
# horizon fog over the converging lines
Hh += [C("shape.rectangle", x=0, y=VY-2, width=W, height=170),
       C("paint.setFill", gradient={"kind":"linear","angle":-90,"stops":[{"offset":0,"color":INK,"opacity":0.95},{"offset":1,"color":INK,"opacity":0}]}),
       C("paint.setStroke", none=True)]
# broadcast rings
for n, rad in enumerate([70, 125, 190, 265, 350, 445, 550, 665, 790]):
    op = max(18, 85 - n*8)
    Hh += [C("shape.ellipse", x=VX-rad, y=VY-rad, width=2*rad, height=2*rad), C("paint.setFill", none=True),
           C("paint.setStroke", gradient={"kind":"linear","angle":-30,"stops":[{"offset":0,"color":VIO},{"offset":1,"color":COR}]}),
           C("stroke.set", weight=2.2 if n < 3 else 1.6), C("transparency.set", opacity=op)]
# glowing horizon line
Hh += glow(VX+80, VY, 1500, 70, COR, 0.55, (0.3, 0.2))
Hh += [C("shape.rectangle", x=520, y=VY-1, width=W-520, height=2),
       C("paint.setFill", gradient={"kind":"linear","angle":0,"stops":[{"offset":0,"color":COR,"opacity":0},{"offset":0.6,"color":"#fda4af","opacity":0.95},{"offset":1,"color":VIO,"opacity":0.6}]}),
       C("paint.setStroke", none=True)]
# bright core
Hh += glow(VX, VY, 120, 120, "#ffffff", 0.9, (0.25, 0.35))
Hh += [C("shape.ellipse", x=VX-7, y=VY-7, width=14, height=14), C("paint.setFill", color="#ffffff"), C("paint.setStroke", none=True)]
# left calm zone + top/bottom fades
Hh += [C("shape.rectangle", x=0, y=0, width=1000, height=H),
       C("paint.setFill", gradient={"kind":"linear","angle":0,"stops":[{"offset":0,"color":INK,"opacity":1},{"offset":0.55,"color":INK,"opacity":0.85},{"offset":1,"color":INK,"opacity":0}]}),
       C("paint.setStroke", none=True),
       C("shape.rectangle", x=0, y=H-220, width=W, height=220),
       C("paint.setFill", gradient={"kind":"linear","angle":-90,"stops":[{"offset":0,"color":INK,"opacity":0},{"offset":1,"color":INK,"opacity":1}]}),
       C("paint.setStroke", none=True),
       C("shape.rectangle", x=0, y=0, width=W, height=140),
       C("paint.setFill", gradient={"kind":"linear","angle":-90,"stops":[{"offset":0,"color":INK,"opacity":0.7},{"offset":1,"color":INK,"opacity":0}]}),
       C("paint.setStroke", none=True)]
json.dump(Hh, open(out+"/hero.json","w"), indent=1)
