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
| **Tab Interface CSS** | 8-100 | Tabbed interface styling, animations, responsive design |
| **Classic CSS Styles** | 101-503 | UI component styling (sliders, buttons, matrices) |
| **HTML Structure** | 620-890 | Tabbed layout with Physics & Audio panels |
| **Main JavaScript** | 920-1410 | Canvas setup, particle system, physics, UI generation |
| **Tab System** | 1362-1388 | Tab switching functionality |
| **Module Imports** | 892-893 | External JS module loading |
| **Initialization** | 1390-1410 | Startup sequence including tab system |

### js/audio-system.js  
| Component | Purpose |
|-----------|---------|
| **Dual-Engine Architecture** | CollisionGrainEngine & LoopingGrainEngine classes |
| **Base GrainEngine Class** | Smoothed threshold system with soft boundaries |
| **Advanced Triggering** | Collision detection & continuous looping modes |
| **Species Audio Matrix** | Configurable inter-species collision triggers |
| **Threshold Visualization** | Interactive drag-based threshold control with smoothing ramp |
| **Smoothing System** | Soft threshold boundaries for natural audio transitions |
| **Real-time Audio Processing** | Particle-driven granular synthesis with compression-style controls |
| **UI Generation** | Mode-specific tabbed audio controls (Collision/Looping) |

### js/physics-core.js
| Component | Purpose |
|-----------|---------|
| **Enhanced Particle Class** | Physics simulation with collision event tracking for audio |
| **Collision Event System** | Real-time collision force recording and decay for audio triggering |
| **SpatialGrid Class** | O(N) collision optimization with force magnitude calculation |
| **Species Activity Tracking** | Real-time velocity and collision monitoring for audio visualization |
| **TrailParticle Class** | Visual-only trail particles for temporal rendering |
| **Trail Particle System** | Separate trail particles with individual species control |
| **Animation Loop** | Render cycle, FPS tracking, and audio activity level updates |
| **Render Pipeline** | Temporal priority rendering with pure colors |

## Critical IDs & Classes

### Essential IDs
- `canvas` - Main 2D rendering surface (centered)
- `physics-panel` - Physics & Simulation tab panel
- `audio-panel` - Audio Engine tab panel
- `speciesCount` - Controls number of particle species (Audio tab - moved from Physics)
- `forceMatrix` - Interactive force relationship grid (Physics tab)
- `particleSettings` - Dynamic species parameter controls (Audio tab)
- `speciesAudioControls` - Dynamic audio synthesis panels (Audio tab)
- `masterVolume` - Master audio volume control (Audio tab)
- `canvas-width` / `canvas-height` - Canvas dimension controls (Physics tab)
- `audioInit` - Audio system initialization button (Audio tab)
- `performanceMetrics` - Floating performance metrics display (top right)
- `keyboardShortcuts` - Persistent keyboard shortcuts display (bottom right)

### Key Classes
- `.tab-header` - Top navigation with tab buttons
- `.tab-button` - Individual tab navigation buttons
- `.tab-panel` - Sliding control panels (Physics/Audio)
- `.control-panel` - Panel content containers
- `.control-group` - Major section groupings  
- `.matrix-grid` - Force relationship visualization
- `.species-audio-panel` - Per-species audio controls
- `.slider` / `.slider-container` - Range input controls
- `.draggable-number` - Interactive numeric parameters
- `.species-audio-status` - Clickable mute/unmute indicators in species tabs
- `.performance-metrics` - Floating metrics panel styling
- `.keyboard-shortcuts` - Persistent shortcuts panel styling

## Development Workflows (Modular)

### Audio System Development
**Target File:** `js/audio-system.js`
```
Search: "CollisionGrainEngine" → Collision-based audio triggering
Search: "LoopingGrainEngine" → Continuous looping audio mode
Search: "GrainEngine" → Base audio engine class with smoothing
Search: "smoothing" → Soft threshold boundary system
Search: "calculateGain" → Audio gain calculation with smoothing curves
Search: "createSpeciesAudioControls" → Tabbed UI generation (Collision/Looping)
Search: "createSmoothingDial" → Threshold smoothing control
Search: "setupThresholdDragInteraction" → Interactive threshold visualization
Search: "updateSmoothingVisualization" → Real-time smoothing ramp display
```

### Physics & Simulation  
**Target File:** `js/physics-core.js`
```
Search: "Particle" → Enhanced particle class with collision events
Search: "collisionEvents" → Audio-integrated collision tracking system
Search: "collisionForce" → Force magnitude calculation for audio
Search: "SpatialGrid" → Collision optimization with audio integration
Search: "updateSpeciesActivityLevels" → Real-time activity monitoring for audio
Search: "update()" → Physics update logic with audio event recording
Search: "TrailParticle" → Trail particle class definition
Search: "updateTrailParticles" → Trail particle lifecycle management
Search: "render()" → Temporal priority rendering pipeline
```

### UI & Controls
**Target File:** `Granular-Particle-Sim-Modular.html`
```
Search: "initTabSystem" → Tab switching functionality
Search: "createParticleSettings" → Dynamic UI generation (Audio tab)
Search: "setupSliders" → Control event handlers  
Search: "createForceMatrix" → Matrix UI (Physics tab)
Search: "RELATIONSHIP_MATRIX" → Force relationships
Search: "setupDraggableNumbers" → Interactive numeric controls
Search: "updateCanvasSize" → Canvas resizing system
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

- **Tabbed interface**: Modern UI with Physics & Audio separation
- **Centered canvas**: Prominent simulation display with slide-out controls
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

## GUI Architecture (Updated 2024)

### Tabbed Interface System
- **Header navigation**: Fixed top bar with Physics & Audio tabs
- **Sliding panels**: 400px wide panels that slide in from left edge
- **Centered canvas**: Simulation always centered with proper z-layering
- **Responsive design**: Mobile/desktop adaptive layouts

### Tab Structure
| Tab | Content | Purpose |
|-----|---------|---------|
| **Physics & Simulation** | Force Matrix, Physics settings, Canvas controls | Particle behavior control |
| **Audio Engine** | Species count, Species audio config, Master controls, Granular synth | Sound generation control |

### Interface Updates (2024)
- **Species Count Control** → Moved from Physics tab to Audio Engine tab for workflow efficiency
- **Performance Metrics** → Relocated from Physics tab to floating top-right panel showing: FPS, Canvas, Particle Count, Audio grains, Audio Latency
- **Keyboard Shortcuts** → Changed from H-key popup to persistent bottom-right panel with hide/show functionality
- **Species Mute Controls** → Enhanced species tabs with clickable status lights (green=unmuted, red=muted), removed speaker emoji buttons
- **Streamlined Audio Controls** → Cleaner species audio panels without redundant mute buttons

## Advanced Audio Engine Architecture (2024 Update)

### Dual-Engine System
| Engine Type | Triggering Method | Best Use Cases |
|-------------|------------------|----------------|
| **CollisionGrainEngine** | Collision force detection | Percussive sounds, impact-based audio |
| **LoopingGrainEngine** | Velocity-based continuous | Ambient textures, flowing soundscapes |

### Threshold & Smoothing System
- **Hard Threshold** (smoothing = 0.0) → Traditional on/off behavior
- **Soft Threshold** (smoothing > 0.0) → Gradual fade boundaries
- **Visual Integration** → Interactive drag threshold with smoothing ramp visualization
- **Real-time Feedback** → Activity bars show particle behavior relative to threshold

### Smart Audio Processing
| Parameter | Purpose | Range |
|-----------|---------|-------|
| **Threshold** | Trigger point for audio activation | 0.0-1.0 |
| **Smoothing** | Soft boundary width around threshold | 0.0-1.0 |
| **Collision Matrix** | Species-specific collision triggers | Boolean grid |
| **Activity Tracking** | Real-time velocity/collision monitoring | Normalized 0-1 |

### Collision Event System
- **Force Tracking** → Real-time collision force recording with decay
- **Species Matrix** → Configurable inter-species audio triggers  
- **Event Filtering** → Threshold-based collision significance detection
- **Visual Feedback** → Collision pulse visualization for debugging

### Threshold Visualization Interface
- **Drag-based Control** → Interactive threshold positioning
- **Smoothing Ramp** → Visual representation of soft boundary extent
- **Activity Overlay** → Real-time particle behavior visualization
- **Responsive Design** → Container-fitted layout with proper spacing

### Current Audio Parameter Mappings
- **X Position** → Stereo panning (-1 to +1)
- **Y Position** → Filter frequency (logarithmic, 80Hz-8kHz default)
- **Velocity/Collision Force** → Grain amplitude (with threshold & smoothing)
- **Size** → Filter bandwidth (smaller particles = narrower Q)
- **Trail Length** → Grain duration (2ms-200ms linear mapping)
- **Species Interaction** → Collision matrix determines audio triggering relationships