# Data Flow Patterns

## Overview
This document defines how data flows through the Granular Particle Synthesizer system, establishing clear boundaries and communication patterns between modules.

---

## System Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│                     User Interface                       │
│              (js/ui/, HTML, User Input)                  │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
        Commands/Actions      Read State/Config
                │                     │
                ▼                     ▼
┌───────────────────────┐   ┌──────────────────────┐
│   Physics Engine      │   │   Audio System       │
│   (js/physics/)       │   │   (js/audio/)        │
│                       │   │                      │
│ - Particle simulation │   │ - Audio synthesis    │
│ - Collision detection │   │ - Sample management  │
│ - Spatial optimization│   │ - Parameter control  │
└───────┬───────────────┘   └──────────┬───────────┘
        │                              │
        │         ┌────────────────────┘
        │         │
        ▼         ▼
┌─────────────────────────────────────────────────────────┐
│                  Global State (CONFIG)                   │
│              Read-mostly shared state                    │
└─────────────────────────────────────────────────────────┘
```

---

## Key Data Flow Scenarios

### 1. Application Initialization

```
main.js (DOMContentLoaded)
    │
    ├─→ UISystem.init()
    │   ├─→ Create DOM elements (tabs, controls, matrix)
    │   ├─→ Setup event listeners (EventListenerManager)
    │   └─→ Initialize keyboard shortcuts
    │
    ├─→ PhysicsEngine.init()
    │   ├─→ Initialize canvas
    │   ├─→ Create spatial grid
    │   ├─→ Initialize particles (read CONFIG)
    │   └─→ Start animation loop
    │
    ├─→ AudioSystem.updateUI({ updateType: 'all' })
    │   └─→ Update audio-specific UI elements
    │
    └─→ disableAudioControls()
        ├─→ Disable all granular parameter controls
        ├─→ Disable all audio species tabs
        ├─→ Add 'disabled' class to all audio controls
        └─→ Result: All audio controls grayed out (40% opacity)
            until user clicks "Start Audio Engine"
```

**State Access:**
- All modules READ from `CONFIG` (species, physics, granular settings)
- PhysicsEngine WRITES to `state.particles`, `state.spatialGrid`
- UI modules update DOM only

**Audio Control State:** Audio controls are initialized in a disabled state to guide users toward starting the audio engine first. This prevents confusion about why audio isn't working and provides clear visual feedback about the required initialization step.

---

### 2. User Adjusts Physics Slider

```
User moves slider (e.g., friction)
    │
    ▼
UI: slider-controls.js (EventListener)
    │
    ├─→ Read slider.value
    ├─→ Validate using validation-utils
    ├─→ Update display (dom-utils)
    └─→ WRITE to CONFIG.physics.friction
            │
            ▼
    PhysicsEngine reads CONFIG.physics.friction
    on next animation frame
            │
            ▼
        Particle.update() uses new friction value
```

**Pattern:** Direct state mutation (CONFIG as shared memory)

---

### 3. Animation Frame (60 FPS Loop)

```
requestAnimationFrame → PhysicsEngine.animate()
    │
    ├─→ updateParticles()
    │   ├─→ spatialGrid.clear() + insertParticle()
    │   ├─→ For each particle: particle.update()
    │   │   ├─→ Read CONFIG.relationships (force matrix)
    │   │   ├─→ Read CONFIG.physics (friction, maxSpeed, etc.)
    │   │   ├─→ Calculate forces from nearby particles
    │   │   ├─→ Update position/velocity
    │   │   └─→ Create trail particles if enabled
    │   │
    │   └─→ Emit event: 'PARTICLES_UPDATED' with particle data
    │       └─→ Audio listens → sendParticleDataToAudio()
    │           ├─→ Map particle data to audio parameters
    │           └─→ audioEngine.workletNode.port.postMessage()
    │
    ├─→ Emit event: 'CANVAS_RENDER' with particle arrays
    │   └─→ PhysicsRenderer listens → draws to canvas
    │       ├─→ Draw trail particles (sorted by age)
    │       └─→ Draw current particles (sorted by age)
    │
    └─→ Emit event: 'PERFORMANCE_UPDATED' with metrics (every 500ms)
        └─→ PerformanceDisplay listens → updates performance displays
```

**Event-Based Architecture:**
- Physics emits events → Audio and Renderer listen
- No direct coupling between physics and rendering
- No direct coupling between physics and audio

---

### 4. User Clicks "Start Audio"

```
User clicks "Start Audio" button
    │
    ▼
UI: onclick handler → window.AudioSystem
    │
    ▼
AudioSystem.init()
    │
    ├─→ audio-engine.js: startAudioEngine()
    │   ├─→ Create AudioContext
    │   ├─→ Load AudioWorklet module (worklet-processor.js)
    │   ├─→ Create AudioWorkletNode
    │   ├─→ Connect to destination
    │   ├─→ Set audioEngine.isActive = true
    │   │
    │   └─→ Update UI state (updateAudioUIState function)
    │       ├─→ Hide "Start Audio" button
    │       ├─→ Show "Stop Audio" button
    │       ├─→ Display sample rate, buffer size
    │       └─→ enableAudioControls()
    │           ├─→ Enable all granular parameter controls
    │           ├─→ Enable all audio species tabs
    │           └─→ Remove 'disabled' class from all audio controls
    │
    └─→ eventBus.emit(Events.AUDIO_INITIALIZED)
        │
        └─→ AudioSystem.init() eventBus.once() handler:
            │
            ├─→ resendAudioBuffers()
            │   └─→ parameter-manager.js: resendAudioBuffers()
            │       ├─→ Iterate through CONFIG.species.audioBuffers[]
            │       ├─→ For each loaded buffer:
            │       │   └─→ workletNode.port.postMessage({ type: 'audioBuffer', ... })
            │       └─→ Ensures previously loaded samples work after engine restart
            │
            └─→ AudioSystem.updateParameters({ all: true })
                └─→ parameter-manager.js: updateAudioParameters()
                    ├─→ Read CONFIG (curves, ranges, volumes, pitches, voices)
                    ├─→ Validate all parameters
                    └─→ Send batch update to workletNode.port
```

**Key Features:**
- Audio controls disabled on page load, enabled when engine starts
- Audio buffer persistence: Previously loaded samples automatically re-sent to new worklet instance
- When user clicks "Stop Audio Engine", all controls are disabled again via `disableAudioControls()`

---

### 5. User Loads Audio Sample

```
User selects file via <input type="file">
    │
    ▼
UI: audio-controls.js (EventListener)
    │
    └─→ AudioSystem.loadSample(speciesIndex, file)
        │
        └─→ sample-manager.js: loadAudioSample()
            ├─→ Create FileReader
            ├─→ audioEngine.context.decodeAudioData()
            ├─→ WRITE to CONFIG.species.audioBuffers[index]
            │
            ├─→ If pre-filtering enabled (CONFIG.granular.usePreFilteredBands):
            │   ├─→ FrequencyBandProcessor.processSampleIntoBands()
            │   ├─→ Pre-filter into CONFIG.granular.numFrequencyBands (default 10)
            │   ├─→ Send all bands to worklet via postMessage
            │   └─→ Display progress during 2-5 second processing
            │
            ├─→ Else: Send single buffer to worklet
            │
            └─→ AudioSystem.updateUI({ speciesIndex, updateType: 'waveform' })
                └─→ sample-manager.js: updateAudioUI()
                    ├─→ Draw waveform to canvas
                    ├─→ Update sample range sliders
                    └─→ Update audio controls visibility
```

**Pre-Filtered Frequency Bands:**
- When enabled, samples are pre-processed into multiple frequency bands at upload time
- Eliminates runtime filtering (20-30% CPU reduction)
- Uses Web Audio API's GPU-accelerated filtering
- Trades memory (10x larger) for CPU performance
- Processing happens once per sample upload (2-5 seconds)

---

### 6. User Changes Species Color

```
User selects new color via color picker in Force Matrix
    │
    ▼
UI: force-matrix.js (EventListener on color input)
    │
    └─→ updateSpeciesColor(speciesIndex, hexColor)
        │
        ├─→ Convert hex to RGB (Utils.hexToRgb)
        ├─→ WRITE to CONFIG.species.colors[speciesIndex]
        │
        ├─→ Update existing particle colors:
        │   └─→ For each particle in state.particles:
        │       └─→ if (particle.species === speciesIndex):
        │           └─→ particle.color = newColor
        │
        ├─→ Update existing trail particle colors:
        │   └─→ For each trailParticle in state.trailParticles:
        │       └─→ if (trailParticle.species === speciesIndex):
        │           └─→ trailParticle.color = newColor
        │
        └─→ Update all UI elements with new color:
            ├─→ createSpeciesTabs() - Rebuild species tab buttons
            ├─→ createForceMatrix() - Rebuild force matrix headers
            ├─→ createSpeciesControls() - Rebuild species controls title
            ├─→ createAudioSpeciesTabs() - Rebuild audio species tabs
            └─→ updateAudioSampleColors() - Update waveform display colors
```

**Pattern:** UI module owns all color updates, directly calls UI update functions

---

### 7. User Adjusts Volume Slider

```
User moves volume slider in Audio & Synthesis tab
    │
    ▼
UI: audio-controls.js (EventListener on volume slider)
    │
    ├─→ Read slider.value (-60 to +12 dB)
    ├─→ Validate using validateFloat(value, -60, 12)
    ├─→ Convert dB to linear: linearGain = 10^(dB / 20)
    ├─→ Update display text (show "dB" units, e.g., "+6.0 dB" or "-12.0 dB")
    ├─→ WRITE to CONFIG.species.sampleVolumes[speciesIndex] (as linear value)
    │
    └─→ AudioSystem.updateParameters({ audio: true })
        │
        └─→ parameter-manager.js: updateAudioParameters()
            ├─→ Read CONFIG.species.sampleVolumes array (linear values)
            ├─→ Validate all volume values (0 to 4.0 linear)
            │
            └─→ Send to worklet via batch update:
                audioEngine.workletNode.port.postMessage({
                    type: 'batchParameterUpdate',
                    updates: {
                        audioParameters: {
                            volumes: validatedVolumes
                        }
                    }
                })
                    │
                    ▼
            AudioWorklet: worklet-processor.js receives message
                │
                ├─→ Store in this.sampleVolumes[species]
                │
                └─→ Applied during grain processing:
                    processGrain(grain, ...)
                        │
                        └─→ Multiply sample by volume:
                            processedSample *= this.sampleVolumes[grain.species]
```

**Implementation:** Volume uses professional dB scale in UI, converted to linear for audio processing

### 8. User Adjusts Master Volume

```
User moves Master Volume slider
    │
    ▼
UI: audio-controls.js (EventListener on volumeScale slider)
    │
    ├─→ Read slider.value (-40 to +12 dB)
    ├─→ Update display text (show "dB" units)
    │
    └─→ parameter-manager.js: sendParticleDataToAudio()
        │
        ├─→ Convert dB to linear: volumeScale = 10^(dB / 20)
        ├─→ Include volumeScale in particle data sent to worklet
        │
        └─→ Applied per-grain during spawning:
            grainGain = velocityCurve × volumeScale
```

**Implementation:** Master volume in dB scale, converted to linear before sending to worklet

---

### 9. Voice Allocation with Audio Crossfading

```
Animation Frame → updateParticles() in AudioWorklet
    │
    ├─→ updateVoiceAllocations(particles) [Throttled to 16ms = 60fps]
    │   │
    │   ├─→ Throttle check: Skip if less than 16ms since last update
    │   │
    │   ├─→ Group particles by species
    │   │
    │   ├─→ For each species:
    │   │   ├─→ Calculate new allocations based on maxVoices:
    │   │   │   └─→ if (particleCount <= maxVoices):
    │   │   │       └─→ newAllocations = all particle IDs
    │   │   │   └─→ else (particleCount > maxVoices):
    │   │   │       ├─→ Sort particles by smoothed velocity (fastest first)
    │   │   │       └─→ newAllocations = top maxVoices particles
    │   │   │
    │   │   ├─→ Check if allocations changed
    │   │   │
    │   │   ├─→ if (maxVoices >= particleCount OR initialAllocation):
    │   │   │   └─→ Apply immediately (no delay needed)
    │   │   │
    │   │   ├─→ if (maxVoicesJustChanged):
    │   │   │   ├─→ Apply change IMMEDIATELY with crossfades (skip delay)
    │   │   │   └─→ Result: ~35ms total latency
    │   │   │
    │   │   └─→ else (natural particle reordering):
    │   │       ├─→ Start/update delay timer (voiceStealingDelay = 50ms)
    │   │       └─→ if (delay elapsed):
    │   │           ├─→ Set up audio crossfades:
    │   │           │   ├─→ Newly allocated → fadeIn state (0% → 100%)
    │   │           │   └─→ De-allocated → fadeOut state (100% → 0%)
    │   │           └─→ Apply new voiceAllocations
    │   │
    │   └─→ Voice allocation complete (determines audio + visual)
    │
    ├─→ For each particle:
    │   │
    │   ├─→ Apply motion hysteresis to determine isMoving
    │   │
    │   ├─→ if (!isMoving):
    │   │   └─→ Release existing grains, continue
    │   │
    │   ├─→ Check voice allocation AND crossfade state:
    │   │   ├─→ hasVoiceAllocation = voiceAllocations.has(particleId)
    │   │   ├─→ crossfade = particleAudioCrossfade.get(particleId)
    │   │   └─→ isFadingOut = crossfade && crossfade.type === 'fadeOut'
    │   │
    │   ├─→ if (!hasVoiceAllocation AND !isFadingOut):
    │   │   └─→ Release grains, delete timer, continue
    │   │
    │   └─→ if (isMoving AND (hasVoiceAllocation OR isFadingOut)):
    │       ├─→ Calculate grain parameters from trail and velocity
    │       ├─→ Update grain timer
    │       └─→ Spawn grains at calculated intervals
    │
    ├─→ During grain processing (process() method):
    │   └─→ For each grain:
    │       ├─→ Calculate crossfade gain:
    │       │   ├─→ fadeIn: gain = √(progress) [0 → 1]
    │       │   └─→ fadeOut: gain = √(1 - progress) [1 → 0]
    │       └─→ Apply crossfade gain to grain volume
    │
    └─→ sendVoiceStateToMainThread()
        ├─→ Serialize voiceAllocations Map
        ├─→ Serialize particleAudioCrossfade Map with progress
        └─→ Send to main thread via port.postMessage({ type: 'voiceState' })
            │
            └─→ Main thread: audio-engine.js receives message
                └─→ Renderer derives brightness from allocations + crossfades
```

**Key Design:**

1. **Voice Allocation Controls Both Audio & Visual:**
   - Determines which particles can make sound AND which appear bright
   - Velocity-based priority when over limit (fastest particles get voices)
   - Smart delay system: User slider changes apply immediately, natural reordering delayed
   - 60fps throttling (16ms intervals) synced with rendering

2. **Unified Audio Crossfade System:**
   - Newly allocated: fadeIn state, grains spawn with increasing volume (0→1)
   - De-allocated: fadeOut state, continue spawning with decreasing volume (1→0)
   - Equal-power curves (√progress) maintain constant acoustic energy
   - Configurable duration: voiceStealingCrossfade (10-500ms, default 50ms)
   - Automatic cleanup: fadeOut completes → crossfade deleted → timer deleted

3. **Grain Spawning with Crossfade Support:**
   - Particles spawn grains if: hasVoiceAllocation OR isFadingOut
   - Burst prevention: Time clamping + 4 grain/update limit
   - Each grain's volume multiplied by crossfade gain

**Example Scenario:**
- Species has 50 particles, user adjusts maxVoices slider from 50 → 10
- Immediate response (~35ms total latency)
- During 50ms crossfade: 40 particles fade out, 10 fade in
- After crossfade: 10 bright particles making sound, 40 dimmed and silent

---

## Communication Patterns

### Event-Based Communication

The system uses an EventBus for decoupled communication:

```javascript
// Physics emits
eventBus.emit(Events.PARTICLES_UPDATED, particleData);
eventBus.emit(Events.PERFORMANCE_UPDATED, metrics);
eventBus.emit(Events.CANVAS_RENDER, { particles, trailParticles });

// Audio listens
eventBus.on(Events.PARTICLES_UPDATED, (data) => processAudio(data));

// Renderer listens
eventBus.on(Events.CANVAS_RENDER, (data) => renderCanvas(data));

// UI listens
eventBus.on(Events.PERFORMANCE_UPDATED, (metrics) => updateDisplay(metrics));
```

### Benefits
- No circular dependencies
- Modules decoupled
- Easy to add new listeners
- Testable in isolation
- Clear data flow

---

## Module Responsibilities

### Physics Engine (`js/physics/`)
- ✅ Particle simulation and forces
- ✅ Spatial grid optimization
- ✅ Trail particle creation
- ✅ Event emission (particles, performance)
- ❌ NO DOM access
- ❌ NO direct audio calls

### Audio System (`js/audio/`)
- ✅ Granular synthesis
- ✅ Sample loading and processing
- ✅ Parameter validation
- ✅ Audio-specific UI updates
- ❌ NO physics state queries
- ❌ NO cross-module UI updates

### Rendering System (`js/rendering/`)
- ✅ Canvas rendering
- ✅ Visual feedback (brightness, trails)
- ✅ Listens to physics events
- ❌ NO physics state manipulation

### UI System (`js/ui/`)
- ✅ User input handling
- ✅ DOM updates
- ✅ Calls public APIs
- ❌ NO direct physics/audio state modification

---

## Optimization Features

### Pre-Filtered Frequency Bands
- Samples pre-processed into multiple frequency bands at upload time
- Eliminates runtime filtering for 20-30% CPU reduction
- Configurable: `CONFIG.granular.usePreFilteredBands` (default: true)
- Number of bands: `CONFIG.granular.numFrequencyBands` (default: 10)
- Trade-off: 10x memory usage for significant CPU savings

### Grain Spawn Optimization
- Longer grain minimum: 50ms (was 30ms)
- Reduced overlap range: 1.2-2.5x (was 1.0-3.0x)
- Lower spawn rate cap: 60 grains/sec (was 100)
- Result: 60% reduction in grain spawn rate while maintaining audio quality

### Voice Allocation Optimization
- 60fps throttling (16ms intervals) for smooth visual feedback
- EMA smoothing for stable velocity-based allocation
- Immediate response to user slider changes (~35ms latency)
- Delayed response to natural particle reordering (prevents flicker)

---

## Success Metrics

- ✅ Zero circular dependencies
- ✅ Physics runs without DOM access
- ✅ Audio runs without physics queries
- ✅ Clear, documented public APIs
- ✅ Event-based communication where appropriate
- ✅ 60-75% CPU reduction from optimizations
