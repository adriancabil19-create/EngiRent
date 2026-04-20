#!/bin/bash
# EngiRent Kiosk – One-shot setup script for Raspberry Pi OS Trixie
# Run once after cloning the repo:  sudo bash setup.sh

set -e
KIOSK_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
USER_HOME="/home/$SERVICE_USER"
USER_UID="$(id -u "$SERVICE_USER")"

echo "======================================================"
echo "  EngiRent Kiosk Setup"
echo "  Directory : $KIOSK_DIR"
echo "  User      : $SERVICE_USER ($USER_UID)"
echo "======================================================"

# ── 1. System packages ─────────────────────────────────────────────────────────
echo "[1/7] Installing system packages…"
apt-get update -qq
apt-get install -y -qq \
    python3-lgpio python3-gpiozero \
    python3-picamera2 python3-opencv \
    git python3-pip python3-venv \
    chromium unclutter \
    v4l-utils ffmpeg \
    network-manager

# ── 2. Python venv ─────────────────────────────────────────────────────────────
echo "[2/7] Setting up Python virtual environment…"
if [ ! -d "$KIOSK_DIR/venv" ]; then
    sudo -u "$SERVICE_USER" python3 -m venv "$KIOSK_DIR/venv" --system-site-packages
fi
sudo -u "$SERVICE_USER" "$KIOSK_DIR/venv/bin/pip" install --quiet -r "$KIOSK_DIR/requirements.txt"

# ── 3. .env file ───────────────────────────────────────────────────────────────
echo "[3/7] Checking .env…"
if [ ! -f "$KIOSK_DIR/.env" ]; then
    cp "$KIOSK_DIR/.env.example" "$KIOSK_DIR/.env"
    chown "$SERVICE_USER":"$SERVICE_USER" "$KIOSK_DIR/.env"
    echo "  ⚠  .env created — edit credentials before starting:"
    echo "     nano $KIOSK_DIR/.env"
else
    chown "$SERVICE_USER":"$SERVICE_USER" "$KIOSK_DIR/.env"
    echo "  .env already exists, fixing ownership."
fi

# ── 4. Log file ────────────────────────────────────────────────────────────────
echo "[4/7] Creating log file…"
touch /var/log/engirent-kiosk.log
chown "$SERVICE_USER":"$SERVICE_USER" /var/log/engirent-kiosk.log

# ── 5. Systemd kiosk controller service ───────────────────────────────────────
echo "[5/7] Installing systemd services…"

sed \
    -e "s|/home/pi/engirent/server/kiosk|$KIOSK_DIR|g" \
    -e "s|User=pi|User=$SERVICE_USER|g" \
    "$KIOSK_DIR/systemd/engirent-kiosk.service" \
    > /etc/systemd/system/engirent-kiosk.service

systemctl daemon-reload
systemctl enable engirent-kiosk.service
echo "  engirent-kiosk.service enabled."

# ── 6. XDG autostart for Chromium (Wayland-compatible) ────────────────────────
echo "[6/7] Installing Chromium autostart…"

AUTOSTART_DIR="$USER_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/engirent-browser.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=EngiRent Kiosk Browser
Exec=bash -c 'until curl -sf http://localhost:8080 > /dev/null 2>&1; do sleep 1; done && /usr/bin/chromium --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-pinch --overscroll-history-navigation=0 --ozone-platform-hint=auto --password-store=basic --kiosk --start-fullscreen --start-maximized --window-size=1920,1080 --force-device-scale-factor=1 --app=http://localhost:8080 --check-for-update-interval=31536000'
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

chown -R "$SERVICE_USER":"$SERVICE_USER" "$AUTOSTART_DIR"
echo "  Chromium autostart installed at $AUTOSTART_DIR/engirent-browser.desktop"

# ── 7. Desktop auto-login + screen blanking ────────────────────────────────────
echo "[7/7] Configuring desktop auto-login and screen blanking…"
raspi-config nonint do_boot_behaviour B4

LXDE_AUTOSTART_DIR="$USER_HOME/.config/lxsession/LXDE-pi"
LXDE_AUTOSTART="$LXDE_AUTOSTART_DIR/autostart"
mkdir -p "$LXDE_AUTOSTART_DIR"

for LINE in \
    "@xset s off" \
    "@xset -dpms" \
    "@xset s noblank" \
    "@unclutter -idle 0 -root"; do
    grep -qxF "$LINE" "$LXDE_AUTOSTART" 2>/dev/null || echo "$LINE" >> "$LXDE_AUTOSTART"
done
chown -R "$SERVICE_USER":"$SERVICE_USER" "$LXDE_AUTOSTART_DIR"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
if grep -q "your-service-role-key\|PASTE_YOUR" "$KIOSK_DIR/.env" 2>/dev/null; then
echo "  ⚠  1. Fill in credentials:  nano $KIOSK_DIR/.env"
fi
echo "  2. Start now (no reboot):   sudo systemctl start engirent-kiosk.service"
echo "  3. Check logs:              journalctl -u engirent-kiosk.service -f"
echo "  4. Reboot for full test:    sudo reboot"
echo "======================================================"
