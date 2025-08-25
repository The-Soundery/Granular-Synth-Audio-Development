// ===== AUDIO SYSTEM =====
// Granular synthesis engine for particle-driven audio

// Audio System Variables
let audioContext = null;
let masterGainNode = null;
let compressorNode = null;
let isAudioEnabled = false;
let isMasterMuted = false;
let masterVolume = 0.3;
let frequencyRange = { low: 80, high: 8000 };

// Global velocity controls
let globalVelocityGainCurve = 1.0; // Exponential curve for velocity->gain (0.1-3.0)
let globalVelocityThreshold = 0.0; // Minimum velocity to trigger audio (0.0-1.0)
let globalVelocityThresholdSquared = 0.0; // Cached squared threshold for performance
let audioFadeDuration = 0.05; // Fade duration in seconds for threshold transitions (50ms)

// Species audio synthesizers
let speciesAudioSynths = [];

// Audio triggering modes
const TRIGGER_MODES = {
    COLLISION: 'collision',
    LOOPING: 'looping'
};

// Base Grain Engine class
class GrainEngine {
    constructor(speciesIndex, audioContext, masterGain, mode) {
        this.speciesIndex = speciesIndex;
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        this.mode = mode;
        
        // Audio buffer
        this.audioBuffer = null;
        
        // Grain pool for performance
        this.grains = [];
        this.maxGrains = 50;
        
        // Audio processing parameters
        this.threshold = 0.1; // Trigger threshold (0-1)
        this.ratio = 2.0; // Compression ratio (1-10) - deprecated, replaced by smoothing
        this.smoothing = 0.0; // Smoothing factor (0-1) - creates soft threshold boundary
        this.attack = 0.01; // Attack time in seconds
        this.release = 0.1; // Release time in seconds
        this.makeupGain = 1.0; // Post-compression gain boost
        
        // State tracking
        this.activeGrains = 0;
        this.gainReduction = 0; // For visual feedback
        this.lastUpdate = 0;
    }
    
    // Abstract methods to be implemented by subclasses
    shouldTrigger(particle) {
        throw new Error('shouldTrigger must be implemented by subclass');
    }
    
    calculateGain(particle, inputLevel) {
        // Smoothed threshold calculation
        if (this.smoothing === 0.0) {
            // Hard threshold - traditional on/off behavior
            if (inputLevel <= this.threshold) {
                this.gainReduction = 0;
                return 0; // No audio below threshold
            }
            return inputLevel * this.makeupGain;
        } else {
            // Soft threshold with smoothing
            const smoothRange = this.smoothing * 0.5; // Smoothing extends 50% of smoothing value on each side
            const lowerBound = Math.max(0, this.threshold - smoothRange);
            const upperBound = Math.min(1, this.threshold + smoothRange);
            
            if (inputLevel <= lowerBound) {
                // Below smooth range - no audio
                this.gainReduction = 1.0;
                return 0;
            } else if (inputLevel >= upperBound) {
                // Above smooth range - full audio
                this.gainReduction = 0;
                return inputLevel * this.makeupGain;
            } else {
                // Within smooth range - fade in/out
                const fadePosition = (inputLevel - lowerBound) / (upperBound - lowerBound);
                const smoothedGain = this.smoothCurve(fadePosition);
                this.gainReduction = 1.0 - smoothedGain;
                return inputLevel * smoothedGain * this.makeupGain;
            }
        }
    }
    
    // Smooth curve function for threshold fading
    smoothCurve(t) {
        // Smooth step function for natural-sounding fade
        return t * t * (3 - 2 * t);
    }
    
    createGrain(particle, gainLevel) {
        if (!this.audioBuffer || this.grains.length >= this.maxGrains) return null;
        
        // Create audio nodes
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        const filterNode = this.audioContext.createBiquadFilter();
        const pannerNode = this.audioContext.createStereoPanner();
        
        // Setup audio graph
        source.buffer = this.audioBuffer;
        source.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(this.masterGain);
        
        // Configure filter
        filterNode.type = 'bandpass';
        filterNode.Q.value = 2;
        
        const grain = {
            source,
            gainNode,
            filterNode,
            pannerNode,
            particle,
            startTime: this.audioContext.currentTime,
            isPlaying: true,
            targetGain: gainLevel
        };
        
        // Configure initial parameters
        this.updateGrainParameters(grain, particle);
        
        this.grains.push(grain);
        return grain;
    }
    
    updateGrainParameters(grain, particle) {
        // Update audio parameters based on particle state
        const now = this.audioContext.currentTime;
        
        // Calculate frequency and bandwidth from Y position and size
        const invY = 1 - (particle.y / (typeof canvasHeight !== 'undefined' ? canvasHeight : 800));
        const logLow = Math.log(frequencyRange.low);
        const logHigh = Math.log(frequencyRange.high);
        const frequency = Math.exp(logLow + (invY * (logHigh - logLow)));
        
        // Map particle size to filter bandwidth
        const minSize = 2, maxSize = 10;
        const normalizedSize = Math.max(0, Math.min(1, (particle.size - minSize) / (maxSize - minSize)));
        const bandwidth = 12.0 - (normalizedSize * 11.0); // Smaller particles = narrower bands
        
        // Set filter parameters
        grain.filterNode.frequency.setTargetAtTime(frequency, now, 0.01);
        grain.filterNode.Q.setTargetAtTime(bandwidth, now, 0.01);
        
        // Set panning based on X position
        const pan = (particle.x / (typeof canvasWidth !== 'undefined' ? canvasWidth : 1200)) * 2 - 1;
        grain.pannerNode.pan.setTargetAtTime(pan, now, 0.01);
        
        // Apply gain with attack/release
        grain.gainNode.gain.setTargetAtTime(grain.targetGain, now, 
            grain.targetGain > grain.gainNode.gain.value ? this.attack : this.release);
    }
    
    removeGrain(grain) {
        const index = this.grains.indexOf(grain);
        if (index !== -1) {
            grain.isPlaying = false;
            this.grains.splice(index, 1);
        }
    }
    
    update(particles) {
        this.activeGrains = this.grains.length;
        
        // Update existing grains
        for (let i = this.grains.length - 1; i >= 0; i--) {
            const grain = this.grains[i];
            if (grain.particle && grain.isPlaying) {
                this.updateGrainParameters(grain, grain.particle);
            }
        }
    }
}

// Collision-based grain engine
class CollisionGrainEngine extends GrainEngine {
    constructor(speciesIndex, audioContext, masterGain) {
        super(speciesIndex, audioContext, masterGain, TRIGGER_MODES.COLLISION);
        
        // Collision-specific parameters
        this.collisionSpeciesMatrix = new Array(8).fill(true); // Which species trigger audio
        this.collisionSensitivity = 1.0; // Multiplier for collision force
        this.minimumCollisionForce = 0.05; // Minimum force to trigger
    }
    
    shouldTrigger(particle) {
        if (!particle.collisionEvents || particle.collisionEvents.length === 0) {
            return false;
        }
        
        // Check recent collisions with enabled species
        const recentCollisions = particle.collisionEvents.filter(event => 
            this.collisionSpeciesMatrix[event.otherSpecies] && 
            event.force >= this.minimumCollisionForce
        );
        
        // Debug logging for collision threshold
        if (particle.collisionEvents.length > 0 && Math.random() < 0.05) { // 5% chance for debug
            const maxForce = Math.max(...particle.collisionEvents.map(e => e.force));
            console.log(`🔍 Collision check - Species ${this.speciesIndex}, MaxForce: ${maxForce.toFixed(3)}, Threshold: ${this.minimumCollisionForce.toFixed(3)}, Triggered: ${recentCollisions.length > 0}`);
        }
        
        return recentCollisions.length > 0;
    }
    
    update(particles) {
        super.update(particles);
        
        // Find particles of this species
        const speciesParticles = particles.filter(p => p.species === this.speciesIndex);
        
        for (const particle of speciesParticles) {
            if (this.shouldTrigger(particle)) {
                // Calculate gain based on collision force
                const maxForce = Math.max(...particle.collisionEvents.map(e => e.force));
                const inputLevel = Math.min(1.0, maxForce * this.collisionSensitivity);
                const gainLevel = this.calculateGain(particle, inputLevel);
                
                // Debug logging
                if (Math.random() < 0.01) { // Log 1% of collision events to avoid spam
                    console.log(`✨ Collision grain - Species ${this.speciesIndex}, Force: ${maxForce.toFixed(3)}, Gain: ${gainLevel.toFixed(3)}`);
                }
                
                // Show collision pulse visualization
                if (typeof showCollisionPulse === 'function') {
                    const triggerSpecies = particle.collisionEvents.find(e => 
                        this.collisionSpeciesMatrix[e.otherSpecies] && 
                        e.force * this.collisionSensitivity >= this.minimumCollisionForce
                    )?.otherSpecies;
                    showCollisionPulse(this.speciesIndex, maxForce, triggerSpecies);
                }
                
                // Create grain if we don't already have one for this particle
                const existingGrain = this.grains.find(g => g.particle === particle);
                if (!existingGrain && gainLevel > 0.01) {
                    const grain = this.createGrain(particle, gainLevel);
                    if (grain) {
                        // Start playback
                        grain.source.start(this.audioContext.currentTime);
                        grain.source.stop(this.audioContext.currentTime + 0.2); // 200ms grain
                        
                        // Cleanup when finished
                        grain.source.onended = () => this.removeGrain(grain);
                    }
                }
            }
        }
    }
}

// Looping grain engine with crossfading
class LoopingGrainEngine extends GrainEngine {
    constructor(speciesIndex, audioContext, masterGain) {
        super(speciesIndex, audioContext, masterGain, TRIGGER_MODES.LOOPING);
        
        // Looping-specific parameters
        this.loopDirection = 'forward'; // 'forward', 'reverse', 'alternate'
        this.crossfadeAmount = 0.5; // 0-1, amount of crossfade between grains
        this.grainDuration = 0.1; // Base grain duration
        this.grainSpacing = 0.05; // Time between grain starts
        this.alternateState = 1; // For alternating direction
        this.velocityThreshold = 0.05; // Configurable velocity threshold
        
        // Per-particle grain scheduling
        this.particleGrains = new Map(); // particle -> grain info
    }
    
    shouldTrigger(particle) {
        // Trigger in looping mode if particle velocity is above threshold
        const velocity = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
        const normalizedVelocity = Math.min(1.0, velocity / 3.0); // Normalize to 0-1 range based on max velocity
        
        // Intuitive logic: lower threshold = more sound (trigger at lower velocities)
        // If threshold is 0.1, trigger when normalized velocity > 0.1
        return normalizedVelocity > this.velocityThreshold;
    }
    
    update(particles) {
        super.update(particles);
        
        const currentTime = this.audioContext.currentTime;
        const speciesParticles = particles.filter(p => p.species === this.speciesIndex);
        
        for (const particle of speciesParticles) {
            if (this.shouldTrigger(particle)) {
                const velocity = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
                const inputLevel = Math.min(1.0, velocity / 3.0); // Normalize to max velocity
                const gainLevel = this.calculateGain(particle, inputLevel);
                
                if (gainLevel > 0.01) {
                    // Check if we need to schedule a new grain for this particle
                    const grainInfo = this.particleGrains.get(particle);
                    const shouldScheduleNew = !grainInfo || 
                        (currentTime - grainInfo.lastGrainTime) >= this.grainSpacing;
                    
                    if (shouldScheduleNew) {
                        const grain = this.createLoopingGrain(particle, gainLevel);
                        if (grain) {
                            this.particleGrains.set(particle, {
                                lastGrainTime: currentTime,
                                currentGrain: grain
                            });
                        }
                    }
                }
            } else {
                // Remove particle from tracking if no longer active
                this.particleGrains.delete(particle);
            }
        }
    }
    
    createLoopingGrain(particle, gainLevel) {
        if (!this.audioBuffer || this.grains.length >= this.maxGrains) return null;
        
        const grain = this.createGrain(particle, gainLevel);
        if (!grain) return null;
        
        // Calculate sample position based on particle X
        const samplePosition = particle.x / (typeof canvasWidth !== 'undefined' ? canvasWidth : 1200);
        const startTime = samplePosition * this.audioBuffer.duration;
        
        // Determine playback direction and rate
        let playbackRate = 1.0;
        let actualStartTime = startTime;
        
        if (this.loopDirection === 'reverse') {
            playbackRate = -1.0;
        } else if (this.loopDirection === 'alternate') {
            playbackRate = this.alternateState;
            this.alternateState *= -1; // Toggle for next grain
        }
        
        // Apply crossfading envelope
        const fadeTime = this.grainDuration * this.crossfadeAmount * 0.5;
        const now = this.audioContext.currentTime;
        
        grain.gainNode.gain.setValueAtTime(0, now);
        grain.gainNode.gain.linearRampToValueAtTime(gainLevel, now + fadeTime);
        grain.gainNode.gain.setValueAtTime(gainLevel, now + this.grainDuration - fadeTime);
        grain.gainNode.gain.linearRampToValueAtTime(0, now + this.grainDuration);
        
        // Start playback
        grain.source.playbackRate.value = Math.abs(playbackRate);
        grain.source.start(now, actualStartTime, this.grainDuration);
        grain.source.stop(now + this.grainDuration);
        
        // Cleanup when finished
        grain.source.onended = () => this.removeGrain(grain);
        
        return grain;
    }
}

// Enhanced Granular Synthesizer Class with dual engine support
class GranularSynth {
    constructor(speciesIndex, audioContext, masterGain) {
        this.speciesIndex = speciesIndex;
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        
        // Audio graph (only create if audioContext exists)
        if (audioContext && masterGain) {
            this.gainNode = audioContext.createGain();
            this.gainNode.connect(masterGain);
            this.gainNode.gain.value = 0.7;
        } else {
            this.gainNode = null;
        }
        
        // Sample buffer and selection
        this.audioBuffer = null;
        this.fileName = '';
        this.sampleStart = 0.0; // Start position in sample (0-1)
        this.sampleEnd = 1.0;   // End position in sample (0-1)
        
        // Trigger mode and engines
        this.triggerMode = TRIGGER_MODES.LOOPING; // Default to looping mode
        this.collisionEngine = null;
        this.loopingEngine = null;
        this.currentEngine = null;
        
        // Legacy parameters (maintained for compatibility)
        this.loopMode = 'forward';
        this.pitch = 0; // Semitones (0-24)
        this.detune = 0; // Cents (0-50, randomized per grain)
        this.fadeLength = 0.002; // Crossfade length (1ms-20ms)
        
        // State
        this.isMuted = false;
        this.volume = 0.7;
        this.activeGrains = 0;
        
        // Initialize engines
        this.initializeEngines();
        
        console.log(`🎵 Enhanced granular synth created for Species ${String.fromCharCode(65 + speciesIndex)}`);
    }
    
    initializeEngines() {
        if (!this.audioContext || !this.gainNode) return;
        
        this.collisionEngine = new CollisionGrainEngine(this.speciesIndex, this.audioContext, this.gainNode);
        this.loopingEngine = new LoopingGrainEngine(this.speciesIndex, this.audioContext, this.gainNode);
        
        // Set current engine based on mode
        this.currentEngine = this.triggerMode === TRIGGER_MODES.COLLISION ? 
            this.collisionEngine : this.loopingEngine;
    }
    
    // Connect audio graph when context becomes available
    connectAudioGraph(audioContext, masterGain) {
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        
        if (!this.gainNode && audioContext && masterGain) {
            this.gainNode = audioContext.createGain();
            this.gainNode.connect(masterGain);
            this.gainNode.gain.value = this.volume || 0.7;
        }
        
        // Initialize engines with new context
        this.initializeEngines();
    }
    
    // Load audio sample
    async loadSample(arrayBuffer) {
        try {
            // If no audio context yet, create a temporary one for display purposes
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.rawAudioData = arrayBuffer;
                this.fileName = 'Sample loaded (awaiting audio start)';
                
                // Create temporary audioContext just for decoding and display
                try {
                    const tempContext = new (window.AudioContext || window.webkitAudioContext)();
                    this.audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0)); // Use copy of buffer
                    await tempContext.close(); // Clean up temporary context
                    console.log(`🎵 Sample decoded for display for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
                } catch (tempError) {
                    console.warn('Could not decode for display:', tempError);
                }
                
                return true;
            }
            
            // Make sure audioContext is in good state before decoding
            if (this.audioContext.state === 'suspended') {
                console.warn('AudioContext suspended, storing sample for later decode');
                this.rawAudioData = arrayBuffer;
                this.fileName = 'Sample loaded (awaiting audio start)';
                return true;
            }
            
            // Decode immediately if audio context exists and is running
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // Share audio buffer with engines
            if (this.collisionEngine) this.collisionEngine.audioBuffer = this.audioBuffer;
            if (this.loopingEngine) this.loopingEngine.audioBuffer = this.audioBuffer;
            
            console.log(`🎵 Sample loaded for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
            return true;
        } catch (error) {
            console.error('Audio decode error:', error);
            return false;
        }
    }
    
    // Decode stored audio data when audio context becomes available
    async decodeStoredAudio() {
        if (this.rawAudioData && this.audioContext) {
            try {
                // If we already have an audioBuffer from temp decode, re-decode with proper audioContext
                // This ensures the audioBuffer is compatible with the main audio system
                this.audioBuffer = await this.audioContext.decodeAudioData(this.rawAudioData);
                this.rawAudioData = null; // Clear raw data after decoding
                
                // Share audio buffer with engines
                if (this.collisionEngine) this.collisionEngine.audioBuffer = this.audioBuffer;
                if (this.loopingEngine) this.loopingEngine.audioBuffer = this.audioBuffer;
                
                console.log(`🎵 Re-decoded sample for audio system for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
                return true;
            } catch (error) {
                console.error('Stored audio decode error:', error);
                return false;
            }
        }
        return false;
    }
    
    // Set trigger mode (collision or looping)
    setTriggerMode(mode) {
        this.triggerMode = mode;
        
        // Ensure engines exist
        if (!this.collisionEngine || !this.loopingEngine) {
            this.initializeEngines();
        }
        
        this.currentEngine = mode === TRIGGER_MODES.COLLISION ? 
            this.collisionEngine : this.loopingEngine;
        
        // Share audio buffer and settings with new engine
        if (this.currentEngine && this.audioBuffer) {
            this.currentEngine.audioBuffer = this.audioBuffer;
        }
        
        console.log(`🎵 Species ${String.fromCharCode(65 + this.speciesIndex)} trigger mode: ${mode}`);
    }
    
    // Get current engine settings for UI
    getEngineSettings() {
        if (!this.currentEngine) return {};
        
        return {
            threshold: this.currentEngine.threshold,
            ratio: this.currentEngine.ratio,
            attack: this.currentEngine.attack,
            release: this.currentEngine.release,
            makeupGain: this.currentEngine.makeupGain,
            gainReduction: this.currentEngine.gainReduction,
            // Mode-specific settings
            ...(this.triggerMode === TRIGGER_MODES.COLLISION ? {
                collisionSpeciesMatrix: this.collisionEngine.collisionSpeciesMatrix,
                collisionSensitivity: this.collisionEngine.collisionSensitivity,
                minimumCollisionForce: this.collisionEngine.minimumCollisionForce
            } : {
                loopDirection: this.loopingEngine.loopDirection,
                crossfadeAmount: this.loopingEngine.crossfadeAmount,
                grainDuration: this.loopingEngine.grainDuration,
                grainSpacing: this.loopingEngine.grainSpacing
            })
        };
    }
    
    // Update engine settings from UI
    updateEngineSettings(settings) {
        if (!this.currentEngine) return;
        
        // Update common settings
        if (settings.threshold !== undefined) this.currentEngine.threshold = settings.threshold;
        if (settings.ratio !== undefined) this.currentEngine.ratio = settings.ratio; // Keep for backwards compatibility
        if (settings.smoothing !== undefined) this.currentEngine.smoothing = settings.smoothing;
        if (settings.attack !== undefined) this.currentEngine.attack = settings.attack;
        if (settings.release !== undefined) this.currentEngine.release = settings.release;
        if (settings.makeupGain !== undefined) this.currentEngine.makeupGain = settings.makeupGain;
        
        // Update mode-specific settings
        if (this.triggerMode === TRIGGER_MODES.COLLISION && this.collisionEngine) {
            // Map threshold to collision-specific parameters
            if (settings.threshold !== undefined) {
                this.collisionEngine.minimumCollisionForce = settings.threshold;
                console.log(`🎯 Collision threshold updated to: ${settings.threshold}`);
            }
            if (settings.collisionSpeciesMatrix) this.collisionEngine.collisionSpeciesMatrix = settings.collisionSpeciesMatrix;
            if (settings.collisionSensitivity !== undefined) this.collisionEngine.collisionSensitivity = settings.collisionSensitivity;
            if (settings.minimumCollisionForce !== undefined) this.collisionEngine.minimumCollisionForce = settings.minimumCollisionForce;
        } else if (this.triggerMode === TRIGGER_MODES.LOOPING && this.loopingEngine) {
            // Map threshold to looping-specific parameters  
            if (settings.threshold !== undefined) {
                this.loopingEngine.velocityThreshold = settings.threshold;
                console.log(`🎯 Looping velocity threshold updated to: ${settings.threshold}`);
            }
            if (settings.loopDirection) this.loopingEngine.loopDirection = settings.loopDirection;
            if (settings.crossfadeAmount !== undefined) this.loopingEngine.crossfadeAmount = settings.crossfadeAmount;
            if (settings.grainDuration !== undefined) this.loopingEngine.grainDuration = settings.grainDuration;
            if (settings.grainSpacing !== undefined) this.loopingEngine.grainSpacing = settings.grainSpacing;
        }
    }
    
    // Create and manage audio grain with crossfading (legacy method - now uses engines)
    createGrain(particle) {
        // Delegate to current engine
        return this.currentEngine ? this.currentEngine.createGrain(particle, 0.5) : null;
    }
    
    // Legacy create grain method (for backwards compatibility)
    createGrainLegacy(particle) {
        if (!this.audioBuffer || this.isMuted || !isAudioEnabled) return null;
        if (this.grains.length >= this.maxGrains) return null;
        
        // FAST velocity threshold check and fade state update
        const velocitySquared = particle.vx * particle.vx + particle.vy * particle.vy;
        const isAboveThreshold = velocitySquared >= globalVelocityThresholdSquared;
        
        // Update fade state efficiently (60fps = ~16.67ms per frame)
        const fadeStep = (1.0 / 60.0) / audioFadeDuration; // Fade step per frame at 60fps
        
        if (isAboveThreshold && !particle.wasAboveThreshold) {
            // Started crossing threshold - begin fade in
            particle.wasAboveThreshold = true;
        } else if (!isAboveThreshold && particle.wasAboveThreshold) {
            // Started crossing threshold - begin fade out  
            particle.wasAboveThreshold = false;
        }
        
        // Update fade state smoothly
        if (particle.wasAboveThreshold) {
            particle.audioFadeState = Math.min(1.0, particle.audioFadeState + fadeStep);
        } else {
            particle.audioFadeState = Math.max(0.0, particle.audioFadeState - fadeStep);
        }
        
        // Exit early if no volume (avoids creating audio nodes for silent particles)
        if (particle.audioFadeState <= 0.001) {
            return null;
        }
        
        // Only now create audio nodes (expensive operations) for audible particles
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        const filterNode = this.audioContext.createBiquadFilter();
        const pannerNode = this.audioContext.createStereoPanner();
        
        // Setup audio graph: source -> filter -> gain -> panner -> species gain
        source.buffer = this.audioBuffer;
        source.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(this.gainNode);
        
        // Configure filter for Y-axis frequency control
        filterNode.type = 'bandpass';
        filterNode.Q.value = 2;
        
        // Calculate parameters from particle (expensive operations only for audible particles)
        const sampleRange = this.sampleEnd - this.sampleStart;
        const samplePosition = this.sampleStart + (Math.max(0, Math.min(1, particle.x / canvasWidth)) * sampleRange);
        const { frequency, bandwidth } = this.calculateFrequencyAndBandwidth(particle.y / canvasHeight, particle.size);
        
        // Calculate velocity and apply gain curve + fade
        const velocity = Math.sqrt(velocitySquared);
        const MAX_SPEED = 3;
        const normalizedVelocity = Math.min(1, velocity / MAX_SPEED);
        const curvedVelocity = Math.pow(normalizedVelocity, globalVelocityGainCurve);
        const volume = curvedVelocity * this.volume * particle.audioFadeState; // Apply fade multiplier
        
        const grainDuration = this.mapTrailLengthToGrainDuration(particle);
        const pan = (particle.x / canvasWidth) * 2 - 1; // -1 (left) to +1 (right)
        
        // Calculate pitch adjustment (semitones + random detune)
        const semitoneRatio = Math.pow(2, this.pitch / 12); // Convert semitones to frequency ratio
        const randomDetuneCents = (Math.random() - 0.5) * 2 * this.detune; // Random detune in cents
        const detuneRatio = Math.pow(2, randomDetuneCents / 1200); // Convert cents to frequency ratio
        const totalPitchRatio = semitoneRatio * detuneRatio;
        
        // Enhanced crossfading parameters using fadeLength setting
        const crossfadeTime = this.fadeLength; // Use species-specific fade length
        const fadeInTime = Math.min(crossfadeTime, grainDuration * 0.1); // Max 10% of grain duration
        const fadeOutTime = Math.min(crossfadeTime, grainDuration * 0.1);
        
        // Calculate sample start/end positions based on loop mode with crossfading
        let startTime, endTime, playbackRate = 1;
        
        if (this.loopMode === 'forward') {
            startTime = samplePosition * this.audioBuffer.duration;
            endTime = Math.min(startTime + grainDuration, this.audioBuffer.duration);
        } else if (this.loopMode === 'reverse') {
            // Play backwards by setting negative playback rate
            startTime = samplePosition * this.audioBuffer.duration;
            endTime = Math.max(startTime - grainDuration, 0);
            playbackRate = -1;
            // For reverse playback, we need to start from the end position
            const temp = startTime;
            startTime = endTime;
            endTime = temp;
        } else if (this.loopMode === 'alternate') {
            // Alternate between forward and reverse for each grain with crossfade
            if (this.alternateDirection === 1) {
                // Forward
                startTime = samplePosition * this.audioBuffer.duration;
                endTime = Math.min(startTime + grainDuration, this.audioBuffer.duration);
                playbackRate = 1;
            } else {
                // Reverse
                startTime = samplePosition * this.audioBuffer.duration;
                endTime = Math.max(startTime - grainDuration, 0);
                playbackRate = -1;
                const temp = startTime;
                startTime = endTime;
                endTime = temp;
            }
            // Toggle direction for next grain
            this.alternateDirection *= -1;
        }
        
        // Set playback rate for direction and pitch
        source.playbackRate.value = Math.abs(playbackRate) * totalPitchRatio;
        
        // Enhanced gain envelope with smooth crossfading
        const now = this.audioContext.currentTime;
        const sustainTime = grainDuration - fadeInTime - fadeOutTime;
        
        // Start with zero gain
        gainNode.gain.setValueAtTime(0, now);
        
        // Fade in (prevents clicks)
        gainNode.gain.linearRampToValueAtTime(volume, now + fadeInTime);
        
        // Sustain level
        if (sustainTime > 0) {
            gainNode.gain.setValueAtTime(volume, now + fadeInTime + sustainTime);
        }
        
        // Fade out (prevents clicks)
        gainNode.gain.linearRampToValueAtTime(0, now + grainDuration);
        
        // Set frequency and bandwidth (Y-axis mapping + particle size)
        filterNode.frequency.setValueAtTime(frequency, now);
        filterNode.Q.setValueAtTime(bandwidth, now);
        
        // Set panning (X-axis mapping)
        pannerNode.pan.setValueAtTime(pan, now);
        
        // Create grain object
        const grain = {
            source,
            gainNode,
            filterNode,
            pannerNode,
            startTime: now,
            duration: grainDuration,
            particle: particle,
            isPlaying: true,
            playbackRate: playbackRate,
            fadeInTime: fadeInTime,
            fadeOutTime: fadeOutTime
        };
        
        // Start playback with proper timing
        const actualDuration = Math.abs(endTime - startTime);
        if (actualDuration > 0) {
            source.start(now, startTime, actualDuration);
            source.stop(now + grainDuration);
        } else {
            // Handle edge case where duration is zero
            return null;
        }
        
        // Cleanup when finished
        source.onended = () => {
            this.removeGrain(grain);
        };
        
        this.grains.push(grain);
        return grain;
    }
    
    // Remove grain from pool
    removeGrain(grain) {
        const index = this.grains.indexOf(grain);
        if (index !== -1) {
            this.grains.splice(index, 1);
            grain.isPlaying = false;
        }
    }
    
    // Update grain parameters based on particle movement
    updateGrain(grain, particle) {
        if (!grain.isPlaying) return;
        
        const now = this.audioContext.currentTime;
        const { frequency, bandwidth } = this.calculateFrequencyAndBandwidth(particle.y / canvas.height, particle.size);
        const velocity = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
        const volume = Math.min(1, velocity / MAX_SPEED) * this.volume;
        const pan = (particle.x / canvas.width) * 2 - 1; // -1 (left) to +1 (right)
        
        // Update frequency and bandwidth smoothly
        grain.filterNode.frequency.setTargetAtTime(frequency, now, 0.01);
        grain.filterNode.Q.setTargetAtTime(bandwidth, now, 0.01);
        
        // Update volume based on velocity
        grain.gainNode.gain.setTargetAtTime(volume, now, 0.01);
        
        // Update panning based on X position
        grain.pannerNode.pan.setTargetAtTime(pan, now, 0.01);
    }
    
    // Calculate frequency and bandwidth from Y position and particle size (narrower bands for smaller particles)
    calculateFrequencyAndBandwidth(normalizedY, particleSize) {
        // Invert Y (top = high frequency, bottom = low frequency)
        const invY = 1 - normalizedY;
        
        // Logarithmic scaling for musical frequency perception
        const logLow = Math.log(frequencyRange.low);
        const logHigh = Math.log(frequencyRange.high);
        const logFreq = logLow + (invY * (logHigh - logLow));
        const frequency = Math.exp(logFreq);
        
        // Map particle size to filter bandwidth - REVERSED: smaller particles = narrower bands
        const minSize = 2; // Minimum particle size
        const maxSize = 10; // Maximum particle size
        const normalizedSize = Math.max(0, Math.min(1, (particleSize - minSize) / (maxSize - minSize)));
        
        // Smaller particles = higher Q (narrower band), larger particles = lower Q (wider band)
        // Adjusted for narrower base frequency at size 2.0
        const minQ = 1.0; // Wide bandwidth for large particles
        const maxQ = 12.0; // Very narrow bandwidth for small particles (size 2.0)
        const bandwidth = maxQ - (normalizedSize * (maxQ - minQ));
        
        return { frequency, bandwidth };
    }
    
    // Map trail length to grain duration - direct mapping to 2ms-200ms range
    mapTrailLengthToGrainDuration(particle) {
        const speciesTrailLength = (typeof speciesTrailLengths !== 'undefined' ? speciesTrailLengths[particle.species] : null) || 0.5;
        
        const minDuration = 0.002; // 2ms
        const maxDuration = 0.2;   // 200ms
        
        // Direct linear mapping of species trail length (0-1) to grain duration (2ms-200ms)
        return minDuration + (speciesTrailLength * (maxDuration - minDuration));
    }
    
    // Update all grains for this species (now uses engine system)
    update(particles) {
        if (!this.currentEngine || this.isMuted || !isAudioEnabled) {
            this.activeGrains = 0;
            return;
        }
        
        // Update current engine
        this.currentEngine.update(particles);
        this.activeGrains = this.currentEngine.activeGrains;
    }
    
    // Set volume
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.gainNode.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.audioContext.currentTime, 0.01);
    }
    
    // Mute/unmute
    setMute(muted) {
        this.isMuted = muted;
        this.gainNode.gain.setTargetAtTime(muted ? 0 : this.volume, this.audioContext.currentTime, 0.01);
    }
    
    // Set loop mode
    setLoopMode(mode) {
        this.loopMode = mode;
        this.alternateDirection = 1; // Reset alternate direction
        console.log(`🎵 Species ${String.fromCharCode(65 + this.speciesIndex)} loop mode: ${mode}`);
    }
    
    // Stop all grains
    stopAll() {
        if (this.collisionEngine) {
            for (let grain of this.collisionEngine.grains) {
                if (grain.source && grain.isPlaying) {
                    grain.source.stop();
                }
            }
            this.collisionEngine.grains = [];
        }
        
        if (this.loopingEngine) {
            for (let grain of this.loopingEngine.grains) {
                if (grain.source && grain.isPlaying) {
                    grain.source.stop();
                }
            }
            this.loopingEngine.grains = [];
            this.loopingEngine.particleGrains.clear();
        }
    }
    
    // Legacy compatibility - expose grains property
    get grains() {
        return this.currentEngine ? this.currentEngine.grains : [];
    }
    
    // Legacy compatibility - expose maxGrains property
    get maxGrains() {
        return this.currentEngine ? this.currentEngine.maxGrains : 50;
    }
}

// Initialize Audio System
async function initAudioSystem() {
    // Prevent multiple initializations
    if (isAudioEnabled && audioContext && audioContext.state === 'running') {
        console.log('🎵 Audio system already initialized');
        return true;
    }
    
    try {
        // Only create new context if one doesn't exist or is closed
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Create master audio graph only if needed
        if (!masterGainNode || !compressorNode) {
            masterGainNode = audioContext.createGain();
            compressorNode = audioContext.createDynamicsCompressor();
            
            // Setup audio chain: species synths -> master gain -> compressor -> destination
            masterGainNode.connect(compressorNode);
            compressorNode.connect(audioContext.destination);
        }
        
        // Configure compressor for safety
        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 10;
        compressorNode.ratio.value = 8;
        compressorNode.attack.value = 0.001;
        compressorNode.release.value = 0.1;
        
        // Set master volume
        masterGainNode.gain.value = masterVolume;
        
        // Connect existing synths to audio context and decode any stored audio
        for (let i = 0; i < speciesAudioSynths.length; i++) {
            if (speciesAudioSynths[i]) {
                speciesAudioSynths[i].connectAudioGraph(audioContext, masterGainNode);
                // Decode any stored audio data
                await speciesAudioSynths[i].decodeStoredAudio();
            }
        }
        
        // Update waveforms for any newly decoded audio
        for (let i = 0; i < speciesAudioSynths.length; i++) {
            const synth = speciesAudioSynths[i];
            if (synth && synth.audioBuffer) {
                const waveformCanvas = document.getElementById(`waveform${i}`);
                if (waveformCanvas) {
                    const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
                    drawWaveform(synth.audioBuffer, waveformCanvas, currentSpeciesColors[i] || [1,1,1], i);
                }
                
                // Update file name
                const fileNameElement = document.getElementById(`fileName${i}`);
                if (fileNameElement && synth.fileName) {
                    fileNameElement.textContent = synth.fileName;
                }
            }
        }
        
        isAudioEnabled = true;
        updateAudioStatus('Ready');
        
        console.log('🎵 Audio system initialized successfully');
        return true;
        
    } catch (error) {
        console.error('Audio initialization failed:', error);
        updateAudioStatus('Failed');
        return false;
    }
}

// Initialize audio UI only (no audio context required)
function initAudioUI() {
    speciesAudioSynths = [];
    
    // Create UI-only synths (no audioContext)
    for (let i = 0; i < maxSpecies; i++) {
        const synth = new GranularSynth(i, null, null);
        speciesAudioSynths.push(synth);
    }
    
    // Generate species audio UI
    createSpeciesAudioControls();
    
    // Setup draggable numbers for species parameters
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
    
    console.log('🎵 Audio UI initialized (controls ready, audio awaiting start)');
}

// Initialize species synthesizers (preserves existing audio buffers)
function initSpeciesSynths() {
    const existingData = [];
    
    // Preserve existing audio data
    for (let i = 0; i < speciesAudioSynths.length; i++) {
        if (speciesAudioSynths[i]) {
            existingData[i] = {
                audioBuffer: speciesAudioSynths[i].audioBuffer,
                fileName: speciesAudioSynths[i].fileName,
                volume: speciesAudioSynths[i].volume,
                isMuted: speciesAudioSynths[i].isMuted,
                loopMode: speciesAudioSynths[i].loopMode,
                sampleStart: speciesAudioSynths[i].sampleStart || 0.0,
                sampleEnd: speciesAudioSynths[i].sampleEnd || 1.0,
                pitch: speciesAudioSynths[i].pitch || 0,
                detune: speciesAudioSynths[i].detune || 0,
                fadeLength: speciesAudioSynths[i].fadeLength || 0.002
            };
        }
    }
    
    speciesAudioSynths = [];
    
    for (let i = 0; i < maxSpecies; i++) {
        const synth = new GranularSynth(i, audioContext, masterGainNode);
        
        // Restore existing data if available
        if (existingData[i]) {
            synth.audioBuffer = existingData[i].audioBuffer;
            synth.fileName = existingData[i].fileName || 'No Sample';
            synth.volume = existingData[i].volume;
            synth.isMuted = existingData[i].isMuted;
            synth.loopMode = existingData[i].loopMode;
            synth.sampleStart = existingData[i].sampleStart || 0.0;
            synth.sampleEnd = existingData[i].sampleEnd || 1.0;
            synth.pitch = existingData[i].pitch || 0;
            synth.detune = existingData[i].detune || 0;
            synth.fadeLength = existingData[i].fadeLength || 0.002;
            synth.alternateDirection = 1; // Reset alternate direction
        }
        
        speciesAudioSynths.push(synth);
    }
    
    // Generate species audio UI
    createSpeciesAudioControls();
    
    // Setup draggable numbers for species parameters (call from main script)
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
}

// Update audio system with particle data
function updateAudioSystem() {
    if (!isAudioEnabled || !audioContext || audioContext.state !== 'running') return;
    
    // Update each species synth with its particles
    for (let i = 0; i < speciesCount; i++) {
        if (speciesAudioSynths[i]) {
            speciesAudioSynths[i].update(particles);
        }
    }
    
    // Update UI indicators
    updateAudioUI();
}

// Update audio status display
function updateAudioStatus(status) {
    const statusElement = document.getElementById('audioStatus');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.style.color = status === 'Ready' ? '#4CAF50' : 
                                  status === 'Failed' ? '#ff4444' : '#888';
    }
}

// Audio control functions - defined globally for event handlers
function toggleSpeciesMute(speciesIndex) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    const synth = speciesAudioSynths[speciesIndex];
    synth.setMute(!synth.isMuted);
    
    // Update species tab status indicator
    if (typeof updateSpeciesTabInfo === 'function') {
        updateSpeciesTabInfo();
    }
}

function setSpeciesVolume(speciesIndex, volume) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].setVolume(volume);
    
    const valueDisplay = document.getElementById(`speciesVolume${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = volume.toFixed(2);
    }
}

function setMasterVolume(volume) {
    masterVolume = volume;
    if (masterGainNode) {
        masterGainNode.gain.setTargetAtTime(isMasterMuted ? 0 : volume, audioContext.currentTime, 0.01);
    }
    
    const valueDisplay = document.getElementById('masterVolume-value');
    if (valueDisplay) {
        valueDisplay.textContent = volume.toFixed(2);
    }
}

function toggleMasterMute() {
    isMasterMuted = !isMasterMuted;
    if (masterGainNode) {
        masterGainNode.gain.setTargetAtTime(isMasterMuted ? 0 : masterVolume, audioContext.currentTime, 0.01);
    }
    
    const button = document.getElementById('masterMute');
    if (button) {
        button.textContent = isMasterMuted ? '🔇' : '🔊';
        button.classList.toggle('active', !isMasterMuted);
    }
}

function setFrequencyRange(low, high) {
    frequencyRange.low = low;
    frequencyRange.high = high;
    
    const lowDisplay = document.getElementById('freqLow-value');
    const highDisplay = document.getElementById('freqHigh-value');
    if (lowDisplay) lowDisplay.textContent = `${low}Hz`;
    if (highDisplay) highDisplay.textContent = `${high}Hz`;
}

function setGlobalVelocityGainCurve(curve) {
    globalVelocityGainCurve = curve;
    
    const valueDisplay = document.getElementById('velocityGainCurve-value');
    if (valueDisplay) {
        valueDisplay.textContent = curve.toFixed(1);
    }
}

function setGlobalVelocityThreshold(threshold) {
    globalVelocityThreshold = threshold;
    
    // Pre-calculate squared threshold for performance (MAX_SPEED = 3)
    const MAX_SPEED = 3;
    globalVelocityThresholdSquared = (threshold * MAX_SPEED) * (threshold * MAX_SPEED);
    
    const valueDisplay = document.getElementById('velocityThreshold-value');
    if (valueDisplay) {
        valueDisplay.textContent = threshold.toFixed(2);
    }
}

// New audio control functions
function setSpeciesPitch(speciesIndex, pitch) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].pitch = pitch;
    
    const valueDisplay = document.getElementById(`speciesPitch${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = pitch >= 0 ? `+${pitch}st` : `${pitch}st`;
    }
}

function setSpeciesDetune(speciesIndex, detune) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].detune = detune;
    
    const valueDisplay = document.getElementById(`speciesDetune${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = `${detune}¢`;
    }
}


function setSpeciesFadeLength(speciesIndex, fadeLength) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].fadeLength = fadeLength;
    
    const valueDisplay = document.getElementById(`speciesFade${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(fadeLength * 1000)}ms`;
    }
}

// Set species loop mode - defined globally for loop button handlers
function setSpeciesLoopMode(speciesIndex, mode) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    // Update the synth's loop mode
    speciesAudioSynths[speciesIndex].setLoopMode(mode);
    
    // Update UI to show selected mode
    const buttons = document.querySelectorAll(`[data-species="${speciesIndex}"][data-loop-mode]`);
    buttons.forEach(button => {
        button.classList.remove('active');
        if (button.dataset.loopMode === mode) {
            button.classList.add('active');
        }
    });
    
    console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} loop mode set to: ${mode}`);
}

// Load audio file for species - defined globally for file input handlers
async function loadAudioFile(event, speciesIndex) {
    const file = event.target.files[0];
    if (!file || !speciesAudioSynths[speciesIndex]) return;
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const success = await speciesAudioSynths[speciesIndex].loadSample(arrayBuffer);
        
        if (success) {
            // Update UI with actual file name
            const fileNameElement = document.getElementById(`fileName${speciesIndex}`);
            if (fileNameElement) {
                fileNameElement.textContent = file.name;
            }
            
            // Store the actual file name in the synth for proper display
            speciesAudioSynths[speciesIndex].fileName = file.name;
            
            // Update waveform if audioBuffer is available (should be available now even before Start Audio)
            const waveformCanvas = document.getElementById(`waveform${speciesIndex}`);
            if (waveformCanvas && speciesAudioSynths[speciesIndex].audioBuffer) {
                const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
                drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, waveformCanvas, currentSpeciesColors[speciesIndex] || [1,1,1], speciesIndex);
            }
            
            console.log(`🎵 Loaded audio file for Species ${String.fromCharCode(65 + speciesIndex)}: ${file.name}`);
        } else {
            alert('Failed to load audio file. Please try a different file.');
        }
    } catch (error) {
        console.error('File loading error:', error);
        alert('Error loading audio file.');
    }
}

// Waveform selection state
let waveformSelection = {
    isSelecting: false,
    speciesIndex: -1,
    startX: 0,
    currentX: 0,
    canvas: null
};

// Draw waveform visualization with selection overlay
function drawWaveform(audioBuffer, canvas, color, speciesIndex) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    if (!audioBuffer) return;
    
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    
    // Draw waveform
    ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        
        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    
    ctx.stroke();
    
    // Draw center line
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();
    
    // Draw selection overlay if this species has selection data
    if (speciesAudioSynths[speciesIndex] && typeof speciesIndex !== 'undefined') {
        const synth = speciesAudioSynths[speciesIndex];
        if (synth.sampleStart !== 0 || synth.sampleEnd !== 1) {
            const startX = synth.sampleStart * width;
            const endX = synth.sampleEnd * width;
            const selectionWidth = endX - startX;
            
            // Draw selection rectangle
            ctx.fillStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, 0.3)`;
            ctx.fillRect(startX, 0, selectionWidth, height);
            
            // Draw selection borders
            ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(startX, 0, selectionWidth, height);
        }
    }
    
    // Draw current selection if actively selecting on this canvas
    if (waveformSelection.isSelecting && waveformSelection.canvas === canvas) {
        const startX = Math.min(waveformSelection.startX, waveformSelection.currentX);
        const endX = Math.max(waveformSelection.startX, waveformSelection.currentX);
        const selectionWidth = endX - startX;
        
        // Draw active selection
        ctx.fillStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, 0.4)`;
        ctx.fillRect(startX, 0, selectionWidth, height);
        
        ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, 0, selectionWidth, height);
        ctx.setLineDash([]); // Reset line dash
    }
}

// Setup waveform selection handlers
function setupWaveformSelection(canvas, speciesIndex) {
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        waveformSelection.isSelecting = true;
        waveformSelection.speciesIndex = speciesIndex;
        waveformSelection.startX = x;
        waveformSelection.currentX = x;
        waveformSelection.canvas = canvas;
        
        e.preventDefault();
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!waveformSelection.isSelecting || waveformSelection.canvas !== canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        waveformSelection.currentX = Math.max(0, Math.min(canvas.width, x));
        
        // Redraw waveform with current selection
        if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
            drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
        }
        
        e.preventDefault();
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (!waveformSelection.isSelecting || waveformSelection.canvas !== canvas) return;
        
        const startX = Math.min(waveformSelection.startX, waveformSelection.currentX);
        const endX = Math.max(waveformSelection.startX, waveformSelection.currentX);
        const width = canvas.width;
        
        // Convert pixels to normalized positions (0-1)
        const startPos = Math.max(0, Math.min(1, startX / width));
        const endPos = Math.max(0, Math.min(1, endX / width));
        
        // Only update if there's a meaningful selection (at least 2% of the waveform)
        if (Math.abs(endPos - startPos) > 0.02) {
            const synth = speciesAudioSynths[speciesIndex];
            if (synth) {
                synth.sampleStart = startPos;
                synth.sampleEnd = endPos;
                console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} sample selection: ${(startPos * 100).toFixed(1)}% - ${(endPos * 100).toFixed(1)}%`);
            }
        }
        
        // Reset selection state
        waveformSelection.isSelecting = false;
        waveformSelection.speciesIndex = -1;
        waveformSelection.canvas = null;
        
        // Final redraw
        if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
            drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
        }
        
        e.preventDefault();
    });
    
    // Handle mouse leaving the canvas
    canvas.addEventListener('mouseleave', (e) => {
        if (waveformSelection.isSelecting && waveformSelection.canvas === canvas) {
            // Cancel selection
            waveformSelection.isSelecting = false;
            waveformSelection.speciesIndex = -1;
            waveformSelection.canvas = null;
            
            // Redraw without selection
            if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
                drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
            }
        }
    });
    
    // Double-click to reset selection to full waveform
    canvas.addEventListener('dblclick', (e) => {
        const synth = speciesAudioSynths[speciesIndex];
        if (synth) {
            synth.sampleStart = 0.0;
            synth.sampleEnd = 1.0;
            console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} sample selection reset to full waveform`);
            
            // Redraw waveform
            if (synth.audioBuffer) {
                drawWaveform(synth.audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
            }
        }
        e.preventDefault();
    });
    
    // Make canvas cursor indicate it's selectable
    canvas.style.cursor = 'crosshair';
}

// RGB to Hex conversion function - ensure it's defined before createSpeciesAudioControls
function rgbToHex(rgbArray) {
    const r = Math.round(rgbArray[0] * 255);
    const g = Math.round(rgbArray[1] * 255);
    const b = Math.round(rgbArray[2] * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ===== UI GENERATION (Audio UI only) =====
// Global variable to track currently selected species for audio controls
let selectedSpeciesForAudio = 0;

// Species selector is now handled by the species tab system in main HTML

// Create species audio controls UI - defined globally (now shows single species)
function createSpeciesAudioControls() {
    const container = document.getElementById('speciesAudioControls');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Use window variables if available, fallback to defaults
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
    const currentParticleCounts = (typeof particleCounts !== 'undefined') ? particleCounts : [200, 200];
    const currentParticleSizes = (typeof particleSizes !== 'undefined') ? particleSizes : [4, 4];
    const currentSpeciesTrailLengths = (typeof speciesTrailLengths !== 'undefined') ? speciesTrailLengths : [0.75, 0.65];
    
    // Only create panel for selected species
    const i = selectedSpeciesForAudio;
    if (i >= currentSpeciesCount) {
        selectedSpeciesForAudio = 0;
        return;
    }
    
    const synth = speciesAudioSynths[i];
    const panel = document.createElement('div');
    panel.className = 'species-audio-panel';
    
    // Add count/size/trail controls at top of panel
    const speciesParamsHeader = document.createElement('div');
    speciesParamsHeader.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #ccc; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 5px;">Species Parameters</h4>';
    
    const speciesParamsRow = document.createElement('div');
    speciesParamsRow.className = 'species-row';
    speciesParamsRow.style.marginBottom = '15px';

    const speciesLabel = document.createElement('div');
    speciesLabel.className = 'species-label';
    speciesLabel.style.color = rgbToHex(currentSpeciesColors[i] || [1,1,1]);
    speciesLabel.textContent = `Species ${String.fromCharCode(65 + i)}`;

    // Count parameter
    const countGroup = document.createElement('div');
    countGroup.className = 'param-group';
    
    const countLabel = document.createElement('span');
    countLabel.className = 'param-label';
    countLabel.textContent = 'Count:';
    
    const countValue = document.createElement('div');
    countValue.className = 'draggable-number';
    countValue.textContent = currentParticleCounts[i] || 200;
    countValue.id = `count-${i}`;
    
    countGroup.appendChild(countLabel);
    countGroup.appendChild(countValue);

    // Size parameter
    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'param-group';
    
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'param-label';
    sizeLabel.textContent = 'Size:';
    
    const sizeValue = document.createElement('div');
    sizeValue.className = 'draggable-number';
    sizeValue.textContent = currentParticleSizes[i] || 4;
    sizeValue.id = `size-${i}`;
    
    sizeGroup.appendChild(sizeLabel);
    sizeGroup.appendChild(sizeValue);

    // Trail parameter
    const trailGroup = document.createElement('div');
    trailGroup.className = 'param-group';
    
    const trailLabel = document.createElement('span');
    trailLabel.className = 'param-label';
    trailLabel.textContent = 'Trail:';
    
    const trailValue = document.createElement('div');
    trailValue.className = 'draggable-number';
    trailValue.textContent = (currentSpeciesTrailLengths[i] || 0.75).toFixed(2);
    trailValue.id = `trail-${i}`;
    
    trailGroup.appendChild(trailLabel);
    trailGroup.appendChild(trailValue);

    speciesParamsRow.appendChild(speciesLabel);
    speciesParamsRow.appendChild(countGroup);
    speciesParamsRow.appendChild(sizeGroup);
    speciesParamsRow.appendChild(trailGroup);
    
    const header = document.createElement('div');
    header.className = 'species-audio-header';
    header.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #ccc; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 5px;">Audio Controls</h4>';
    
    const title = document.createElement('div');
    title.className = 'species-audio-title';
    title.style.color = rgbToHex(currentSpeciesColors[i] || [1,1,1]);
    title.textContent = `Species ${String.fromCharCode(65 + i)}`;
    
    header.appendChild(title);
    
    // File controls
    const fileControls = document.createElement('div');
    fileControls.className = 'audio-file-controls';
    
    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'file-input-wrapper';
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = `audioFile${i}`;
    fileInput.accept = '.wav,.mp3,.m4a,.ogg';
    fileInput.addEventListener('change', (e) => loadAudioFile(e, i));
    
    const fileLabel = document.createElement('label');
    fileLabel.className = 'file-input-label';
    fileLabel.htmlFor = `audioFile${i}`;
    fileLabel.textContent = '📁 Load Sample';
    
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.id = `fileName${i}`;
    fileName.textContent = (synth && synth.fileName) || 'No Sample';
    
    fileWrapper.appendChild(fileInput);
    fileWrapper.appendChild(fileLabel);
    fileControls.appendChild(fileWrapper);
    fileControls.appendChild(fileName);
    
    // Waveform display
    const waveformContainer = document.createElement('div');
    waveformContainer.className = 'waveform-container';
    
    const waveformCanvas = document.createElement('canvas');
    waveformCanvas.className = 'waveform-canvas';
    waveformCanvas.id = `waveform${i}`;
    waveformCanvas.width = 280;
    waveformCanvas.height = 40;
    
    waveformContainer.appendChild(waveformCanvas);
    
    // Setup waveform selection handlers
    setupWaveformSelection(waveformCanvas, i);
    
    // Audio Mode Tab System
    const audioModeTabsContainer = document.createElement('div');
    audioModeTabsContainer.className = 'audio-mode-tabs';
    
    const currentTriggerMode = (synth && synth.triggerMode) || TRIGGER_MODES.LOOPING;
    
    // Collision mode tab
    const collisionTab = document.createElement('button');
    collisionTab.className = 'audio-mode-tab';
    if (currentTriggerMode === TRIGGER_MODES.COLLISION) collisionTab.classList.add('active');
    collisionTab.innerHTML = '<span>✨</span><span>Collision</span>';
    collisionTab.addEventListener('click', () => {
        setSpeciesTriggerMode(i, TRIGGER_MODES.COLLISION);
        updateAudioModeUI(i);
    });
    
    // Looping mode tab
    const loopingTab = document.createElement('button');
    loopingTab.className = 'audio-mode-tab';
    if (currentTriggerMode === TRIGGER_MODES.LOOPING) loopingTab.classList.add('active');
    loopingTab.innerHTML = '<span>🔁</span><span>Looping</span>';
    loopingTab.addEventListener('click', () => {
        setSpeciesTriggerMode(i, TRIGGER_MODES.LOOPING);
        updateAudioModeUI(i);
    });
    
    audioModeTabsContainer.appendChild(collisionTab);
    audioModeTabsContainer.appendChild(loopingTab);
    
    // Volume control
    const volumeRow = document.createElement('div');
    volumeRow.className = 'audio-controls-row';
    
    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = 'Volume:';
    volumeLabel.style.minWidth = '50px';
    volumeLabel.style.fontSize = '12px';
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'slider';
    volumeSlider.id = `speciesVolume${i}`;
    volumeSlider.min = '0';
    volumeSlider.max = '1';
    volumeSlider.step = '0.05';
    const currentVolume = (synth && typeof synth.volume !== 'undefined') ? synth.volume : 0.7;
    volumeSlider.value = currentVolume.toString();
    volumeSlider.style.flex = '1';
    volumeSlider.addEventListener('input', (e) => setSpeciesVolume(i, parseFloat(e.target.value)));
    
    const volumeValue = document.createElement('span');
    volumeValue.className = 'value-display';
    volumeValue.id = `speciesVolume${i}-value`;
    volumeValue.textContent = currentVolume.toFixed(2);
    
    volumeRow.appendChild(volumeLabel);
    volumeRow.appendChild(volumeSlider);
    volumeRow.appendChild(volumeValue);
    
    // Audio mode content container
    const audioModeContent = document.createElement('div');
    audioModeContent.className = 'audio-mode-content';
    audioModeContent.id = `audioModeContent${i}`;
    
    // Create both mode panels
    createAudioModePanels(audioModeContent, i, currentTriggerMode, synth);
    
    // This is now handled in createAudioModePanels
    
    // Legacy loop controls moved to mode-specific section
    
    // Pitch control
    const pitchRow = document.createElement('div');
    pitchRow.className = 'audio-controls-row';
    
    const pitchLabel = document.createElement('span');
    pitchLabel.textContent = 'Pitch:';
    pitchLabel.style.minWidth = '50px';
    pitchLabel.style.fontSize = '12px';
    
    const pitchSlider = document.createElement('input');
    pitchSlider.type = 'range';
    pitchSlider.className = 'slider';
    pitchSlider.id = `speciesPitch${i}`;
    pitchSlider.min = '-12';
    pitchSlider.max = '12';
    pitchSlider.step = '1';
    const currentPitch = (synth && typeof synth.pitch !== 'undefined') ? synth.pitch : 0;
    pitchSlider.value = currentPitch.toString();
    pitchSlider.style.flex = '1';
    pitchSlider.addEventListener('input', (e) => setSpeciesPitch(i, parseInt(e.target.value)));
    
    const pitchValue = document.createElement('span');
    pitchValue.className = 'value-display';
    pitchValue.id = `speciesPitch${i}-value`;
    pitchValue.textContent = currentPitch >= 0 ? `+${currentPitch}st` : `${currentPitch}st`;
    
    pitchRow.appendChild(pitchLabel);
    pitchRow.appendChild(pitchSlider);
    pitchRow.appendChild(pitchValue);
    
    // Detune control
    const detuneRow = document.createElement('div');
    detuneRow.className = 'audio-controls-row';
    
    const detuneLabel = document.createElement('span');
    detuneLabel.textContent = 'Detune:';
    detuneLabel.style.minWidth = '50px';
    detuneLabel.style.fontSize = '12px';
    
    const detuneSlider = document.createElement('input');
    detuneSlider.type = 'range';
    detuneSlider.className = 'slider';
    detuneSlider.id = `speciesDetune${i}`;
    detuneSlider.min = '0';
    detuneSlider.max = '50';
    detuneSlider.step = '1';
    const currentDetune = (synth && typeof synth.detune !== 'undefined') ? synth.detune : 0;
    detuneSlider.value = currentDetune.toString();
    detuneSlider.style.flex = '1';
    detuneSlider.addEventListener('input', (e) => setSpeciesDetune(i, parseInt(e.target.value)));
    
    const detuneValue = document.createElement('span');
    detuneValue.className = 'value-display';
    detuneValue.id = `speciesDetune${i}-value`;
    detuneValue.textContent = `${currentDetune}¢`;
    
    detuneRow.appendChild(detuneLabel);
    detuneRow.appendChild(detuneSlider);
    detuneRow.appendChild(detuneValue);
    
    // Fade Length control
    const fadeRow = document.createElement('div');
    fadeRow.className = 'audio-controls-row';
    
    const fadeLabel = document.createElement('span');
    fadeLabel.textContent = 'Fade:';
    fadeLabel.style.minWidth = '50px';
    fadeLabel.style.fontSize = '12px';
    
    const fadeSlider = document.createElement('input');
    fadeSlider.type = 'range';
    fadeSlider.className = 'slider';
    fadeSlider.id = `speciesFade${i}`;
    fadeSlider.min = '0.001';
    fadeSlider.max = '0.02';
    fadeSlider.step = '0.001';
    const currentFade = (synth && typeof synth.fadeLength !== 'undefined') ? synth.fadeLength : 0.002;
    fadeSlider.value = currentFade.toString();
    fadeSlider.style.flex = '1';
    fadeSlider.addEventListener('input', (e) => setSpeciesFadeLength(i, parseFloat(e.target.value)));
    
    const fadeValue = document.createElement('span');
    fadeValue.className = 'value-display';
    fadeValue.id = `speciesFade${i}-value`;
    fadeValue.textContent = `${Math.round(currentFade * 1000)}ms`;
    
    fadeRow.appendChild(fadeLabel);
    fadeRow.appendChild(fadeSlider);
    fadeRow.appendChild(fadeValue);
    
    // Activity indicators
    const activityRow = document.createElement('div');
    activityRow.className = 'audio-controls-row';
    
    const activityLabel = document.createElement('span');
    activityLabel.textContent = 'Grains:';
    activityLabel.style.minWidth = '50px';
    activityLabel.style.fontSize = '12px';
    
    const grainActivity = document.createElement('div');
    grainActivity.className = 'grain-activity';
    grainActivity.id = `grainActivity${i}`;
    
    // Create grain indicators
    for (let j = 0; j < 10; j++) {
        const indicator = document.createElement('div');
        indicator.className = 'grain-indicator';
        grainActivity.appendChild(indicator);
    }
    
    const audioMeter = document.createElement('div');
    audioMeter.className = 'audio-meter';
    
    const meterBar = document.createElement('div');
    meterBar.className = 'meter-bar';
    
    const meterFill = document.createElement('div');
    meterFill.className = 'meter-fill';
    meterFill.id = `meterFill${i}`;
    
    meterBar.appendChild(meterFill);
    audioMeter.appendChild(meterBar);
    
    const grainCount = document.createElement('span');
    grainCount.id = `grainCount${i}`;
    grainCount.textContent = '0/50';
    grainCount.style.fontSize = '11px';
    grainCount.style.color = '#888';
    
    audioMeter.appendChild(grainCount);
    
    activityRow.appendChild(activityLabel);
    activityRow.appendChild(grainActivity);
    activityRow.appendChild(audioMeter);
    
    // Gain reduction meter removed - too confusing for users
    
    // Assemble panel
    panel.appendChild(speciesParamsHeader);
    panel.appendChild(speciesParamsRow);
    panel.appendChild(header);
    panel.appendChild(fileControls);
    panel.appendChild(waveformContainer);
    panel.appendChild(audioModeTabsContainer);
    panel.appendChild(audioModeContent);
    panel.appendChild(volumeRow);
    panel.appendChild(pitchRow);
    panel.appendChild(detuneRow);
    panel.appendChild(fadeRow);
    panel.appendChild(activityRow);
    
    container.appendChild(panel);
    
    // Draw waveform if audio buffer exists
    if (synth && synth.audioBuffer) {
        drawWaveform(synth.audioBuffer, waveformCanvas, currentSpeciesColors[i] || [1,1,1], i);
    }
    
    // Setup draggable numbers for the species parameters (call from main script if available)
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
}

// Set species trigger mode
function setSpeciesTriggerMode(speciesIndex, mode) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    const synth = speciesAudioSynths[speciesIndex];
    synth.setTriggerMode(mode);
    
    console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} trigger mode: ${mode}`);
}

// Update engine parameter
function updateEngineParameter(speciesIndex, parameter, value) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    const synth = speciesAudioSynths[speciesIndex];
    const settings = {};
    settings[parameter] = value;
    synth.updateEngineSettings(settings);
    
    // Update UI display
    const valueElement = document.getElementById(`species${parameter.charAt(0).toUpperCase() + parameter.slice(1)}${speciesIndex}-value`);
    if (valueElement) {
        if (parameter === 'ratio') {
            valueElement.textContent = `${value.toFixed(1)}:1`;
        } else {
            valueElement.textContent = value.toFixed(2);
        }
    }
}

// Update audio mode UI
function updateAudioModeUI(speciesIndex) {
    const audioModeContent = document.getElementById(`audioModeContent${speciesIndex}`);
    if (!audioModeContent || !speciesAudioSynths[speciesIndex]) return;
    
    const synth = speciesAudioSynths[speciesIndex];
    
    // Update tab appearance
    const tabs = audioModeContent.parentNode.querySelectorAll('.audio-mode-tab');
    tabs.forEach((tab, index) => {
        const isActive = (index === 0 && synth.triggerMode === TRIGGER_MODES.COLLISION) ||
                        (index === 1 && synth.triggerMode === TRIGGER_MODES.LOOPING);
        tab.classList.toggle('active', isActive);
    });
    
    // Show/hide appropriate panels
    const collisionPanel = document.getElementById(`collisionPanel${speciesIndex}`);
    const loopingPanel = document.getElementById(`loopingPanel${speciesIndex}`);
    
    if (collisionPanel && loopingPanel) {
        collisionPanel.classList.toggle('active', synth.triggerMode === TRIGGER_MODES.COLLISION);
        loopingPanel.classList.toggle('active', synth.triggerMode === TRIGGER_MODES.LOOPING);
    }
}

// Create audio mode panels (Collision and Looping)
function createAudioModePanels(container, speciesIndex, currentMode, synth) {
    container.innerHTML = '';
    
    // Collision mode panel
    const collisionPanel = document.createElement('div');
    collisionPanel.className = 'audio-mode-panel';
    collisionPanel.id = `collisionPanel${speciesIndex}`;
    if (currentMode === TRIGGER_MODES.COLLISION) collisionPanel.classList.add('active');
    
    createCollisionModePanel(collisionPanel, speciesIndex, synth);
    
    // Looping mode panel
    const loopingPanel = document.createElement('div');
    loopingPanel.className = 'audio-mode-panel';
    loopingPanel.id = `loopingPanel${speciesIndex}`;
    if (currentMode === TRIGGER_MODES.LOOPING) loopingPanel.classList.add('active');
    
    createLoopingModePanel(loopingPanel, speciesIndex, synth);
    
    container.appendChild(collisionPanel);
    container.appendChild(loopingPanel);
}

// Create collision mode panel with intuitive controls
function createCollisionModePanel(container, speciesIndex, synth) {
    // Threshold with visualization
    const thresholdGroup = document.createElement('div');
    thresholdGroup.className = 'audio-controls-group';
    
    const thresholdTitle = document.createElement('h4');
    thresholdTitle.textContent = 'Collision Threshold';
    thresholdGroup.appendChild(thresholdTitle);
    
    const thresholdContainer = document.createElement('div');
    thresholdContainer.className = 'threshold-container';
    thresholdContainer.style.position = 'relative'; // Required for absolute positioned children
    
    // Collision pulse visualization
    const collisionViz = document.createElement('div');
    collisionViz.className = 'collision-pulse-container';
    collisionViz.id = `collisionPulseContainer${speciesIndex}`;
    collisionViz.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 50px;
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        z-index: 1;
        pointer-events: none;
    `;
    
    thresholdContainer.appendChild(collisionViz);
    
    // Hide the original threshold slider - we'll use the new drag interface
    const thresholdSlider = document.createElement('input');
    thresholdSlider.type = 'range';
    thresholdSlider.className = 'slider threshold-slider';
    thresholdSlider.id = `speciesThreshold${speciesIndex}`;
    thresholdSlider.min = '0.01';
    thresholdSlider.max = '1.0';
    thresholdSlider.step = '0.01';
    thresholdSlider.value = '0.15'; // Better default for collisions
    thresholdSlider.style.display = 'none'; // Hide original slider
    thresholdSlider.addEventListener('input', (e) => {
        updateEngineParameter(speciesIndex, 'threshold', parseFloat(e.target.value));
    });
    
    thresholdContainer.appendChild(thresholdSlider);
    
    const thresholdRow = document.createElement('div');
    thresholdRow.className = 'audio-controls-row';
    thresholdRow.appendChild(thresholdContainer);
    
    thresholdGroup.appendChild(thresholdRow);
    
    // Add smoothing dial to threshold group
    createSmoothingDial(thresholdContainer, speciesIndex, 'collision');
    
    // Species collision matrix
    const matrixGroup = document.createElement('div');
    matrixGroup.className = 'audio-controls-group';
    
    const matrixTitle = document.createElement('h4');
    matrixTitle.textContent = 'Collision Triggers';
    matrixGroup.appendChild(matrixTitle);
    
    createSpeciesCollisionMatrix(matrixGroup, speciesIndex);
    
    container.appendChild(thresholdGroup);
    container.appendChild(matrixGroup);
}

// Create looping mode panel
function createLoopingModePanel(container, speciesIndex, synth) {
    // Threshold with velocity visualization
    const thresholdGroup = document.createElement('div');
    thresholdGroup.className = 'audio-controls-group';
    
    const thresholdTitle = document.createElement('h4');
    thresholdTitle.textContent = 'Velocity Threshold';
    thresholdGroup.appendChild(thresholdTitle);
    
    const thresholdContainer = document.createElement('div');
    thresholdContainer.className = 'threshold-container';
    thresholdContainer.style.position = 'relative'; // Required for absolute positioned children
    
    // Velocity level visualization
    const velocityViz = document.createElement('div');
    velocityViz.className = 'threshold-visualization';
    
    const velocityBar = document.createElement('div');
    velocityBar.className = 'velocity-level-bar';
    velocityBar.id = `velocityBar${speciesIndex}`;
    
    velocityViz.appendChild(velocityBar);
    thresholdContainer.appendChild(velocityViz);
    
    // Hide the original threshold slider - we'll use the new drag interface
    const thresholdSlider = document.createElement('input');
    thresholdSlider.type = 'range';
    thresholdSlider.className = 'slider threshold-slider';
    thresholdSlider.id = `speciesThreshold${speciesIndex}`;
    thresholdSlider.min = '0.01';
    thresholdSlider.max = '1.0';
    thresholdSlider.step = '0.01';
    thresholdSlider.value = '0.05'; // Lower default for continuous looping
    thresholdSlider.style.display = 'none'; // Hide original slider
    thresholdSlider.addEventListener('input', (e) => {
        updateEngineParameter(speciesIndex, 'threshold', parseFloat(e.target.value));
    });
    
    thresholdContainer.appendChild(thresholdSlider);
    
    const thresholdRow = document.createElement('div');
    thresholdRow.className = 'audio-controls-row';
    thresholdRow.appendChild(thresholdContainer);
    
    thresholdGroup.appendChild(thresholdRow);
    
    // Add smoothing dial to threshold group
    createSmoothingDial(thresholdContainer, speciesIndex, 'looping');
    
    // Loop direction and crossfade
    const loopGroup = document.createElement('div');
    loopGroup.className = 'audio-controls-group';
    
    const loopTitle = document.createElement('h4');
    loopTitle.textContent = 'Loop Settings';
    loopGroup.appendChild(loopTitle);
    
    createLoopingControls(loopGroup, speciesIndex);
    
    container.appendChild(thresholdGroup);
    container.appendChild(loopGroup);
}

// Create smoothing dial component
function createSmoothingDial(container, speciesIndex, mode) {
    const dialContainer = document.createElement('div');
    dialContainer.className = 'smoothing-dial-container';
    dialContainer.style.cssText = `
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        z-index: 3;
    `;
    
    const dial = document.createElement('div');
    dial.className = 'smoothing-dial';
    dial.id = `${mode}SmoothingDial${speciesIndex}`;
    dial.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #444;
        border: 2px solid #666;
        position: relative;
        cursor: pointer;
        transition: border-color 0.2s ease;
    `;
    
    const indicator = document.createElement('div');
    indicator.className = 'smoothing-dial-indicator';
    indicator.id = `${mode}SmoothingDialIndicator${speciesIndex}`;
    indicator.style.cssText = `
        position: absolute;
        top: 2px;
        left: 50%;
        width: 2px;
        height: 8px;
        background: #4CAF50;
        transform-origin: center bottom;
        transform: translateX(-50%) rotate(0deg);
        border-radius: 1px;
        transition: transform 0.1s ease;
    `;
    
    dial.appendChild(indicator);
    
    const dialValue = document.createElement('div');
    dialValue.className = 'smoothing-dial-value';
    dialValue.id = `${mode}SmoothingDialValue${speciesIndex}`;
    dialValue.style.cssText = `
        font-size: 10px;
        color: #888;
        min-width: 20px;
        text-align: center;
    `;
    dialValue.textContent = '0.0';
    
    dialContainer.appendChild(dial);
    dialContainer.appendChild(dialValue);
    
    // Add smoothing visualization to the threshold container
    addSmoothingVisualization(container, speciesIndex, mode);
    
    // Setup dial interaction
    setupSmoothingDialInteraction(dial, speciesIndex, mode);
    
    container.appendChild(dialContainer);
}

// Add smoothing visualization to threshold container
function addSmoothingVisualization(container, speciesIndex, mode) {
    // Create new threshold visualization elements
    
    // Make the container bigger and adjust styling to fit within parent
    container.style.cssText += `
        height: 14px; /* 20% thicker than previous 12px */
        width: 100%; /* Fit within container */
        max-width: calc(100% - 60px); /* Leave space for smoothing dial */
        margin: 10px 0;
        box-sizing: border-box;
    `;
    
    // Create threshold line (vertical line that shows current threshold position)
    const thresholdLine = document.createElement('div');
    thresholdLine.className = 'threshold-line';
    thresholdLine.id = `${mode}ThresholdLine${speciesIndex}`;
    thresholdLine.style.cssText = `
        position: absolute;
        top: -2px;
        width: 2px;
        height: 18px; /* Match new container height + 4px extra */
        background: #fff;
        z-index: 5;
        left: 15%; /* Initial position */
        pointer-events: none;
        box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
    `;
    
    // Create drag tab underneath the meter
    const dragTab = document.createElement('div');
    dragTab.className = 'threshold-drag-tab';
    dragTab.id = `${mode}DragTab${speciesIndex}`;
    dragTab.style.cssText = `
        position: absolute;
        top: 16px; /* Adjusted for new container height */
        left: calc(15% - 8px);
        width: 16px;
        height: 8px;
        background: #4CAF50;
        border-radius: 0 0 4px 4px;
        cursor: ew-resize;
        z-index: 5;
        border: 1px solid #fff;
    `;
    
    // Create single smoothing ramp line (left side, ramping up to threshold)
    const smoothRampLine = document.createElement('div');
    smoothRampLine.className = 'smoothing-ramp-line';
    smoothRampLine.id = `${mode}SmoothRampLine${speciesIndex}`;
    smoothRampLine.style.cssText = `
        position: absolute;
        top: 0;
        width: 0px;
        height: 14px; /* Full height of container */
        background: linear-gradient(to right, transparent, rgba(76, 175, 80, 0.3));
        z-index: 3;
        right: 85%; /* Start from left, end at threshold (15% from left = 85% from right) */
        opacity: 0;
        transition: all 0.2s ease;
        border-radius: 2px 0 0 2px;
    `;
    
    container.appendChild(thresholdLine);
    container.appendChild(dragTab);
    container.appendChild(smoothRampLine);
    
    // Setup drag interaction for the new tab
    setupThresholdDragInteraction(dragTab, thresholdLine, smoothRampLine, speciesIndex, mode);
}

// Setup smoothing dial interaction
function setupSmoothingDialInteraction(dial, speciesIndex, mode) {
    let isDragging = false;
    let startY = 0;
    let startSmoothing = 0.0;
    
    dial.addEventListener('mousedown', (e) => {
        isDragging = true;
        startY = e.clientY;
        const synth = speciesAudioSynths[speciesIndex];
        startSmoothing = (synth && synth.currentEngine && synth.currentEngine.smoothing !== undefined) ? synth.currentEngine.smoothing : 0.0;
        e.preventDefault();
    });
    
    const handleMouseMove = (e) => {
        if (!isDragging) return;
        
        // Use vertical mouse movement: up increases smoothing, down decreases
        const deltaY = startY - e.clientY;
        const sensitivity = 0.01; // Smoothing change per pixel
        let newSmoothing = startSmoothing + (deltaY * sensitivity);
        newSmoothing = Math.max(0.0, Math.min(1.0, newSmoothing)); // Clamp to 0-1
        
        // Update visual indicator
        const indicator = document.getElementById(`${mode}SmoothingDialIndicator${speciesIndex}`);
        if (indicator) {
            const rotationDegrees = (newSmoothing * 180) - 90; // -90 to +90 degrees
            indicator.style.transform = `translateX(-50%) rotate(${rotationDegrees}deg)`;
        }
        
        // Update value display
        const valueDisplay = document.getElementById(`${mode}SmoothingDialValue${speciesIndex}`);
        if (valueDisplay) {
            valueDisplay.textContent = newSmoothing.toFixed(1);
        }
        
        // Update smoothing visualization
        updateSmoothingVisualization(speciesIndex, mode, newSmoothing);
        
        // Update engine parameter
        updateEngineParameter(speciesIndex, 'smoothing', newSmoothing);
    };
    
    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
        }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

// Setup threshold drag interaction
function setupThresholdDragInteraction(dragTab, thresholdLine, smoothRampLine, speciesIndex, mode) {
    let isDragging = false;
    let startX = 0;
    let containerRect = null;
    
    dragTab.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        containerRect = dragTab.parentNode.getBoundingClientRect();
        e.preventDefault();
    });
    
    const handleMouseMove = (e) => {
        if (!isDragging || !containerRect) return;
        
        // Calculate position relative to container
        const relativeX = e.clientX - containerRect.left;
        const containerWidth = containerRect.width - 60; // Account for smoothing dial space
        let position = Math.max(0, Math.min(1, relativeX / containerWidth));
        
        // Update threshold value
        updateEngineParameter(speciesIndex, 'threshold', position);
        
        // Update visual elements
        const percentage = position * 100;
        thresholdLine.style.left = `${percentage}%`;
        dragTab.style.left = `calc(${percentage}% - 8px)`;
        
        // Update smoothing ramp position (ends at threshold)
        smoothRampLine.style.right = `${100 - percentage}%`;
    };
    
    const handleMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            containerRect = null;
        }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
}

// Update smoothing visualization on threshold slider
function updateSmoothingVisualization(speciesIndex, mode, smoothingValue) {
    const smoothRampLine = document.getElementById(`${mode}SmoothRampLine${speciesIndex}`);
    
    if (!smoothRampLine) return;
    
    if (smoothingValue > 0) {
        // Show smoothing ramp with width based on smoothing value
        const rampWidth = smoothingValue * 30; // Max 30% of container width
        
        smoothRampLine.style.opacity = '1';
        smoothRampLine.style.width = `${rampWidth}%`;
    } else {
        // Hide smoothing ramp when smoothing is 0
        smoothRampLine.style.opacity = '0';
        smoothRampLine.style.width = '0%';
    }
}

// Create species collision matrix (simplified from old version)
function createSpeciesCollisionMatrix(container, speciesIndex) {
    const matrixContainer = document.createElement('div');
    matrixContainer.style.display = 'grid';
    matrixContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
    matrixContainer.style.gap = '6px';
    
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
    
    for (let i = 0; i < Math.min(currentSpeciesCount, 8); i++) {
        const checkboxContainer = document.createElement('label');
        checkboxContainer.style.display = 'flex';
        checkboxContainer.style.alignItems = 'center';
        checkboxContainer.style.gap = '6px';
        checkboxContainer.style.fontSize = '12px';
        checkboxContainer.style.color = rgbToHex(currentSpeciesColors[i] || [1,1,1]);
        checkboxContainer.style.cursor = 'pointer';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true; // Default: all species can trigger
        checkbox.addEventListener('change', (e) => {
            updateCollisionMatrix(speciesIndex, i, e.target.checked);
        });
        
        const label = document.createElement('span');
        label.textContent = String.fromCharCode(65 + i);
        
        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(label);
        matrixContainer.appendChild(checkboxContainer);
    }
    
    container.appendChild(matrixContainer);
}

// Species velocity/collision tracking for visualization
let speciesActivityLevels = new Array(8).fill(0);

// Update species activity levels (called from animation loop)
function updateSpeciesActivityLevels(particles) {
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    
    for (let i = 0; i < currentSpeciesCount; i++) {
        const speciesParticles = particles.filter(p => p.species === i);
        if (speciesParticles.length === 0) {
            speciesActivityLevels[i] = 0;
            continue;
        }
        
        // Calculate average activity for this species
        let totalActivity = 0;
        for (const particle of speciesParticles) {
            // For collision mode: use collision force
            const collisionActivity = particle.collisionForce || 0;
            
            // For looping mode: use velocity
            const velocity = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
            const velocityActivity = Math.min(1.0, velocity / 3.0); // Normalize to max velocity
            
            // Use the higher of the two
            totalActivity += Math.max(collisionActivity, velocityActivity);
        }
        
        // Smooth the activity level
        const targetLevel = totalActivity / speciesParticles.length;
        speciesActivityLevels[i] = speciesActivityLevels[i] * 0.9 + targetLevel * 0.1;
    }
    
    // Update UI visualization
    updateVelocityVisualization();
}

// Update velocity visualization bars (for looping mode only)
function updateVelocityVisualization() {
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    
    for (let i = 0; i < currentSpeciesCount; i++) {
        const velocityBar = document.getElementById(`velocityBar${i}`);
        if (velocityBar) {
            const level = Math.min(100, speciesActivityLevels[i] * 100);
            velocityBar.style.width = `${level}%`;
        }
    }
}

// Show collision pulse for collision mode visualization
function showCollisionPulse(speciesIndex, force, triggerSpecies) {
    const container = document.getElementById(`collisionPulseContainer${speciesIndex}`);
    if (!container) return;
    
    // Create pulse element
    const pulse = document.createElement('div');
    const intensity = Math.min(1.0, force);
    const opacity = 0.3 + (intensity * 0.7);
    
    pulse.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: ${intensity * 100}%;
        height: 100%;
        background: linear-gradient(to right, 
            rgba(255, 68, 68, ${opacity}), 
            rgba(255, 193, 7, ${opacity * 0.5}), 
            transparent);
        border-radius: 3px;
        animation: collisionPulse 0.3s ease-out forwards;
    `;
    
    // Add CSS animation if not already defined
    if (!document.getElementById('collisionPulseStyles')) {
        const style = document.createElement('style');
        style.id = 'collisionPulseStyles';
        style.textContent = `
            @keyframes collisionPulse {
                0% { transform: scaleX(0); opacity: 0.8; }
                50% { transform: scaleX(1); opacity: 1; }
                100% { transform: scaleX(0.1); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    container.appendChild(pulse);
    
    // Remove pulse after animation
    setTimeout(() => {
        if (pulse.parentNode) {
            pulse.remove();
        }
    }, 300);
}

// Create looping controls (simplified version for new UI)
function createLoopingControls(container, speciesIndex) {
    // Loop direction controls
    const directionRow = document.createElement('div');
    directionRow.className = 'audio-controls-row';
    directionRow.style.marginBottom = '8px';
    
    const directionLabel = document.createElement('span');
    directionLabel.textContent = 'Direction:';
    directionLabel.style.minWidth = '60px';
    directionLabel.style.fontSize = '12px';
    directionLabel.style.color = '#ccc';
    
    const loopControls = document.createElement('div');
    loopControls.className = 'loop-controls';
    loopControls.style.flex = '1';
    
    const directions = [
        { mode: 'forward', icon: '▶', title: 'Forward' },
        { mode: 'reverse', icon: '◀', title: 'Reverse' },
        { mode: 'alternate', icon: '⇄', title: 'Alternating' }
    ];
    
    directions.forEach(dir => {
        const btn = document.createElement('button');
        btn.className = 'loop-button';
        btn.textContent = dir.icon;
        btn.title = dir.title;
        if (dir.mode === 'forward') btn.classList.add('active');
        btn.addEventListener('click', () => {
            updateEngineParameter(speciesIndex, 'loopDirection', dir.mode);
            loopControls.querySelectorAll('.loop-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
        loopControls.appendChild(btn);
    });
    
    directionRow.appendChild(directionLabel);
    directionRow.appendChild(loopControls);
    
    // Crossfade amount
    const crossfadeRow = document.createElement('div');
    crossfadeRow.className = 'audio-controls-row';
    
    const crossfadeLabel = document.createElement('span');
    crossfadeLabel.textContent = 'Smoothness:';
    crossfadeLabel.style.minWidth = '60px';
    crossfadeLabel.style.fontSize = '12px';
    crossfadeLabel.style.color = '#ccc';
    
    const crossfadeSlider = document.createElement('input');
    crossfadeSlider.type = 'range';
    crossfadeSlider.className = 'slider';
    crossfadeSlider.min = '0.0';
    crossfadeSlider.max = '1.0';
    crossfadeSlider.step = '0.05';
    crossfadeSlider.value = '0.5';
    crossfadeSlider.style.flex = '1';
    crossfadeSlider.addEventListener('input', (e) => {
        updateEngineParameter(speciesIndex, 'crossfadeAmount', parseFloat(e.target.value));
        document.getElementById(`crossfade${speciesIndex}-value`).textContent = `${Math.round(parseFloat(e.target.value) * 100)}%`;
    });
    
    const crossfadeValue = document.createElement('span');
    crossfadeValue.className = 'value-display';
    crossfadeValue.id = `crossfade${speciesIndex}-value`;
    crossfadeValue.textContent = '50%';
    
    crossfadeRow.appendChild(crossfadeLabel);
    crossfadeRow.appendChild(crossfadeSlider);
    crossfadeRow.appendChild(crossfadeValue);
    
    container.appendChild(directionRow);
    container.appendChild(crossfadeRow);
}

// Update collision matrix
function updateCollisionMatrix(speciesIndex, triggerSpecies, enabled) {
    if (!speciesAudioSynths[speciesIndex] || !speciesAudioSynths[speciesIndex].collisionEngine) return;
    
    const engine = speciesAudioSynths[speciesIndex].collisionEngine;
    engine.collisionSpeciesMatrix[triggerSpecies] = enabled;
    
    console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} collision trigger from ${String.fromCharCode(65 + triggerSpecies)}: ${enabled}`);
}

// Update audio UI indicators - defined globally
function updateAudioUI() {
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    for (let i = 0; i < currentSpeciesCount; i++) {
        if (!speciesAudioSynths[i]) continue;
        
        const synth = speciesAudioSynths[i];
        const grainCount = synth.activeGrains;
        
        // Update grain count
        const grainCountElement = document.getElementById(`grainCount${i}`);
        if (grainCountElement) {
            grainCountElement.textContent = `${grainCount}/${synth.maxGrains}`;
        }
        
        // Update grain activity indicators
        const grainActivity = document.getElementById(`grainActivity${i}`);
        if (grainActivity) {
            const indicators = grainActivity.children;
            for (let j = 0; j < indicators.length; j++) {
                indicators[j].classList.toggle('active', j < Math.ceil(grainCount / 5));
            }
        }
        
        // Update audio level meter
        const meterFill = document.getElementById(`meterFill${i}`);
        if (meterFill) {
            const level = Math.min(100, (grainCount / synth.maxGrains) * 100);
            meterFill.style.width = `${level}%`;
        }
        
        // Update gain reduction meter
        const gainReductionFill = document.getElementById(`gainReduction${i}`);
        const gainReductionValue = document.getElementById(`gainReduction${i}-value`);
        if (gainReductionFill && gainReductionValue && synth.currentEngine) {
            const gainReduction = synth.currentEngine.gainReduction || 0;
            const reductionPercent = Math.min(100, gainReduction * 100);
            gainReductionFill.style.width = `${reductionPercent}%`;
            gainReductionValue.textContent = `${(gainReduction * -20).toFixed(1)}dB`; // Convert to dB
        }
    }
}

