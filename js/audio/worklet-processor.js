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
            softLimiterThreshold: 0.8,
            softLimiterGain: 1.25
        };

        // Audio state
        this.currentTime = 0;
        this.volumeLevel = 0;
        this.volumeDecay = 0.95;

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

        // Voice stealing delay system
        this.voiceStealingDelay = 50; // milliseconds (set via message)
        this.voiceStealingCrossfade = 50; // milliseconds (set via message)
        this.lastVoiceAllocationTime = new Map(); // species -> timestamp of last allocation change
        this.pendingVoiceChanges = new Map(); // species -> { newAllocations, changeRequestTime }
        this.voiceAllocationUpdateInterval = 0.016; // seconds (16ms = 60fps for smooth visual feedback)
        this.lastVoiceAllocationUpdate = 0;

        // Track previous maxVoices to detect user-initiated changes
        this.previousMaxVoices = [...this.maxVoicesPerSpecies];

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
                                        console.log('[maxVoices changed] Clearing pending delays for immediate application');
                                        // Clear all pending voice changes to apply immediately
                                        this.pendingVoiceChanges.clear();
                                        // Force next update to process immediately
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

    // Cubic interpolation for high-quality sample reading
    readSampleCubic(buffer, idxFloat) {
        const bufferLength = buffer.length;
        if (bufferLength === 0) return 0.0;

        // Wrap index to buffer bounds
        let wrappedIdx = idxFloat;
        if (wrappedIdx < 0 || wrappedIdx >= bufferLength) {
            wrappedIdx = ((wrappedIdx % bufferLength) + bufferLength) % bufferLength;
        }

        const idx = Math.floor(wrappedIdx);
        const fraction = wrappedIdx - idx;

        // Get surrounding samples with wrapping
        const idx0 = (idx - 1 + bufferLength) % bufferLength;
        const idx1 = idx;
        const idx2 = (idx + 1) % bufferLength;
        const idx3 = (idx + 2) % bufferLength;

        const y0 = buffer[idx0];
        const y1 = buffer[idx1];
        const y2 = buffer[idx2];
        const y3 = buffer[idx3];

        // Cubic interpolation
        const c0 = y1;
        const c1 = 0.5 * (y2 - y0);
        const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);

        return c0 + c1 * fraction + c2 * fraction * fraction + c3 * fraction * fraction * fraction;
    }

    // Gaussian window function for grain envelopes
    gaussianWindow(position, length, sigma) {
        const center = length * 0.5;
        const normalizedPos = (position - center) / (sigma * length);
        return Math.exp(-0.5 * normalizedPos * normalizedPos);
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

            // Apply hysteresis: different thresholds for starting vs stopping motion
            if (prevState && prevState.wasAudioActive !== undefined) {
                const stopThreshold = this.granularConfig.velocityThreshold * 0.5; // Lower threshold to stop
                const startThreshold = this.granularConfig.velocityThreshold * 1.5; // Higher threshold to start

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
                this.particleGrainTimers.delete(id);
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
            const grainGain = this.applyVelocityCurve(velocity, velocityCurvePower) * volumeScale;

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
            let grainsSpawnedThisUpdate = 0;
            while (grainTimer.nextGrainTime <= this.currentTime && grainsSpawnedThisUpdate < 4) {
                this.spawnGrain(id, species, xPosition, yPosition, particleSize,
                              grainLength, grainGain, trailParameter);
                grainTimer.nextGrainTime += grainInterval;
                grainsSpawnedThisUpdate++;
            }
        }

        // Send debug info
        this.port.postMessage({
            type: 'particleCount',
            count: this.activeGrains.length,
            volumeLevel: this.volumeLevel
        });

        // Voice activity is now updated in process() method for continuous tracking
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

            // Grain lifecycle
            startTime: this.currentTime,
            duration: grainLength,
            isReleasing: false,
            releaseStartTime: 0,
            // Release time: 8ms for trail=0 (quick fade), 300ms for trail=1.0 (smooth fade)
            releaseTime: 0.008 + (trailParameter * (this.granularConfig.releaseTimeMax - 0.008)),

            // Attack envelope: 1ms for trail=0 (sharp), 300ms for trail=1.0 (smooth)
            attackTime: 0.001 + (trailParameter * 0.299), // 1ms to 300ms range

            // Removal tracking for voice activity system
            removalReason: null // Will be set when grain is marked for removal: 'natural', 'stolen', 'stopped'
        };

        // Add to active grains
        this.activeGrains.push(grain);

        // Track grains per particle for release management
        if (!this.particleGrains.has(particleId)) {
            this.particleGrains.set(particleId, []);
        }
        this.particleGrains.get(particleId).push(grain);

        // Voice limiting is now handled before particle processing in updateParticles()
    }

    // Voice allocation with delay and crossfade support
    // Only updates allocations when changes are needed, with configurable delay
    updateVoiceAllocations(particles) {
        // Throttle voice allocation updates to reduce CPU usage and provide stability
        if (this.currentTime - this.lastVoiceAllocationUpdate < this.voiceAllocationUpdateInterval) {
            return; // Skip update, not enough time has passed
        }
        this.lastVoiceAllocationUpdate = this.currentTime;

        console.log('[updateVoiceAllocations] Called with', particles.length, 'particles');

        // Group particles by species
        const bySpecies = new Map();
        for (const particle of particles) {
            if (!bySpecies.has(particle.species)) {
                bySpecies.set(particle.species, []);
            }
            bySpecies.get(particle.species).push(particle);
        }

        // For each species, calculate new allocations and handle delays
        for (const [species, speciesParticles] of bySpecies) {
            // Skip if no audio buffer loaded
            if (!this.audioBuffers[species]) continue;

            // Skip if no particles
            if (speciesParticles.length === 0) continue;

            const maxVoices = this.maxVoicesPerSpecies[species];
            // Use actual particle count from current frame
            const particleCount = speciesParticles.length;

            // Calculate new allocations
            let newAllocations;
            if (speciesParticles.length <= maxVoices || maxVoices >= particleCount) {
                // Under limit or maxVoices set to max - allocate all particles (moving or still)
                newAllocations = new Set(speciesParticles.map(p => p.id));
            } else {
                // Over limit - allocate top maxVoices fastest particles
                const sorted = [...speciesParticles]
                    .sort((a, b) => b.velocity - a.velocity)
                    .slice(0, maxVoices);
                newAllocations = new Set(sorted.map(p => p.id));
            }

            // Check if allocations have changed
            const currentAllocations = this.voiceAllocations.get(species);
            const allocationsChanged = !this.areSetsEqual(currentAllocations, newAllocations);

            if (!allocationsChanged) {
                // No change needed, clear any pending changes
                this.pendingVoiceChanges.delete(species);
                continue;
            }

            // Special case: If maxVoices >= particleCount, apply immediately (no delay needed)
            // This ensures all particles are lit when user sets max voices to full
            if (maxVoices >= particleCount) {
                this.voiceAllocations.set(species, newAllocations);
                this.lastVoiceAllocationTime.set(species, this.currentTime * 1000);
                this.pendingVoiceChanges.delete(species);
                console.log(\`Species \${species}: maxVoices (\${maxVoices}) >= particleCount (\${particleCount}) - all \${newAllocations.size} particles allocated\`);
                continue;
            }

            // Special case: Initial allocation (no current allocations)
            // Apply immediately to avoid blank screen on startup
            if (!currentAllocations || currentAllocations.size === 0) {
                this.voiceAllocations.set(species, newAllocations);
                this.lastVoiceAllocationTime.set(species, this.currentTime * 1000);
                continue;
            }

            // Special case: maxVoices just changed (user slider adjustment)
            // Apply immediately with crossfades, skip delay to improve responsiveness
            const maxVoicesJustChanged = this.maxVoicesPerSpecies[species] !== this.previousMaxVoices[species];
            if (maxVoicesJustChanged) {
                console.log(\`[maxVoices changed] Species \${species}: Applying immediately (was \${this.previousMaxVoices[species]}, now \${this.maxVoicesPerSpecies[species]})\`);

                // Apply change with crossfades (same as normal path, but immediate)
                const crossfadeDuration = this.voiceStealingCrossfade / 1000.0;

                let fadeInCount = 0;
                for (const particleId of newAllocations) {
                    if (!currentAllocations.has(particleId)) {
                        this.particleAudioCrossfade.set(particleId, {
                            type: 'fadeIn',
                            startTime: this.currentTime * 1000,
                            duration: crossfadeDuration * 1000
                        });
                        fadeInCount++;
                    }
                }

                let fadeOutCount = 0;
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

                if (fadeInCount > 0 || fadeOutCount > 0) {
                    console.log(\`[Crossfade] Created \${fadeInCount} fadeIn + \${fadeOutCount} fadeOut for species \${species} (immediate, duration: \${Math.round(crossfadeDuration * 1000)}ms)\`);
                }

                this.voiceAllocations.set(species, newAllocations);
                this.lastVoiceAllocationTime.set(species, this.currentTime * 1000);
                this.pendingVoiceChanges.delete(species);

                // Update previousMaxVoices for this species
                this.previousMaxVoices[species] = this.maxVoicesPerSpecies[species];
                continue;
            }

            // Check if we have a pending change
            const pending = this.pendingVoiceChanges.get(species);

            if (!pending) {
                // New change detected, start the delay timer
                this.pendingVoiceChanges.set(species, {
                    newAllocations: newAllocations,
                    changeRequestTime: this.currentTime * 1000 // Convert to milliseconds
                });
                continue;
            }

            // Check if the pending change is the same as the new calculation
            if (!this.areSetsEqual(pending.newAllocations, newAllocations)) {
                // Different allocation requested, reset the timer
                this.pendingVoiceChanges.set(species, {
                    newAllocations: newAllocations,
                    changeRequestTime: this.currentTime * 1000
                });
                continue;
            }

            // Check if delay period has elapsed
            const timeElapsed = (this.currentTime * 1000) - pending.changeRequestTime;
            if (timeElapsed >= this.voiceStealingDelay) {
                // Apply the pending change with attack ramps for newly allocated particles
                const crossfadeDuration = this.voiceStealingCrossfade / 1000.0; // Convert ms to seconds

                // Set up crossfades for smooth audio and visual transitions
                // fadeIn: Newly allocated particles (0→100% gain over crossfade duration)
                // fadeOut: De-allocated particles (100%→0% gain, auto-cleanup when complete)
                let fadeInCount = 0;
                for (const particleId of newAllocations) {
                    if (!currentAllocations || !currentAllocations.has(particleId)) {
                        this.particleAudioCrossfade.set(particleId, {
                            type: 'fadeIn',
                            startTime: this.currentTime * 1000,  // Convert to ms for consistent timing
                            duration: crossfadeDuration * 1000   // Convert to ms
                        });
                        fadeInCount++;
                    }
                }

                // Create fadeOut for smooth transitions (audio + visual)
                let fadeOutCount = 0;
                if (currentAllocations) {
                    for (const particleId of currentAllocations) {
                        if (!newAllocations.has(particleId)) {
                            this.particleAudioCrossfade.set(particleId, {
                                type: 'fadeOut',
                                startTime: this.currentTime * 1000,  // Convert to ms for consistent timing
                                duration: crossfadeDuration * 1000   // Convert to ms
                            });
                            fadeOutCount++;
                        }
                    }
                }

                if (fadeInCount > 0 || fadeOutCount > 0) {
                    console.log(\`[Crossfade] Created \${fadeInCount} fadeIn + \${fadeOutCount} fadeOut for species \${species} (duration: \${Math.round(crossfadeDuration * 1000)}ms)\`);
                }

                this.voiceAllocations.set(species, newAllocations);
                this.lastVoiceAllocationTime.set(species, this.currentTime * 1000);
                this.pendingVoiceChanges.delete(species);

                console.log(\`Voice allocation changed for species \${species} after \${Math.round(timeElapsed)}ms delay\`);
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
    cleanupOrphanedTimers(activeParticleIds) {
        const activeIds = new Set(activeParticleIds);

        // Clean up orphaned grain timers
        for (const [particleId] of this.particleGrainTimers) {
            if (!activeIds.has(particleId)) {
                this.particleGrainTimers.delete(particleId);
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

        this.port.postMessage({
            type: 'voiceState',
            allocations: allocations,
            crossfades: crossfades
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

        // Apply √N normalization to prevent clipping
        // Simple grain count - crossfade gain already applied to individual grains (line 860)
        // No need for weighted normalization as fadeIn grains naturally have reduced contribution
        const grainCount = this.activeGrains.length;

        if (grainCount > 1) {
            const normFactor = 1.0 / Math.sqrt(grainCount);
            for (let i = 0; i < bufferLength; i++) {
                for (let channel = 0; channel < outputChannels; channel++) {
                    output[channel][i] *= normFactor;
                }
            }
        }

        // Apply soft limiting
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

        // Calculate volume level for visualization
        let maxSample = 0;
        for (let i = 0; i < bufferLength; i++) {
            for (let channel = 0; channel < outputChannels; channel++) {
                maxSample = Math.max(maxSample, Math.abs(output[channel][i]));
            }
        }

        // Update volume level with decay
        this.volumeLevel = Math.max(maxSample, this.volumeLevel * this.volumeDecay);

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

        // Send voice state to main thread for visual feedback
        this.sendVoiceStateToMainThread();

        return true;
    }

    // Process individual grain with frequency filtering and envelope
    processGrain(grain, grainAge, bufferLength, output) {
        const buffer = this.audioBuffers[grain.species];
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
            // Attack + Gaussian envelope for grain
            let attackGain = 1.0;

            // Apply attack envelope if we're still in attack phase
            if (grainAge < grain.attackTime) {
                // Exponential attack curve for smoother transitions (especially for long trails)
                const attackProgress = grainAge / grain.attackTime;
                attackGain = 1.0 - Math.exp(-attackProgress * 4.0); // Exponential curve, reaches ~98% at progress=1
            }

            // Apply Gaussian window
            const sigma = this.granularConfig.windowSigmaFactor;
            const gaussianGain = this.gaussianWindow(grainProgress, 1.0, sigma);

            // Combine attack and gaussian envelopes
            envelopeGain = attackGain * gaussianGain;
        }

        if (envelopeGain <= 0.001) {
            return grain.isReleasing; // Remove if releasing and silent
        }

        // Process grain samples
        for (let i = 0; i < bufferLength; i++) {
            // Calculate sample position
            const grainSampleProgress = (grainAge + (i / sampleRate)) / grain.duration;
            if (grainSampleProgress >= 1.0) break;

            const samplePosition = grain.centerSample +
                (grainSampleProgress - 0.5) * grain.grainLengthSamples;

            // Read sample with cubic interpolation
            const audioSample = this.readSampleCubic(sourceData, samplePosition);

            // Apply per-species volume and pitch
            let processedSample = audioSample;
            if (this.sampleVolumes && this.sampleVolumes[grain.species]) {
                processedSample *= this.sampleVolumes[grain.species];
            }

            // Apply grain gain and envelope
            processedSample *= grain.gain * envelopeGain;

            // Apply crossfade gain for smooth voice stealing transitions
            const crossfadeGain = this.getCrossfadeGain(grain.particleId);
            processedSample *= crossfadeGain;

            // Apply frequency band filtering
            const filteredSample = this.applyFrequencyBandFilter(processedSample, grain);

            // Apply stereo panning and add to output
            this.addToStereoOutput(filteredSample, grain.xPosition, output, i);
        }

        return false; // Keep grain
    }

    // Get crossfade gain for smooth voice allocation transitions
    // Handles both fadeIn (attack ramp) and fadeOut (release ramp)
    // Uses equal-power curves (sqrt) for constant acoustic energy during transitions
    getCrossfadeGain(particleId) {
        const crossfade = this.particleAudioCrossfade.get(particleId);

        if (!crossfade) {
            return 1.0; // No crossfade, full volume
        }

        const elapsed = (this.currentTime * 1000) - crossfade.startTime;  // Convert to ms
        const progress = Math.min(elapsed / crossfade.duration, 1.0);

        if (crossfade.type === 'fadeIn') {
            // Newly allocated voice: fade in from 0 → 1
            // Equal-power curve maintains constant energy during overlap
            const gain = Math.sqrt(progress);

            if (progress >= 1.0) {
                console.log(\`[Crossfade] FadeIn complete for particle \${particleId} (duration: \${crossfade.duration}ms)\`);
                this.particleAudioCrossfade.delete(particleId); // FadeIn complete
            }

            return gain;

        } else if (crossfade.type === 'fadeOut') {
            // De-allocated voice: fade out from 1 → 0
            // Equal-power curve: fadeOut² + fadeIn² = 1.0 (constant total power)
            const gain = Math.sqrt(1.0 - progress);

            if (progress >= 1.0) {
                console.log(\`[Crossfade] FadeOut complete for particle \${particleId} (duration: \${crossfade.duration}ms)\`);
                this.particleAudioCrossfade.delete(particleId); // FadeOut complete
                // Next updateParticles() call will hit line 317 with no voice + no crossfade
                // → Timer deleted, spawning stops permanently
            }

            return gain;
        }

        return 1.0;
    }

    // Apply frequency band filtering based on Y position and particle size
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

        // Frequency Mapping: Map Y-position to center frequency with low-end emphasis
        // fc = f_min * (f_max/f_min)^(y^gamma)
        // gamma < 1.0 extends low-frequency resolution (more canvas space for bass)
        const f_min = this.granularConfig.freqRangeMin;    // 20 Hz
        const f_max = this.granularConfig.freqRangeMax;    // 20000 Hz
        const gamma = this.granularConfig.freqGamma;       // 0.6
        const y = 1.0 - grain.yPosition;                   // Invert: top=high, bottom=low
        const fc = f_min * Math.pow(f_max / f_min, Math.pow(y, gamma));

        // Bandwidth Scaling: Linear relationship with particle size
        // BW_oct = s * BW_max_oct
        const BW_oct = grain.particleSize * this.granularConfig.bandwidthOctavesMax;

        // Calculate bandwidth in Hz (needed for amplitude normalization)
        // BW_hz = fc * (2^(BW_oct/2) - 2^(-BW_oct/2))
        const BW_hz = fc * (Math.pow(2, BW_oct / 2) - Math.pow(2, -BW_oct / 2));

        // Calculate band edges with clamping to [20, 20000] Hz
        // f_low = max(20, fc * 2^(-BW_oct/2))
        // f_high = min(20000, fc * 2^(BW_oct/2))
        const lowFreq = Math.max(f_min, fc * Math.pow(2, -BW_oct / 2));
        const highFreq = Math.min(f_max, fc * Math.pow(2, BW_oct / 2));

        // Debug output (uncomment to verify calculations)
        // console.log('Grain ' + grain.id + ': yPos=' + grain.yPosition.toFixed(3) + ', y=' + y.toFixed(3) + ', fc=' + fc.toFixed(1) + 'Hz, f_low=' + lowFreq.toFixed(1) + 'Hz, f_high=' + highFreq.toFixed(1) + 'Hz, BW_hz=' + BW_hz.toFixed(1) + 'Hz');

        // Apply adaptive cascaded bandpass filters
        // Smaller particles get more stages (sharper filtering)
        const nyquist = this.sampleRates[grain.species] / 2;
        const lowFreqNorm = Math.min(lowFreq / nyquist, 0.95);
        const highFreqNorm = Math.min(highFreq / nyquist, 0.95);

        // Determine number of filter stages based on particle size
        // Size range is 0-1 (normalized in parameter-manager.js as size/20)
        // Size 2 → 0.1, Size 5 → 0.25, Size 12 → 0.6, Size 20 → 1.0
        let numStages;
        if (grain.particleSize <= 0.25) {
            // Size 2-5: 4 stages = 24dB/octave (very sharp)
            numStages = 4;
        } else if (grain.particleSize <= 0.6) {
            // Size 6-12: 3 stages = 18dB/octave (medium sharp)
            numStages = 3;
        } else {
            // Size 13+: 2 stages = 12dB/octave (smooth)
            numStages = 2;
        }

        // Apply cascaded lowpass filtering (attenuates high frequencies)
        let filtered = sample;
        for (let stage = 1; stage <= numStages; stage++) {
            filtered = this.simpleFilter(filtered, highFreqNorm, filterState['lowpass' + stage]);
        }

        // Apply cascaded highpass filtering (attenuates low frequencies)
        // Highpass = input - lowpass, but only apply ONCE at the end
        let highpassed = filtered;
        for (let stage = 1; stage <= numStages; stage++) {
            highpassed = this.simpleFilter(highpassed, lowFreqNorm, filterState['highpass' + stage]);
        }
        filtered = filtered - highpassed;

        // Amplitude Normalization: Keep perceived loudness consistent across frequencies and bandwidths
        // Narrower filters reduce energy (fewer frequencies), so boost to maintain perceived loudness
        // Using Hz-based compensation (not octave-based) for frequency-independent normalization
        // gain = sqrt(BW_ref / BW_hz)
        const BW_ref = this.granularConfig.bandwidthRefHz; // 1000 Hz reference
        const compensationGain = Math.sqrt(BW_ref / BW_hz);

        // Clamp max gain to prevent excessive boost (max 10x = +20dB)
        const clampedGain = Math.min(compensationGain, 10.0);

        // Debug output (uncomment to verify gain calculation)
        // console.log('Grain ' + grain.id + ': gain=' + clampedGain.toFixed(2) + 'x (' + (20*Math.log10(clampedGain)).toFixed(1) + 'dB)');

        filtered *= clampedGain;

        return filtered;
    }

    // Simple one-pole filter
    simpleFilter(input, cutoff, state) {
        const alpha = 1.0 - Math.exp(-2.0 * Math.PI * cutoff);
        state.y1 = state.y1 + alpha * (input - state.y1);
        return state.y1;
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