/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Mode = "idle" | "mic" | "tab";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function rmsTimeDomain(buf: Float32Array) {
  // Root mean square amplitude (0..1-ish)
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export default function AudioVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);

  const [fftSize, setFftSize] = useState(2048); // spectrum resolution
  const [smoothing, setSmoothing] = useState(0.8);
  const [gainBoost, setGainBoost] = useState(1.0); // purely visual boost
  const [barCount, setBarCount] = useState(64);

  const ui = useMemo(() => {
    const fftOptions = [512, 1024, 2048, 4096, 8192];
    return { fftOptions };
  }, []);

  async function ensureAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    // Some browsers start suspended until a user gesture
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function cleanup() {
    setIsRunning(false);

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    try {
      analyserRef.current?.disconnect();
      sourceRef.current?.disconnect();
    } catch {}

    analyserRef.current = null;
    sourceRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Keep AudioContext around (faster restart), but you can close if you want:
    // audioCtxRef.current?.close(); audioCtxRef.current = null;

    setMode("idle");
  }

  async function startMic() {
    setError("");
    cleanup();

    try {
      const ctx = await ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothing;
      analyserRef.current = analyser;

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;
      src.connect(analyser);

      setMode("mic");
      setIsRunning(true);
      loopDraw();
    } catch (e: any) {
      setError(e?.message ?? "Failed to start microphone.");
      cleanup();
    }
  }

  async function startTabCapture() {
    setError("");
    cleanup();

    try {
      const ctx = await ensureAudioContext();

      // getDisplayMedia with audio works best in Chromium.
      // User must select a tab/window and enable “Share audio”.
   
      const stream: MediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // required by many browsers to allow display capture
        audio: true,
      });

      // We only need audio tracks; keep video track to satisfy capture,
      // but we won’t render it.
      streamRef.current = stream;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothing;
      analyserRef.current = analyser;

      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;
      src.connect(analyser);

      setMode("tab");
      setIsRunning(true);
      loopDraw();
    } catch (e: any) {
      setError(
        e?.message ??
          "Failed to start tab/screen capture. Try Chrome/Edge and ensure “Share audio” is enabled."
      );
      cleanup();
    }
  }

  function stop() {
    setError("");
    cleanup();
  }

  function loopDraw() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const freqBins = analyser.frequencyBinCount;
    const freqData = new Uint8Array(freqBins);
    const timeData = new Float32Array(analyser.fftSize);

    const draw = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(freqData);
      analyserRef.current.getFloatTimeDomainData(timeData);

      // Background
      ctx2d.clearRect(0, 0, w, h);

      // Layout
      const padding = 16 * dpr;
      const vuWidth = 26 * dpr;
      const gap = 14 * dpr;

      const spectrumX = padding + vuWidth + gap;
      const spectrumY = padding;
      const spectrumW = w - spectrumX - padding;
      const spectrumH = h - padding * 2;

      // VU meter on the left
      const rms = clamp(rmsTimeDomain(timeData) * gainBoost, 0, 1.25);
      const vuLevel = clamp(rms / 1.0, 0, 1);

      // VU background
      ctx2d.fillStyle = "rgba(255,255,255,0.06)";
      ctx2d.fillRect(padding, padding, vuWidth, spectrumH);

      // VU fill
      const vuFillH = spectrumH * vuLevel;
      const vuFillY = padding + (spectrumH - vuFillH);

      // Color-ish without hardcoding fancy palettes: just grayscale + a “peak” line
      ctx2d.fillStyle = "rgba(255,255,255,0.75)";
      ctx2d.fillRect(padding, vuFillY, vuWidth, vuFillH);

      // Peak line
      const peakY = clamp(vuFillY, padding, padding + spectrumH);
      ctx2d.fillStyle = "rgba(255,255,255,0.95)";
      ctx2d.fillRect(padding, peakY, vuWidth, 2 * dpr);

      // Spectrum bars
      const bars = clamp(barCount, 8, 256);
      const barW = spectrumW / bars;

      // Average bins into bars (log-ish feel by sampling higher indices more)
      for (let i = 0; i < bars; i++) {
        // Use a curve to map bar index to freq bin index (more detail in lows)
        const t = i / (bars - 1);
        const curved = t * t; // quadratic
        const bin = Math.floor(curved * (freqBins - 1));

        // Also average a small neighborhood
        const win = Math.max(1, Math.floor(freqBins / (bars * 3)));
        let sum = 0;
        let count = 0;
        for (let j = -win; j <= win; j++) {
          const k = clamp(bin + j, 0, freqBins - 1);
          sum += freqData[k];
          count++;
        }
        const v = sum / count / 255; // 0..1
        const level = clamp(v * gainBoost, 0, 1);

        const barH = spectrumH * level;
        const x = spectrumX + i * barW;
        const y = padding + (spectrumH - barH);

        ctx2d.fillStyle = "rgba(255,255,255,0.65)";
        ctx2d.fillRect(x + 1 * dpr, y, Math.max(1, barW - 2 * dpr), barH);
      }

      // Border
      ctx2d.strokeStyle = "rgba(255,255,255,0.10)";
      ctx2d.lineWidth = 1 * dpr;
      ctx2d.strokeRect(
        padding - 0.5 * dpr,
        padding - 0.5 * dpr,
        w - padding * 2 + dpr,
        h - padding * 2 + dpr
      );

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }

  // Keep analyser parameters in sync
  useEffect(() => {
    if (analyserRef.current) analyserRef.current.fftSize = fftSize;
  }, [fftSize]);

  useEffect(() => {
    if (analyserRef.current)
      analyserRef.current.smoothingTimeConstant = smoothing;
  }, [smoothing]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={startMic}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20"
          >
            Start Mic
          </button>
          <button
            onClick={startTabCapture}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20"
          >
            Capture Tab/Screen Audio
          </button>
          <button
            onClick={stop}
            className="rounded-xl border border-white/10 bg-transparent px-4 py-2 text-sm font-medium hover:bg-white/5 active:bg-white/10"
          >
            Stop
          </button>

          <span className="ml-1 text-xs text-zinc-400">
            Status:{" "}
            <span className="text-zinc-200">
              {isRunning
                ? mode === "mic"
                  ? "Listening (Mic)"
                  : "Listening (Capture)"
                : "Idle"}
            </span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <div className="text-[11px] text-zinc-400">FFT</div>
            <select
              value={fftSize}
              onChange={(e) => setFftSize(Number(e.target.value))}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            >
              {ui.fftOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-400">Smoothing</div>
            <input
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={smoothing}
              onChange={(e) => setSmoothing(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-[11px] text-zinc-500">
              {smoothing.toFixed(2)}
            </div>
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-400">Bars</div>
            <input
              type="range"
              min={16}
              max={160}
              step={8}
              value={barCount}
              onChange={(e) => setBarCount(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-[11px] text-zinc-500">{barCount}</div>
          </label>

          <label className="space-y-1">
            <div className="text-[11px] text-zinc-400">Visual Boost</div>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={gainBoost}
              onChange={(e) => setGainBoost(Number(e.target.value))}
              className="w-full"
            />
            <div className="text-[11px] text-zinc-500">
              {gainBoost.toFixed(1)}x
            </div>
          </label>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-zinc-400">VU + Spectrum</span>
          <span className="text-xs text-zinc-500">Canvas / Web Audio API</span>
        </div>

        <canvas
          ref={canvasRef}
          className="h-[320px] w-full rounded-xl border border-zinc-800 bg-zinc-950/40"
        />
      </div>
    </div>
  );
}
