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

# ── 6. Test USB camera nodes with OpenCV GStreamer ────────────────────────────
# Only test even-numbered nodes 0–10; Pi ISP nodes (video19+) stall GStreamer.
section("Camera open test  (OpenCV GStreamer, USB nodes only)")
import cv2 as _cv2, os as _os, numpy as _np, re as _re, subprocess as _sp

# Detect USB capture nodes from v4l2-ctl (first /dev/videoX under each USB device)
def _usb_capture_nodes() -> list[str]:
    try:
        out = _sp.run(["v4l2-ctl", "--list-devices"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return [f"/dev/video{i}" for i in [0, 2, 4, 6, 9]]  # safe fallback
    nodes, in_usb, seen_first = [], False, False
    for line in out.splitlines():
        stripped = line.strip()
        if not line.startswith("\t"):
            # device header line — USB if it mentions "usb"
            in_usb = "usb" in line.lower()
            seen_first = False
        elif in_usb and not seen_first and stripped.startswith("/dev/video"):
            nodes.append(stripped)
            seen_first = True  # only take the first node per USB device
    return nodes

USB_TEST_NODES = _usb_capture_nodes()
_CAMERA_LABELS = {
    "/dev/video0": "Face Cam  (A4tech FHD)",
    "/dev/video2": "Locker 3  (Web Camera)",
    "/dev/video4": "Locker 4  (Web Camera)",
    "/dev/video6": "Extra Cam 1",
    "/dev/video8": "Extra Cam 2",
    "/dev/video9": "Extra Cam 3",
    "/dev/video10": "Extra Cam 4",
}
_working_cameras: list[str] = []
# Keep caps open — reused directly in the preview (avoids re-open race)
_preview_caps: dict[str, object] = {}

THUMB_W, THUMB_H = 320, 240   # scale in pipeline, not Python
_FONT   = _cv2.FONT_HERSHEY_SIMPLEX
_GREEN  = (0, 220, 60)
_SHADOW = (0, 0, 0)

def _open_preview_cap(device: str):
    # Scale + limit framerate inside GStreamer — far cheaper than Python resize
    gst = (
        f"v4l2src device={device} ! "
        f"video/x-raw,framerate=15/1 ! "
        f"videoscale ! video/x-raw,width={THUMB_W},height={THUMB_H} ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    c = _cv2.VideoCapture(gst, _cv2.CAP_GSTREAMER)
    if c.isOpened():
        return c
    # Fallback: no framerate/scale negotiation
    gst2 = (
        f"v4l2src device={device} ! "
        f"videoconvert ! video/x-raw,format=BGR ! "
        f"appsink max-buffers=1 drop=true sync=false"
    )
    c2 = _cv2.VideoCapture(gst2, _cv2.CAP_GSTREAMER)
    return c2 if c2.isOpened() else None

for device in USB_TEST_NODES:
    if not _os.path.exists(device):
        continue
    c = _open_preview_cap(device)
    if c is not None:
        ret, frame = c.read()
        if ret and frame is not None:
            h, w = frame.shape[:2]
            label = _CAMERA_LABELS.get(device, device)
            ok(f"{device}  [{label}]  →  {w}x{h} ✓")
            _working_cameras.append(device)
            _preview_caps[device] = c   # keep open for preview
        else:
            warn(f"{device}  →  opened but no frame")
            c.release()
    else:
        fail(f"{device}  →  could not open")

# ── 6b. Live preview of all working cameras ───────────────────────────────────
if _preview_caps:
    section("Live camera preview  (press Q to quit)")
    n = len(_preview_caps)
    print(f"  {n} camera(s) found: {', '.join(_preview_caps)}")
    print("  Preview window open — press  Q  or  Esc  to close.\n")

    # Layout: up to 3 per row, 320x240 tiles → max 960px wide
    COLS = min(n, 3)
    ROWS = (n + COLS - 1) // COLS

    _cv2.namedWindow("EngiRent Cameras", _cv2.WINDOW_NORMAL)
    _cv2.resizeWindow("EngiRent Cameras", THUMB_W * COLS, THUMB_H * ROWS)

    try:
        while True:
            tiles = []
            for device, c in _preview_caps.items():
                ret, frame = c.read()
                if not ret or frame is None:
                    frame = _np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8)
                else:
                    if frame.shape[1] != THUMB_W or frame.shape[0] != THUMB_H:
                        frame = _cv2.resize(frame, (THUMB_W, THUMB_H))

                label   = _CAMERA_LABELS.get(device, device)
                caption = f"{label} | {device}"
                _cv2.putText(frame, caption, (6, 22),  _FONT, 0.48, _SHADOW, 3, _cv2.LINE_AA)
                _cv2.putText(frame, caption, (5, 21),  _FONT, 0.48, _GREEN,  1, _cv2.LINE_AA)
                _cv2.rectangle(frame, (0,0), (THUMB_W-1, THUMB_H-1), _GREEN, 2)
                tiles.append(frame)

            # Pad to fill grid
            blank = _np.zeros((THUMB_H, THUMB_W, 3), dtype=_np.uint8)
            while len(tiles) < COLS * ROWS:
                tiles.append(blank)

            rows_img = [_np.hstack(tiles[r*COLS:(r+1)*COLS]) for r in range(ROWS)]
            _cv2.imshow("EngiRent Cameras", _np.vstack(rows_img))

            key = _cv2.waitKey(1) & 0xFF
            if key in (ord('q'), ord('Q'), 27):
                break
    finally:
        for c in _preview_caps.values():
            c.release()
        _cv2.destroyAllWindows()
    ok("Preview closed")
else:
    warn("No cameras available for preview")

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
