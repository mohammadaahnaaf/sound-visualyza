"use client";

import { useState } from "react";
import AudioVisualizer from "../components/AudioVisualizer";

export default function Page() {
  const [fullScreen, setFullScreen] = useState(false);
  return (
    <main
      className={
        fullScreen
          ? "fixed inset-0 overflow-hidden bg-zinc-950 text-zinc-100"
          : "min-h-screen bg-zinc-950 text-zinc-100"
      }
    >
      {!fullScreen && (
        <div className="mx-auto max-w-7xl px-4 py-10">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ahnafya Live Audio Spectrum Analyzer
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Don&apos;t ask What it is! Just turn on mic and Sing the song you
            want her to listen to...
          </p>
        </div>
      )}

      <div className={fullScreen ? "h-full w-full" : "mx-auto max-w-7xl px-4"}>
        <AudioVisualizer
          fullScreen={fullScreen}
          setFullScreen={setFullScreen}
        />
      </div>
    </main>
  );
}
