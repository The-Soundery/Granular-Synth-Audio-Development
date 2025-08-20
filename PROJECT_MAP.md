# Granular Particle Synth - Project Structure Map

## File Architecture (Modular)

### Main Files
| File | Purpose | Key Components |
|------|---------|----------------|
| **Granular-Particle-Sim-Modular.html** | Main application | WebGL setup, UI generation, control systems |
| **js/audio-system.js** | Audio engine | GranularSynth class, waveform UI, grain management |
| **js/physics-core.js** | Physics simulation | Particle class, spatial grid, trail system |
| **build-combined.js** | Build script | Combines modules into single HTML file |

### Legacy Files  
| File | Status | Notes |
|------|--------|--------|
| **Granular-Particle-Sim-Original.html** | Backup | Original monolithic version |
| **Granular Particle Sim Audio Build.html** | Deprecated | Broken during extraction |

## Component Reference by File

### Granular-Particle-Sim-Modular.html
| Component | Lines | Purpose |
|-----------|-------|---------|
| **CSS Styles** | 7-503 | Complete UI styling including audio controls |
| **HTML Structure** | 505-680 | DOM layout, control panels, audio panels |
| **Main JavaScript** | 687-1241 | Canvas setup, particle system, physics, UI generation |
| **Module Imports** | 683-684 | External JS module loading |
| **Initialization** | 1224-1241 | Startup sequence |

### js/audio-system.js  
| Component | Purpose |
|-----------|---------|
| **GranularSynth Class** | Core audio synthesis engine |
| **Audio Controls** | Volume, mute, frequency range management |
| **Waveform System** | Sample loading, selection, visualization |
| **Grain Management** | Loop modes, pitch, detune, crossfading |
| **UI Generation** | Dynamic per-species audio controls |

### js/physics-core.js
| Component | Purpose |
|-----------|---------|
| **SpatialGrid Class** | O(N) collision optimization |
| **Particle Class** | Physics simulation, movement |
| **TrailParticle Class** | Visual-only trail particles for temporal rendering |
| **Trail Particle System** | Separate trail particles with individual species control |
| **Animation Loop** | Render cycle, FPS tracking |
| **Render Pipeline** | Temporal priority rendering with pure colors |

## Critical IDs & Classes

### Essential IDs
- `canvas` (507) - Main 2D rendering surface
- `speciesCount` (549) - Controls number of particle species  
- `forceMatrix` (562) - Interactive force relationship grid
- `particleSettings` (553) - Dynamic species parameter controls
- `speciesAudioControls` (676) - Dynamic audio synthesis panels
- `masterVolume` (636) - Master audio volume control
- `canvas-width` (520) - Canvas width control
- `canvas-height` (527) - Canvas height control
- `audioInit` (672) - Audio system initialization button

### Key Classes
- `.control-panel` - Right sidebar container
- `.control-group` - Major section groupings  
- `.matrix-grid` - Force relationship visualization
- `.species-audio-panel` - Per-species audio controls
- `.slider` / `.slider-container` - Range input controls
- `.draggable-number` - Interactive numeric parameters

## Development Workflows (Modular)

### Audio System Development
**Target File:** `js/audio-system.js`
```
Search: "GranularSynth" → Class definition
Search: "audioBuffer" → Sample handling  
Search: "grain" → Granular synthesis logic
Search: "createSpeciesAudioControls" → UI generation
```

### Physics & Simulation  
**Target File:** `js/physics-core.js`
```
Search: "Particle" → Particle class definition
Search: "SpatialGrid" → Collision optimization
Search: "update()" → Physics update logic
Search: "TrailParticle" → Trail particle class definition
Search: "updateTrailParticles" → Trail particle lifecycle management
Search: "render()" → Temporal priority rendering pipeline
```

### UI & Controls
**Target File:** `Granular-Particle-Sim-Modular.html`
```
Search: "createParticleSettings" → Dynamic UI generation (line 769)
Search: "setupSliders" → Control event handlers (line 849)
Search: "createForceMatrix" → Matrix UI (line 1017)
Search: "RELATIONSHIP_MATRIX" → Force relationships (line 751)
Search: "setupDraggableNumbers" → Interactive numeric controls (line 940)
Search: "updateCanvasSize" → Canvas resizing system (line 1154)
```

### Canvas & Rendering
**Target File:** `Granular-Particle-Sim-Modular.html` + `js/physics-core.js`
```
Search: "initCanvas" → Canvas initialization (line 702)
Search: "render()" → Main render loop (physics-core.js)
Search: "animate()" → Animation loop (line 1240)
Search: "ctx" → 2D canvas context usage
```

## Development Workflow Shortcuts

### Single-File Development (Recommended)
- **Audio changes** → Edit `js/audio-system.js` directly
- **Physics changes** → Edit `js/physics-core.js` directly  
- **UI changes** → Edit `Granular-Particle-Sim-Modular.html`
- **Test locally** → Open `Granular-Particle-Sim-Modular.html` in browser

### Combined Deployment
- **Build single file** → Run `node build-combined.js`
- **Deploy** → Use generated `Granular-Particle-Sim-Combined.html`

### Performance Optimization Areas
- **Spatial grid** → `SpatialGrid` class in `js/physics-core.js`
- **Temporal rendering** → `render()` function in `js/physics-core.js`  
- **Audio processing** → `GranularSynth.update()` in `js/audio-system.js`
- **Trail system** → `updateTrailParticles()` and `TrailParticle` class in `js/physics-core.js`

### Common Development Tasks
- **Add new species** → Modify UI generation in main HTML + adjust arrays
- **Audio effects** → Extend `GranularSynth` class methods
- **Visual effects** → Modify trail system in `js/physics-core.js`
- **Force relationships** → Update matrix UI and `RELATIONSHIP_MATRIX`

## File Organization

```
Project Root/
├── Granular-Particle-Sim-Modular.html     (main application)
├── js/
│   ├── audio-system.js                     (audio engine)
│   └── physics-core.js                     (physics simulation)
├── build-combined.js                       (build script)
├── PROJECT_MAP.md                          (this file)
├── DEVELOPMENT_NOTES.md                    (session tracker)
├── Granular-Particle-Sim-Original.html    (backup)
└── Granular-Particle-Sim-Combined.html    (generated)
```

## Multi-File Benefits
- **Reduced conversation limits** - Edit specific modules without loading entire codebase
- **Cleaner development** - Focus on single responsibility per file
- **Better version control** - Targeted diffs and change tracking  
- **Maintained deployment** - Build script preserves single-file option

## Code Architecture Notes

- **Canvas 2D approach**: Single canvas with temporal priority rendering
- **Component separation**: Clear boundaries between physics/audio/UI/trails
- **Dynamic UI generation**: Species count drives control creation
- **Interactive controls**: Draggable numbers for real-time parameter adjustment
- **Spatial optimization**: Grid-based collision detection for O(N) performance
- **Real-time audio**: Particle state directly drives granular synthesis parameters
- **Responsive design**: Canvas resizing with proportional particle scaling
- **Modular architecture**: External JS files for audio and physics systems
- **Separated trail system**: Trail particles isolated from main particles for audio safety

## Trail System Architecture (Updated 2024)

### Trail Particle System with Temporal Priority
- **Separated particle types**: Species particles (physics/audio) + Trail particles (visual only)
- **Temporal priority**: Newer particles paint over older ones (no color washing)
- **Individual trail control**: Species trail lengths work independently (0.0-0.99 range)
- **Age-based fading**: Trail particles fade based on age and species-specific settings
- **Pure colors maintained**: No additive blending - clean, distinct species colors
- **Audio isolation**: Trail particles completely separate from audio engine

### Trail System Functions
| Function | Location | Purpose |
|----------|----------|---------|
| `initTrailSystem()` | js/physics-core.js:376 | Initializes trail particle system |
| `TrailParticle` class | js/physics-core.js:286 | Visual-only trail particle with species-specific aging |
| `updateTrailParticles()` | js/physics-core.js:494 | Updates and removes expired trail particles |
| `removeTrailParticlesForSpecies()` | js/physics-core.js:492 | Instant removal of all trails for specific species |
| `render()` | js/physics-core.js:507 | Temporal priority rendering with adaptive canvas fade |
| `resetSimulation()` | js/physics-core.js:613 | Clears all trail particles and resets simulation |

### Trail Control Behavior
- **Trail Length 0.00** → No trails (no spawning, immediate removal of existing)
- **Trail Length 0.01** → Very aggressive fade (minimal trails)
- **Trail Length 0.50** → Medium-short trails (compressed scale)
- **Trail Length 0.99** → Longest available trails (equivalent to old 0.5 setting)
- **Individual species control** → Each species fades independently
- **Temporal layering** → Species particles always render over trail particles
- **Adaptive canvas fade** → Global fade only applied when any species has trails enabled

### Performance Optimizations
- **Conditional spawning**: Trail particles only created when trail length > 0.01
- **Garbage collection**: Expired trail particles automatically removed
- **Adaptive rendering**: Canvas fade skipped when all trails disabled
- **Audio safety**: Trail particles never affect audio engine or physics calculations