"""Pocket TTS worker process: one model copy and its voice states. pocket_server.py runs several
of these in a process pool because one model only uses ~2 CPU cores (generate_audio is batch-1
and not thread-safe)."""
import logging
import os
import time
from pathlib import Path

AUDIO_EXTS = ('.wav', '.mp3', '.flac', '.m4a')
BUILTIN_VOICES = ['alba', 'marius', 'javert', 'jean', 'fantine', 'cosette', 'eponine', 'azelma',
                  'anna', 'vera', 'charles', 'paul', 'george', 'mary', 'jane', 'michael', 'eve',
                  'bill_boerst', 'peter_yearsley', 'stuart_bell', 'caro_davy']

_model = None
_voices_dir = None
_states = {}
log = logging.getLogger('pocket')


def cloned_voices(voices_dir):
    return {p.stem: p for p in sorted(Path(voices_dir).iterdir()) if p.suffix.lower() in AUDIO_EXTS}


def _exit_with_parent():
    """Quit when the server process dies (killed or crashed), instead of lingering as an orphan."""
    import threading
    parent = os.getppid()

    def watch():
        while os.getppid() == parent:
            time.sleep(2)
        os._exit(0)
    threading.Thread(target=watch, daemon=True).start()


def init_worker(language, voices_dir, threads):
    """Pool initializer: load the model once per worker process."""
    global _model, _voices_dir
    # Lower priority than rendering: a render needs ~2 cores promptly to keep the hardware encoder fed,
    # and TTS soaks up whatever is left (at equal priority 8 TTS threads starved renders to ~36 fps)
    try:
        os.nice(int(os.environ.get('POCKET_NICE', 10)))
    except OSError:
        pass
    _exit_with_parent()
    import torch
    if threads > 0:
        torch.set_num_threads(threads)
    from pocket_tts import TTSModel
    logging.basicConfig(level=logging.INFO, format=f'[pocket w{os.getpid()}] %(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)
    _voices_dir = voices_dir
    _model = TTSModel.load_model(**({'language': language} if language else {}))


def _voice_state(voice):
    if voice in _states:
        return _states[voice]
    from pocket_tts.models.model_state import export_model_state
    clones = cloned_voices(_voices_dir)
    if voice in clones:
        ref = clones[voice]
        cache = ref.with_suffix('.safetensors')
        if cache.exists() and cache.stat().st_mtime >= ref.stat().st_mtime:
            state = _model.get_state_for_audio_prompt(str(cache))
        else:
            state = _model.get_state_for_audio_prompt(str(ref), truncate=True)
            # Workers may race to cache the same voice: write a private temp file, then rename
            tmp = cache.with_name(f'{cache.stem}.{os.getpid()}.tmp.safetensors')
            export_model_state(state, str(tmp))
            os.replace(tmp, cache)
    elif voice in BUILTIN_VOICES:
        state = _model.get_state_for_audio_prompt(voice)
    else:
        raise LookupError(f'Unknown voice "{voice}". Add {voice}.wav to {_voices_dir}.')
    _states[voice] = state
    return state


def synthesize(text, voice):
    """Returns (int16 PCM bytes, sample rate, seconds of compute)."""
    state = _voice_state(voice)
    started = time.time()
    audio = _model.generate_audio(state, text).numpy()
    pcm = (audio * 32767).clip(-32768, 32767).astype('<i2')
    return pcm.tobytes(), _model.sample_rate, time.time() - started


def ping():
    return os.getpid()
