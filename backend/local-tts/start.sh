#!/bin/sh
# Starts the local Pocket TTS server on :3910 (see pocket_server.py).
# First run creates .venv and installs dependencies (~1 GB with torch).
# Voice cloning needs the gated weights: accept the terms at
# https://huggingface.co/kyutai/pocket-tts and run `.venv/bin/hf auth login` once.
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
    PY=$(command -v python3.13 || command -v python3.12 || command -v python3)
    "$PY" -m venv .venv
    .venv/bin/pip install -q --upgrade pip
    .venv/bin/pip install -q -r requirements.txt
fi

exec .venv/bin/python pocket_server.py "$@"
