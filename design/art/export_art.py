"""Runs vectorcraft-cli on every design/art/*.commands.json (see targets.json), from the repo root.

Usage: python design/art/export_art.py [path/to/vectorcraft-cli.exe]
SVGs with text are written with the text as outlines, so they look the same without the font installed.
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(ROOT, "design", "art")
CLI = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    "VECTORCRAFT_CLI", r"C:\Program Files\ArtCraft\VectorCraft\vectorcraft-cli.exe")

targets = json.load(open(os.path.join(HERE, "targets.json")))
failed = []
for name, outs in targets.items():
    cmds = os.path.join(HERE, f"{name}.commands.json")
    has_text = '"text.create"' in open(cmds).read()
    tmp = os.path.join(tempfile.gettempdir(), f"{name}.vectorcraft")
    exports = []
    for o in outs:
        p = os.path.join(ROOT, o)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if not (has_text and p.endswith(".svg")):
            exports += ["--export", p]
    if has_text:
        exports += ["--export", tmp]
    r = subprocess.run([CLI, "run", "--commands", cmds, *exports], capture_output=True, text=True)
    bad = [l for l in r.stdout.splitlines() if '"error"' in l]
    if r.returncode or bad:
        failed.append(name)
        print(name, "FAILED", r.returncode, *(bad or [r.stderr.strip()]), sep="\n  ")
        continue
    for o in outs:
        if has_text and o.endswith(".svg"):
            c = subprocess.run([CLI, "convert", tmp, os.path.join(ROOT, o), "--outline-text"],
                               capture_output=True, text=True)
            if c.returncode:
                failed.append(name)
                print(name, "convert FAILED", c.stderr.strip())
    print("ok", name, "->", ", ".join(outs))
sys.exit(1 if failed else 0)
