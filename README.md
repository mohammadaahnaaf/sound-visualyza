# Ahnafya Live Audio Spectrum Analyzer

A real-time audio visualization tool built with Next.js that displays live audio spectrum analysis and VU meter readings. Perfect for monitoring audio input from your microphone or system audio capture.

## Features

### 🎤 Audio Input Sources
- **Microphone Input**: Capture and visualize audio directly from your microphone
- **Tab/Screen Audio Capture**: Capture audio from browser tabs or system audio (Chrome/Edge recommended)

### 📊 Visualization Components
- **VU Meter**: Real-time volume unit meter displayed as a vertical bar on the left side
- **Frequency Spectrum**: Horizontal bar graph showing frequency distribution across the audio spectrum
- **Real-time Updates**: Smooth, continuous visualization using Web Audio API and Canvas

### ⚙️ Customizable Settings
- **FFT Size**: Adjustable frequency resolution (512, 1024, 2048, 4096, 8192)
- **Smoothing**: Control the smoothing time constant (0-0.95) for smoother or more responsive visualization
- **Bar Count**: Adjust the number of spectrum bars displayed (16-160)
- **Visual Boost**: Amplify visual representation without affecting audio (0.5x-3x)

### 🎨 Design
- Modern dark theme UI with zinc color palette
- Responsive design that works on desktop and mobile
- High-DPI canvas rendering for crisp visuals

## Getting Started

### Prerequisites
- Node.js 18+ and npm/yarn/pnpm/bun

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd vumeter-sound
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Building for Production

```bash
npm run build
npm start
```

## Usage

1. **Start Microphone**: Click "Start Mic" to begin capturing audio from your microphone. Grant microphone permissions when prompted.

2. **Capture Tab/Screen Audio**: Click "Capture Tab/Screen Audio" to capture audio from browser tabs or system audio. Select a tab/window and ensure "Share audio" is enabled.

3. **Adjust Settings**: Use the control panel to fine-tune:
   - **FFT**: Higher values provide more frequency resolution but require more processing
   - **Smoothing**: Higher values create smoother animations but slower response
   - **Bars**: More bars show finer frequency detail
   - **Visual Boost**: Increase to make quiet audio more visible

4. **Stop**: Click "Stop" to end audio capture and visualization

## Technical Details

### Technologies Used
- **Next.js 16**: React framework with App Router
- **React 19**: UI library
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **Web Audio API**: Audio processing and analysis
- **Canvas API**: Real-time rendering

### Audio Processing
- Uses `AnalyserNode` for frequency and time-domain analysis
- Implements RMS (Root Mean Square) calculation for VU meter
- Logarithmic frequency mapping for better low-frequency visualization
- Configurable FFT size for balancing resolution and performance

### Browser Compatibility
- **Microphone**: Works in all modern browsers
- **Tab/Screen Capture**: Best supported in Chromium-based browsers (Chrome, Edge)
- Requires user interaction to start audio capture (browser security requirement)

## Project Structure

```
vumeter-sound/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # Root layout with metadata
│   │   ├── page.tsx         # Main page component
│   │   └── globals.css      # Global styles
│   └── components/
│       └── AudioVisualizer.tsx  # Main audio visualization component
├── public/                  # Static assets
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Linting
```bash
npm run lint
```

### Key Components

- **AudioVisualizer**: Main component handling audio capture, analysis, and canvas rendering
- **AudioContext Management**: Handles Web Audio API context creation and suspension
- **Canvas Rendering**: High-DPI aware canvas rendering with requestAnimationFrame

## Notes

- Audio processing happens entirely in the browser - no server-side processing required
- Microphone settings disable echo cancellation, noise suppression, and auto gain control for raw audio capture
- The app maintains the AudioContext between sessions for faster restarts

## License

This project is private.
