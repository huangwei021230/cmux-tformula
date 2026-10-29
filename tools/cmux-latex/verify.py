import os
import select
import termios
import tty
import time
import json
import subprocess
from pathlib import Path

root = Path(__file__).parent
fd = os.open("/dev/tty", os.O_RDWR)
old = termios.tcgetattr(fd)
response = b""
try:
    tty.setraw(fd)
    os.write(fd, b"\x1b_Gi=314159,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\")
    end = time.monotonic() + 3
    while time.monotonic() < end:
        if select.select([fd], [], [], 0.1)[0]:
            response += os.read(fd, 4096)
            if b";OK" in response:
                break
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    os.close(fd)
supported = b";OK" in response
(root / "verification.json").write_text(
    json.dumps({"kitty_graphics": supported}, indent=2) + "\n"
)
print("Kitty graphics protocol:", "OK" if supported else "UNCONFIRMED")
if supported:
    print("KaTeX formula rendered inside the terminal:")
    subprocess.run(
        ["node", str(root / "render.mjs"), r"\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}"],
        check=True,
    )
