"""
Solenoid relay controller — uses lgpio directly (no gpiozero).

Each locker has 2 solenoids:
  main_door   – top insertion door
  bottom_door – retrieval door at the base

Relay modules are active-LOW (energised = GPIO LOW = solenoid open).
Set RELAY_ACTIVE_LEVEL=active_high in .env if your board is active-HIGH.
"""

import asyncio
import logging

from config import LOCKER_PINS, MOCK_GPIO, RELAY_ACTIVE_LOW, GPIO_CHIP

log = logging.getLogger("kiosk.gpio")

DOOR_KEYS = ("main_door", "bottom_door")

# Logical pin states for active-LOW vs active-HIGH relay boards
_RELAY_ON  = 0 if RELAY_ACTIVE_LOW else 1   # energise = unlock
_RELAY_OFF = 1 if RELAY_ACTIVE_LOW else 0   # de-energise = lock

if not MOCK_GPIO:
    import lgpio
    log.info("Solenoid controller using gpiochip%s", GPIO_CHIP)


class _MockOutput:
    """Stand-in when MOCK_GPIO=True."""
    def __init__(self, pin: int):
        self._pin = pin

    def on(self):
        log.debug("[MOCK] GPIO %s → ON (unlock)", self._pin)

    def off(self):
        log.debug("[MOCK] GPIO %s → OFF (lock)", self._pin)

    def close(self):
        pass


class _LgpioOutput:
    """Thin wrapper around a single lgpio output pin."""

    def __init__(self, handle: int, pin: int):
        self._h   = handle
        self._pin = pin
        # Claim pin as output, initial state = RELAY_OFF (locked)
        lgpio.gpio_claim_output(self._h, self._pin, _RELAY_OFF)
        log.info("Solenoid pin=GPIO%s claimed as output ✓", self._pin)

    def on(self):
        lgpio.gpio_write(self._h, self._pin, _RELAY_ON)

    def off(self):
        lgpio.gpio_write(self._h, self._pin, _RELAY_OFF)

    def close(self):
        try:
            lgpio.gpio_write(self._h, self._pin, _RELAY_OFF)   # ensure locked
            lgpio.gpio_free(self._h, self._pin)
        except Exception:
            pass


class SolenoidController:
    """Manages all solenoids across 4 lockers."""

    def __init__(self, pin_config: dict | None = None):
        self._handle: int | None = None
        self._relays: dict[tuple[int, str], _MockOutput | _LgpioOutput] = {}
        self._pin_config = pin_config or LOCKER_PINS

        if not MOCK_GPIO:
            self._handle = lgpio.gpiochip_open(GPIO_CHIP)

        self._init_pins()

    def _init_pins(self):
        for locker_id, pins in self._pin_config.items():
            for door in DOOR_KEYS:
                pin_key = f"{door}_pin"
                pin = pins[pin_key]

                if MOCK_GPIO:
                    relay = _MockOutput(pin)
                    log.debug("Solenoid locker=%s door=%s pin=GPIO%s [MOCK]", locker_id, door, pin)
                else:
                    try:
                        relay = _LgpioOutput(self._handle, pin)
                        log.info("Solenoid locker=%s door=%s pin=GPIO%s ✓", locker_id, door, pin)
                    except Exception as e:
                        log.error("Failed to init solenoid locker=%s door=%s pin=GPIO%s: %s", locker_id, door, pin, e)
                        raise

                self._relays[(locker_id, door)] = relay

    def _relay(self, locker_id: int, door: str):
        key = (locker_id, door)
        if key not in self._relays:
            raise ValueError(f"Unknown locker={locker_id} door={door}")
        return self._relays[key]

    def unlock(self, locker_id: int, door: str):
        relay = self._relay(locker_id, door)
        relay.on()
        log.info("UNLOCK locker=%s door=%s", locker_id, door)

    def lock(self, locker_id: int, door: str):
        relay = self._relay(locker_id, door)
        relay.off()
        log.info("LOCK   locker=%s door=%s", locker_id, door)

    async def unlock_for(self, locker_id: int, door: str, seconds: float):
        self.unlock(locker_id, door)
        log.info("Holding unlock locker=%s door=%s for %.1fs…", locker_id, door, seconds)
        await asyncio.sleep(seconds)
        self.lock(locker_id, door)
        log.info("AUTO-LOCKED locker=%s door=%s after %.1fs", locker_id, door, seconds)

    def lock_all(self):
        for (lid, door) in self._relays:
            self.lock(lid, door)
        log.warning("ALL solenoids locked")

    def cleanup(self):
        self.lock_all()
        for relay in self._relays.values():
            relay.close()
        self._relays = {}
        if self._handle is not None:
            try:
                lgpio.gpiochip_close(self._handle)
            except Exception:
                pass
            self._handle = None
