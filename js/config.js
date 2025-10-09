/**
 * Granular Particle Synthesizer Configuration
 * Contains all application settings, constants, and global state
 */

export const CONFIG = {
    // Canvas settings
    canvas: {
        width: 800,
        height: 600,
        backgroundColor: '#000000' // Canvas background color (default black)
    },

    // Species settings
    species: {
        count: 2,
        maxCount: 8,
        colors: [
            [1.0, 0.27, 0.27], [0.27, 0.27, 1.0], [0.27, 1.0, 0.27], [1.0, 1.0, 0.27],
            [1.0, 0.27, 1.0], [0.27, 1.0, 1.0], [1.0, 0.5, 0.0], [0.5, 0.0, 1.0]
        ],
        sizes: [8, 8, 8, 8, 8, 8, 8, 8],
        counts: [20, 20, 20, 20, 20, 20, 20, 20],
        trailLengths: [0.05, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        // Audio settings for each species
        audioBuffers: [null, null, null, null, null, null, null, null],
        sampleRanges: [
            {start: 0, end: 1}, {start: 0, end: 1}, {start: 0, end: 1}, {start: 0, end: 1},
            {start: 0, end: 1}, {start: 0, end: 1}, {start: 0, end: 1}, {start: 0, end: 1}
        ],
        // Per-species volume adjustments in dB (-60 to +12)
        sampleVolumes: [0, 0, 0, 0, 0, 0, 0, 0],
        // Per-species pitch adjustments in semitones (-12 to +12)
        samplePitches: [0, 0, 0, 0, 0, 0, 0, 0],
        // Per-species voice limits for CPU management
        maxVoicesPerSpecies: [20, 20, 20, 20, 20, 20, 20, 20],
        // Per-species mute state (true = muted, false = active)
        mutedSpecies: [false, false, false, false, false, false, false, false]
    },

    // Physics settings
    physics: {
        friction: 0.95,
        maxForceDistance: 100,
        simulationSpeed: 1.0,
        toroidalSpace: true,
        gravityStrength: 2.0,
        bounceDamping: 0.8,
        maxSpeed: 3,
        audioScaleFactor: 4,  // Reduced for better dynamic range and curve response

        // Advanced force curve options
        forceCurveMode: 'piecewise', // Options: 'classic', 'piecewise', 'beta'

        // Piecewise force curve settings (used when forceCurveMode = 'piecewise')
        piecewise: {
            repulsionZone: 0.2,      // 0-20% of maxForceDistance = strong repulsion
            attractionZone: 0.8,     // 20-80% = attraction/transition zone
            repulsionStrength: 2.0,  // Multiplier for repulsion force
            attractionStrength: 1.0  // Multiplier for attraction force
        },

        // Beta function force curve settings (used when forceCurveMode = 'beta')
        beta: {
            power: 2.3,              // Curve shape (higher = sharper transition)
            equilibriumDistance: 0.5 // Balance point (0-1 normalized)
        },

        // Integration method
        useVerletIntegration: false,  // true = Verlet (accurate), false = Euler (fast)

        // Dynamic friction
        useDynamicFriction: false,    // Enable velocity-dependent friction
        dynamicFrictionScale: 0.001,  // How much velocity affects friction

        // Orbital mechanics
        enableOrbitalForces: false,   // Enable tangential forces for orbits/vortices
        orbitalStrength: 0.1          // Strength of orbital force component
    },

    // Motion-driven granular synthesis parameters
    granular: {
        // Grain length range (seconds)
        // PHASE 2 OPTIMIZATION: Longer grains = smoother with fewer spawns
        grainLengthMin: 0.05,    // 50ms - longer minimum for better CPU (was 0.03)
        grainLengthMax: 0.5,     // 500ms - long smooth drones

        // Overlap factor range (controls grain spawn rate via overlapFactor / grainLength)
        // PHASE 2 OPTIMIZATION: Further reduced for aggressive CPU savings
        overlapMin: 1.3,         // 1.3x overlap - slightly smoother at low trails
        overlapMax: 1.8,         // 1.8x overlap - less CPU at high trails, still smooth

        // Motion detection
        // PHASE 3 OPTIMIZATION: Threshold skips nearly-still particles + gain ramping for soft start
        velocityThreshold: 0.03, // minimum velocity for grain spawning (was 0.01, tried 0.05)
        maxVelocity: 3.0,        // expected maximum velocity
        maxGrainRate: 60.0,      // Hz, aggressive cap for grain spawn rate (was 100.0)

        // Gain and release
        gainPowerDefault: 1.5,   // default power curve for velocity→gain
        releaseTimeMin: 0.02,    // 20ms quick release
        releaseTimeMax: 0.3,     // 300ms smooth fade

        // Windowing
        windowSigmaFactor: 0.25, // Gaussian window width factor

        // Frequency band mapping
        freqRangeMin: 20.0,       // Hz, minimum frequency (full audible spectrum)
        freqRangeMax: 15000.0,    // Hz, maximum frequency
        freqGamma: 0.6,           // Low-end emphasis (< 1.0 extends low-freq resolution)
        bandwidthOctavesMax: 4.0, // maximum bandwidth in octaves

        // PHASE 3 OPTIMIZATION: Pre-filtered frequency bands
        usePreFilteredBands: true,  // Enable pre-filtered audio bands (eliminates runtime filtering)
        numFrequencyBands: 10,      // Number of frequency bands to pre-compute (10 = ~200 cent resolution)

        // Mixing (constant-power normalization prevents clipping, soft limiter is safety net)
        softLimiterThreshold: 0.8, // soft limiting threshold (rarely triggered)
        softLimiterGain: 1.25      // soft limiter output gain
    },

    // Force relationship matrix
    relationships: [
        [-0.3, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [-0.5, -0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, -0.1, 0.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.0, -0.1, 0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.0, 0.0, -0.1, 0.0, 0.0],
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.1, 0.0],
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.1]
    ]
};

// Global state variables - direct access recommended (e.g., state.isPaused)
export const state = {
    particles: [],
    trailParticles: [],
    isPaused: false,
    spatialGrid: null,
    gravityPoint: { x: 0, y: 0, active: false },
    isMouseDown: false,
    currentSpeciesTab: 0,
    keyboardEnabled: true,
    showActiveVoices: true, // Toggle for voice activity visual feedback
    voiceStealingDelay: 50, // Voice stealing delay in milliseconds (1-500ms)
    voiceStealingCrossfade: 50 // Voice stealing crossfade duration in milliseconds (10-500ms)
};

// Audio Engine Variables
export const audioEngine = {
    context: null,
    workletNode: null,
    isActive: false,
    activeParticleCount: 0,
    voiceAllocations: new Map(), // species -> Set<particleId> - synced from worklet for visual feedback
    particleAudioCrossfade: new Map() // particleId -> {type, progress} - synced from worklet for visual feedback
};