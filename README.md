# Granular Particle Synthesizer - Modular Architecture

A sophisticated granular particle synthesizer with physics simulation, completely compartmentalized from a single 5000+ line HTML file into a modular, maintainable codebase.

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies (Node.js 14+ required)
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
```

### GitHub Pages Deployment

**Live Site:** https://the-soundery.github.io/Granular-Synth-Audio-Development/

This project uses a **two-branch deployment system**:
- **`main` branch** = Development code (includes build scripts, deploy tools, documentation)
- **`gh-pages` branch** = Production deployment (only runtime files: HTML, JS, CSS)

**⚠️ Important:** Changes to `main` branch do NOT automatically update the live site. You must manually run `npm run deploy` after every change you want to publish.

#### First-Time Setup

```bash
# 1. Connect to your GitHub repository (if not already connected)
git remote add origin https://github.com/The-Soundery/Granular-Synth-Audio-Development.git
git push -u origin main

# 2. Deploy to GitHub Pages
npm run deploy

# Your site will be live at:
# https://the-soundery.github.io/Granular-Synth-Audio-Development/
```

**After first deployment**, verify GitHub Pages settings:
1. Go to https://github.com/The-Soundery/Granular-Synth-Audio-Development/settings/pages
2. Source should be set to `gh-pages` branch (auto-configured)
3. Wait 1-2 minutes for initial deployment to complete

## 📁 Project Structure

```
Granular Particle Synth Project Folder/
├── index.html              # Main HTML structure
├── build.js                # Development server
├── package.json            # Project configuration
├── styles/
│   └── main.css            # Complete CSS (~700 lines)
├── js/
│   ├── main.js             # Application entry point
│   ├── config.js           # Configuration and global state
│   ├── utils.js            # Utility functions
│   │
│   ├── shared/             # Shared utility modules
│   │   ├── dom-utils.js        # Safe DOM operations
│   │   ├── event-manager.js    # Memory-safe event handling
│   │   ├── validation-utils.js # Math validation utilities
│   │   └── event-bus.js        # Event-based communication
│   │
│   ├── physics/            # Physics simulation modules
│   │   ├── physics-engine.js   # Main physics loop (DOM-free)
│   │   ├── spatial-grid.js     # O(N) optimization system
│   │   └── particle.js         # Particle and TrailParticle classes
│   │
│   ├── rendering/          # Rendering layer
│   │   └── physics-renderer.js # Canvas rendering (separated from physics)
│   │
│   ├── audio/              # Complete audio system
│   │   ├── audio-system.js          # Main AudioSystem API
│   │   ├── audio-engine.js          # AudioContext management
│   │   ├── worklet-processor.js     # Granular synthesis processor (~1300 lines)
│   │   ├── parameter-manager.js     # Event-driven parameter updates
│   │   ├── sample-manager.js        # File loading and UI controls
│   │   └── frequency-band-processor.js # Pre-filtered frequency bands
│   │
│   ├── ui/                 # Complete UI system
│   │   ├── ui-system.js        # Main UI coordinator
│   │   ├── slider-controls.js  # Slider and draggable number controls
│   │   ├── force-matrix.js     # Interactive force matrix and species tabs
│   │   ├── tab-system.js       # Tab navigation and collapsible sections
│   │   ├── keyboard-shortcuts.js # Keyboard navigation system
│   │   ├── preset-system.js    # Save/load/import/export presets
│   │   ├── audio-controls.js   # Audio parameter controls and visualization
│   │   ├── canvas-interaction.js # Mouse and canvas interactions
│   │   └── performance-display.js # Event-driven performance metrics
│   │
│   ├── MODULE_CONTRACTS.md     # Module interface documentation
│   └── DATA_FLOW.md            # Data flow patterns and scenarios
```

## 🔧 System Architecture

### Core Systems

1. **Physics Engine** (`js/physics/`)
   - Real-time particle simulation with O(N) spatial optimization
   - Species-based force relationships and interactions
   - Trail particle system with motion blur effects
   - Toroidal space and gravity point interactions
   - Event-driven architecture (no direct DOM access)

2. **Audio System** (`js/audio/`)
   - Complete granular synthesis engine using AudioWorklet
   - **Motion-driven grain spawning** - Only moving particles produce sound
   - **Pre-filtered frequency bands** - Eliminates runtime filtering for 20-30% CPU reduction
   - **Voice allocation system** - Visual feedback with velocity-based priority
   - **Audio crossfading** - Smooth, click-free voice transitions
   - Real-time parameter control and batch updates
   - **Tabbed audio interface** - Clean, organized per-species controls with mute functionality

3. **Rendering System** (`js/rendering/`)
   - Dedicated canvas rendering module
   - Visual feedback for voice allocation (brightness)
   - Smooth crossfade transitions
   - Trail particle rendering with motion blur

4. **UI System** (`js/ui/`)
   - Interactive force relationship matrix
   - Species management with color customization and mute controls
   - Tabbed audio interface with organized slider controls
   - Comprehensive preset system (save/load/import/export)
   - Keyboard shortcuts and canvas interactions
   - Event-driven performance display

### Key Features

- **Modular Architecture**: Each system is completely self-contained with clear interfaces
- **Event-Driven Communication**: EventBus decouples modules (zero circular dependencies)
- **ES6 Modules**: Modern import/export system for clean dependency management
- **Development Server**: Built-in HTTP server for testing and development
- **Complete Functionality**: All 5000+ lines from original HTML file preserved
- **Performance Optimized**: Spatial grid (O(N)), pre-filtered bands, optimized grain spawning

## 🎵 Audio System Details

### Granular Synthesis Features

- **Motion-driven grain spawning** - Grains spawn only when particles are moving (velocity threshold)
- **Trail-based smoothness control** - Trail length controls grain length and spawn rate for audio texture
- **Velocity-to-volume mapping** - Grain volume controlled by velocity curve power for clear audiovisual connection
- **Constant-power grain normalization** - Industry-standard 1/√N scaling prevents clipping while maintaining constant acoustic energy
- **Optimized grain spawning** - 60% reduction in grain spawn rate while maintaining audio quality:
  - Longer grain minimum: 50ms (smoother with fewer spawns)
  - Reduced overlap range: 1.3-1.8x (balanced smoothness and performance)
  - Lower spawn rate cap: 60 grains/sec (prevents CPU spikes)
- **Pitch shifting** - Per-species pitch control (±24 semitones / ±2 octaves) via playback rate modulation
- **Pre-filtered frequency bands** - Samples pre-processed at upload time:
  - Eliminates runtime filtering (20-30% CPU reduction)
  - Uses Web Audio API's GPU-accelerated filtering
  - Configurable number of bands (default: 10)
  - Trade-off: 10x memory usage for significant CPU savings
  - Processing time: 2-5 seconds per sample upload
- **Real-time frequency control** - Y position and particle size modulate frequency bands
- **Voice allocation system** - Visual feedback and CPU management with velocity-based priority
- **Real-time parameter mapping** - X position (sample playback), trail length (smoothness), velocity (volume)
- **Per-species audio parameters** - Independent volume, pitch, and voice limits for each species
- **Per-species mute control** - Visual toggle indicators (green = active, red = muted)

### Voice Allocation System with Audio Crossfading

The audio system implements **voice limiting with smooth audio crossfading** where `maxVoices` controls both audio output and particle brightness with seamless transitions:

- **Voice Allocation Logic:**
  - When `maxVoices ≥ particleCount`: All particles allocated (all can make sound if moving)
  - When `maxVoices < particleCount`: Top N fastest particles allocated (velocity-based priority)
  - **Smart transition system**:
    - **User slider changes**: Apply immediately (~35ms total latency)
    - **Natural particle reordering**: Delayed by `voiceStealingDelay` (50ms default) to prevent flicker
    - **60fps sync**: Updates throttled to 16ms for smooth visual feedback
  - Visual feedback: Allocated particles are bright, non-allocated particles are dimmed

- **Audio Crossfading (Smooth Transitions):**
  - **Newly allocated particles**: Fade in from 0% → 100% volume over `voiceStealingCrossfade` duration
  - **De-allocated particles**: Fade out from 100% → 0% volume, continue spawning grains during fadeout
  - **Equal-power crossfade**: Uses √(progress) curves to maintain constant acoustic energy
  - **Configurable duration**: 10-500ms (default 50ms) for crossfade length
  - **Automatic cleanup**: fadeOut completes → crossfade entry deleted → grain timer deleted (no leaks)
  - **Result**: Click-free, spike-free voice transitions with proper resource cleanup

- **Audio Output (Motion-Driven):**
  - Only **allocated AND moving** particles produce audio grains (with crossfade volume applied)
  - Particles in fadeOut state continue spawning grains at decreasing volume until crossfade completes
  - Allocated but still particles appear bright but produce no sound (motion threshold check)
  - **Direct audio connection**: Reducing maxVoices smoothly reduces audio complexity/volume

**Example:**
- 50 particles, user adjusts `maxVoices` slider from 50 → 10:
  - **Immediate response**: Change applied within ~35ms
  - **During 50ms crossfade**: 40 particles fade out (bright→dim, loud→quiet), 10 particles fade in (dim→bright, quiet→loud)
  - **After crossfade**: Only 10 fastest particles are bright and making sound
  - **No volume spikes**: Equal-power crossfade maintains constant total energy

### Audio Interface

The audio control interface features a **tabbed design** for clean, organized per-species control:

- **Species Tabs**: Click tabs to switch between species audio controls
- **Mute Toggle**: Colored circle indicators on each tab
  - 🟢 **Green** = Species active (producing sound)
  - 🔴 **Red** = Species muted (silent)
  - Click to toggle mute state for individual species
- **Vertical Slider Layout**: All controls aligned for easy reading
  - **Volume** (-60 to +12 dB) - Professional dB scale for precise volume control (0dB = unity gain)
  - **Pitch** (-24 to +24 semitones) - Sample playback rate adjustment (±2 octaves)
  - **Max Voices** (1 to particle count) - CPU management and voice limiting
- **Master Volume** (-40 to +12 dB) - Global volume control with dB scale
- **Waveform Display**: Visual representation of loaded audio sample (100px height)
- **Value Alignment**: All numeric values right-aligned in a consistent column

### Supported Audio Formats

- WAV, MP3, MP4, OGG, WebM, FLAC
- Maximum file size: 50MB
- Maximum duration: 60 seconds
- Automatic sample rate conversion

## 🎮 Controls

### Audio Engine Initialization

**IMPORTANT:** All audio controls are **disabled (grayed out)** until you click the **"Start Audio Engine"** button in the Audio & Synthesis tab. This helps users understand that starting the audio engine is essential before making any audio-related changes.

- Click **"Start Audio Engine"** to initialize the Web Audio API and enable all audio controls
- Once started, all sliders, toggles, file inputs, and audio parameters become interactive
- Click **"Stop Audio Engine"** to shutdown audio and re-disable all controls

### Keyboard Shortcuts

- `Space` - Pause/Resume simulation
- `R` - Reset simulation
- `1-8` - Select species tabs
- `H` - Toggle keyboard shortcuts display
- `A` - Switch to audio tab

### Mouse Interactions

- **Force Matrix**: Drag cells to adjust force relationships
- **Draggable Numbers**: Drag values to adjust parameters
- **Canvas**: Click and drag for gravity point (when gravity enabled)
- **Mute Toggle**: Click colored circles on audio species tabs to mute/unmute individual species

### Physics Parameters

- **Friction**: Particle velocity damping
- **Force Radius**: Maximum interaction distance
- **Simulation Speed**: Overall simulation speed multiplier
- **Gravity Strength**: Attraction to mouse cursor
- **Bounce Damping**: Energy loss on wall collisions
- **Toroidal Space**: Wrap-around boundaries

### Advanced Physics Features

The physics system includes **5 advanced features** inspired by particle-life simulations for more complex emergent behaviors:

#### 1. **Piecewise Force Curves** (`forceCurveMode: 'piecewise'`)

Creates distinct interaction zones with natural equilibrium distances:
- **Repulsion Zone (0-20%)**: Strong repulsion when particles are too close
- **Attraction Zone (20-80%)**: Primary interaction region where forces balance
- **Weak Zone (80-100%)**: Gradual force decay at distance

```javascript
CONFIG.physics.forceCurveMode = 'piecewise';
CONFIG.physics.piecewise.repulsionZone = 0.2;
CONFIG.physics.piecewise.attractionZone = 0.8;
```

#### 2. **Beta Function Force Curves** (`forceCurveMode: 'beta'`)

Smooth attraction/repulsion with configurable equilibrium point:
- Creates orbital behaviors and stable clustering
- Adjustable power curve for sharp or gradual transitions

```javascript
CONFIG.physics.forceCurveMode = 'beta';
CONFIG.physics.beta.equilibriumDistance = 0.5; // Balance point
CONFIG.physics.beta.power = 2.3; // Curve sharpness
```

#### 3. **Velocity Verlet Integration** (`useVerletIntegration: true`)

More accurate physics simulation with better energy conservation:
- Reduces numerical drift over long simulations
- More stable at high simulation speeds
- Slightly slower than Euler but more realistic

```javascript
CONFIG.physics.useVerletIntegration = true;
```

#### 4. **Dynamic Friction** (`useDynamicFriction: true`)

Velocity-dependent drag that prevents runaway speeds:
- Faster particles experience more friction
- Creates more realistic damping behavior
- Helps stabilize chaotic systems

```javascript
CONFIG.physics.useDynamicFriction = true;
CONFIG.physics.dynamicFrictionScale = 0.001;
```

#### 5. **Orbital Mechanics** (`enableOrbitalForces: true`)

Tangential forces that create rotation and vortex patterns:
- Particles can orbit each other instead of just attracting/repelling
- Creates spiral patterns and rotating clusters
- Adjustable orbital strength

```javascript
CONFIG.physics.enableOrbitalForces = true;
CONFIG.physics.orbitalStrength = 0.1;
```

#### Force Curve Comparison

| Mode | Best For | Characteristics |
|------|----------|----------------|
| `classic` | Simple behaviors | Smooth quadratic falloff, predictable |
| `piecewise` | Life-like patterns | Distinct zones, natural clustering |
| `beta` | Orbital systems | Smooth equilibrium, stable orbits |

**Try These Combinations:**
- **Stable Clusters**: `piecewise` + `useDynamicFriction`
- **Orbital Systems**: `beta` + `enableOrbitalForces`
- **Accurate Simulation**: `useVerletIntegration` + `useDynamicFriction`
- **Chaotic Energy**: `piecewise` + `enableOrbitalForces` + high force values

## 🔄 Deployment Architecture

### Two-Branch System

This project uses a **dual-branch deployment strategy** to separate development from production:

| Branch | Purpose | Contains | Deployed To |
|--------|---------|----------|-------------|
| `main` | Development | All source files, build scripts, deploy tools, docs, package.json | GitHub repository only |
| `gh-pages` | Production | **Only** runtime files: index.html, js/, styles/, favicon.ico, .nojekyll | GitHub Pages (live site) |

### Why Manual Deployment?

**Changes to `main` do NOT automatically update the live site.** This design is intentional:

✅ **Benefits:**
- Test changes locally (`npm run dev`) before publishing
- Prevent accidental broken deployments
- Control exactly when updates go live
- Keep development files (build.js, deploy.sh) out of production
- Maintain clean production branch with only essential files

❌ **What NOT to do:**
- Don't manually edit `gh-pages` branch (it gets force-pushed)
- Don't expect `git push` to update the live site
- Don't commit directly to `gh-pages` (changes will be overwritten)

### What Gets Deployed

The `deploy.sh` script copies **only these files** to `gh-pages`:
- `index.html` - Main application
- `js/` - All JavaScript modules (flattened structure)
- `styles/main.css` - Stylesheet (moved to root as `main.css`)
- `favicon.ico` - Site icon
- `.nojekyll` - Tells GitHub not to process with Jekyll

**Excluded from deployment:**
- `build.js` - Development server (not needed in production)
- `deploy.sh` - Deployment script
- `package.json` - npm configuration
- `README.md` - Documentation
- `node_modules/` - Dependencies (if any)

## 📦 Deployment Workflow

### Making Changes and Deploying

**Complete workflow** for updating the live site:

```bash
# 1. Make your changes to the code
# Edit any files in js/, styles/, index.html, etc.

# 2. Test locally
npm run dev
# Open http://localhost:3000 and verify changes work

# 3. Commit changes to main branch
git add .
git commit -m "Description of your changes"
git push origin main

# 4. Deploy to GitHub Pages
npm run deploy
# This creates a new commit on gh-pages and pushes it

# 5. Verify deployment
# Wait 1-2 minutes, then visit:
# https://the-soundery.github.io/Granular-Synth-Audio-Development/
```

### Quick Reference

```bash
# Development workflow
npm run dev              # Start local server (http://localhost:3000)
git add . && git commit  # Commit to main branch
git push origin main     # Push to GitHub

# Deployment workflow
npm run deploy           # Deploy to GitHub Pages (updates live site)
```

### What `npm run deploy` Does

The deployment script performs these steps automatically:

1. ✅ **Safety check** - Warns if you have uncommitted changes
2. 📦 **Package files** - Copies only production files to temp directory
3. 🔀 **Switch branches** - Checks out `gh-pages` (creates if needed)
4. 🗑️ **Clean old deployment** - Removes previous files from `gh-pages`
5. 📋 **Copy new files** - Moves packaged files to `gh-pages`
6. 💾 **Commit** - Creates timestamped commit on `gh-pages`
7. 📤 **Push** - Force-pushes to `origin/gh-pages`
8. 🔙 **Return** - Switches back to your original branch
9. 🧹 **Cleanup** - Removes temporary files

**Result:** Live site updates in 1-2 minutes with your latest changes.

## 🔧 Troubleshooting Deployment

### Common Issues

#### "Your site is not published yet"
**Cause:** GitHub Pages hasn't finished building
**Solution:** Wait 1-2 minutes and refresh. Check Settings > Pages for status.

#### "404 Not Found" on live site
**Cause:** GitHub Pages source not configured correctly
**Solution:**
1. Go to Settings > Pages
2. Ensure source is set to `gh-pages` branch
3. Ensure "root" folder is selected (not `/docs`)

#### Deploy script shows "No changes to commit"
**Cause:** No files changed since last deployment
**Solution:** This is normal. The script didn't push anything because there's nothing new.

#### Files missing on live site
**Cause:** Files not copied by deploy script
**Solution:** Check `deploy.sh` line 37. Add missing files/folders to the `cp -r` command.

#### Permission denied when pushing
**Cause:** Git authentication issue
**Solution:**
```bash
# Verify remote is correct
git remote -v

# Re-authenticate if needed
git push origin gh-pages  # Follow GitHub prompts
```

#### Changes deployed but not showing up
**Cause:** Browser cache
**Solution:** Hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows) or open in private/incognito window.

### Verification Checklist

After deploying, verify:

- [ ] Deployment script completed without errors
- [ ] GitHub shows recent commit on `gh-pages` branch
- [ ] Settings > Pages shows "Your site is live at..."
- [ ] Live URL loads without 404 errors
- [ ] Audio engine starts correctly
- [ ] Physics simulation runs smoothly
- [ ] All UI controls work (tabs, sliders, presets)
- [ ] Console shows no JavaScript errors

### Rolling Back a Deployment

If you deployed a broken version:

```bash
# 1. Find the last working commit on gh-pages
git checkout gh-pages
git log  # Note the commit hash of the working version

# 2. Reset to that commit
git reset --hard <commit-hash>

# 3. Force push
git push origin gh-pages --force

# 4. Return to main
git checkout main
```

## 📊 Performance Features

### Optimization Systems

- **Spatial Grid**: O(N) complexity for particle interactions (eliminates O(N²) brute force)
- **Pre-Filtered Frequency Bands**: 20-30% CPU reduction by eliminating runtime filtering
- **Optimized Grain Spawning**: 60% reduction in grain spawn rate while maintaining quality
- **Voice Allocation**: Velocity-prioritized voice limiting with visual feedback
- **Batch Updates**: Reduced AudioWorklet message overhead
- **Event-Driven Architecture**: Efficient module communication

### Debug Information

- Real-time particle count display
- Audio voice activity monitoring
- Volume level metering with accurate pre-limiter peak detection (0-100% range, color-coded warnings)
- Performance metrics (FPS, frame time, audio CPU)
- Browser console logging with detailed system status

## 🛠️ Development

### Adding New Features

1. **Audio Effects**: Extend `worklet-processor.js` with new synthesis techniques
2. **Physics Forces**: Add new force types in `physics-engine.js`
3. **UI Components**: Create new modules in `js/ui/` directory
4. **Preset Parameters**: Extend `preset-system.js` with new state properties

### Testing

```bash
# Start development server
npm run dev

# Test in browser at http://localhost:3000
# Check browser console for any module loading errors
# Verify all functionality matches original HTML file
```

### Building

The project uses static files and doesn't require a build step. All files are served directly by the development server.

## 📈 Technical Specifications

- **Lines of Code**: 5000+ (original single file)
- **Modules**: 18+ separate, focused modules
- **Audio Worklet**: ~1300 lines of granular synthesis code
- **UI Components**: Complete interactive interface system
- **Physics Engine**: Real-time particle simulation with optimization
- **Browser Support**: Modern browsers with Web Audio API and AudioWorklet support

## ✨ Architecture Features

### Modular Design

The system is organized into focused, single-responsibility modules:

- **Shared Utilities** (`js/shared/`)
  - `dom-utils.js` - Safe DOM access with null checks
  - `event-manager.js` - EventListenerManager for automatic cleanup
  - `validation-utils.js` - Math validation and clamping utilities
  - `event-bus.js` - Event-based communication system

- **Event-Driven Communication**
  - EventBus decouples modules (zero circular dependencies)
  - Type-safe event names with `Events` enum
  - Clear data flow patterns
  - Debug logging and error handling

- **Separation of Concerns**
  - Physics engine is 100% DOM-free (testable without browser)
  - Rendering separated into dedicated module
  - Audio system manages synthesis, not UI
  - UI system handles all DOM updates

### Key Architectural Achievements

- ✅ Zero circular dependencies
- ✅ Physics runs without DOM access
- ✅ Event-based communication (loose coupling)
- ✅ Comprehensive documentation (MODULE_CONTRACTS.md, DATA_FLOW.md)
- ✅ Reusable shared utilities (470 lines)
- ✅ Clear separation: Physics → Renderer → UI
- ✅ JSDoc documentation for all public APIs

## 🎯 Migration Notes

This modular version maintains 100% functional compatibility with the original single HTML file while providing:

- **Maintainability**: Clear separation of concerns across focused modules
- **Extensibility**: Easy to add new features without touching existing code
- **Debuggability**: Isolated systems with comprehensive error handling
- **Performance**: Optimized loading and execution with modern ES6 modules
- **Testability**: DOM-free physics engine, event-driven architecture
- **Documentation**: Complete API docs, data flow diagrams, and contracts

## 📚 Architecture Documentation

**Essential Reference Documents:**
- **[MODULE_CONTRACTS.md](js/MODULE_CONTRACTS.md)** - Module interface contracts, public APIs, and communication patterns
- **[DATA_FLOW.md](js/DATA_FLOW.md)** - Complete data flow documentation with key scenarios

These documents serve as living documentation for maintaining clean architecture and module boundaries.

## 🚀 Future Enhancements

The clean, event-driven architecture enables easy addition of:
- **TypeScript Integration** - Add type safety with interface definitions
- **Unit Testing** - Test physics engine without browser (now DOM-free!)
- **Additional Synthesis** - Extend granular engine with new techniques
- **Physics Features** - New force types, collision behaviors
- **Enhanced UI** - Additional visualizations and controls
- **Collaboration** - Real-time multi-user features
- **Preset Sharing** - Cloud-based preset library

---

**Original HTML File**: `Granular-Particle-Sim-Synth.html` (preserved for reference)
**Development Server**: http://localhost:3000 (when running `npm run dev`)
**Module Count**: 18+ focused, single-responsibility modules
**Total Functionality**: 100% preserved + improved architecture
