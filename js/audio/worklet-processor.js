/**
 * Motion-Driven Granular Synthesis AudioWorkletProcessor
 *
 * Grain Spawning Model:
 * - Trail length controls grain length AND spawn rate (smoothness via overlap)
 * - Velocity controls grain volume only (audiovisual connection)
 * - Overlap-based rate calculation ensures smooth audio with minimal grain count
 *
 * This is the complete AudioWorklet processor code that gets embedded
 * into the audio context for real-time granular synthesis
 */

export const WORKLET_PROCESSOR_CODE = `
/**
 * Motion-Driven Granular Synthesis AudioWorkletProcessor
 *
 * Grain Spawning Model:
 * - Trail length controls grain length AND spawn rate (smoothness via overlap)
 * - Velocity controls grain volume only (audiovisual connection)
 * - Overlap-based rate calculation ensures smooth audio with minimal grain count
 */
class GranularProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Audio buffers for species samples
        this.audioBuffers = new Array(8).fill(null);
        this.sampleRates = new Array(8).fill(sampleRate);

        // PHASE 3 OPTIMIZATION: Pre-filtered frequency bands
        // Each species can have multiple frequency bands (or just one if pre-filtering disabled)
        this.frequencyBands = new Array(8).fill(null); // [species] = [band0, band1, ..., bandN]
        this.numBands = 1; // Default: 1 band (no pre-filtering)

        // Motion-driven grain management
        this.particleGrains = new Map(); // particle ID -> grain instances
        this.activeGrains = [];          // currently playing grains
        this.grainIdCounter = 0;

        // Granular synthesis parameters (updated from main thread)
        this.granularConfig = {
            grainLengthMin: 0.02,
            grainLengthMax: 0.5,
            overlapMin: 0.5,
            overlapMax: 4.0,
            velocityThreshold: 0.01,
            maxVelocity: 3.0,
            maxGrainRate: 200.0,
            gainPowerDefault: 1.5,
            releaseTimeMin: 0.02,
            releaseTimeMax: 0.3,
            windowSigmaFactor: 0.25,
            freqRangeMin: 20.0,
            freqRangeMax: 15000.0,
            freqGamma: 0.6,
            bandwidthOctavesMax: 4.0,
            bandwidthRefHz: 1000,
            softLimiterThreshold: 0.98,
            softLimiterGain: 1.25
        };

        // Audio state
        this.currentTime = 0;

        // Volume metering - improved for accurate clipping detection
        this.peakLevel = 0;          // Peak sample value
        this.rmsLevel = 0;            // RMS (average power) level
        this.peakDecay = 0.98;        // Slower decay for smoother peak reading
        this.rmsDecay = 0.95;         // Decay for RMS
        this.rmsWindowSize = 128;     // Sample window for RMS calculation
        this.rmsBuffer = new Float32Array(this.rmsWindowSize);
        this.rmsBufferIndex = 0;

        // Clipping detection thresholds
        this.clipWarningThreshold = 0.8;   // Orange warning at 80%
        this.clipDangerThreshold = 0.95;    // Red danger at 95%
        this.clippingDetected = false;

        // Performance optimization buffers
        this.mixedGrainBuffer = new Float32Array(128);
        this.tempFilterBuffer = new Float32Array(128);

        // Filter states for frequency band processing
        // Using cascaded one-pole filters (2 stages each) for 12dB/octave rolloff
        this.filterStates = new Map(); // particle ID -> filter state

        // Voice management
        this.maxVoicesPerSpecies = [8, 8, 8, 8, 8, 8, 8, 8];

        // Simple voice allocation for visual feedback
        // Maps species -> Set<particleId> of particles that should be lit up
        this.voiceAllocations = new Map();

        // Voice stealing system (SIMPLIFIED)
        this.voiceStealingDelay = 50; // milliseconds - controls EMA alpha (response time)
        this.voiceStealingCrossfade = 50; // milliseconds - controls audio crossfade duration
        this.voiceAllocationUpdateInterval = 0.016; // seconds (16ms = 60fps for smooth visual feedback)
        this.lastVoiceAllocationUpdate = 0;

        // EMA smoothed velocities for stable voice allocation
        // voiceStealingDelay controls alpha: shorter delay = more responsive, longer = more smoothing
        this.particleSmoothedVelocities = new Map(); // particleId -> smoothedVelocity (EMA)

        // Audio crossfade system for smooth voice stealing transitions
        // When voice allocations change, particles enter fadeIn (0→100% volume) or fadeOut (100→0% volume)
        // Equal-power crossfade (√progress curves) maintains constant acoustic energy during transitions
        // Eliminates volume spikes and audio clicks when maxVoices changes
        this.particleAudioCrossfade = new Map(); // particleId -> { type: 'fadeIn'|'fadeOut', startTime, duration }

        // Audio processing parameters
        this.sampleRanges = null;
        this.sampleVolumes = null;
        this.samplePitches = null;
        this.mutedSpecies = [false, false, false, false, false, false, false, false]; // Mute state per species

        // Previous particle states for motion detection
        this.previousParticleStates = new Map();

        // Grain scheduling timers per particle
        this.particleGrainTimers = new Map(); // particle ID -> { nextGrainTime, grainRate, stutterSeed }

        // CPU usage tracking for performance monitoring
        this.cpuUsageHistory = [];
        this.cpuUsageHistorySize = 60; // Track last 60 callbacks (~0.17s at 128 samples/callback)
        this.lastCpuReportTime = 0;
        this.cpuReportInterval = 0.5; // Report every 500ms

        // PHASE 2 OPTIMIZATION: Debug mode flag (disable logging in production for 2-3% CPU savings)
        this.debugMode = false; // Set to true for debugging, false for production

        // Debug: Track grain and timer statistics for leak detection
        this.debugStats = {
            lastReportTime: 0,
            reportInterval: 2.0, // Report every 2 seconds
            maxGrainTimers: 0,
            maxActiveGrains: 0,
            totalGrainsSpawned: 0,
            timerLeakWarnings: 0
        };

        // Initialize message handling
        this.port.onmessage = this.handleMessage.bind(this);
        console.log('Motion-driven granular processor initialized');
    }

    handleMessage(event) {
        try {
            if (!event || !event.data) {
                console.warn('AudioWorklet: Invalid message received');
                return;
            }

            const { type } = event.data;

            switch (type) {
                case 'audioBuffer':
                    this.loadAudioBuffer(event.data);
                    break;

                case 'audioBufferBands':
                    // PHASE 3 OPTIMIZATION: Load pre-filtered frequency bands
                    this.loadAudioBufferBands(event.data);
                    break;

                case 'particleUpdate':
                    if (event.data.particles && Array.isArray(event.data.particles)) {
                        // Update granular config if provided
                        if (event.data.granularConfig) {
                            this.granularConfig = { ...this.granularConfig, ...event.data.granularConfig };
                        }
                        this.updateParticles(event.data.particles);
                    } else {
                        console.warn('AudioWorklet: Invalid particle data received');
                    }
                    break;

                case 'pauseStateUpdate':
                    if (typeof event.data.isPaused === 'boolean') {
                        this.handlePauseState(event.data.isPaused);
                    }
                    break;

                case 'batchParameterUpdate':
                    // Handle batch parameter updates with validation
                    if (event.data.updates && typeof event.data.updates === 'object') {
                        const { updates } = event.data;
                        try {
                            if (updates.sampleRanges && updates.sampleRanges.ranges) {
                                this.sampleRanges = updates.sampleRanges.ranges;
                            }
                            if (updates.audioParameters) {
                                if (updates.audioParameters.volumes) {
                                    this.sampleVolumes = updates.audioParameters.volumes;
                                }
                                if (updates.audioParameters.pitches) {
                                    this.samplePitches = updates.audioParameters.pitches;
                                }
                            }
                            if (updates.voiceManagement) {
                                if (updates.voiceManagement.maxVoicesPerSpecies) {
                                    // Store previous values before updating
                                    this.previousMaxVoices = [...this.maxVoicesPerSpecies];
                                    this.maxVoicesPerSpecies = updates.voiceManagement.maxVoicesPerSpecies;

                                    // Detect if any maxVoices changed (user slider adjustment)
                                    const maxVoicesChanged = this.maxVoicesPerSpecies.some((val, idx) =>
                                        val !== this.previousMaxVoices[idx]
                                    );

                                    if (maxVoicesChanged) {
                                        console.log('[maxVoices changed] Forcing immediate voice allocation update');
                                        // Force next update to process immediately by resetting timer
                                        this.lastVoiceAllocationUpdate = 0;
                                    }
                                }
                            }
                            if (updates.muteState && updates.muteState.mutedSpecies) {
                                this.mutedSpecies = updates.muteState.mutedSpecies;
                            }
                        } catch (batchError) {
                            console.error('AudioWorklet: Error in batch parameter update:', batchError);
                        }
                    }
                    break;

                case 'voiceStealingDelay':
                    if (typeof event.data.delay === 'number') {
                        this.voiceStealingDelay = Math.max(1, Math.min(500, event.data.delay));
                        console.log('AudioWorklet: Voice stealing delay set to ' + this.voiceStealingDelay + 'ms');
                    }
                    break;

                case 'voiceStealingCrossfade':
                    if (typeof event.data.duration === 'number') {
                        this.voiceStealingCrossfade = Math.max(10, Math.min(500, event.data.duration));
                        console.log('AudioWorklet: Voice stealing crossfade set to ' + this.voiceStealingCrossfade + 'ms');
                    }
                    break;

                default:
                    console.warn('AudioWorklet: Unknown message type: ' + type);
            }
        } catch (error) {
            console.error('AudioWorklet: Error in handleMessage:', error);
        }
    }

    // Load audio buffer for species
    loadAudioBuffer(data) {
        const { species, sampleRate, length, numberOfChannels, channelData } = data;
        const buffer = {
            sampleRate,
            length,
            numberOfChannels,
            channels: channelData.map(channel => new Float32Array(channel))
        };
        this.audioBuffers[species] = buffer;
        this.sampleRates[species] = sampleRate;
        console.log('Audio buffer loaded for species', species);
    }

    // PHASE 3 OPTIMIZATION: Load pre-filtered frequency bands
    loadAudioBufferBands(data) {
        const { species, numBands, bands } = data;

        // Store all bands for this species
        const bandBuffers = bands.map(bandData => ({
            sampleRate: bandData.sampleRate,
            length: bandData.length,
            numberOfChannels: bandData.numberOfChannels,
            channels: bandData.channels.map(channel => new Float32Array(channel))
        }));

        this.frequencyBands[species] = bandBuffers;
        this.numBands = numBands;

        // Also store the first band as the default audioBuffer for backward compatibility
        this.audioBuffers[species] = bandBuffers[0];
        this.sampleRates[species] = bandBuffers[0].sampleRate;

        console.log('Audio buffer bands loaded for species', species, ':', numBands, 'bands');
    }

    // PHASE 2 OPTIMIZATION: Linear interpolation for sample reading
    // Switched from cubic (4 samples + complex math) to linear (2 samples + simple multiply)
    // 30-40% faster with minimal audio quality difference
    readSampleLinear(buffer, idxFloat) {
        const bufferLength = buffer.length;
        if (bufferLength === 0) return 0.0;

        // Wrap index to buffer bounds
        let wrappedIdx = idxFloat;
        if (wrappedIdx < 0 || wrappedIdx >= bufferLength) {
            wrappedIdx = ((wrappedIdx % bufferLength) + bufferLength) % bufferLength;
        }

        const idx = Math.floor(wrappedIdx);
        const fraction = wrappedIdx - idx;

        // Get two samples with wrapping
        const idx2 = (idx + 1) % bufferLength;

        // Simple linear interpolation (2 samples instead of 4)
        return buffer[idx] * (1.0 - fraction) + buffer[idx2] * fraction;
    }

    // Apply velocity curve to normalize gain
    applyVelocityCurve(normalizedVelocity, curvePower) {
        normalizedVelocity = Math.max(0, Math.min(1, normalizedVelocity));
        return Math.pow(normalizedVelocity, curvePower);
    }

    // Motion-driven particle update with grain spawning logic
    updateParticles(particles) {
        // Clean up orphaned timers for particles that no longer exist
        const activeParticleIds = particles.map(p => p.id);
        if (activeParticleIds.length > 0) {
            this.cleanupOrphanedTimers(activeParticleIds);
        }

        // Update voice allocations for visual feedback (simple and fast)
        this.updateVoiceAllocations(particles);

        // Process each particle for motion detection and grain scheduling
        for (const particle of particles) {
            const { id, species, xPosition, yPosition, particleSize, velocity, trailParameter,
                   isMoving, velocityCurvePower, volumeScale } = particle;

            const buffer = this.audioBuffers[species];
            if (!buffer) continue;

            // Motion hysteresis to prevent audio dropouts from velocity fluctuations
            const prevState = this.previousParticleStates.get(id);
            let currentlyMoving = isMoving;

            // PHASE 3 OPTIMIZATION: Apply hysteresis with higher thresholds to skip nearly-still particles
            if (prevState && prevState.wasAudioActive !== undefined) {
                const stopThreshold = this.granularConfig.velocityThreshold * 0.6; // 0.018 - lower to stop
                const startThreshold = this.granularConfig.velocityThreshold * 1.4; // 0.042 - higher to start

                if (prevState.wasAudioActive) {
                    // If audio was active, require velocity to drop below stop threshold to stop
                    currentlyMoving = velocity > stopThreshold;
                } else {
                    // If audio was not active, require velocity to exceed start threshold to start
                    currentlyMoving = velocity > startThreshold;
                }
            }

            // Store state for next frame
            this.previousParticleStates.set(id, {
                xPosition, yPosition, velocity, trailParameter, isMoving,
                wasAudioActive: currentlyMoving
            });

            // Skip grain spawning if particle is not moving (with hysteresis)
            if (!currentlyMoving) {
                // Stop any existing grains for this particle (release phase)
                const existingGrains = this.particleGrains.get(id);
                if (existingGrains) {
                    for (const grain of existingGrains) {
                        grain.isReleasing = true;
                        grain.releaseStartTime = this.currentTime;
                        grain.removalReason = 'stopped';
                    }
                }
                continue;
            }

            // Check voice allocation and crossfade state
            const allocatedVoices = this.voiceAllocations.get(species);
            const hasVoiceAllocation = allocatedVoices && allocatedVoices.has(id);
            const crossfade = this.particleAudioCrossfade.get(id);
            const isFadingOut = crossfade && crossfade.type === 'fadeOut';

            // Determine if particle should spawn grains
            if (!hasVoiceAllocation && !isFadingOut) {
                // Lost voice AND fadeOut complete/never started → stop spawning
                const existingGrains = this.particleGrains.get(id);
                if (existingGrains) {
                    for (const grain of existingGrains) {
                        grain.isReleasing = true;
                        grain.releaseStartTime = this.currentTime;
                        grain.removalReason = 'voice_stolen';
                    }
                }
                // Clean up timer (prevents leak)
                const hadTimer = this.particleGrainTimers.has(id);
                this.particleGrainTimers.delete(id);

                // Debug: Track timer cleanup
                if (this.debugMode && hadTimer) {
                    console.log('[Timer Cleanup] Removed timer for particle ' + id + ' (no voice, no fadeOut)');
                }
                continue;
            }

            // Has voice OR is fading out → proceed to spawn grains
            // fadeIn: grains spawn with increasing gain (0→1 over crossfade)
            // fadeOut: grains spawn with decreasing gain (1→0 over crossfade)
            // After fadeOut completes, crossfade entry deleted and particle loops back here with no voice + no crossfade → timer cleanup

            // Calculate grain parameters from trail and velocity
            // Trail length controls grain length and overlap (smoothness)
            const grainLength = this.granularConfig.grainLengthMin +
                (trailParameter * (this.granularConfig.grainLengthMax - this.granularConfig.grainLengthMin));

            const overlapFactor = this.granularConfig.overlapMin +
                (trailParameter * (this.granularConfig.overlapMax - this.granularConfig.overlapMin));

            // SIMPLIFIED: Grain rate based purely on overlap requirement
            // Long grains (high trail) → fewer spawns needed for smooth audio
            // Short grains (low trail) → more spawns needed to avoid gaps
            // Velocity controls volume only, not spawn rate
            const grainRate = Math.min(
                overlapFactor / grainLength,
                this.granularConfig.maxGrainRate  // Safety cap at 200 Hz
            );

            // Velocity controls VOLUME (audiovisual connection), not spawn rate
            let grainGain = this.applyVelocityCurve(velocity, velocityCurvePower) * volumeScale;

            // PHASE 3 BUGFIX: Soft-start gain ramping for smooth acoustic threshold
            // Particles in "soft-start zone" (0.03-0.06) fade in gradually instead of hard cut-in
            // This maintains CPU benefits while creating natural-sounding velocity curves
            const softStartMin = this.granularConfig.velocityThreshold; // 0.03
            const softStartMax = this.granularConfig.velocityThreshold * 2.0; // 0.06
            if (velocity < softStartMax) {
                // Calculate soft-start gain multiplier (0.0 at threshold, 1.0 at 2x threshold)
                const softStartProgress = Math.max(0, (velocity - softStartMin) / (softStartMax - softStartMin));
                const softStartGain = softStartProgress * softStartProgress; // Quadratic curve for natural feel
                grainGain *= softStartGain;
            }

            // Get or create grain timer for this particle
            // Timers are deleted when voice is lost, so fresh allocations always start clean
            let grainTimer = this.particleGrainTimers.get(id);
            if (!grainTimer) {
                grainTimer = {
                    nextGrainTime: this.currentTime,
                    grainRate
                };
                this.particleGrainTimers.set(id, grainTimer);
            }

            // Update grain rate
            grainTimer.grainRate = grainRate;

            // Schedule new grains based on rate with burst prevention
            const grainInterval = 1.0 / grainRate;

            // Clamp timer if drifted too far (tab backgrounding, CPU spikes)
            if (grainTimer.nextGrainTime < this.currentTime - 0.5) {
                // Timer drifted >500ms - reset to current time instead of burst spawning
                grainTimer.nextGrainTime = this.currentTime;
            }

            // Limit grain spawning per particle per update to prevent audio spikes
            // OPTIMIZED: Reduced from 4 to 2 grains per update for better CPU performance
            let grainsSpawnedThisUpdate = 0;
            while (grainTimer.nextGrainTime <= this.currentTime && grainsSpawnedThisUpdate < 2) {
                this.spawnGrain(id, species, xPosition, yPosition, particleSize,
                              grainLength, grainGain, trailParameter);
                grainTimer.nextGrainTime += grainInterval;
                grainsSpawnedThisUpdate++;
            }
        }

        // Voice activity is now updated in process() method for continuous tracking
        // Note: Volume metering moved to voiceState message for unified updates
    }

    // Spawn a new grain for motion-driven synthesis
    spawnGrain(particleId, species, xPosition, yPosition, particleSize, grainLength, grainGain, trailParameter) {
        // Check if species is muted - if so, skip grain spawning
        if (this.mutedSpecies && this.mutedSpecies[species]) return;

        const buffer = this.audioBuffers[species];
        if (!buffer || !buffer.channels || buffer.channels.length === 0) return;

        const bufferLength = buffer.length;
        const sampleRange = this.sampleRanges ? this.sampleRanges[species] : { start: 0, end: 1 };

        // Calculate sample position from X position
        const rangeStart = sampleRange.start * bufferLength;
        const rangeLength = (sampleRange.end - sampleRange.start) * bufferLength;
        const centerSample = rangeStart + (xPosition * rangeLength);

        // Calculate grain length in samples with pitch shift
        // Convert semitones to playback rate: rate = 2^(semitones/12)
        // Positive semitones = faster playback (higher pitch), negative = slower (lower pitch)
        const pitchSemitones = (this.samplePitches && this.samplePitches[species]) ? this.samplePitches[species] : 0;
        const playbackRate = Math.pow(2, pitchSemitones / 12.0);
        const grainLengthSamples = Math.max(1, Math.round(grainLength * this.sampleRates[species] * playbackRate));

        // PHASE 3 OPTIMIZATION: Select pre-filtered frequency band instead of runtime filtering
        let bandIndex = 0;
        let numStages = 0;
        let lowpassAlpha = 0;
        let highpassAlpha = 0;
        let compensationGain = 1.0;

        if (this.frequencyBands[species] && this.numBands > 1) {
            // Pre-filtered bands enabled: select band based on Y-position
            bandIndex = Math.floor(yPosition * this.numBands);
            bandIndex = Math.max(0, Math.min(bandIndex, this.numBands - 1));
            // No runtime filtering needed, pre-filtered bands handle it
            numStages = 0;
        } else {
            // Legacy path: runtime filtering (used when pre-filtering disabled)
            const f_min = this.granularConfig.freqRangeMin;
            const f_max = this.granularConfig.freqRangeMax;
            const gamma = this.granularConfig.freqGamma;
            const y = 1.0 - yPosition; // Invert: top=high, bottom=low
            const fc = f_min * Math.pow(f_max / f_min, Math.pow(y, gamma));

            const BW_oct = particleSize * this.granularConfig.bandwidthOctavesMax;
            const BW_hz = fc * (Math.pow(2, BW_oct / 2) - Math.pow(2, -BW_oct / 2));
            const lowFreq = Math.max(f_min, fc * Math.pow(2, -BW_oct / 2));
            const highFreq = Math.min(f_max, fc * Math.pow(2, BW_oct / 2));

            // Determine filter stages based on particle size
            if (particleSize <= 0.3) {
                numStages = 2; // 12dB/octave
            } else {
                numStages = 1; // 6dB/octave
            }

            // Pre-calculate normalized frequencies
            const nyquist = this.sampleRates[species] / 2;
            const lowFreqNorm = Math.min(lowFreq / nyquist, 0.95);
            const highFreqNorm = Math.min(highFreq / nyquist, 0.95);

            // Pre-calculate filter alphas (for one-pole filters)
            lowpassAlpha = 1.0 - Math.exp(-2.0 * Math.PI * highFreqNorm);
            highpassAlpha = 1.0 - Math.exp(-2.0 * Math.PI * lowFreqNorm);

            // Pre-calculate compensation gain
            const BW_ref = this.granularConfig.bandwidthRefHz;
            compensationGain = Math.min(Math.sqrt(BW_ref / BW_hz), 10.0);
        }

        // Create grain object
        const grain = {
            id: this.grainIdCounter++,
            particleId,
            species,

            // Playback parameters
            centerSample,
            grainLengthSamples,
            playbackPosition: 0, // 0-1 within grain

            // Audio parameters
            gain: grainGain,
            xPosition, // for panning
            yPosition, // for frequency filtering
            particleSize, // for bandwidth

            // PHASE 3 OPTIMIZATION: Pre-filtered frequency band index
            bandIndex: bandIndex,

            // PRE-CALCULATED FILTER PARAMETERS (only used if pre-filtering disabled)
            filterNumStages: numStages,
            filterLowpassAlpha: lowpassAlpha,
            filterHighpassAlpha: highpassAlpha,
            filterCompensationGain: compensationGain,

            // Grain lifecycle
            startTime: this.currentTime,
            duration: grainLength,
            isReleasing: false,
            releaseStartTime: 0,
            // Release time: 8ms for trail=0 (quick fade), 300ms for trail=1.0 (smooth fade)
            releaseTime: 0.008 + (trailParameter * (this.granularConfig.releaseTimeMax - 0.008)),

            // PHASE 3 OPTIMIZATION: Store overlap factor for adaptive envelope calculation
            // More overlap = longer fades for smoother sound, less overlap = shorter fades to prevent gaps
            overlapFactor: this.granularConfig.overlapMin +
                (trailParameter * (this.granularConfig.overlapMax - this.granularConfig.overlapMin)),

            // Removal tracking for voice activity system
            removalReason: null, // Will be set when grain is marked for removal: 'natural', 'stolen', 'stopped'

            // PHASE 2C OPTIMIZATION: Cached crossfade gain to reduce getCrossfadeGain() calls
            cachedCrossfadeGain: 1.0,
            lastCrossfadeUpdate: 0
        };

        // Add to active grains
        this.activeGrains.push(grain);

        // Track grains per particle for release management
        if (!this.particleGrains.has(particleId)) {
            this.particleGrains.set(particleId, []);
        }
        this.particleGrains.get(particleId).push(grain);

        // Debug: Track grain spawning statistics
        this.debugStats.totalGrainsSpawned++;

        // Voice limiting is now handled before particle processing in updateParticles()
    }

    // REMOVED: hasSignificantVelocityChange() - no longer needed with simplified system
    // Voice allocation now uses direct EMA-smoothed velocity sorting

    // SIMPLIFIED: Voice allocation with EMA-smoothed velocities and direct allocation
    // User's voiceStealingDelay slider controls EMA alpha (response time)
    updateVoiceAllocations(particles) {
        // Throttle voice allocation updates to reduce CPU usage and provide stability
        if (this.currentTime - this.lastVoiceAllocationUpdate < this.voiceAllocationUpdateInterval) {
            return; // Skip update, not enough time has passed
        }
        this.lastVoiceAllocationUpdate = this.currentTime;

        // Calculate alpha from user's voiceStealingDelay slider
        // Formula: alpha = updateInterval / (targetDelay + updateInterval)
        // Shorter delay = higher alpha (more responsive), longer delay = lower alpha (more smoothing)
        const updateInterval = 16; // ms (60fps)
        const alpha = updateInterval / (this.voiceStealingDelay + updateInterval);
        for (const particle of particles) {
            const prevSmoothed = this.particleSmoothedVelocities.get(particle.id);
            if (prevSmoothed !== undefined) {
                // Apply EMA: smoothed = (alpha × current) + ((1 - alpha) × previous)
                particle.smoothedVelocity = (alpha * particle.rawVelocity) + ((1 - alpha) * prevSmoothed);
            } else {
                // First time seeing this particle, initialize with current velocity
                particle.smoothedVelocity = particle.rawVelocity;
            }
            this.particleSmoothedVelocities.set(particle.id, particle.smoothedVelocity);
        }

        // Group particles by species
        const bySpecies = new Map();
        for (const particle of particles) {
            if (!bySpecies.has(particle.species)) {
                bySpecies.set(particle.species, []);
            }
            bySpecies.get(particle.species).push(particle);
        }

        // For each species, sort by smoothed velocity and allocate top maxVoices particles
        for (const [species, speciesParticles] of bySpecies) {
            // Skip if no audio buffer loaded
            if (!this.audioBuffers[species]) continue;

            // Skip if no particles
            if (speciesParticles.length === 0) continue;

            const maxVoices = this.maxVoicesPerSpecies[species];
            const particleCount = speciesParticles.length;
            const currentAllocations = this.voiceAllocations.get(species);

            // Calculate new allocations based on smoothed velocities
            let newAllocations;

            if (particleCount <= maxVoices) {
                // Under limit - allocate all particles
                newAllocations = new Set(speciesParticles.map(p => p.id));
            } else {
                // Over limit - allocate top maxVoices fastest particles (by smoothed velocity)
                const sortedParticles = [...speciesParticles]
                    .sort((a, b) => b.smoothedVelocity - a.smoothedVelocity);
                const topParticles = sortedParticles.slice(0, maxVoices);
                newAllocations = new Set(topParticles.map(p => p.id));
            }

            // Check if allocations changed
            const allocationsChanged = !this.areSetsEqual(currentAllocations, newAllocations);

            if (!allocationsChanged) {
                continue; // No change, skip this species
            }

            // Apply new allocations with crossfades for smooth transitions
            const crossfadeDuration = this.voiceStealingCrossfade / 1000.0; // Convert ms to seconds

            // Set up fadeIn for newly allocated particles
            let fadeInCount = 0;
            for (const particleId of newAllocations) {
                if (!currentAllocations || !currentAllocations.has(particleId)) {
                    this.particleAudioCrossfade.set(particleId, {
                        type: 'fadeIn',
                        startTime: this.currentTime * 1000,
                        duration: crossfadeDuration * 1000
                    });
                    fadeInCount++;
                }
            }

            // Set up fadeOut for de-allocated particles
            let fadeOutCount = 0;
            if (currentAllocations) {
                for (const particleId of currentAllocations) {
                    if (!newAllocations.has(particleId)) {
                        this.particleAudioCrossfade.set(particleId, {
                            type: 'fadeOut',
                            startTime: this.currentTime * 1000,
                            duration: crossfadeDuration * 1000
                        });
                        fadeOutCount++;
                    }
                }
            }

            // Apply the allocation
            this.voiceAllocations.set(species, newAllocations);

            if (fadeInCount > 0 || fadeOutCount > 0) {
                console.log(\`[Crossfade] Species \${species}: \${fadeInCount} fadeIn + \${fadeOutCount} fadeOut (duration: \${Math.round(crossfadeDuration * 1000)}ms)\`);
            }
        }
    }

    // Helper: Compare two Sets for equality
    areSetsEqual(set1, set2) {
        if (!set1 || !set2) return false;
        if (set1.size !== set2.size) return false;
        for (const item of set1) {
            if (!set2.has(item)) return false;
        }
        return true;
    }

    // Clean up orphaned timers and states for particles that no longer exist
    // Also performs defensive cleanup for particles that have been idle too long
    cleanupOrphanedTimers(activeParticleIds) {
        const activeIds = new Set(activeParticleIds);
        let cleanupCount = 0;

        // Clean up orphaned grain timers
        for (const [particleId] of this.particleGrainTimers) {
            if (!activeIds.has(particleId)) {
                this.particleGrainTimers.delete(particleId);
                cleanupCount++;
            }
        }

        // Clean up orphaned particle states
        for (const [particleId] of this.previousParticleStates) {
            if (!activeIds.has(particleId)) {
                this.previousParticleStates.delete(particleId);
            }
        }

        // Clean up orphaned particle grain tracking
        for (const [particleId] of this.particleGrains) {
            if (!activeIds.has(particleId)) {
                this.particleGrains.delete(particleId);
            }
        }

        // Clean up orphaned audio crossfade states
        for (const [particleId] of this.particleAudioCrossfade) {
            if (!activeIds.has(particleId)) {
                this.particleAudioCrossfade.delete(particleId);
            }
        }

        // BUGFIX: Clean up orphaned smoothed velocities
        for (const [particleId] of this.particleSmoothedVelocities) {
            if (!activeIds.has(particleId)) {
                this.particleSmoothedVelocities.delete(particleId);
            }
        }

        // DEFENSIVE CLEANUP: Remove timers for particles that have no active grains
        // This catches cases where a particle stopped moving but timer wasn't cleaned up
        for (const [particleId] of this.particleGrainTimers) {
            const particleGrains = this.particleGrains.get(particleId);
            if (!particleGrains || particleGrains.length === 0) {
                // Particle has a timer but no grains - likely idle, clean up timer
                this.particleGrainTimers.delete(particleId);
                cleanupCount++;
            }
        }

        if (this.debugMode && cleanupCount > 0) {
            console.log('[Cleanup] Removed ' + cleanupCount + ' orphaned grain timers');
        }
    }

    // Send voice state to main thread for visual feedback
    sendVoiceStateToMainThread() {
        // Convert Maps to plain objects for messaging
        const allocations = {};
        for (const [species, particleSet] of this.voiceAllocations) {
            allocations[species] = Array.from(particleSet);
        }

        const crossfades = {};
        const currentTimeMs = this.currentTime * 1000;
        for (const [particleId, fadeState] of this.particleAudioCrossfade) {
            const elapsed = currentTimeMs - fadeState.startTime;
            const progress = Math.min(elapsed / fadeState.duration, 1.0);
            crossfades[particleId] = {
                type: fadeState.type,
                progress: progress
            };
        }

        // Calculate and send CPU usage periodically (every 500ms)
        const timeSinceLastReport = this.currentTime - this.lastCpuReportTime;
        let cpuUsage = null;
        if (timeSinceLastReport >= this.cpuReportInterval && this.cpuUsageHistory.length > 0) {
            // Calculate average CPU usage
            const sum = this.cpuUsageHistory.reduce((a, b) => a + b, 0);
            cpuUsage = sum / this.cpuUsageHistory.length;
            this.lastCpuReportTime = this.currentTime;
        }

        this.port.postMessage({
            type: 'voiceState',
            allocations: allocations,
            crossfades: crossfades,
            cpuUsage: cpuUsage, // null if not time to report yet
            // Volume metering with clipping detection
            peakLevel: this.peakLevel,
            rmsLevel: this.rmsLevel,
            clipping: this.clippingDetected
        });
    }

    handlePauseState(isPaused) {
        if (isPaused) {
            // Release all active grains
            for (const grain of this.activeGrains) {
                grain.isReleasing = true;
                grain.releaseStartTime = this.currentTime;
                grain.releaseTime = 0.01; // Quick fade for pause
                grain.removalReason = 'paused';
            }
            this.particleGrains.clear();
            this.particleGrainTimers.clear();
            this.previousParticleStates.clear();
            this.voiceAllocations.clear();
            this.particleAudioCrossfade.clear();
        }
        console.log('Audio worklet pause state:', isPaused ? 'paused' : 'resumed');
    }

    // Main audio processing loop for motion-driven grains
    process(inputs, outputs, parameters) {
        const processStartTime = Date.now(); // Measure CPU usage (Date.now available in worklets)

        const output = outputs[0];
        const outputChannels = output.length;
        const bufferLength = output[0].length;

        // Clear output buffers
        for (let channel = 0; channel < outputChannels; channel++) {
            output[channel].fill(0);
        }

        // Process all active grains
        if (this.activeGrains.length === 0) {
            this.currentTime += bufferLength / sampleRate;
            return true;
        }

        // Clear temporary buffers
        this.mixedGrainBuffer.fill(0, 0, bufferLength);
        this.tempFilterBuffer.fill(0, 0, bufferLength);

        // Process each grain
        for (let grainIndex = this.activeGrains.length - 1; grainIndex >= 0; grainIndex--) {
            const grain = this.activeGrains[grainIndex];

            // Check if grain should be removed
            const grainAge = this.currentTime - grain.startTime;
            const shouldRemove = this.processGrain(grain, grainAge, bufferLength, output);

            if (shouldRemove) {
                // Remove grain from active list
                this.activeGrains.splice(grainIndex, 1);

                // Remove from particle grain tracking
                const particleGrains = this.particleGrains.get(grain.particleId);
                if (particleGrains) {
                    const grainIdx = particleGrains.indexOf(grain);
                    if (grainIdx !== -1) {
                        particleGrains.splice(grainIdx, 1);
                    }
                    if (particleGrains.length === 0) {
                        this.particleGrains.delete(grain.particleId);
                    }
                }

                // Clean up filter state for removed grain
                this.filterStates.delete(grain.id);
            }
        }

        // √N normalization removed - soft limiter provides adaptive protection instead

        // Calculate volume level BEFORE soft limiter for accurate clipping detection
        let maxSample = 0;
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            for (let channel = 0; channel < outputChannels; channel++) {
                const sample = Math.abs(output[channel][i]);
                maxSample = Math.max(maxSample, sample);
                sumSquares += sample * sample;
            }
        }

        // Update peak level with decay (slower for smoother visual feedback)
        this.peakLevel = Math.max(maxSample, this.peakLevel * this.peakDecay);

        // Calculate RMS (Root Mean Square) - average power level
        const currentRMS = Math.sqrt(sumSquares / (bufferLength * outputChannels));

        // Store RMS sample in circular buffer
        this.rmsBuffer[this.rmsBufferIndex] = currentRMS;
        this.rmsBufferIndex = (this.rmsBufferIndex + 1) % this.rmsWindowSize;

        // Calculate smoothed RMS from buffer
        let rmsSum = 0;
        for (let i = 0; i < this.rmsWindowSize; i++) {
            rmsSum += this.rmsBuffer[i];
        }
        this.rmsLevel = rmsSum / this.rmsWindowSize;

        // Detect clipping (using peak level for accurate detection)
        const wasClipping = this.clippingDetected;
        this.clippingDetected = this.peakLevel >= this.clipDangerThreshold;

        // Apply soft limiting (after metering to preserve true peak detection)
        const threshold = this.granularConfig.softLimiterThreshold;
        const gain = this.granularConfig.softLimiterGain;
        for (let i = 0; i < bufferLength; i++) {
            for (let channel = 0; channel < outputChannels; channel++) {
                const sample = output[channel][i];
                if (Math.abs(sample) > threshold) {
                    output[channel][i] = Math.sign(sample) *
                        (threshold + (gain - threshold) * Math.tanh((Math.abs(sample) - threshold) * 3));
                }
            }
        }

        this.currentTime += bufferLength / sampleRate;

        // Periodic cleanup of expired crossfades (every ~1 second)
        // Prevents memory leak if getCrossfadeGain() never called for a particle
        if (this.currentTime % 1.0 < (bufferLength / sampleRate)) {
            for (const [particleId, fadeState] of this.particleAudioCrossfade) {
                const elapsed = (this.currentTime * 1000) - fadeState.startTime;  // Convert to ms
                if (elapsed >= fadeState.duration) {
                    this.particleAudioCrossfade.delete(particleId);
                }
            }
        }

        // Calculate CPU usage for this process callback
        const processEndTime = Date.now();
        const processingTime = processEndTime - processStartTime; // Already in ms
        const callbackDuration = (bufferLength / sampleRate) * 1000; // Expected time in ms
        const cpuUsage = (processingTime / callbackDuration) * 100;

        // Track CPU usage history for averaging
        this.cpuUsageHistory.push(cpuUsage);
        if (this.cpuUsageHistory.length > this.cpuUsageHistorySize) {
            this.cpuUsageHistory.shift();
        }

        // Send voice state to main thread for visual feedback
        this.sendVoiceStateToMainThread();

        // Debug: Track and report grain/timer statistics
        this.debugStats.maxGrainTimers = Math.max(this.debugStats.maxGrainTimers, this.particleGrainTimers.size);
        this.debugStats.maxActiveGrains = Math.max(this.debugStats.maxActiveGrains, this.activeGrains.length);

        // Report statistics periodically (only in debug mode)
        if (this.debugMode && this.currentTime - this.debugStats.lastReportTime >= this.debugStats.reportInterval) {
            const timerCount = this.particleGrainTimers.size;
            const grainCount = this.activeGrains.length;
            const particleGrainsSize = this.particleGrains.size;
            const crossfadeCount = this.particleAudioCrossfade.size;

            // Calculate grain spawn rate
            const elapsed = this.currentTime - this.debugStats.lastReportTime;
            const grainSpawnRate = elapsed > 0 ? (this.debugStats.totalGrainsSpawned / elapsed).toFixed(1) : 0;

            console.log('[Grain Debug] Stats:', {
                'Grain Timers': timerCount,
                'Active Grains': grainCount,
                'Particle Grains Tracked': particleGrainsSize,
                'Crossfading': crossfadeCount,
                'Spawn Rate': grainSpawnRate + ' grains/sec',
                'Total Spawned': this.debugStats.totalGrainsSpawned
            });

            // Warn if timer count seems abnormally high
            // Timer count should roughly match number of moving particles
            if (timerCount > particleGrainsSize * 1.5) {
                this.debugStats.timerLeakWarnings++;
                console.warn('[Grain Timer Leak?] Timer count (' + timerCount + ') exceeds tracked particles (' + particleGrainsSize + ') by 50%+. Warning #' + this.debugStats.timerLeakWarnings);
            }

            // Reset counters
            this.debugStats.lastReportTime = this.currentTime;
            this.debugStats.totalGrainsSpawned = 0;
        }

        return true;
    }

    // Process individual grain with frequency filtering and envelope
    processGrain(grain, grainAge, bufferLength, output) {
        // PHASE 3 OPTIMIZATION: Select source buffer from pre-filtered band or use original
        let buffer;
        if (this.frequencyBands[grain.species] && this.numBands > 1) {
            // Use pre-filtered frequency band
            buffer = this.frequencyBands[grain.species][grain.bandIndex];
        } else {
            // Use original buffer (legacy path)
            buffer = this.audioBuffers[grain.species];
        }

        if (!buffer || !buffer.channels || buffer.channels.length === 0) {
            return true; // Remove grain
        }

        const sourceData = buffer.channels[0];
        const sampleRate = this.sampleRates[grain.species];

        // Check if grain should be released or removed
        if (grain.isReleasing) {
            const releaseElapsed = this.currentTime - grain.releaseStartTime;
            if (releaseElapsed >= grain.releaseTime) {
                return true; // Remove grain
            }
        } else if (grainAge >= grain.duration) {
            grain.isReleasing = true;
            grain.releaseStartTime = this.currentTime;
            grain.removalReason = 'natural';
        }

        // Calculate grain envelope
        let envelopeGain = 1.0;
        const grainProgress = Math.min(grainAge / grain.duration, 1.0);

        if (grain.isReleasing) {
            // Release envelope
            const releaseElapsed = this.currentTime - grain.releaseStartTime;
            const releaseProgress = Math.min(releaseElapsed / grain.releaseTime, 1.0);
            envelopeGain = 1.0 - releaseProgress;
        } else {
            // PHASE 3 OPTIMIZATION: Adaptive envelope based on overlap factor
            // More overlap = longer fades for smooth sound, less overlap = shorter fades to prevent clicks
            // BUGFIX: Increased base envelope from 0.15 → 0.20 to prevent clicks at low trails
            // Low overlap (1.2x, trails=0.05) → 20% envelope minimum
            // High overlap (2.5x, trails=1.0) → 40% envelope (capped at 0.45 or 45%)
            const baseEnvelopeTime = 0.20;
            const envelopeScale = Math.min(grain.overlapFactor / 1.2, 2.25);
            const attackTime = Math.min(baseEnvelopeTime * envelopeScale, 0.45);
            const releaseTime = attackTime; // Symmetric envelope

            if (grainProgress < attackTime) {
                // Attack phase: linear fade in
                envelopeGain = grainProgress / attackTime;
            } else if (grainProgress > (1.0 - releaseTime)) {
                // Release phase: linear fade out
                envelopeGain = (1.0 - grainProgress) / releaseTime;
            } else {
                // Sustain phase: full volume
                envelopeGain = 1.0;
            }
        }

        if (envelopeGain <= 0.001) {
            return grain.isReleasing; // Remove if releasing and silent
        }

        // Process grain samples
        for (let i = 0; i < bufferLength; i++) {
            // PHASE 2C OPTIMIZATION: Update cached crossfade gain every 8 samples (87% reduction)
            // Crossfade changes slowly, so we don't need per-sample precision
            if ((i % 8) === 0) {
                grain.cachedCrossfadeGain = this.getCrossfadeGain(grain.particleId);
                grain.lastCrossfadeUpdate = i;
            }

            // Calculate sample position
            const grainSampleProgress = (grainAge + (i / sampleRate)) / grain.duration;
            if (grainSampleProgress >= 1.0) break;

            const samplePosition = grain.centerSample +
                (grainSampleProgress - 0.5) * grain.grainLengthSamples;

            // Read sample with linear interpolation (optimized)
            const audioSample = this.readSampleLinear(sourceData, samplePosition);

            // Apply per-species volume and pitch
            let processedSample = audioSample;
            if (this.sampleVolumes && this.sampleVolumes[grain.species]) {
                processedSample *= this.sampleVolumes[grain.species];
            }

            // Apply grain gain and envelope
            processedSample *= grain.gain * envelopeGain;

            // Apply cached crossfade gain (updated every 8 samples)
            processedSample *= grain.cachedCrossfadeGain;

            // PHASE 3 OPTIMIZATION: Skip runtime filtering if using pre-filtered bands
            let filteredSample;
            if (this.frequencyBands[grain.species] && this.numBands > 1) {
                // Pre-filtered bands: no runtime filtering needed (20-30% CPU saved!)
                filteredSample = processedSample;
            } else {
                // Legacy path: apply runtime frequency band filtering
                filteredSample = this.applyFrequencyBandFilter(processedSample, grain);
            }

            // Apply stereo panning and add to output
            this.addToStereoOutput(filteredSample, grain.xPosition, output, i);
        }

        return false; // Keep grain
    }

    // Get crossfade gain for smooth voice allocation transitions
    // Handles both fadeIn (attack ramp) and fadeOut (release ramp)
    // Uses equal-power curves (sqrt) for constant acoustic energy during transitions
    // OPTIMIZED: Reduced logging, streamlined calculation
    getCrossfadeGain(particleId) {
        const crossfade = this.particleAudioCrossfade.get(particleId);

        if (!crossfade) {
            return 1.0; // No crossfade, full volume
        }

        const elapsed = (this.currentTime * 1000) - crossfade.startTime;  // Convert to ms
        const progress = Math.min(elapsed / crossfade.duration, 1.0);

        // Check if crossfade complete (done once here instead of in each branch)
        if (progress >= 1.0) {
            this.particleAudioCrossfade.delete(particleId);
            return crossfade.type === 'fadeIn' ? 1.0 : 0.0;
        }

        // Equal-power crossfade curves
        if (crossfade.type === 'fadeIn') {
            // Newly allocated voice: fade in from 0 → 1
            return Math.sqrt(progress);
        } else {
            // De-allocated voice: fade out from 1 → 0
            // Equal-power curve: fadeOut² + fadeIn² = 1.0
            return Math.sqrt(1.0 - progress);
        }
    }

    // Apply frequency band filtering based on Y position and particle size
    // OPTIMIZED: Uses pre-calculated filter parameters from grain object
    applyFrequencyBandFilter(sample, grain) {
        // Get or create filter state for this grain
        // Using adaptive cascaded filters: more stages for smaller particles (sharper filtering)
        let filterState = this.filterStates.get(grain.id);
        if (!filterState) {
            filterState = {
                highpass1: { y1: 0 },  // Highpass stage 1
                highpass2: { y1: 0 },  // Highpass stage 2
                highpass3: { y1: 0 },  // Highpass stage 3 (for small particles)
                highpass4: { y1: 0 },  // Highpass stage 4 (for small particles)
                lowpass1: { y1: 0 },   // Lowpass stage 1
                lowpass2: { y1: 0 },   // Lowpass stage 2
                lowpass3: { y1: 0 },   // Lowpass stage 3 (for small particles)
                lowpass4: { y1: 0 }    // Lowpass stage 4 (for small particles)
            };
            this.filterStates.set(grain.id, filterState);
        }

        // OPTIMIZATION: Use pre-calculated filter parameters from grain object
        // This eliminates expensive calculations per sample (frequency mapping, exp, pow, etc.)
        const numStages = grain.filterNumStages;
        const highFreqAlpha = grain.filterLowpassAlpha;
        const lowFreqAlpha = grain.filterHighpassAlpha;

        // Apply cascaded lowpass filtering (attenuates high frequencies)
        // Using pre-calculated alpha values for one-pole filters
        let filtered = sample;
        for (let stage = 1; stage <= numStages; stage++) {
            const state = filterState['lowpass' + stage];
            state.y1 = state.y1 + highFreqAlpha * (filtered - state.y1);
            filtered = state.y1;
        }

        // Apply cascaded highpass filtering (attenuates low frequencies)
        // Highpass = input - lowpass, but only apply ONCE at the end
        let highpassed = filtered;
        for (let stage = 1; stage <= numStages; stage++) {
            const state = filterState['highpass' + stage];
            state.y1 = state.y1 + lowFreqAlpha * (highpassed - state.y1);
            highpassed = state.y1;
        }
        filtered = filtered - highpassed;

        // Apply pre-calculated compensation gain
        filtered *= grain.filterCompensationGain;

        return filtered;
    }

    // Add sample to stereo output with panning
    addToStereoOutput(sample, xPosition, output, sampleIndex) {
        const outputChannels = output.length;

        if (outputChannels >= 2) {
            // Equal-power panning
            const panPosition = (xPosition * 2) - 1; // -1 to 1
            const panAngle = (panPosition + 1) * Math.PI / 4;
            const leftGain = Math.cos(panAngle);
            const rightGain = Math.sin(panAngle);

            output[0][sampleIndex] += sample * leftGain;
            output[1][sampleIndex] += sample * rightGain;
        } else if (outputChannels >= 1) {
            output[0][sampleIndex] += sample;
        }
    }
}

registerProcessor('granular-processor', GranularProcessor);
`;