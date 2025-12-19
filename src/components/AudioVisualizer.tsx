/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

function levelToColor(level: number): string {
  // Convert level (0-1) to color from blue (240°) to red (0°/360°)
  // Using HSL for smooth color transitions
  const hue = 240 * (1 - level); // Blue (240) to Red (0)
  const saturation = 80 + level * 20; // 80% to 100% saturation
  const lightness = 50 + level * 10; // 50% to 60% lightness
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export default function AudioVisualizer({
  fullScreen,
  setFullScreen,
}: {
  fullScreen: boolean;
  setFullScreen: (fullScreen: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fadeOutStartRef = useRef<number | null>(null);
  const fadeOutDurationRef = useRef<number>(1000); // 1 second fade-out

  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  const [fftSize, setFftSize] = useState(4096); // spectrum resolution
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
    setIsFadingOut(false);
    fadeOutStartRef.current = null;

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
          "Failed to start tab/screen capture. Try Chrome/Edge and ensure 'Share audio' is enabled."
      );
      cleanup();
    }
  }

  function stop() {
    setError("");
    if (isRunning && !isFadingOut) {
      // Disconnect audio sources but keep animation running for fade-out
      try {
        analyserRef.current?.disconnect();
        sourceRef.current?.disconnect();
      } catch {}

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      sourceRef.current = null;
      analyserRef.current = null;
      setIsRunning(false);

      // Start fade-out
      setIsFadingOut(true);
      fadeOutStartRef.current = performance.now();
    } else {
      // If already fading or not running, cleanup immediately
      cleanup();
    }
  }

  function loopDraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Allow drawing during fade-out even if analyser is disconnected
    const analyser = analyserRef.current;

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

    // Use stored FFT size or default if analyser is gone (during fade-out)
    const currentFftSize = analyser?.fftSize || fftSize;
    const freqBins = analyser?.frequencyBinCount || currentFftSize / 2;
    const freqData = new Uint8Array(freqBins);
    const timeData = new Float32Array(currentFftSize);

    const draw = () => {
      // Calculate fade-out multiplier
      let fadeMultiplier = 1.0;
      if (isFadingOut && fadeOutStartRef.current !== null) {
        const elapsed = performance.now() - fadeOutStartRef.current;
        const progress = Math.min(elapsed / fadeOutDurationRef.current, 1.0);
        fadeMultiplier = 1.0 - progress; // Fade from 1.0 to 0.0

        // When fade-out is complete, cleanup
        if (progress >= 1.0) {
          cleanup();
          return;
        }
      }

      if (!analyserRef.current) {
        // If analyser is gone but we're still drawing (during fade-out), use zero data
        freqData.fill(0);
        timeData.fill(0);
      } else {
        analyserRef.current.getByteFrequencyData(freqData);
        analyserRef.current.getFloatTimeDomainData(timeData);
      }

      // Background
      ctx2d.clearRect(0, 0, w, h);

      // Layout
      const padding = 16 * dpr;
      const vuWidth = 26 * dpr;
      const gap = 14 * dpr;

      const spectrumX = padding + vuWidth + gap;
      const spectrumW = w - spectrumX - padding;
      const spectrumH = h - padding * 2;

      // VU meter on the left
      const rms = clamp(
        rmsTimeDomain(timeData) * gainBoost * fadeMultiplier,
        0,
        1.25
      );
      const vuLevel = clamp(rms / 1.0, 0, 1);

      // VU background
      ctx2d.fillStyle = "rgba(255,255,255,0.06)";
      ctx2d.fillRect(padding, padding, vuWidth, spectrumH);

      // VU fill
      const vuFillH = spectrumH * vuLevel;
      const vuFillY = padding + (spectrumH - vuFillH);

      // Color gradient based on VU level (blue to red)
      ctx2d.fillStyle = levelToColor(vuLevel);
      ctx2d.fillRect(padding, vuFillY, vuWidth, vuFillH);

      // Peak line - use red for high levels
      const peakY = clamp(vuFillY, padding, padding + spectrumH);
      ctx2d.fillStyle = levelToColor(Math.min(vuLevel + 0.2, 1));
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
        const level = clamp(v * gainBoost * fadeMultiplier, 0, 1);

        const barH = spectrumH * level;
        const x = spectrumX + i * barW;
        const y = padding + (spectrumH - barH);

        // Color gradient based on bar level (blue to red)
        ctx2d.fillStyle = levelToColor(level);
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

  // Restart draw loop when switching to/from fullscreen if already running
  useEffect(() => {
    if (isRunning || isFadingOut) {
      // Cancel existing animation frame
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      // Small delay to ensure canvas is mounted and sized in new mode
      const timeout = setTimeout(() => {
        if (canvasRef.current && (isRunning || isFadingOut)) {
          loopDraw();
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullScreen]); // Only run when fullScreen changes, loopDraw is recreated each render

  // Handle window resize to ensure canvas resizes properly
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && (isRunning || isFadingOut)) {
        // Force canvas resize by clearing and restarting if needed
        const canvas = canvasRef.current;
        const ctx2d = canvas.getContext("2d");
        if (ctx2d) {
          const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
          const rect = canvas.getBoundingClientRect();
          const w = Math.floor(rect.width * dpr);
          const h = Math.floor(rect.height * dpr);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isRunning, isFadingOut]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, []);

  return !fullScreen ? (
    <div className="bg-zinc-900/40 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={startMic}
            className="rounded-xl inline-flex items-center gap-2 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-mic-icon lucide-mic"
            >
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
            <span>Start Mic</span>
          </button>
          <button
            onClick={startTabCapture}
            className="rounded-xl inline-flex items-center gap-2 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-app-window-icon lucide-app-window"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M10 4v4" />
              <path d="M2 8h20" />
              <path d="M6 4v4" />
            </svg>
            <span>Capture Tab/Screen</span>
          </button>
          <button
            onClick={stop}
            className="rounded-xl inline-flex items-center gap-2 text-rose-500 border border-white/10 bg-transparent px-4 py-2 text-sm font-medium hover:bg-white/5 active:bg-white/10"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-square-icon lucide-square"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
            </svg>
            <span>Stop</span>
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
          <button
            onClick={() => setFullScreen(!fullScreen)}
            className="rounded-xl inline-flex items-center gap-2 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-expand-icon lucide-expand"
            >
              <path d="m15 15 6 6" />
              <path d="m15 9 6-6" />
              <path d="M21 16v5h-5" />
              <path d="M21 8V3h-5" />
              <path d="M3 16v5h5" />
              <path d="m3 21 6-6" />
              <path d="M3 8V3h5" />
              <path d="M9 9 3 3" />
            </svg>
          </button>
        </div>

        <canvas
          ref={canvasRef}
          className="h-[calc(100vh-300px)] w-full rounded-xl bg-zinc-950/40"
        />
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 bg-zinc-950 z-50">
      <canvas ref={canvasRef} className="h-full w-full" />
      <button
        onClick={() => setFullScreen(!fullScreen)}
        className="absolute top-4 right-4 rounded-xl inline-flex items-center gap-2 bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15 active:bg-white/20 backdrop-blur-sm"
        title="Exit Fullscreen"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lucide lucide-minimize-2"
        >
          <polyline points="4 14 10 4 4 4 4 10" />
          <polyline points="20 10 14 20 20 20 20 14" />
          <line x1="14" y1="4" x2="20" y2="10" />
          <line x1="4" y1="14" x2="10" y2="20" />
        </svg>
      </button>
    </div>
  );
}
