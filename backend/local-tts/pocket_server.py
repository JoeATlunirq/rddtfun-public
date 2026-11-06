"""Local TTS server for RddtFun: Kyutai Pocket TTS (CPU, voice cloning) plus
Whisper word timings, behind the OpenAI-compatible routes that
backend/services/localTtsService.js calls.

    GET  /health
    GET  /v1/audio/voices          cloned voices in VOICES_DIR + built-in voices
    POST /v1/audio/speech          {input, voice, response_format: "wav", speed?}
    POST /v1/audio/transcriptions  multipart file, verbose_json + word timestamps

Speed: one Pocket model only uses ~2 CPU cores, so --workers model copies run in a process pool
(M3, cloned voice: 1 worker 6.2x realtime, 4 workers 8.8x). Whisper runs on the GPU through MLX
when installed (frees the CPU for TTS), else on the CPU with faster-whisper; both use base.en.

A cloned voice is a reference clip `<voice_id>.wav` (or .mp3/.flac, ~10-30 s,
one clean speaker) in VOICES_DIR. Its encoded state is cached next to it as
`<voice_id>.safetensors`, so only the first request pays for encoding.

Run with backend/local-tts/start.sh. Settings → Local TTS URL defaults to
http://localhost:3910.
"""
import argparse
import io
import logging
import multiprocessing as mp
import os
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

import pocket_worker

log = logging.getLogger('pocket')


def decode_16k_mono(path):
    # faster-whisper's own decoder (PyAV) breaks on new PyAV releases; system ffmpeg is reliable.
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


class Transcriber:
    """base.en word timings: MLX on the GPU when available, faster-whisper on the CPU otherwise.
    No initial_prompt: prompting with the chunk's own text makes Whisper skip whole sentences."""

    def __init__(self, name):
        self.name = name
        self.lock = threading.Lock()
        self.backend = None
        if name == 'off':
            return
        try:
            import mlx_whisper
            self.mlx = mlx_whisper
            self.repo = f'mlx-community/whisper-{name}-mlx'
            self.backend = 'mlx'
            self.words(np.zeros(16000, dtype=np.float32))  # download + compile once at startup
        except Exception as error:  # noqa: BLE001 - any MLX problem falls back to the CPU model
            log.info('MLX Whisper unavailable (%s); using faster-whisper on the CPU', error)
            from faster_whisper import WhisperModel
            self.cpu = WhisperModel(name, device='cpu', compute_type='int8', cpu_threads=4)
            self.backend = 'cpu'

    def words(self, audio):
        with self.lock:
            if self.backend == 'mlx':
                result = self.mlx.transcribe(audio, path_or_hf_repo=self.repo, word_timestamps=True,
                                             language='en', condition_on_previous_text=False, verbose=None)
                segments = result.get('segments', [])
                words = [{'word': w['word'].strip(), 'start': round(w['start'], 3), 'end': round(w['end'], 3)}
                         for s in segments for w in s.get('words', [])]
                return words, ''.join(s.get('text', '') for s in segments).strip()
            segments, _ = self.cpu.transcribe(audio, word_timestamps=True, language='en', condition_on_previous_text=False)
            words, texts = [], []
            for seg in segments:
                texts.append(seg.text)
                words += [{'word': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3)} for w in seg.words or []]
            return words, ''.join(texts).strip()


def build_app(args, pool, transcriber):
    app = FastAPI(title='RddtFun Pocket TTS')

    @app.get('/health')
    def health():
        return {'status': 'ok', 'engine': 'pocket-tts', 'workers': args.workers,
                'whisper': f'{args.whisper} ({transcriber.backend})', 'voices_dir': args.voices}

    @app.get('/v1/audio/voices')
    def list_voices():
        voices = [{'voice_id': v, 'name': v, 'type': 'clone'} for v in pocket_worker.cloned_voices(args.voices)]
        voices += [{'voice_id': v, 'name': v, 'type': 'builtin'} for v in pocket_worker.BUILTIN_VOICES]
        return {'voices': voices}

    class SpeechRequest(BaseModel):
        input: str
        voice: str | dict = 'alba'
        response_format: str = 'wav'
        model: str | None = None
        speed: float | None = None

    @app.post('/v1/audio/speech')
    def speech(req: SpeechRequest):
        if req.response_format not in ('wav', 'pcm'):
            raise HTTPException(400, 'Only wav and pcm output are supported')
        if not req.input.strip():
            raise HTTPException(400, 'input is empty')
        voice = req.voice.get('id') if isinstance(req.voice, dict) else req.voice
        if pool is None:
            raise HTTPException(503, 'Pocket TTS is off (--workers 0 / POCKET_WORKERS=0); this server only transcribes')
        try:
            pcm, rate, took = pool.submit(pocket_worker.synthesize, req.input, voice).result()
        except LookupError as error:
            raise HTTPException(404, str(error)) from error
        seconds = len(pcm) / 2 / rate
        log.info('%d chars -> %.1fs audio in %.1fs (RTF %.3f)', len(req.input), seconds, took, took / max(seconds, 0.01))
        if req.response_format == 'pcm':
            return Response(pcm, media_type='audio/pcm')
        import scipy.io.wavfile
        buf = io.BytesIO()
        scipy.io.wavfile.write(buf, rate, np.frombuffer(pcm, dtype='<i2'))
        return Response(buf.getvalue(), media_type='audio/wav')

    @app.post('/v1/audio/transcriptions')
    def transcriptions(
        file: UploadFile = File(...),
        prompt: str | None = Form(None),
        language: str | None = Form(None),
        response_format: str = Form('json'),
        model_name: str | None = Form(None, alias='model'),
    ):
        if transcriber.backend is None:
            raise HTTPException(501, 'Transcription is disabled (--whisper off)')
        suffix = Path(file.filename or 'audio.wav').suffix or '.wav'
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file.file.read())
            path = tmp.name
        try:
            audio = decode_16k_mono(path)
            words, text = transcriber.words(audio)
        finally:
            os.unlink(path)
        if response_format == 'text':
            return Response(text, media_type='text/plain')
        return {'text': text, 'language': 'en', 'duration': len(audio) / 16000, 'words': words}

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=3910)
    parser.add_argument('--voices', default=str(Path(__file__).parent / 'voices'))
    parser.add_argument('--language', default=None, help='Pocket TTS model, e.g. english (default)')
    parser.add_argument('--workers', type=int, default=int(os.environ.get('POCKET_WORKERS', 4)),
                        help='Pocket model copies running in parallel (2 CPU threads each); 0 = Whisper only')
    # base.en: ~1.9% WER on narrated stories, 2.2x faster than small.en (1.6%).
    parser.add_argument('--whisper', default='base.en', help='Whisper model; "off" disables transcription')
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='[pocket] %(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)
    Path(args.voices).mkdir(parents=True, exist_ok=True)

    started = time.time()
    pool = None
    if args.workers > 0:
        pool = ProcessPoolExecutor(max_workers=args.workers, mp_context=mp.get_context('spawn'),
                                   initializer=pocket_worker.init_worker, initargs=(args.language, args.voices, 2))
        # Start every worker now so the first job doesn't pay for model loading
        pids = {f.result() for f in [pool.submit(pocket_worker.ping) for _ in range(args.workers * 2)]}
        log.info('%d Pocket TTS workers ready in %.1fs (pids %s)', args.workers, time.time() - started, sorted(pids))
    else:
        log.info('Pocket TTS off: Whisper only')
    started = time.time()
    transcriber = Transcriber(args.whisper)
    log.info('Whisper %s on %s ready in %.1fs', args.whisper, transcriber.backend, time.time() - started)

    uvicorn.run(build_app(args, pool, transcriber), host=args.host, port=args.port, log_level='warning')


if __name__ == '__main__':
    main()
