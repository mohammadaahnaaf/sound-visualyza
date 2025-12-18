"use client";

import AudioVisualizer from "../components/AudioVisualizer";

export default function Page() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ahnafya Live Audio Spectrum Analyzer
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
         Don&apos;t ask What it is! Just turn on mic and Sing the song you want her to listen to...
        </p>

        <div className="mt-8">
          <AudioVisualizer />
        </div>
      </div>
    </main>
  );
}
