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

## Data Flow Patterns by Scenario

### 1. Application Initialization (Updated 2025-10-06)

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
    └─→ ✅ NEW (2025-10-06): disableAudioControls()
        ├─→ Disable all granular parameter controls
        ├─→ Disable all audio species tabs
        ├─→ Disable all file input buttons
        ├─→ Disable all sample control sliders
        ├─→ Disable waveform canvases
        ├─→ Disable mute toggles
        ├─→ Add 'disabled' class/attribute to all audio controls
        └─→ Result: All audio controls grayed out (40% opacity)
            until user clicks "Start Audio Engine"
```

**State Access:**
- All modules READ from `CONFIG` (species, physics, granular settings)
- PhysicsEngine WRITES to `state.particles`, `state.spatialGrid`
- UI modules update DOM only

**New Feature (2025-10-06):** Audio controls are initialized in a disabled state to guide users toward starting the audio engine first. This prevents confusion about why audio isn't working and provides clear visual feedback about the required initialization step.

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
        (No explicit notification needed)
            │
            ▼
    PhysicsEngine reads CONFIG.physics.friction
    on next animation frame
            │
            ▼
        Particle.update() uses new friction value
```

**Pattern:** Direct state mutation (CONFIG as shared memory)
**Issue:** No change notification system
**Phase 3 Goal:** Add event emission for config changes

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
    │   └─→ ⚠️ VIOLATION: Direct call to sendParticleDataToAudio()
    │       │
    │       └─→ parameter-manager.js: sendParticleDataToAudio()
    │           ├─→ Read state.particles
    │           ├─→ Read CONFIG.granular, CONFIG.canvas
    │           ├─→ Map particle data to audio parameters
    │           └─→ audioEngine.workletNode.port.postMessage()
    │
    ├─→ render()
    │   └─→ ⚠️ VIOLATION: Direct DOM access (canvas rendering)
    │       ├─→ document.getElementById('canvas')
    │       ├─→ Draw trail particles (sorted by age)
    │       └─→ Draw current particles (sorted by age)
    │
    └─→ Update performance metrics (every 500ms)
        └─→ ⚠️ VIOLATION: Multiple DOM updates
            ├─→ document.getElementById('fps-display')
            ├─→ document.getElementById('frame-time')
            └─→ etc.
```

**Current Issues:**
- Physics directly calls audio functions
- Physics directly manipulates canvas (rendering should be separate)
- Physics updates UI performance displays

**Proposed Fix:**
```
PhysicsEngine.animate()
    │
    ├─→ updateParticles() (pure physics)
    │
    ├─→ Emit event: 'particles:updated' with particle data
    │   ├─→ Audio listens → processes particle data
    │   └─→ Renderer listens → draws to canvas
    │
    └─→ Emit event: 'performance:updated' with metrics
        └─→ UI listens → updates performance displays
```

---

### 4. User Clicks "Start Audio" (Updated 2025-10-06)

```
User clicks "Start Audio" button
    │
    ▼
UI: onclick handler → window.AudioSystem (exposed in main.js)
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
    │   ├─→ ⚠️ VIOLATION: Call AudioSystem.updateParameters()
    │   │       (Circular dependency!)
    │   │
    │   └─→ Update UI state (updateAudioUIState function)
    │       ├─→ Hide "Start Audio" button
    │       ├─→ Show "Stop Audio" button
    │       ├─→ Display sample rate, buffer size
    │       └─→ ✅ NEW (2025-10-06): enableAudioControls()
    │           ├─→ Enable all granular parameter controls
    │           ├─→ Enable all audio species tabs
    │           ├─→ Enable all file input buttons
    │           ├─→ Enable all sample control sliders
    │           ├─→ Enable waveform canvases
    │           ├─→ Enable mute toggles
    │           └─→ Remove 'disabled' class/attribute from all audio controls
    │
    └─→ eventBus.emit(Events.AUDIO_INITIALIZED)
        │
        └─→ AudioSystem.init() eventBus.once() handler:
            │
            ├─→ ✅ NEW (2025-10-06): resendAudioBuffers()
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

**Current Issue:** Circular import (audio-engine imports AudioSystem)

**Fix:** Remove AudioSystem import from audio-engine.js, call updateParameters() from AudioSystem.init() after startAudioEngine() completes

**New Feature (2025-10-06):**
- Audio controls are disabled on page load and only enabled when audio engine starts
- Audio buffer persistence: When engine restarts, previously loaded samples are automatically re-sent to new worklet instance
- When the user clicks "Stop Audio Engine", all controls are disabled again via `disableAudioControls()`

---

### 4b. User Stops Audio Engine

```
User clicks "Stop Audio Engine" button
    │
    ▼
Main: stopAudioEngine() [audio-engine.js]
    │
    ├─→ Close AudioContext
    ├─→ Set audioEngine.context = null
    ├─→ Set audioEngine.workletNode = null
    ├─→ Set audioEngine.isActive = false
    ├─→ Clear voice allocations and crossfade maps
    │
    ├─→ ⚠️ NOTE: CONFIG.species.audioBuffers[] NOT cleared
    │   └─→ Loaded samples persist on main thread for restart
    │
    └─→ Update UI state (updateAudioUIState function)
        ├─→ Show "Start Audio" button
        ├─→ Hide "Stop Audio" button
        └─→ disableAudioControls()
            ├─→ Disable all granular parameter controls
            ├─→ Disable all audio species tabs
            ├─→ Disable all file input buttons
            ├─→ Disable all sample control sliders
            ├─→ Disable waveform canvases
            ├─→ Disable mute toggles
            └─→ Add 'disabled' class/attribute to all audio controls
```

**Key Design Decision (2025-10-06):**
- `CONFIG.species.audioBuffers[]` is **not** cleared when engine stops
- Allows `resendAudioBuffers()` to restore samples when engine restarts
- Users don't need to reload audio files after stopping/restarting engine

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
            ├─→ Send buffer to workletNode via postMessage
            │
            └─→ AudioSystem.updateUI({ speciesIndex, updateType: 'waveform' })
                └─→ sample-manager.js: updateAudioUI()
                    ├─→ Draw waveform to canvas
                    ├─→ Update sample range sliders
                    └─→ Update audio controls visibility
```

**Pattern:** UI → Audio API → State mutation → UI update
**Good:** Uses AudioSystem public API
**Issue:** Audio module updates UI (should be separated)

---

### 6. User Changes Species Color (Updated 2025-10-05)

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
        ├─→ Update all UI elements with new color (UI module orchestrates):
        │   │
        │   ├─→ createSpeciesTabs()
        │   │   └─→ Rebuild species tab buttons with new colors
        │   │
        │   ├─→ createForceMatrix()
        │   │   └─→ Rebuild force matrix headers with new colors
        │   │
        │   ├─→ createSpeciesControls()
        │   │   └─→ Rebuild species controls title with new color
        │   │
        │   ├─→ createAudioSpeciesTabs() [audio-controls.js]
        │   │   └─→ Rebuild audio species tab buttons with new colors
        │   │
        │   └─→ updateAudioSampleColors() [audio-controls.js]
        │       ├─→ Update audio samples section header color and border
        │       └─→ Update waveform display colors (if sample loaded)
        │
        └─→ Color update complete (immediate visual feedback)
```

**Pattern:** UI module owns all color updates, directly calls UI update functions
**Architectural Principle:** Species color management centralized in force-matrix.js
**Key Improvement (2025-10-05):**
- Removed Audio module dependency (no more updateAudioUI() calls)
- Audio module no longer manages colors (violates separation of concerns)
- All color updates happen in UI module via direct function calls
- Updates work independently of audio engine state (no panel visibility checks)

**Previous Architecture (Before 2025-10-05):**
```
force-matrix.js → updateAudioUI() [Audio module]
                  └─→ Check if audio panel is active (BAD: UI update depends on audio state)
                      └─→ Update colors only if panel visible
```

**New Architecture (After 2025-10-05):**
```
force-matrix.js → createAudioSpeciesTabs() + updateAudioSampleColors() [UI module]
                  └─→ Direct color updates, no state checks (GOOD: UI owns UI updates)
```

---

### 7. User Adjusts Pitch Slider

```
User moves pitch slider in Audio & Synthesis tab
    │
    ▼
UI: audio-controls.js (EventListener on pitch slider)
    │
    ├─→ Read slider.value (-24 to +24 semitones)
    ├─→ Validate using validateInt(value, -24, 24)
    ├─→ Update display text (show + for positive values)
    ├─→ WRITE to CONFIG.species.samplePitches[speciesIndex]
    │
    └─→ AudioSystem.updateParameters({ audio: true })
        │
        └─→ parameter-manager.js: updateAudioParameters()
            ├─→ Read CONFIG.species.samplePitches array
            ├─→ Validate all pitch values (-24 to +24)
            │
            └─→ Send to worklet via batch update:
                audioEngine.workletNode.port.postMessage({
                    type: 'batchParameterUpdate',
                    updates: {
                        audioParameters: {
                            pitches: validatedPitches
                        }
                    }
                })
                    │
                    ▼
            AudioWorklet: worklet-processor.js receives message
                │
                ├─→ Store in this.samplePitches[species]
                │
                └─→ Applied during grain spawning:
                    spawnGrain(species, ...)
                        │
                        ├─→ Read pitch: this.samplePitches[species]
                        ├─→ Convert to playback rate:
                        │   playbackRate = 2^(semitones / 12)
                        │   • +24 semitones → 4.0× (2 octaves up)
                        │   • +12 semitones → 2.0× (1 octave up)
                        │   •   0 semitones → 1.0× (original pitch)
                        │   • -12 semitones → 0.5× (1 octave down)
                        │   • -24 semitones → 0.25× (2 octaves down)
                        │
                        └─→ Apply to grain length calculation:
                            grainLengthSamples = grainLength × sampleRate × playbackRate
                            │
                            └─→ Higher pitch = more samples per grain
                                → faster traversal through audio buffer
                                → higher perceived pitch
```

**Pattern:** UI → Audio API → Worklet parameter storage → Applied during grain spawning
**Implementation:** Pitch modulates playback rate, not volume or frequency filtering
**Result:** Time-stretching effect - chipmunk (high) or monster (low) vocal characteristics

**Technical Details:**
- **Location**: [worklet-processor.js:405-410](js/audio/worklet-processor.js#L405-L410)
- **Formula**: Uses equal-tempered tuning (12-TET): `playbackRate = 2^(semitones/12)`
- **Effect**: Changes both pitch AND timbre (formants shift with pitch)
- **Range**: ±24 semitones (±2 octaves) for extreme sound design
- **Integration**: Works independently of frequency filtering (Y-position/particle size)

---

### 8. User Adjusts Force Matrix

```
User types in force matrix cell
    │
    ▼
UI: force-matrix.js (EventListener)
    │
    ├─→ Parse input value as float
    ├─→ Clamp to range [-1, 1]
    ├─→ WRITE to CONFIG.relationships[row][col]
    └─→ Update cell color based on value
        │
        ▼
    (No explicit notification)
        │
        ▼
PhysicsEngine reads CONFIG.relationships
on next particle.update() call
```

**Pattern:** Direct CONFIG mutation (immediate effect next frame)

---

### 9. User Toggles Pause

```
User clicks "Pause" button
    │
    ▼
main.js: window.togglePause() (HTML onclick)
    │
    └─→ PhysicsEngine.togglePause()
        ├─→ Toggle state.isPaused
        │
        └─→ Send message to audio worklet:
            audioEngine.workletNode.port.postMessage({
                type: 'pauseStateUpdate',
                isPaused: newState
            })
```

**Pattern:** UI → Physics API → State update + Audio notification
**Good:** Physics owns pause state, notifies audio system
**Issue:** Physics directly messaging audio worklet (should use Audio API)

**Better Pattern:**
```
UI → PhysicsEngine.togglePause()
  ├─→ state.isPaused = !state.isPaused
  └─→ Emit 'simulation:paused' event
      └─→ AudioSystem listens → updates worklet
```

---

### 10. Preset Save/Load

```
User clicks "Save Preset"
    │
    ▼
UI: preset-system.js: savePreset()
    │
    ├─→ Read entire CONFIG object
    ├─→ Serialize to JSON
    ├─→ Store in localStorage
    └─→ Update preset list UI

User clicks "Load Preset"
    │
    ▼
UI: preset-system.js: loadPreset()
    │
    ├─→ Read JSON from localStorage
    ├─→ Deep merge into CONFIG (WRITE all properties)
    │
    ├─→ Call PhysicsEngine APIs:
    │   ├─→ adjustParticleCounts()
    │   ├─→ updateParticleSizes()
    │   └─→ removeTrailParticlesForSpecies()
    │
    ├─→ Call AudioSystem APIs:
    │   └─→ updateParameters({ all: true })
    │
    └─→ Update UI to reflect new CONFIG:
        ├─→ Rebuild force matrix
        ├─→ Update all sliders
        ├─→ Update audio controls
        └─→ Rebuild species tabs
```

**Pattern:** UI orchestrates multi-system update via public APIs
**Good:** Uses proper APIs, doesn't bypass module boundaries
**Issue:** Large state mutation all at once (hard to track)

---

### 11. Voice Allocation with Audio Crossfading (Updated 2025-10-06)

```
Animation Frame → updateParticles() in AudioWorklet
    │
    ├─→ updateVoiceAllocations(particles) [Throttled to 16ms = 60fps, optimized 2025-10-06]
    │   │
    │   ├─→ Throttle check: Skip if less than 16ms since last update (60fps sync)
    │   │
    │   ├─→ Group particles by species
    │   │
    │   ├─→ For each species:
    │   │   ├─→ Get all particles (moving AND still)
    │   │   │
    │   │   ├─→ Calculate new allocations based on maxVoices:
    │   │   │   └─→ if (particleCount <= maxVoices):
    │   │   │       │   // All particles get voice allocation
    │   │   │       └─→ newAllocations = Set<all particle IDs>
    │   │   │   └─→ else (particleCount > maxVoices):
    │   │   │       │   // Prioritize by velocity
    │   │   │       ├─→ Sort particles by velocity (fastest first)
    │   │   │       ├─→ Take top maxVoices particles
    │   │   │       └─→ newAllocations = Set<top particle IDs>
    │   │   │
    │   │   ├─→ Check if allocations changed (compare Sets)
    │   │   │
    │   │   ├─→ if (!allocationsChanged):
    │   │   │   └─→ Clear any pending changes, continue
    │   │   │
    │   │   ├─→ if (maxVoices >= particleCount):
    │   │   │   └─→ Apply immediately (no delay needed, all lit)
    │   │   │
    │   │   ├─→ if (initialAllocation):
    │   │   │   └─→ Apply immediately (avoid blank screen)
    │   │   │
    │   │   ├─→ if (maxVoicesJustChanged): [NEW 2025-10-06 - Immediate Response]
    │   │   │   │   // User slider adjustment detected
    │   │   │   ├─→ Apply change IMMEDIATELY with crossfades (skip delay)
    │   │   │   ├─→ Set up fadeIn/fadeOut crossfades (50ms default)
    │   │   │   ├─→ Update previousMaxVoices tracking
    │   │   │   └─→ Result: ~35ms total latency (16ms throttle + messaging + render)
    │   │   │
    │   │   ├─→ else (natural particle reordering):
    │   │   │   │   // Particles changing velocity order
    │   │   │   ├─→ Start/update delay timer (voiceStealingDelay = 50ms default)
    │   │   │   ├─→ Store pendingVoiceChanges
    │   │   │   └─→ if (delay elapsed):
    │   │   │       │   // Apply allocation change with crossfade
    │   │   │       ├─→ Set up audio crossfades (Timing: milliseconds, Fixed 2025-10-06):
    │   │   │       │   ├─→ Newly allocated particles → fadeIn state
    │   │   │       │   │   └─→ particleAudioCrossfade.set(id, { type: 'fadeIn', startTime: currentTime*1000, duration: crossfadeDuration*1000 })
    │   │   │       │   └─→ De-allocated particles → fadeOut state
    │   │   │       │       └─→ particleAudioCrossfade.set(id, { type: 'fadeOut', startTime: currentTime*1000, duration: crossfadeDuration*1000 })
    │   │   │       └─→ Apply new voiceAllocations
    │   │   │
    │   │   └─→ Voice allocation complete (determines audio + visual with crossfade)
    │
    ├─→ For each particle in particles:
    │   │
    │   ├─→ Apply motion hysteresis to determine isMoving
    │   │
    │   ├─→ if (!isMoving):
    │   │   │   // Still particle - no grain spawning
    │   │   └─→ Release existing grains, continue to next particle
    │   │
    │   ├─→ Check voice allocation AND crossfade state:
    │   │   │
    │   │   ├─→ hasVoiceAllocation = voiceAllocations.has(particleId)
    │   │   ├─→ crossfade = particleAudioCrossfade.get(particleId)
    │   │   ├─→ isFadingOut = crossfade && crossfade.type === 'fadeOut'
    │   │   │
    │   │   └─→ if (!hasVoiceAllocation AND !isFadingOut):
    │   │       │   // No voice and fadeOut complete/never started
    │   │       ├─→ Release existing grains
    │   │       ├─→ Delete grain timer (cleanup prevents leak)
    │   │       └─→ Continue to next particle
    │   │
    │   ├─→ if (isMoving AND (hasVoiceAllocation OR isFadingOut)):
    │   │   │   // Particle can spawn grains (allocated OR fading out)
    │   │   │
    │   │   ├─→ Get or create grain timer (lifecycle managed by voice allocation)
    │   │   │
    │   │   ├─→ Calculate grain parameters from trail and velocity:
    │   │   │   • Grain length: trail parameter maps to grainLengthMin → grainLengthMax (20ms → 500ms)
    │   │   │   • Overlap factor: trail parameter maps to overlapMin → overlapMax (0.5 → 4.0)
    │   │   │   • Grain rate: overlapFactor / grainLength (SIMPLIFIED - no velocity scaling)
    │   │   │   • Grain gain: velocity ^ velocityCurvePower × volumeScale (audiovisual connection)
    │   │   │
    │   │   │   Design: Trail controls smoothness (rate + length), velocity controls volume only
    │   │   │
    │   │   ├─→ Update grain timer
    │   │   └─→ Spawn grains at calculated intervals
    │   │
    │   └─→ During grain processing (process() method):
    │       │
    │       └─→ For each grain:
    │           ├─→ Calculate crossfade gain (Fixed timing 2025-10-06):
    │           │   ├─→ elapsed_ms = (currentTime * 1000) - startTime  // All in ms
    │           │   ├─→ progress = min(elapsed_ms / duration, 1.0)
    │           │   ├─→ fadeIn: gain = √(progress) [0 → 1]
    │           │   └─→ fadeOut: gain = √(1 - progress) [1 → 0]
    │           │
    │           └─→ Apply crossfade gain to grain volume
    │               └─→ processedSample *= crossfadeGain
    │
    ├─→ Apply crossfade-aware normalization:
    │   ├─→ Calculate weighted grain count:
    │   │   └─→ weightedGrainCount += crossfadeGain²
    │   └─→ Normalize by √(weightedGrainCount)
    │
    └─→ sendVoiceStateToMainThread() [Simplified 2025-10-04, Timing fixed 2025-10-06]
        │
        ├─→ Serialize voiceAllocations Map → allocations object
        ├─→ Serialize particleAudioCrossfade Map → crossfades object with progress:
        │   ├─→ elapsed_ms = (currentTime * 1000) - fadeState.startTime  // Fixed: both in ms
        │   └─→ progress = min(elapsed_ms / fadeState.duration, 1.0)
        └─→ Send to main thread via port.postMessage({ type: 'voiceState' })
            │
            └─→ Main thread: audio-engine.js receives message
                │
                ├─→ Update audioEngine.voiceAllocations Map from allocations
                └─→ Update audioEngine.particleAudioCrossfade Map from crossfades
                    │
                    └─→ Renderer derives brightness from allocations + crossfades
                        │
                        └─→ Apply brightness: hasVoice ? (crossfading ? interpolated : 1.0) : 0.3
```

**Key Design:**

1. **Voice Allocation Controls Both Audio & Visual:**
   - Location: [worklet-processor.js:487-627](js/audio/worklet-processor.js#L487-L627)
   - Determines which particles can make sound AND which appear bright
   - Velocity-based priority when over limit (fastest particles get voices)
   - **Smart delay system (2025-10-06)**:
     - **User slider changes**: Apply immediately (no delay, responsive UX)
     - **Natural particle reordering**: Delayed by voiceStealingDelay (prevents flicker)
   - **60fps throttling**: Updates run at 16ms intervals (synced with rendering)

2. **Unified Audio Crossfade System (Smooth Transitions with Auto-Cleanup):**
   - Location: [worklet-processor.js:568-600](js/audio/worklet-processor.js#L568-L600) (setup), [worklet-processor.js:889-927](js/audio/worklet-processor.js#L889-L927) (gain)
   - **Newly allocated**: fadeIn state, grains spawn with increasing volume (0→1)
   - **De-allocated**: fadeOut state, continue spawning with decreasing volume (1→0)
   - **Equal-power curves**: √(progress) and √(1-progress) maintain constant acoustic energy
   - **Configurable duration**: voiceStealingCrossfade (10-500ms, default 50ms)
   - **Timing Implementation (Fixed 2025-10-06)**: All timing in **milliseconds**:
     - `startTime = currentTime * 1000` (convert to ms)
     - `duration = crossfadeDuration * 1000` (convert to ms)
     - `progress = (currentTime * 1000 - startTime) / duration`
   - **Automatic cleanup**: When fadeOut completes (progress=1.0), crossfade entry deleted
   - **Timer cleanup**: Next frame with no voice + no crossfade → grain timer deleted (no leak)

3. **Grain Spawning with Crossfade Support:**
   - Location: [worklet-processor.js:310-335](js/audio/worklet-processor.js#L310-L335)
   - Particles spawn grains if: hasVoiceAllocation OR isFadingOut
   - **Burst prevention**: Time clamping (max 500ms drift) + 4 grain/update limit
   - Each grain's volume multiplied by crossfade gain via getCrossfadeGain()
   - fadeIn: gain increases 0→1, fadeOut: gain decreases 1→0

4. **Simple Normalization (No Weighting):**
   - Location: [worklet-processor.js:725-737](js/audio/worklet-processor.js#L725-L737)
   - Simple √N grain count normalization
   - Crossfade gain already applied to individual grains (line 860)
   - Removed weighted normalization that caused volume dips

**Why This Design:**
- **Smooth Transitions**: Audio crossfading eliminates clicks and volume spikes
- **Constant Energy**: Equal-power curves maintain consistent perceived loudness
- **Functional Control**: maxVoices directly affects audio output (reduces complexity/volume)
- **Visual Feedback**: Particles smoothly fade between bright and dim states
- **Motion-Driven**: Bright particles only make sound when moving

**Example Scenario:**
- Species has 50 particles, user adjusts maxVoices slider from 50 → 10
- **Immediate response (~35ms total latency):**
  - Allocation change applied immediately (no 50ms delay)
  - 40 particles enter fadeOut state
  - 10 particles enter fadeIn state (fastest moving particles)
  - Visual feedback updates within 1-2 frames
- **During 50ms crossfade:**
  - 40 particles fadeOut: Continue spawning grains, volume 100% → 0%
  - 10 particles fadeIn: Start spawning grains, volume 0% → 100%
  - Total acoustic energy remains constant (equal-power crossfade)
- **After crossfade:**
  - fadeOut completes → crossfade entries deleted
  - Next frame: no voice + no crossfade → timers deleted (cleanup)
  - 10 particles bright and making sound, 40 particles dimmed and silent

**Impact:** Slider changes are highly responsive (~35ms vs ~115ms previously), smooth and click-free, with automatic resource cleanup preventing timer leaks.

### Voice Allocation System Status (Updated 2025-10-06)

**✅ Fully Functional with Unified Audio Crossfading** - Voice allocation controls both visual feedback AND audio output with smooth, spike-free transitions and automatic cleanup.

**Recent Enhancements:**
1. **Responsive MaxVoices Control (2025-10-06)** ([worklet-processor.js:160-177](js/audio/worklet-processor.js#L160-L177), [worklet-processor.js:558-602](js/audio/worklet-processor.js#L558-L602))
   - **16ms throttling** (60fps sync, down from 33ms)
   - **Immediate application** for user slider changes (skips 50ms delay)
   - **Smart delay system**: Only delays natural particle velocity reordering
   - **70% latency reduction**: ~115ms → ~35ms for slider changes
   - **Prevents stuck states**: Rapid slider movement no longer resets timer indefinitely
   - **Safety preserved**: All crossfades still apply to prevent audio clicks/leaks

2. **Unified Crossfade System** ([worklet-processor.js:564-593](js/audio/worklet-processor.js#L564-L593), [worklet-processor.js:889-927](js/audio/worklet-processor.js#L889-L927))
   - Equal-power fadeIn/fadeOut during voice transitions
   - Eliminates volume spikes and audio clicks
   - Automatic cleanup when fadeOut completes (no timer leaks)
   - Configurable duration via voiceStealingCrossfade parameter (10-500ms, default 50ms)
   - **Timing Fix (2025-10-06)**: All crossfade timing standardized to milliseconds for audio/visual sync

3. **Grain Timer Lifecycle Management** ([worklet-processor.js:310-335](js/audio/worklet-processor.js#L310-L335))
   - fadeOut particles continue spawning during crossfade
   - When fadeOut completes, crossfade entry deleted automatically
   - Next frame: no voice + no crossfade → timer deleted (prevents leak)
   - Burst protection: time clamping + 4 grain/update limit

4. **Simplified Normalization** ([worklet-processor.js:725-737](js/audio/worklet-processor.js#L725-L737))
   - Simple √N grain count (removed weighted approach)
   - Crossfade gain applied to individual grains (line 860)
   - Prevents volume dips during transitions

5. **Simplified Grain Rate** ([worklet-processor.js:337-351](js/audio/worklet-processor.js#L337-L351))
   - Removed velocity-to-rate scaling (velocity controls volume only)
   - Removed smoothness boost multiplier (redundant with long grains)
   - Pure overlap-based calculation: grainRate = overlapFactor / grainLength
   - 85% reduction in grain count at high trail settings

---

## Summary of Current Data Flow Issues

### ⚠️ Critical Violations:

1. **Physics → Audio Direct Call**
   - Location: [physics-engine.js:132](js/physics/physics-engine.js#L132)
   - `sendParticleDataToAudio()` called directly
   - Should use event emission or callback

2. **Circular Import: audio-engine ↔ audio-system**
   - Location: [audio-engine.js:7](js/audio/audio-engine.js#L7), [audio-engine.js:89](js/audio/audio-engine.js#L89)
   - audio-engine imports and calls AudioSystem.updateParameters()
   - Should be called from AudioSystem.init() instead

3. **Physics Direct DOM Access**
   - render() function (lines 192-254)
   - animate() performance updates (lines 277-303)
   - updateVoiceSliders() (lines 82-109)
   - Should be extracted to separate renderer/UI modules

### 🟡 Architectural Issues:

4. **Global CONFIG as Shared Mutable State**
   - All modules read and write CONFIG directly
   - No change tracking or validation
   - Makes debugging difficult

5. **No Event Bus / Observer Pattern**
   - State changes don't notify interested parties
   - Modules poll CONFIG on every frame
   - Inefficient and error-prone

6. **UI Update Responsibilities Scattered** (Partially Resolved)
   - Physics updates performance displays
   - ✅ FIXED (2025-10-05): Species color updates now fully owned by UI module
   - ✅ FIXED (2025-10-05): Audio module no longer manages cross-module UI updates
   - Audio still updates waveform canvases (acceptable - audio-specific UI)
   - Should extract performance displays from physics to UI module

---

## Recommended Data Flow Architecture (Phase 3)

### Event-Based Communication:

```javascript
// EventBus (to be created in Phase 3)
const eventBus = {
    on(event, handler),
    off(event, handler),
    emit(event, data)
};

// Physics emits
eventBus.emit('particles:updated', particleData);
eventBus.emit('performance:metrics', metrics);
eventBus.emit('simulation:paused', isPaused);

// Audio listens
eventBus.on('particles:updated', (data) => processAudio(data));
eventBus.on('simulation:paused', (paused) => updateWorklet(paused));

// UI listens
eventBus.on('performance:metrics', (metrics) => updateDisplay(metrics));
```

### Benefits:
- ✅ No circular dependencies
- ✅ Modules decoupled
- ✅ Easy to add new listeners
- ✅ Testable in isolation
- ✅ Clear data flow

---

## Data Flow Validation Checklist

For each data flow path, verify:

- [ ] Does it cross module boundaries appropriately?
- [ ] Does it use public APIs (not internal functions)?
- [ ] Does it avoid circular dependencies?
- [ ] Is the data validated before use?
- [ ] Are side effects clearly documented?
- [ ] Can the flow be tested in isolation?

---

## Next Steps (Phase 2 Completion)

1. ✅ Document current data flows (this file)
2. ⏳ Fix circular dependency (audio-engine ↔ audio-system)
3. ⏳ Extract rendering from physics-engine
4. ⏳ Remove direct audio calls from physics
5. ⏳ Document all public APIs with JSDoc

Phase 3 will introduce event bus and consolidate initialization.
