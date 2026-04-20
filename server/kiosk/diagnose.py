#!/usr/bin/env python3
"""
EngiRent Kiosk – Diagnostic script
Run:  python3 diagnose.py
Checks all imports, GPIO, cameras, Flask UI, and socket config.
"""

import os
import sys
import subprocess

sys.path.insert(0, os.path.dirname(__file__))

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m⚠\033[0m"
HEAD = "\033[1;96m"
RST  = "\033[0m"

def section(title):
    print(f"\n{HEAD}── {title} {'─' * (50 - len(title))}{RST}")

def ok(msg):   print(f"  {PASS}  {msg}")
def fail(msg): print(f"  {FAIL}  {msg}")
def warn(msg): print(f"  {WARN}  {msg}")

# ── 1. Python version ──────────────────────────────────────────────────────────
section("Python")
ok(f"Python {sys.version.split()[0]} at {sys.executable}")

# ── 2. Core imports ────────────────────────────────────────────────────────────
section("Core imports")
checks = [
    ("dotenv",        "python-dotenv"),
    ("structlog",     "structlog"),
    ("flask",         "Flask"),
    ("flask_socketio","flask-socketio"),
    ("flask_cors",    "flask-cors"),
    ("socketio",      "python-socketio"),
    ("aiohttp",       "aiohttp"),
    ("supabase",      "supabase"),
    ("PIL",           "pillow"),
]
for mod, pkg in checks:
    try:
        __import__(mod)
        ok(f"{pkg}")
    except ImportError as e:
        fail(f"{pkg}  →  {e}")

# ── 3. Hardware imports ────────────────────────────────────────────────────────
section("Hardware imports")
for mod, pkg in [("cv2","opencv"), ("gpiozero","gpiozero"), ("lgpio","lgpio"), ("picamera2","picamera2")]:
    try:
        m = __import__(mod)
        ver = getattr(m, "__version__", "?")
        ok(f"{pkg}  v{ver}")
    except ImportError as e:
        fail(f"{pkg}  →  {e}")

# ── 4. OpenCV build info ───────────────────────────────────────────────────────
section("OpenCV backends")
try:
    import cv2
    info = cv2.getBuildInformation()
    for line in info.splitlines():
        if any(k in line for k in ("V4L2", "GStreamer", "FFMPEG")):
            status = "enabled" if "YES" in line or "YES (" in line else "disabled"
            (ok if "YES" in line else warn)(line.strip())
except Exception as e:
    fail(str(e))

# ── 5. Video devices ───────────────────────────────────────────────────────────
section("Video devices  (v4l2-ctl --list-devices)")
try:
    result = subprocess.run(["v4l2-ctl", "--list-devices"],
                            capture_output=True, text=True, timeout=5)
    if result.stdout.strip():
        for line in result.stdout.strip().splitlines():
            print(f"     {line}")
    else:
        warn("No video devices found — plug in USB cameras")
except FileNotFoundError:
    warn("v4l2-ctl not found — run: sudo apt install v4l-utils")
except Exception as e:
    fail(str(e))

# ── 6. Test each /dev/videoX with OpenCV GStreamer ────────────────────────────
section("Camera open test  (OpenCV GStreamer)")
import glob
video_nodes = sorted(glob.glob("/dev/video*"))
if not video_nodes:
    warn("No /dev/video* devices found")
else:
    import cv2, re
    for node in video_nodes:
        m = re.search(r"(/dev/video\d+)", node)
        if not m:
            continue
        device = m.group(1)
        gst = (
            f"v4l2src device={device} ! "
            f"videoconvert ! video/x-raw,format=BGR ! "
            f"appsink max-buffers=1 drop=true sync=false"
        )
        cap = cv2.VideoCapture(gst, cv2.CAP_GSTREAMER)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                ok(f"{device}  →  opened + read frame ({w}x{h})")
            else:
                warn(f"{device}  →  opened but no frame (metadata node?)")
            cap.release()
        else:
            fail(f"{device}  →  could not open via GStreamer")

# ── 7. Face cascade ────────────────────────────────────────────────────────────
section("Face detection (Haar cascade)")
try:
    from services.face_service import _find_cascade_path
    p = _find_cascade_path()
    ok(f"Cascade found: {p}")
except Exception as e:
    fail(str(e))

# ── 8. .env config ─────────────────────────────────────────────────────────────
section(".env configuration")
from dotenv import load_dotenv
load_dotenv()
keys = ["KIOSK_ID", "SERVER_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
        "ML_SERVICE_URL", "UI_PORT", "RELAY_ACTIVE_LEVEL", "MOCK_GPIO", "MOCK_CAMERA"]
for k in keys:
    v = os.getenv(k, "")
    if not v:
        fail(f"{k}  →  NOT SET")
    elif "your-" in v.lower() or "paste" in v.lower():
        warn(f"{k}  →  still placeholder value")
    else:
        masked = v[:8] + "…" if len(v) > 12 else v
        ok(f"{k}  =  {masked}")

# ── 9. WiFi ────────────────────────────────────────────────────────────────────
section("WiFi")
try:
    result = subprocess.run(
        ["nmcli", "-t", "-f", "TYPE,STATE", "con", "show", "--active"],
        capture_output=True, text=True, timeout=5,
    )
    wifi_lines = [l for l in result.stdout.splitlines() if "wifi" in l.lower()]
    if wifi_lines:
        ok(f"WiFi active: {wifi_lines[0]}")
    else:
        warn("No active WiFi connection found")
        print("     All active connections:")
        for l in result.stdout.splitlines():
            print(f"       {l}")
except Exception as e:
    fail(str(e))

# ── 10. Port 8080 ──────────────────────────────────────────────────────────────
section("Flask UI port 8080")
import socket as _socket
s = _socket.socket()
s.settimeout(1)
result = s.connect_ex(("127.0.0.1", 8080))
s.close()
if result == 0:
    ok("Port 8080 is OPEN — Flask UI is running")
else:
    warn("Port 8080 not open — Flask UI not started yet")

# ── Done ───────────────────────────────────────────────────────────────────────
print(f"\n{HEAD}{'=' * 56}{RST}")
print(f"{HEAD}  Diagnostic complete{RST}")
print(f"{HEAD}{'=' * 56}{RST}\n")
