#!/usr/bin/env python3
"""
Real-Time Pitch Correction SocketIO Events
===========================================
SocketIO events for live vocal pitch correction.

Usage:
  Browser connects via SocketIO → streams audio chunks
  Server processes with RealtimePitchCorrector
  Server emits pitch data back
"""

import numpy as np
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.audio.realtime_pitch_correction import RealtimePitchCorrector, HarmonyGenerator

logger = logging.getLogger(__name__)

# Store active sessions
_active_sessions = {}


def register_socketio_events(socketio):
    """Register SocketIO events for realtime pitch correction"""

    @socketio.on('connect', namespace='/realtime-pitch')
    def on_connect():
        logger.info("Client connected to /realtime-pitch")

    @socketio.on('disconnect', namespace='/realtime-pitch')
    def on_disconnect():
        from flask import request
        sid = request.sid
        _active_sessions.pop(sid, None)
        logger.info(f"Client disconnected from /realtime-pitch: {sid}")

    @socketio.on('start_pitch_correction', namespace='/realtime-pitch')
    def on_start(data):
        from flask import request
        sid = request.sid
        corrector = RealtimePitchCorrector()
        _active_sessions[sid] = corrector

        scale = data.get('scale', 'C major')
        strength = data.get('correction_strength', 0.8)
        corrector.set_scale(scale)
        corrector.set_correction_strength(strength)

        socketio.emit('config_ack', {
            'scale': scale,
            'strength': strength,
        }, namespace='/realtime-pitch', room=sid)

        logger.info(f"Pitch correction started for {sid}: {scale} @ {strength}")

    @socketio.on('audio_chunk', namespace='/realtime-pitch')
    def on_audio_chunk(data):
        from flask import request
        sid = request.sid
        corrector = _active_sessions.get(sid)
        if not corrector:
            return

        try:
            audio_data = data.get('samples', [])
            if not audio_data:
                return

            audio_chunk = np.array(audio_data, dtype=np.float32)
            result = corrector.process_chunk(audio_chunk)

            if result['original_pitch'] is not None:
                socketio.emit('pitch_data', {
                    'type': 'pitch',
                    **result,
                }, namespace='/realtime-pitch', room=sid)
        except Exception as e:
            logger.error(f"Error processing audio chunk: {e}")

    @socketio.on('stop_pitch_correction', namespace='/realtime-pitch')
    def on_stop():
        from flask import request
        sid = request.sid
        _active_sessions.pop(sid, None)
        logger.info(f"Pitch correction stopped for {sid}")

    @socketio.on('generate_harmony', namespace='/realtime-pitch')
    def on_generate_harmony(data):
        from flask import request
        sid = request.sid
        corrector = _active_sessions.get(sid)
        scale = corrector.scale if corrector else 'C major'

        melody = data.get('melody', [])
        harmony_type = data.get('harmony_type', '3rd')
        generator = HarmonyGenerator(scale=scale)
        harmony = generator.generate_harmony(melody, harmony_type)

        socketio.emit('harmony_data', {
            'type': 'harmony',
            'notes': harmony,
        }, namespace='/realtime-pitch', room=sid)

    @socketio.on('generate_backing', namespace='/realtime-pitch')
    def on_generate_backing(data):
        from flask import request
        sid = request.sid
        corrector = _active_sessions.get(sid)
        scale = corrector.scale if corrector else 'C major'

        melody = data.get('melody', [])
        style = data.get('style', 'parallel')
        num_voices = data.get('num_voices', 2)
        generator = HarmonyGenerator(scale=scale)
        tracks = generator.generate_backing_vocals(melody, style, num_voices)

        socketio.emit('backing_data', {
            'type': 'backing',
            'tracks': tracks,
        }, namespace='/realtime-pitch', room=sid)

