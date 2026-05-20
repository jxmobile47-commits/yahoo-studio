"""
Chord Gemini Post-Processing Service
====================================
Enhances BTC-SL chord recognition with Google Gemini API for:
- Enharmonic correction (e.g. preferring Db vs C# contextually)
- Extended chord vocabulary (maj7, m7b5, sus2, add9, etc.)
- Jazz / complex chord handling
- Roman numeral analysis

Requires GOOGLE_API_KEY in environment.
"""

import os
import time
import json
from typing import Dict, Any, List, Optional

from utils.logging import log_info, log_error, log_debug


class ChordGeminiService:
    """
    Post-processing service that uses Gemini to refine raw chord recognition results.
    Does NOT replace BTC-SL; it enhances its output.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("GOOGLE_API_KEY", "")
        self._client = None
        self._available = None

    def is_available(self) -> bool:
        """Check if Gemini API key is configured and the client works."""
        if self._available is not None:
            return self._available

        if not self.api_key:
            log_error("Gemini API key not found. Set GOOGLE_API_KEY environment variable.")
            self._available = False
            return False

        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            # Lightweight test: list models
            models = [m.name for m in genai.list_models() if "gemini" in m.name]
            if not models:
                log_error("No Gemini models found for this API key.")
                self._available = False
                return False

            self._client = genai
            log_info(f"Gemini client ready. Available models: {models[:3]}")
            self._available = True
            return True
        except Exception as e:
            log_error(f"Gemini client initialization failed: {e}")
            self._available = False
            return False

    def _get_model(self):
        """Return the preferred Gemini model instance."""
        if not self.is_available():
            return None
        # Prefer gemini-1.5-flash for speed; fallback to gemini-1.5-pro for quality
        try:
            return self._client.GenerativeModel("gemini-1.5-flash")
        except Exception:
            return self._client.GenerativeModel("gemini-1.5-pro")

    def post_process_chords(
        self,
        raw_chords: List[Dict[str, Any]],
        bpm: float = 120.0,
        key: Optional[str] = None,
        style: str = "auto",
    ) -> Dict[str, Any]:
        """
        Send raw BTC-SL chords to Gemini for enharmonic correction
        and extended vocabulary enhancement.

        Args:
            raw_chords: List of {start, end, chord} dicts from BTC-SL
            bpm: Estimated BPM for context
            key: Detected musical key (e.g. 'C major', 'A minor')
            style: 'jazz', 'pop', 'rock', 'classical', or 'auto'

        Returns:
            {
                "success": bool,
                "chords": [ {start, end, chord, chord_original, confidence}, ... ],
                "roman_numerals": [ {start, end, roman}, ... ] or None,
                "key": str,
                "enhancements_applied": [str, ...],
                "model_used": "gemini-1.5-flash",
                "processing_time": float,
                "error": str (if success=False),
            }
        """
        start_time = time.time()

        if not self.is_available():
            return {
                "success": False,
                "error": "Gemini service not available (missing GOOGLE_API_KEY or client init failed)",
                "chords": raw_chords,
                "roman_numerals": None,
                "key": key,
                "enhancements_applied": [],
                "model_used": "none",
                "processing_time": time.time() - start_time,
            }

        if not raw_chords:
            return {
                "success": True,
                "chords": [],
                "roman_numerals": None,
                "key": key,
                "enhancements_applied": [],
                "model_used": "gemini",
                "processing_time": time.time() - start_time,
            }

        try:
            model = self._get_model()
            if model is None:
                raise RuntimeError("Gemini model could not be loaded")

            # Build a compact chord timeline for the prompt
            timeline = []
            for c in raw_chords[:120]:  # Cap at 120 chords to stay within token limits
                timeline.append(f"{c.get('start', 0):.2f}s: {c.get('chord', 'N')}")

            chord_list_str = "\n".join(timeline)
            key_hint = f"Detected key: {key}\n" if key else ""

            prompt = f"""You are an expert music theorist and chord analyst.
A neural network (BTC-SL) detected the following chord timeline from an audio file:

{key_hint}BPM: {bpm:.1f}
Style hint: {style}

Timeline:
{chord_list_str}

Your tasks:
1. ENHARMONIC CORRECTION: Choose the correct enharmonic spelling for each chord based on the likely key and voice-leading conventions (e.g., prefer F# major over Gb major in B minor context; prefer Eb over D# in Bb major context).
2. EXTENDED CHORDS: Where musically appropriate, upgrade simple triads to extended chords using context. For example:
   - If a major chord sits on the tonic and sounds stable for >2 bars, consider "maj7".
   - If a minor chord on the II or III degree lasts >1 bar in jazz style, consider "m7".
   - If a dominant chord leads to tonic, consider "7" or "9".
   - ONLY upgrade when you have high confidence from context; otherwise keep the original.
3. ROMAN NUMERAL ANALYSIS: Provide a parallel list of Roman numeral analyses (e.g., I, vi, V7/ii) matching each corrected chord.

Return ONLY a valid JSON object with no markdown formatting, no explanation text, and no code fences. Use this exact schema:
{{
  "corrected_chords": [
    {{"start": float, "end": float, "chord": string, "chord_original": string, "confidence": "high"|"medium"|"low"}}
  ],
  "roman_numerals": [
    {{"start": float, "end": float, "roman": string}}
  ],
  "key": string,
  "enhancements_applied": [string]
}}

Rules:
- Preserve all original start/end times exactly.
- If a chord should NOT be changed, set chord == chord_original and confidence = "high".
- Use standard chord symbols: C, Cm, C7, Cmaj7, Cm7, Cdim, Caug, Csus2, Csus4, Cadd9, C6, Cm6, C9, Cm9, C13, Cm7b5, C+, C/o, etc.
- Return empty roman_numerals array if key is unknown.
"""

            log_info("Sending chord timeline to Gemini for post-processing...")
            response = model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.2,
                    "max_output_tokens": 8192,
                    "response_mime_type": "application/json",
                },
            )

            raw_text = response.text.strip()
            # Strip markdown fences if present
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            raw_text = raw_text.strip()

            data = json.loads(raw_text)

            corrected = data.get("corrected_chords", [])
            roman_numerals = data.get("roman_numerals", None)
            inferred_key = data.get("key", key)
            enhancements = data.get("enhancements_applied", [])

            # Merge back any chords that were truncated due to the 120-chord cap
            if len(raw_chords) > len(corrected):
                log_debug(f"Gemini processed {len(corrected)}/{len(raw_chords)} chords; appending remainder unchanged.")
                for i in range(len(corrected), len(raw_chords)):
                    c = raw_chords[i]
                    corrected.append({
                        "start": c.get("start", 0),
                        "end": c.get("end", 0),
                        "chord": c.get("chord", "N"),
                        "chord_original": c.get("chord", "N"),
                        "confidence": "high",
                    })
                    if roman_numerals is not None:
                        roman_numerals.append({
                            "start": c.get("start", 0),
                            "end": c.get("end", 0),
                            "roman": "?",
                        })

            processing_time = time.time() - start_time
            log_info(
                f"Gemini post-processing complete: {len(corrected)} chords, "
                f"key={inferred_key}, enhancements={enhancements}, time={processing_time:.2f}s"
            )

            return {
                "success": True,
                "chords": corrected,
                "roman_numerals": roman_numerals,
                "key": inferred_key,
                "enhancements_applied": enhancements,
                "model_used": "gemini-1.5-flash",
                "processing_time": processing_time,
            }

        except Exception as e:
            log_error(f"Gemini chord post-processing failed: {e}")
            import traceback
            log_error(traceback.format_exc())
            return {
                "success": False,
                "error": f"Gemini post-processing failed: {str(e)}",
                "chords": raw_chords,
                "roman_numerals": None,
                "key": key,
                "enhancements_applied": [],
                "model_used": "gemini",
                "processing_time": time.time() - start_time,
            }

    def roman_numeral_analysis(
        self,
        chords: List[Dict[str, Any]],
        key: str,
        bpm: float = 120.0,
    ) -> Dict[str, Any]:
        """
        Standalone endpoint: get Roman numeral analysis for a chord progression.
        """
        result = self.post_process_chords(chords, bpm=bpm, key=key, style="auto")
        return {
            "success": result.get("success", False),
            "roman_numerals": result.get("roman_numerals"),
            "key": result.get("key"),
            "error": result.get("error"),
            "processing_time": result.get("processing_time", 0),
        }
