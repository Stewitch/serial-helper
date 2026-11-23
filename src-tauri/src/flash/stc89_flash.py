"""SerialHelper STC89/STC90 flasher.

Uses stcgal (https://github.com/grigorig/stcgal, MIT) for the ISP protocol, but
opens the serial port and cycles the board's power itself:

* stcgal's --autoreset holds DTR for a fixed 0.25 s (0.5 s for stc89a) and opens
  the port with DTR asserted, which cuts power on boards where DTR low = power off.
* stcgal's protocol autodetection picks "stc89" for chips with the newer 7.x
  bootloader, which need "stc89a". The first byte of the status packet tells
  them apart (0x00 = stc89, 0x50 = stc89a).

Progress is written to stdout as lines starting with "@@" followed by JSON.
Everything else on stdout/stderr is plain log output.
"""

import argparse
import json
import sys
import time


def emit(stage, message="", percent=None, **extra):
    event = {"stage": stage, "message": message}
    if percent is not None:
        event["percent"] = max(0, min(100, int(percent)))
    event.update(extra)
    # Leading newline: stcgal prints partial lines (end=""), keep events on their own line.
    sys.stdout.write("\n@@" + json.dumps(event) + "\n")
    sys.stdout.flush()


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", required=True)
    ap.add_argument("--image", help="binary image starting at address 0")
    ap.add_argument("--protocol", choices=["auto", "stc89", "stc89a"], default="auto")
    ap.add_argument("--pin", choices=["dtr", "rts"], default="dtr", help="line that switches board power")
    ap.add_argument("--off-level", choices=["low", "high"], default="low",
                    help="physical pin level that turns the board off")
    ap.add_argument("--off-ms", type=int, default=500, help="how long the board stays off")
    ap.add_argument("--handshake", type=int, default=2400)
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--attempts", type=int, default=3)
    ap.add_argument("--sync-timeout", type=float, default=2.0, help="seconds to wait for the bootloader per attempt")
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--check", action="store_true", help="only report the stcgal version")
    return ap.parse_args()


def sync(probe, ser, timeout, framing_errors):
    """Send 0x7F until the bootloader answers with a status packet."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ser.write(b"\x7f")
        ser.flush()
        time.sleep(0.030)
        if ser.in_waiting == 0:
            continue
        try:
            packet = probe.get_status_packet()
            if len(packet) >= 23:
                return packet
        except framing_errors:
            pass
    return None


def main():
    args = parse_args()

    try:
        import serial
        import stcgal
        from stcgal.protocols import (
            Stc89AProtocol,
            Stc89Protocol,
            StcAutoProtocol,
            StcFramingException,
            StcProtocolException,
        )
    except ImportError as ex:
        emit("error", "stcgal is not installed for this Python (%s). Run: python -m pip install stcgal" % ex)
        return 3

    if args.check:
        print("stcgal %s, pyserial %s, Python %s" % (stcgal.__version__, serial.__version__, sys.version.split()[0]))
        return 0

    if not args.image:
        emit("error", "No firmware image given")
        return 2

    with open(args.image, "rb") as f:
        image = f.read()

    # pyserial: True = line asserted. CH340 and most USB-UART chips drive an
    # asserted DTR/RTS pin low, so "off at low level" means asserting the line.
    off_state = args.off_level == "low"

    def set_power(ser, on):
        state = (not off_state) if on else off_state
        if args.pin == "rts":
            ser.rts = state
        else:
            ser.dtr = state

    ser = serial.Serial()
    ser.port = args.port
    ser.baudrate = args.handshake
    ser.parity = serial.PARITY_NONE
    ser.timeout = 0.5
    ser.inter_byte_timeout = 0.5
    # Set both lines before opening, so opening the port does not cut power.
    ser.dtr = False
    ser.rts = False
    set_power(ser, True)

    framing_errors = (StcFramingException, serial.SerialTimeoutException)
    proto = None
    try:
        emit("connecting", "Opening %s at %d baud" % (args.port, args.handshake))
        ser.open()
        set_power(ser, True)

        probe = StcAutoProtocol(args.port, args.handshake, args.baud)
        probe.ser = ser
        probe.debug = args.debug

        status = None
        for attempt in range(1, args.attempts + 1):
            emit("connecting", "Power off for %d ms (%s pin %s), attempt %d of %d"
                 % (args.off_ms, args.pin.upper(), args.off_level, attempt, args.attempts))
            set_power(ser, False)
            time.sleep(args.off_ms / 1000.0)
            ser.reset_input_buffer()
            set_power(ser, True)
            status = sync(probe, ser, args.sync_timeout, framing_errors)
            if status:
                break
            emit("connecting", "No answer from the bootloader within %.1f s" % args.sync_timeout)

        if not status:
            emit("error", "The MCU did not answer after %d power cycles. Check the power pin setting, "
                          "the off time and the wiring, or press the board's power switch by hand." % args.attempts)
            return 1

        # Same as the end of stcgal's StcBaseProtocol.connect().
        probe.status_packet = status
        ser.timeout = 15.0
        ser.inter_byte_timeout = 1.0
        probe.initialize_model()

        if args.protocol != "auto":
            name = args.protocol
        elif status[0] == 0x50:
            name = "stc89a"
        elif status[0] == 0x00 and probe.protocol_name == "stc89":
            name = "stc89"
        else:
            emit("error", "%s uses the stcgal protocol '%s'. This module supports STC89/STC90 chips only."
                 % (probe.model.name, probe.protocol_name))
            return 1

        proto = (Stc89AProtocol if name == "stc89a" else Stc89Protocol)(args.port, args.handshake, args.baud)
        proto.debug = args.debug
        proto.initialize(probe)
        emit("detecting", "%s, %.3f MHz, bootloader %s, protocol %s"
             % (proto.model.name, proto.mcu_clock_hz / 1e6, proto.mcu_bsl_version, name),
             chip=proto.model.name, codeSize=proto.model.code, protocol=name)

        code_size = proto.model.code
        if len(image) > code_size + proto.model.eeprom:
            emit("error", "Firmware is %d bytes but %s has %d bytes of flash" % (len(image), proto.model.name, code_size))
            proto.disconnect()
            return 1
        if len(image) > code_size:
            print("WARNING: firmware overflows into the EEPROM area", file=sys.stderr)
        if len(image) % 512:
            image += b"\xff" * (512 - len(image) % 512)

        def on_progress(current, written, maximum):
            if current >= maximum:
                return
            emit("writing", "Writing 0x%04X" % current, percent=(current + written) * 100 // maximum,
                 address=current, length=written)

        proto.progress_cb = on_progress

        # The MCU's UART divider must be at least 1 (stcgal divides by zero otherwise).
        sample_rate = 16 if getattr(proto, "cpu_6t", False) and name == "stc89" else 32
        if round(proto.mcu_clock_hz / (args.baud * sample_rate)) < 1:
            emit("error", "%d baud is too fast for a %.3f MHz clock. Choose a lower transfer baud rate."
                 % (args.baud, proto.mcu_clock_hz / 1e6))
            proto.disconnect()
            proto = None
            return 1

        emit("detecting", "Switching to %d baud" % args.baud)
        proto.handshake()
        emit("erasing", "Erasing %d bytes" % len(image))
        proto.erase_flash(len(image), code_size)
        emit("writing", "Writing %d bytes" % len(image), percent=0)
        proto.program_flash(image)
        emit("resetting", "Writing the option byte and starting the program")
        proto.program_options()
        proto.disconnect()
        proto = None
        emit("complete", "Done", percent=100)
        return 0
    except (StcFramingException, StcProtocolException) as ex:
        emit("error", "Protocol error: %s" % ex)
        return 1
    except serial.SerialException as ex:
        emit("error", "Serial port error: %s" % ex)
        return 1
    except Exception as ex:  # noqa: BLE001 - report anything stcgal raises
        emit("error", "%s: %s" % (type(ex).__name__, ex))
        return 1
    finally:
        if ser.is_open:
            ser.close()


if __name__ == "__main__":
    sys.exit(main())
