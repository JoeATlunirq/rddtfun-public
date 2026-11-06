"""Generate one sample from the deployed Drama 3 app with your Modal login (no proxy token needed).

    .venv/bin/python sample.py Alex out.wav "Text to read"
"""
import pathlib
import sys
import time

import modal

voice, out, text = sys.argv[1], sys.argv[2], sys.argv[3]
ref_text = (pathlib.Path(__file__).parent.parent / 'local-tts' / 'voices' / f'{voice}.txt').read_text().strip()
Drama = modal.Cls.from_name('rddtfun-fish-drama', 'Drama')
t0 = time.time()
wav = Drama().speak.remote(text, voice, ref_text)
pathlib.Path(out).write_bytes(wav)
print(f'{voice}: {len(wav)} bytes in {time.time() - t0:.1f}s')
