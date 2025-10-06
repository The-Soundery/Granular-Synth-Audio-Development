/**
 * Granular Particle Synthesizer Configuration
 * Contains all application settings, constants, and global state
 */

export const CONFIG = {
    // Canvas settings
    canvas: {
        width: 800,
        height: 600
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
        // Per-species volume adjustments (0.1 to 2.0)
        sampleVolumes: [1, 1, 1, 1, 1, 1, 1, 1],
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
        grainLengthMin: 0.02,    // 20ms - short stutter grains
        grainLengthMax: 0.5,     // 500ms - long smooth drones

        // Overlap factor range (controls grain spawn rate via overlapFactor / grainLength)
        overlapMin: 0.5,         // minimal overlap, stutter effect
        overlapMax: 4.0,         // heavy overlap, smooth texture

        // Motion detection
        velocityThreshold: 0.01, // minimum velocity for grain spawning
        maxVelocity: 3.0,        // expected maximum velocity
        maxGrainRate: 200.0,     // Hz, safety cap for grain spawn rate

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
        bandwidthRefHz: 1000,     // reference bandwidth for amplitude normalization (Hz)

        // Mixing
        softLimiterThreshold: 0.8, // soft limiting threshold
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