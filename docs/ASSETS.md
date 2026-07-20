# Assets & Third-Party Packages

## Policy

Fully client-side, no runtime network fetches. No external audio, image or data assets
are shipped: everything visual is CSS/SVG authored for this project, and all audio
sample content is synthesized in code (see below). External *packages* are listed with
purpose and license.

## Externally acquired assets

| Asset | Source | License | Use / modifications |
| --- | --- | --- | --- |
| Oswald typeface | Fontsource npm package (`@fontsource/oswald`), upstream Google Fonts | SIL Open Font License 1.1 | Condensed headings/labels for the instrument-panel identity. Unmodified, self-hosted via the package's woff2 files |
| IBM Plex Mono typeface | Fontsource npm package (`@fontsource/ibm-plex-mono`), upstream IBM | SIL Open Font License 1.1 | Measurement readouts and code. Unmodified, self-hosted |
| KaTeX fonts & CSS | `katex` npm package | MIT | Math rendering in "Math Behind It" panels. Unmodified |

No other external assets are used. The logo mark, favicon, knobs, jacks, grid textures
and all UI chrome are original CSS/inline-SVG in this repository.

## Built-in audio samples (not external)

The Sample Player's clips are synthesized deterministically at runtime in
`src/engine/nodes/sources.ts` (seeded PRNG): a Karplus–Strong plucked string (220 Hz),
a swept-sine drum hit with noise attack, and a 200 Hz→2 kHz linear chirp. There are no
recorded/licensed audio files in the project.

## Runtime dependencies

| Package | Purpose | License |
| --- | --- | --- |
| react / react-dom 18 | UI | MIT |
| @xyflow/react 12 | Node canvas interaction (drag, handles, viewport, minimap) | MIT |
| zustand | State stores | MIT |
| zod | Schema validation for persisted/imported projects | MIT |
| katex | Math rendering | MIT |
| lz-string | Share-URL compression | MIT |
| html-to-image | Signal-chain diagram PNG capture | MIT |
| @fontsource/oswald, @fontsource/ibm-plex-mono | Self-hosted fonts | OFL-1.1 (fonts), MIT (packaging) |

## Development dependencies

Vite, TypeScript, Vitest, Playwright, ESLint (+typescript-eslint, react-hooks plugin),
Prettier, @types/* — standard MIT/Apache-licensed tooling; not shipped to users.

All DSP (FFT, filters, convolution, measurements, expression parser, WAV/CSV encoders)
is original code in this repository — deliberately dependency-free so it runs
identically in workers, tests and the main thread.
