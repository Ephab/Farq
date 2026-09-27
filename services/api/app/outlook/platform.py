"""Passive classic Outlook capability probe; never launches Outlook or reads mail."""
import sys


def classic_outlook_supported() -> bool:
    if sys.platform != "win32":
        return False
    import winreg
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Outlook.Application\CLSID", 0, winreg.KEY_READ | view):
                return True
        except OSError:
            pass
    return False
