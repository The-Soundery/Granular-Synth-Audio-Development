/**
 * Parameter Manager - Parameter validation, bounds checking, and unified AudioWorklet communication
 * Handles batch parameter updates and validation for the audio system
 */

import { CONFIG, audioEngine, state } from '../config.js';
import { clamp, validateFloat, validateInt } from '../shared/validation-utils.js';
import { safeGetElement } from '../shared/dom-utils.js';
import { eventBus, Events } from '../shared/event-bus.js';

// Set up event listener for particle updates from physics engine
// This replaces the direct function call from physics-engine.js
eventBus.on(Events.PARTICLES_UPDATED, () => {
    sendParticleDataToAudio();
});

export function validateAudioParameter(type, value) {
    switch (type) {
        case 'curveParameter':
            return validateFloat(value, 0.1, 4.0);
        case 'volume':
            return validateFloat(value, 0.1, 2.0);
        case 'pitch':
            return validateInt(value, -24, 24);
        case 'voices':
            // Note: Actual validation happens in updateAudioParameters() using per-species particle counts
            // This is just a fallback - should not be used for voices validation
            return validateInt(value, 1, 100);
        case 'rangePosition':
            return clamp(parseFloat(value) || 0, 0, 1);
        default:
            return value;
    }
}

export function updateAudioParameters(config = {}) {
    if (!audioEngine.workletNode || !audioEngine.isActive) return;

    const updates = {};

    try {
        // Collect and validate parameters to update
        if (config.curves || config.all) {
            const curveParameterEl = safeGetElement('curveParameter');
            const curveParameter = validateAudioParameter('curveParameter',
                curveParameterEl?.value || 1.0);
            updates.curveParameters = {
                curveType: 'power',
                curveParameter: curveParameter
            };
        }

        if (config.ranges || config.all) {
            // Validate all sample ranges
            const validatedRanges = CONFIG.species.sampleRanges.map(range => ({
                start: validateAudioParameter('rangePosition', range.start),
                end: validateAudioParameter('rangePosition', range.end)
            }));
            updates.sampleRanges = {
                ranges: validatedRanges
            };
        }

        if (config.audio || config.all) {
            // Validate audio parameters
            const validatedVolumes = CONFIG.species.sampleVolumes.map(vol =>
                validateAudioParameter('volume', vol));
            const validatedPitches = CONFIG.species.samplePitches.map(pitch =>
                validateAudioParameter('pitch', pitch));
            updates.audioParameters = {
                volumes: validatedVolumes,
                pitches: validatedPitches
            };
        }

        if (config.voices || config.all) {
            // Validate voice limits against actual particle counts
            const validatedVoices = CONFIG.species.maxVoicesPerSpecies.map((voices, index) => {
                const particleCount = CONFIG.species.counts[index] || 1;
                return validateInt(voices, 1, particleCount);
            });
            updates.voiceManagement = {
                maxVoicesPerSpecies: validatedVoices
            };
        }

        if (config.mute || config.all) {
            // Send mute state for all species
            updates.muteState = {
                mutedSpecies: [...CONFIG.species.mutedSpecies] // Force fresh array copy
            };
        }

        // Send batch update message
        if (Object.keys(updates).length > 0) {
            audioEngine.workletNode.port.postMessage({
                type: 'batchParameterUpdate',
                updates: updates
            });
        }
    } catch (error) {
        console.error('Error updating audio parameters:', error);
    }
}

/**
 * Re-send all loaded audio buffers to the AudioWorklet
 * Called after audio engine restart to restore previously loaded samples
 */
export function resendAudioBuffers() {
    if (!audioEngine?.workletNode?.port || !audioEngine.isActive) {
        console.warn('Cannot resend audio buffers: Audio engine not active');
        return;
    }

    let resentCount = 0;

    try {
        // Iterate through all species and resend any loaded buffers
        for (let speciesIndex = 0; speciesIndex < CONFIG.species.audioBuffers.length; speciesIndex++) {
            const audioBuffer = CONFIG.species.audioBuffers[speciesIndex];

            // Skip if no buffer loaded for this species
            if (!audioBuffer) continue;

            try {
                // Transfer the audio buffer data to the worklet (same as loadAudioSample)
                const channelData = Array.from(
                    { length: audioBuffer.numberOfChannels },
                    (_, i) => audioBuffer.getChannelData(i)
                );

                audioEngine.workletNode.port.postMessage({
                    type: 'audioBuffer',
                    species: speciesIndex,
                    sampleRate: audioBuffer.sampleRate,
                    length: audioBuffer.length,
                    numberOfChannels: audioBuffer.numberOfChannels,
                    channelData: channelData
                });

                resentCount++;
                console.log(`🔄 Re-sent audio buffer for species ${speciesIndex}`);
            } catch (bufferError) {
                console.error(`Failed to resend audio buffer for species ${speciesIndex}:`, bufferError);
            }
        }

        if (resentCount > 0) {
            console.log(`✅ Re-sent ${resentCount} audio buffer${resentCount > 1 ? 's' : ''} to AudioWorklet`);
        }
    } catch (error) {
        console.error('Error in resendAudioBuffers:', error);
    }
}

export function sendParticleDataToAudio() {
    // Performance optimization: early exit checks
    if (!audioEngine?.workletNode?.port || !audioEngine.isActive || !state.particles?.length) {
        return;
    }

    try {
        // Pre-allocate array for better performance
        const particleData = new Array(state.particles.length);
        let validParticleCount = 0;

        // Get UI parameters for motion-driven synthesis
        const volumeScaleEl = safeGetElement('volumeScale');
        const curveParameterEl = safeGetElement('curveParameter');
        const volumeScale = parseFloat(volumeScaleEl?.value || 1.0);
        const curveParameter = parseFloat(curveParameterEl?.value || CONFIG.granular.gainPowerDefault);

        // Cache constants for performance
        const canvasWidth = CONFIG.canvas.width;
        const canvasHeight = CONFIG.canvas.height;
        const maxVelocity = CONFIG.granular.maxVelocity;
        const velocityThreshold = CONFIG.granular.velocityThreshold;

        for (let i = 0; i < state.particles.length; i++) {
            const particle = state.particles[i];

            // Performance: Fast validation with minimal object access
            if (!particle?.audioId || typeof particle.x !== 'number' ||
                typeof particle.y !== 'number' || typeof particle.size !== 'number' ||
                typeof particle.species !== 'number') {
                continue;
            }

            // New parameter mappings for motion-driven synthesis
            const xPosition = clamp(particle.x / canvasWidth, 0, 1);
            const yPosition = clamp(particle.y / canvasHeight, 0, 1);

            // Normalize particle size to bandwidth factor (0-1)
            const normalizedSize = clamp(particle.size / 20, 0, 1);

            // Get trail parameter for this species
            const trailParameter = CONFIG.species.trailLengths[particle.species] || 0.0;

            // Velocity for motion detection and audio triggering
            const rawVelocity = particle.velocityMagnitude;
            const normalizedVelocity = clamp(rawVelocity / maxVelocity, 0, 1);

            // Motion-driven: only process if above velocity threshold
            const isMoving = rawVelocity > velocityThreshold;

            // Performance: Direct assignment to pre-allocated array
            particleData[validParticleCount++] = {
                id: particle.audioId,
                species: Math.floor(clamp(particle.species, 0, 7)),

                // New parameter mappings
                xPosition: xPosition,           // → sample playback position
                yPosition: yPosition,           // → frequency band center
                particleSize: normalizedSize,   // → frequency band width
                velocity: normalizedVelocity,   // → grain rate + gain
                trailParameter: trailParameter, // → grain length + overlap + release

                // Motion detection
                isMoving: isMoving,
                rawVelocity: rawVelocity,

                // UI parameters
                velocityCurvePower: curveParameter,
                volumeScale: volumeScale
            };
        }

        // Trim array to actual size for better performance
        if (validParticleCount < particleData.length) {
            particleData.length = validParticleCount;
        }

        // Validate particle data before sending
        if (particleData.length === 0) {
            return; // No particles to send
        }

        // Send to worklet with error handling
        audioEngine.workletNode.port.postMessage({
            type: 'particleUpdate',
            particles: particleData,
            // Send granular constants for worklet processing
            granularConfig: CONFIG.granular
        });
    } catch (error) {
        console.error('Error sending particle data to audio:', error);
        // Graceful degradation - continue without audio for this frame
    }
}

