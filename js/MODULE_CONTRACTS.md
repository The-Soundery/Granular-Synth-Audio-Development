# Module Interface Contracts

## Overview
This document defines the public APIs and communication patterns for each module in the Granular Particle Synthesizer. These contracts enforce clear separation of concerns and prevent circular dependencies.

---

## 1. Config Module (`js/config.js`)

**Purpose:** Central configuration and state storage (read-only from other modules)

**Exports:**
- `CONFIG` - Immutable configuration object
- `state` - Global mutable state (particles, UI state, etc.)
- `audioEngine` - Audio engine state reference

**Contract Rules:**
- ✅ All modules MAY read from CONFIG/state
- ❌ Only initialization modules should WRITE to CONFIG
- ❌ State mutations should be minimized and documented

---

## 2. Physics Module (`js/physics/`)

**Purpose:** Particle simulation, collision detection, spatial optimization

**Public API (PhysicsEngine):**
```javascript
{
  init(): Promise<boolean>
  togglePause(): void
  resetSimulation(): void
  updateCanvasSize(width, height): void
  updateParticleSizes(): void
  removeTrailParticlesForSpecies(index): void
  adjustParticleCounts(): void
  getState(): Object
}
```

**Contract Rules:**
- ✅ Physics operates on `state.particles` array
- ✅ Physics emits events for UI/audio consumption
- ❌ Physics MUST NOT access DOM directly
- ❌ Physics MUST NOT call audio functions directly

**Event Emissions:**
- `PARTICLES_UPDATED` - Fired each frame with particle data
- `CANVAS_RENDER` - Fired each frame with rendering data
- `PERFORMANCE_UPDATED` - Fired periodically with metrics
- `CANVAS_RESIZED` - Fired when canvas dimensions change

---

## 3. Audio Module (`js/audio/`)

**Purpose:** Audio synthesis, sample management, parameter validation

**Public API (AudioSystem):**
```javascript
{
  init(): Promise<boolean>
  shutdown(): Promise<boolean>
  updateParameters(config): void  // config can include: curves, ranges, audio, voices, mute, all
  validateParameter(type, value): number
  updateUI(options): void
  loadSample(speciesIndex, file): Promise<boolean>
  isActive(): boolean
  getState(): Object
}
```

**Audio Engine Control Functions (audio-engine.js):**
```javascript
{
  enableAudioControls(): void   // Enable all audio UI controls when engine starts
  disableAudioControls(): void  // Disable all audio UI controls when engine stops/not initialized
}
```

**Control Enable/Disable System:**
- All audio controls are disabled on page load via `disableAudioControls()` called from main.js
- Controls become enabled when user clicks "Start Audio Engine" via `enableAudioControls()`
- Controls are re-disabled when user clicks "Stop Audio Engine" via `disableAudioControls()`
- Disabled controls have 40% opacity and `pointer-events: none` for clear visual feedback
- Affected controls: sliders, toggles, draggable numbers, file inputs, species tabs, mute buttons, waveforms
- Location: [audio-engine.js:13-121](audio-engine.js#L13-L121)

**Audio Buffer Persistence System:**
- When audio engine stops, `CONFIG.species.audioBuffers[]` retains loaded samples on main thread
- When audio engine restarts, a new AudioWorklet instance is created with empty buffer array
- `resendAudioBuffers()` function automatically re-sends all loaded buffers to new worklet instance
- Called from `AudioSystem.init()` during `Events.AUDIO_INITIALIZED` handler, before parameter sync
- Ensures audio playback resumes immediately after engine restart without reloading files
- Waveform displays remain active and audio continues to play seamlessly
- Implementation: [parameter-manager.js:106-155](parameter-manager.js#L106-L155)
- Integration: [audio-system.js:44-48](audio-system.js#L44-L48)

**Mute System:**
- Per-species mute state stored in `CONFIG.species.mutedSpecies` array
- Mute toggle UI in audio-controls.js sends updates via `updateParameters({ mute: true })`
- parameter-manager.js forwards mute state to AudioWorklet
- worklet-processor.js checks `mutedSpecies[species]` before spawning grains
- Muted species produce no audio but particles still show visual feedback

**Contract Rules:**
- ✅ Audio receives particle data via event listeners
- ✅ Audio MAY update its own UI elements (waveforms, volume meters)
- ❌ Audio MUST NOT query physics state directly
- ❌ Audio MUST NOT manage species colors or cross-module UI updates

**Dependencies:**
- Listens to `PARTICLES_UPDATED` event from Physics
- Updates audio-specific UI elements
- Validates audio parameters

### Voice Allocation System with Audio Crossfading

The AudioWorklet processor implements **voice limiting with smooth audio crossfading** where `maxVoices` controls both audio output and particle brightness with seamless transitions:

**1. Voice Allocation (Audio + Visual):**
- Location: [worklet-processor.js:487-627](audio/worklet-processor.js#L487-L627)
- Determines which particles can produce sound AND which appear bright
- **When under voice limit**: All particles get allocated (can make sound if moving)
- **When over voice limit**: Fastest particles (by velocity) get priority
- **Smart delay system**:
  - **User slider changes**: Apply immediately (no delay, responsive UX)
  - **Natural particle reordering**: Delayed by `voiceStealingDelay` (default 50ms) to prevent flicker
- **60fps throttling**: Updates run at 16ms intervals (synced with rendering)
- Result: `voiceAllocations` Map contains particle IDs with audio permission

**2. Unified Audio Crossfade System:**
- Location: [worklet-processor.js:568-600](audio/worklet-processor.js#L568-L600) (setup), [worklet-processor.js:889-927](audio/worklet-processor.js#L889-L927) (gain calculation)
- **Newly allocated particles**: Enter fadeIn state, grains spawn at increasing volume (0% → 100%)
- **De-allocated particles**: Enter fadeOut state, continue spawning grains at decreasing volume (100% → 0%)
- **Equal-power crossfade**: Uses √(progress) and √(1-progress) curves to maintain constant acoustic energy
- **Configurable duration**: `voiceStealingCrossfade` parameter (10-500ms, default 50ms)
- **Automatic cleanup**: When fadeOut completes (progress=1.0), crossfade entry deleted
- **Timer cleanup**: Next frame with no voice + no crossfade → grain timer deleted (prevents leak)
- **Result**: Smooth, click-free voice transitions with proper resource cleanup

**3. Grain Spawning (Motion + Allocation + Crossfade):**
- Location: [worklet-processor.js:310-335](audio/worklet-processor.js#L310-L335)
- Particles spawn grains if: hasVoiceAllocation **OR** isFadingOut
- First checks if particle is moving (velocity threshold with hysteresis)
- Then checks: `if (!hasVoiceAllocation AND !isFadingOut)` → cleanup and skip
- **Burst prevention**: Time clamping (max 500ms drift) + 4 grain/update limit
- Each grain's volume is multiplied by crossfade gain in `processGrain()`

**4. Visual Feedback Flow:**
- AudioWorklet calculates voice allocations and crossfade states
- Sends allocations + crossfades to main thread via `port.postMessage({ type: 'voiceState' })`
- Main thread stores in `audioEngine.voiceAllocations` and `audioEngine.particleAudioCrossfade` Maps
- Renderer derives brightness from allocations + crossfade progress (smooth transitions between 0.3 and 1.0)
- **Design simplification:** Single source of truth - visual feedback reads directly from audio state, no duplicate tracking

**Design Impact:**
- **Functional Control**: Reducing maxVoices directly reduces audio complexity/volume
- **Smooth Transitions**: Audio crossfading eliminates clicks and volume spikes during voice changes
- **Visual Feedback**: Particles smoothly fade between bright (allocated) and dim (no voice)
- **Motion-Driven**: Allocated particles only make sound when moving (velocity threshold)

**Recent Enhancements:**
1. **Unified Crossfade System** - Equal-power fadeIn/fadeOut with automatic cleanup (no timer leaks)
2. **Grain Timer Lifecycle** - fadeOut particles continue spawning, timer deleted when fadeOut completes
3. **Burst Protection** - Time clamping + grain limit prevents audio spikes from tab backgrounding
4. **Voice Stealing Delay** - Configurable delay before voice reallocation (reduces flicker)
5. **Smart Delay System** - Immediate response to user slider changes, delayed for natural particle reordering

**Supporting Systems:**
1. **Voice Stealing Delay**: Configurable delay before voice reallocation (1-500ms, default 50ms)
2. **Voice Stealing Crossfade**: Audio crossfade duration (10-500ms, default 50ms)
3. **Parameter Sync**: Particle count changes automatically update voice limits
4. **Element IDs**: Standardized to `voices-${i}` across all modules

**Audio UI Refactoring:**
- Removed duplicate `createAudioSampleControls()` implementation from sample-manager.js
- All audio UI rendering now handled by audio-controls.js (single source of truth)
- Implemented tabbed interface for audio species controls
- Added per-species mute functionality with visual toggle indicators
- sample-manager.js now imports and delegates to audio-controls.js for UI updates

**Species Color Management:**
- Species color updates fully owned by UI module (force-matrix.js)
- Removed color update logic from Audio module (sample-manager.js)
- force-matrix.js directly calls UI update functions for all color-dependent elements
- Audio module no longer involved in color management
- Color updates work independently of audio engine state (no panel visibility checks)
- Implementation:
  - [force-matrix.js:updateSpeciesColor()](ui/force-matrix.js#L166-L200) - Central color update orchestration
  - [audio-controls.js:createAudioSpeciesTabs()](ui/audio-controls.js#L237-L276) - Updates audio tab button colors
  - [audio-controls.js:updateAudioSampleColors()](ui/audio-controls.js#L298-L318) - Updates audio sample section header and waveform colors

**Pre-Filtered Frequency Bands:**
- When enabled (`CONFIG.granular.usePreFilteredBands`), samples are pre-processed into multiple frequency bands at upload time
- Uses `FrequencyBandProcessor` to create filtered bands using Web Audio API's GPU-accelerated filtering
- Eliminates runtime filtering for 20-30% CPU reduction
- Configurable number of bands: `CONFIG.granular.numFrequencyBands` (default: 10)
- Trade-off: 10x memory usage for significant CPU savings
- Processing time: 2-5 seconds per sample upload
- Implementation: [frequency-band-processor.js](audio/frequency-band-processor.js)

---

## 4. Rendering Module (`js/rendering/`)

**Purpose:** Canvas rendering separated from physics simulation

**Public API (PhysicsRenderer):**
```javascript
{
  init(canvas): void
  render(particles, trailParticles): void
  clearCanvas(): void
  updateCanvasSize(width, height): void
}
```

**Contract Rules:**
- ✅ Listens to `CANVAS_RENDER` events from Physics
- ✅ Reads voice allocation state from `audioEngine.voiceAllocations`
- ✅ Reads crossfade state from `audioEngine.particleAudioCrossfade`
- ❌ MUST NOT manipulate physics state
- ❌ MUST NOT query physics module directly

**Dependencies:**
- Listens to Physics events for rendering data
- Reads audio state for visual feedback (brightness)

---

## 5. UI Module (`js/ui/`)

**Purpose:** User interface, controls, event handling

**Public API (UISystem):**
```javascript
{
  init(): Promise<boolean>
  update(options): void
  getState(): Object
}
```

**Contract Rules:**
- ✅ UI listens to user input and dispatches actions
- ✅ UI updates DOM based on state changes
- ✅ UI calls public APIs of Physics/Audio to trigger changes
- ❌ UI MUST NOT directly modify physics/audio state

**Submodules:**
- `tab-system.js` - Tab navigation and collapsible sections
- `slider-controls.js` - Physics parameter sliders
- `audio-controls.js` - Audio parameter controls, species tabs with mute functionality, color updates for audio UI elements
- `canvas-interaction.js` - Mouse/canvas events
- `keyboard-shortcuts.js` - Keyboard handling
- `preset-system.js` - Save/load presets
- `force-matrix.js` - Force matrix UI and **centralized species color management** (orchestrates all color updates)
- `performance-display.js` - Event-driven performance metrics display

---

## 6. Main Module (`js/main.js`)

**Purpose:** Application entry point and system orchestration

**Responsibilities:**
- Initialize all systems in correct order
- Wire up global event handlers
- Expose minimal API to window for HTML onclick handlers
- Handle top-level errors

**Contract Rules:**
- ✅ Main coordinates initialization
- ✅ Main MAY expose thin wrapper functions to window
- ❌ Main should NOT contain business logic

---

## 7. Shared Utilities (`js/shared/`)

**Purpose:** Reusable, dependency-free utility functions

**Modules:**
- `dom-utils.js` - Safe DOM access and manipulation
- `event-manager.js` - Event listener lifecycle management
- `validation-utils.js` - Math validation and clamping
- `event-bus.js` - Event-based communication system

**Contract Rules:**
- ✅ Utilities MUST be pure functions or stateless classes
- ❌ Utilities MUST NOT import from application modules
- ❌ Utilities MUST NOT have side effects (except DOM operations)
- ✅ All modules MAY use shared utilities

---

## Communication Patterns

### ✅ Allowed Patterns:

1. **Direct API Calls (Top-Down)**
   - Main → Physics.init()
   - Main → Audio.init()
   - Main → UI.init()
   - UI → Physics.togglePause()
   - UI → Audio.loadSample()

2. **State Reading (Read-Only)**
   - All modules → CONFIG (read)
   - All modules → state (read, minimize writes)

3. **Event-Based Communication**
   - Physics emits → UI listens
   - Physics emits → Audio listens
   - Physics emits → Renderer listens
   - Audio emits → System responds

### ❌ Forbidden Patterns:

1. **Circular Imports**
   - ❌ Audio imports Physics imports Audio

2. **Cross-Layer DOM Access**
   - ❌ Physics accessing DOM
   - ❌ Audio accessing DOM (except audio-specific UI)

3. **Tight Coupling**
   - ❌ Physics calling audio functions directly
   - ❌ Modules querying other modules' internal state

---

## Data Flow Architecture

```
User Input
    ↓
UI System (event handlers)
    ↓
Public APIs (Physics/Audio)
    ↓
State Updates (CONFIG/state)
    ↓
Event Emission
    ↓
Event Listeners (Audio/Renderer/UI)
    ↓
Visual/Audio Output
```

---

## Testing Boundaries

Each module should be testable in isolation:

- **Physics:** Can run without DOM or Audio (100% DOM-free)
- **Audio:** Can run without Physics (mock particle data via events)
- **UI:** Can render without active Physics/Audio
- **Renderer:** Can render with mock particle data

---

## Success Metrics

- ✅ Zero circular dependencies
- ✅ Physics runs without DOM access
- ✅ Audio runs without Physics queries
- ✅ Clear, documented public APIs
- ✅ Event-based communication where appropriate
- ✅ All modules testable in isolation
