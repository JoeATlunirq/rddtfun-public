"""Fish Audio Drama 3 on Modal: serverless, billed per second, scales to zero when idle.

SGLang-Omni serves Drama 3 behind an OpenAI-style POST /v1/audio/speech; a cloned voice is passed
as `references: [{audio_path, text}]`, with the clip stored on the `fish-drama-voices` volume.
The HTTP endpoint requires Modal proxy auth (Modal-Key / Modal-Secret headers).

    .venv/bin/modal run fish_drama.py::download          # once: cache the weights on a volume
    .venv/bin/modal volume put fish-drama-voices ../local-tts/voices/Alex.wav Alex.wav
    .venv/bin/modal deploy fish_drama.py                 # prints the endpoint URL
    .venv/bin/python sample.py Alex out.wav "Some text"  # direct call with your Modal login

Licence: Fish Audio Community License (free while annual revenue < $500k; show "Built with Fish Audio").
"""
import os
import subprocess
import time

import modal

MODEL = os.environ.get('FISH_DRAMA_MODEL', 'fishaudio/drama-3')  # FP8 experts, 37 GB
GPU = os.environ.get('FISH_DRAMA_GPU', 'H100')
PORT = 8000
# GPU memory snapshot (restore a warmed-up server instead of booting it). Off: on 2026-10-27 the
# snapshot of this 3-process, ~70 GB server hung for 12+ min at "Creating GPU memory snapshot".
SNAPSHOT = os.environ.get('FISH_DRAMA_SNAPSHOT', '0') == '1'

# The official image already has SGLang-Omni and the Drama 3 vocoder deps (descript-audiotools
# with upstream's protobuf override) in /opt/sglang; installing the [fishaudio] extra again
# with plain pip fails on that protobuf conflict.
# Its entrypoint clones and installs sglang-omni on every boot; do that once at build time instead.
image = (
    modal.Image.from_registry('hongccc/sglang-omni:dev', add_python=None)
    .entrypoint([])
    .env({'HF_HOME': '/weights',
          'PATH': '/opt/sglang/bin:/usr/local/bin:/usr/bin:/bin'})
    .run_commands(
        'git clone --depth 1 --branch main https://github.com/sgl-project/sglang-omni.git /workspace/sglang-omni',
        'python3 -m pip install --no-deps --no-build-isolation -e /workspace/sglang-omni',
    )
)

weights = modal.Volume.from_name('fish-drama-weights', create_if_missing=True)
voices = modal.Volume.from_name('fish-drama-voices', create_if_missing=True)

app = modal.App('rddtfun-fish-drama')


@app.function(image=image, volumes={'/weights': weights}, timeout=3600)
def download():
    """Download the checkpoint into the weights volume (run once; resumes a partial download)."""
    subprocess.run(['hf', 'download', MODEL], check=True)
    weights.commit()
    subprocess.run(f'du -shL /weights/hub/models--{MODEL.replace("/", "--")}/snapshots/*', shell=True)


@app.cls(
    image=image,
    gpu=GPU,
    volumes={'/weights': weights, '/voices': voices},
    timeout=3600,
    # Stay up between the parts of one job, then scale to zero
    scaledown_window=120,
    max_containers=1,
    enable_memory_snapshot=SNAPSHOT,
    experimental_options={'enable_gpu_snapshot': True} if SNAPSHOT else {},
)
@modal.concurrent(max_inputs=64)
class Drama:
    @modal.enter(snap=SNAPSHOT)
    def start(self):
        import urllib.request

        t0 = time.time()
        self.proc = subprocess.Popen([
            'sgl-omni', 'serve',
            '--model-path', MODEL,
            '--host', '0.0.0.0',
            '--port', str(PORT),
            # Many parallel chunks per job: raise the request cap and the engine's memory share (vocoder ~0.10 + 6 GiB reserve must fit in 80 GB)
            '--tts_engine.factory.max_running_requests', '64',
            '--tts_engine.gpu_memory_fraction', '0.78',
            # Capturing prefill CUDA graphs took 62 s of the ~4 min boot; TTS time is mostly decode
            '--tts_engine.engine.cuda_graph_backend_prefill', 'disabled',
        ])
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f'sgl-omni exited with {self.proc.returncode}')
            try:
                urllib.request.urlopen(f'http://localhost:{PORT}/health', timeout=5)
                break
            except Exception:
                time.sleep(2)
        print(f'Drama 3 ready in {time.time() - t0:.0f}s')
        # Warm the request path (reference encoder, vocoder) so the snapshot holds it compiled
        try:
            self._speak('Warming up.', 'Alex', 'Warming up.')
        except Exception as e:
            print(f'warm-up request failed: {e}')
        print(f'Drama 3 warm in {time.time() - t0:.0f}s')

    @modal.exit()
    def stop(self):
        self.proc.terminate()

    @modal.web_server(port=PORT, startup_timeout=900, requires_proxy_auth=True)
    def serve(self):
        pass  # the server started in start(); this only exposes its port

    def _speak(self, text, voice, ref_text):
        import json
        import urllib.request

        body = json.dumps({
            'input': text,
            'references': [{'audio_path': f'/voices/{voice}.wav', 'text': ref_text}],
            'response_format': 'wav',
        }).encode()
        req = urllib.request.Request(f'http://localhost:{PORT}/v1/audio/speech', data=body,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=1800) as res:
            return res.read()

    @modal.method()
    def speak(self, text: str, voice: str, ref_text: str) -> bytes:
        """Synthesize `text` in the cloned `voice` (/voices/<voice>.wav) and return WAV bytes."""
        return self._speak(text, voice, ref_text)
