# test_cam.py — replace with this
import os, sys, ctypes

_DIR = os.path.dirname(os.path.abspath(__file__))
print(f"Looking in: {_DIR}")
print(f"uvcham.dll exists: {os.path.exists(os.path.join(_DIR, 'uvcham.dll'))}")
print(f"Python: {sys.version}")
print()

# Try loading directly with full path
try:
    dll = ctypes.windll.LoadLibrary(os.path.join(_DIR, 'uvcham.dll'))
    print("✓ DLL loaded directly by full path")
except OSError as e:
    print(f"✗ Direct load failed: {e}")
    print()
    print("This means uvcham.dll itself needs other DLLs that are missing.")
    print("Download 'Dependencies.exe' from:")
    print("  https://github.com/lucasg/Dependencies/releases")
    print("Drag uvcham.dll onto it to see which DLLs are missing (shown in red).")
    sys.exit(1)

print()
import uvcham
print("✓ uvcham module loaded")
print("Version:", uvcham.Uvcham.Version())
print()

cameras = uvcham.Uvcham.enum()
if not cameras:
    print("✗ No cameras found — check USB connection")
else:
    for c in cameras:
        print(f"✓ Camera found: {c.displayname}  id={c.id}")