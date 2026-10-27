"""Reproduce original 0.32s PCM chimes; no third-party audio assets."""
from pathlib import Path
import math
import struct
import wave

root = Path(__file__).resolve().parents[1] / 'modules/run-announcer/android/src/main/res/raw'
root.mkdir(parents=True, exist_ok=True)
for name, notes in [('run_candidate', [1046.5]), ('run_stop', [880, 587.33]), ('run_resume', [659.25, 987.77])]:
    samples = []
    for hz in notes:
        for i in range(3520):
            envelope = min(1, i / 220) * min(1, (3519 - i) / 660)
            amplitude = 7000 if name == 'run_candidate' else 8500
            samples.append(int(amplitude * envelope * math.sin(2 * math.pi * hz * i / 22000)))
    with wave.open(str(root / (name + '.wav')), 'wb') as output:
        output.setparams((1, 2, 22000, 0, 'NONE', 'not compressed'))
        output.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
