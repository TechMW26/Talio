"""Fixed cross-platform input operations. No generated code or shell execution."""
import ctypes
import json
import os
import re
import subprocess
import sys
import time


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=8).stdout.strip()


def status():
    if sys.platform == "win32":
        import psutil
        user = ctypes.windll.user32
        user.OpenInputDesktop.restype = ctypes.c_void_p
        user.SwitchDesktop.argtypes = [ctypes.c_void_p]
        user.CloseDesktop.argtypes = [ctypes.c_void_p]
        user.GetForegroundWindow.restype = ctypes.c_void_p
        user.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except (AttributeError, OSError):
            pass
        desktop = user.OpenInputDesktop(0, False, 0x0100)
        if not desktop:
            return {"success": False, "message": "Unlock Windows before using desktop controls."}
        try:
            if not user.SwitchDesktop(desktop):
                return {"success": False, "message": "Unlock Windows before using desktop controls."}
        finally:
            user.CloseDesktop(desktop)
        handle = user.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user.GetWindowThreadProcessId(handle, ctypes.byref(pid))
        return {"success": True, "pid": pid.value, "app": psutil.Process(pid.value).name()}
    if sys.platform == "linux":
        if os.environ.get("XDG_SESSION_TYPE") == "wayland" or not os.environ.get("DISPLAY"):
            return {"success": False, "message": "Desktop controls currently require a Linux X11 session. Wayland blocks this input method."}
        locked = run(["loginctl", "show-session", os.environ.get("XDG_SESSION_ID", "self"), "-p", "LockedHint", "--value"])
        if locked != "no":
            return {"success": False, "message": "Unlock the Linux session before using desktop controls."}
        active = run(["xprop", "-root", "_NET_ACTIVE_WINDOW"]).split()[-1]
        if not re.fullmatch(r"0x[0-9a-fA-F]+", active) or int(active, 16) == 0:
            raise ValueError("No foreground window")
        pid = int(run(["xprop", "-id", active, "_NET_WM_PID"]).split()[-1])
        import psutil
        return {"success": True, "pid": pid, "app": psutil.Process(pid).name()}
    raise ValueError("Unsupported platform")


def open_app(name):
    if not isinstance(name, str) or not 1 <= len(name) <= 80 or not all(c.isalnum() or c in " ._-" for c in name):
        raise ValueError("Invalid app name")
    if sys.platform == "win32":
        # Name is passed as environment data, never interpolated into PowerShell.
        script = r'''$n=$env:TALIO_TARGET_APP; $p=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -ieq $n -or $_.MainWindowTitle -ieq $n) } | Select-Object -First 1; if($p){$s=New-Object -ComObject WScript.Shell; if($s.AppActivate($p.Id)){exit 0}; exit 3}; $a=Get-StartApps | Where-Object {$_.Name -ieq $n} | Select-Object -First 1; if($a){Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\'+$a.AppID);exit 0};exit 2'''
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], env={**os.environ, "TALIO_TARGET_APP": name}, capture_output=True, timeout=10)
        return {"success": result.returncode == 0, "notInstalled": result.returncode == 2}
    windows = run(["wmctrl", "-lx"])
    for line in windows.splitlines():
        fields = line.split(None, 4)
        if len(fields) >= 4 and any(name.casefold() == part.casefold() for part in fields[2].split(".")):
            run(["wmctrl", "-ia", fields[0]])
            return {"success": True}
    import configparser
    from pathlib import Path
    roots = [Path.home() / ".local/share/applications", Path("/usr/local/share/applications"), Path("/usr/share/applications")]
    for root in roots:
        for file in root.glob("*.desktop"):
            config = configparser.ConfigParser(interpolation=None, strict=False)
            try:
                config.read(file)
                entry = config["Desktop Entry"]
                if entry.get("Name", "").casefold() == name.casefold() and entry.get("Hidden", "false") != "true":
                    run(["gio", "launch", str(file)])
                    return {"success": True}
            except (configparser.Error, KeyError):
                continue
    return {"success": False, "notInstalled": True}


def control(value):
    probe = status()
    if not probe["success"] or value.get("type") == "status":
        return probe
    kind = value.get("type")
    if kind == "open_app":
        return open_app(value.get("name"))
    if kind == "lock":
        if sys.platform == "win32":
            if not ctypes.windll.user32.LockWorkStation():
                raise ValueError("Lock unavailable")
        else:
            run(["loginctl", "lock-session"])
        return {"success": True}
    import pyautogui
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.08
    if kind == "click":
        x, y = value["x"], value["y"]
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not pyautogui.onScreen(x, y):
            raise ValueError("Invalid click")
        pyautogui.moveTo(x, y, duration=0.2)
        pyautogui.click()
    elif kind == "type" and isinstance(value.get("text"), str) and len(value["text"]) <= 2000:
        if sys.platform == 'win32':
            # Unicode input preserves all clipboard formats, unlike text-only
            # clipboard backup/restore (which would discard copied images).
            from ctypes import wintypes
            class KeyboardInput(ctypes.Structure):
                _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
            class InputUnion(ctypes.Union):
                _fields_ = [('ki', KeyboardInput), ('padding', ctypes.c_byte * (32 if ctypes.sizeof(ctypes.c_void_p) == 8 else 24))]
            class Input(ctypes.Structure):
                _fields_ = [('type', wintypes.DWORD), ('data', InputUnion)]
            units = value['text'].encode('utf-16-le')
            for offset in range(0, len(units), 2):
                unit = int.from_bytes(units[offset:offset+2], 'little')
                for flags in (0x0004, 0x0004 | 0x0002):
                    event = Input(type=1, data=InputUnion(ki=KeyboardInput(0, unit, flags, 0, 0)))
                    if ctypes.windll.user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(event)) != 1:
                        raise ValueError('Windows rejected keyboard input')
            return {"success": True, "message": "Input delivered; verify the next screenshot."}
        import pyperclip
        targets = run(['xclip', '-selection', 'clipboard', '-t', 'TARGETS', '-o'])
        if any(item.startswith('image/') or item in ('text/html', 'text/uri-list') for item in targets.splitlines()):
            return {"success": False, "message": "Copy plain text first; desktop typing will not overwrite your rich clipboard content."}
        previous = pyperclip.paste()
        pyperclip.copy(value["text"])
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.15)
        if pyperclip.paste() == value["text"]:
            pyperclip.copy(previous)
    elif kind == "key":
        keys = {"select_all": ["ctrl", "a"], "find": ["ctrl", "f"], "copy": ["ctrl", "c"], "paste": ["ctrl", "v"]}
        if value.get("key") in keys:
            pyautogui.hotkey(*keys[value["key"]])
        elif value.get("key") in ("enter", "tab", "escape", "backspace", "up", "down", "left", "right"):
            pyautogui.press(value["key"])
        else:
            raise ValueError("Unsupported key")
    elif kind == "scroll" and type(value.get("amount")) is int and abs(value["amount"]) <= 10:
        pyautogui.scroll(-value["amount"])
    else:
        raise ValueError("Unsupported action")
    return {"success": True, "message": "Input delivered; verify the next screenshot."}


def main():
    try:
        print(json.dumps(control(json.loads(sys.stdin.readline(10000)))))
    except Exception:
        print(json.dumps({"success": False, "message": "Desktop input is unavailable. Check session permissions and required desktop utilities."}))
