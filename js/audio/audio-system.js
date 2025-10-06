/**
 * Audio System Public API
 *
 * Main interface for all audio operations including initialization, parameter management,
 * sample loading, and UI coordination.
 *
 * @namespace AudioSystem
 * @public
 *
 * @example
 * // Initialize audio system
 * await AudioSystem.init();
 *
 * // Load a sample
 * await AudioSystem.loadSample(0, audioFile);
 *
 * // Update parameters
 * AudioSystem.updateParameters({ curves: true, voices: true });
 *
 * // Check status
 * if (AudioSystem.isActive()) {
 *   console.log('Audio is running');
 * }
 */

import { startAudioEngine, stopAudioEngine } from './audio-engine.js';
import { updateAudioParameters, validateAudioParameter, resendAudioBuffers } from './parameter-manager.js';
import { updateAudioUI, loadAudioSample } from './sample-manager.js';
import { audioEngine } from '../config.js';
import { eventBus, Events } from '../shared/event-bus.js';

export const AudioSystem = {
    /**
     * Initialize the complete audio system
     * Creates AudioContext, loads worklet, connects to output, and sends initial parameters
     *
     * @returns {Promise<boolean>} True if initialization successful
     * @public
     */
    async init() {
        try {
            // Listen for audio engine initialization to send parameters
            // This breaks the circular dependency between audio-engine and audio-system
            eventBus.once(Events.AUDIO_INITIALIZED, () => {
                // First, re-send any previously loaded audio buffers to the new worklet instance
                resendAudioBuffers();
                // Then send all parameters
                this.updateParameters({ all: true });
            });

            await startAudioEngine();
            updateAudioUI({ updateType: 'all' });
            return true;
        } catch (error) {
            console.error('AudioSystem init failed:', error);
            return false;
        }
    },

    /**
     * Gracefully shutdown the audio system
     * Closes AudioContext and cleans up resources
     *
     * @returns {Promise<boolean>} True if shutdown successful
     * @public
     */
    async shutdown() {
        await stopAudioEngine();
        return true;
    },

    /**
     * Update audio parameters with validation and batch processing
     * Sends validated parameters to audio worklet
     *
     * @param {Object} config - Parameter configuration
     * @param {boolean} [config.curves] - Update velocity-to-gain curves
     * @param {boolean} [config.ranges] - Update sample playback ranges
     * @param {boolean} [config.audio] - Update volume/pitch settings
     * @param {boolean} [config.voices] - Update voice management limits
     * @param {boolean} [config.all] - Update all parameters
     * @returns {void}
     * @public
     */
    updateParameters(config) {
        return updateAudioParameters(config);
    },

    /**
     * Validate audio parameter values with proper bounds checking
     *
     * @param {string} type - Parameter type: 'curveParameter', 'volume', 'pitch', 'voices', 'rangePosition'
     * @param {any} value - Value to validate
     * @returns {number} Validated and clamped value
     * @public
     */
    validateParameter(type, value) {
        return validateAudioParameter(type, value);
    },

    /**
     * Update audio UI components with debouncing and visibility checks
     * Updates waveform displays, range sliders, and audio controls
     *
     * @param {Object} options - UI update options
     * @param {number} [options.speciesIndex] - Specific species to update (0-7)
     * @param {string} [options.updateType] - Type: 'waveform', 'controls', 'curve', 'all'
     * @param {boolean} [options.debounce] - Enable debouncing for frequent updates
     * @returns {void}
     * @public
     */
    updateUI(options) {
        return updateAudioUI(options);
    },

    /**
     * Load and process audio sample for a specific species
     * Decodes audio file, stores in CONFIG, sends to worklet, updates UI
     *
     * @param {number} speciesIndex - Species index (0-7)
     * @param {File} file - Audio file to load (WAV, MP3, etc.)
     * @returns {Promise<boolean>} True if loading successful
     * @throws {Error} If audio context not initialized or decoding fails
     * @public
     */
    async loadSample(speciesIndex, file) {
        try {
            await loadAudioSample(speciesIndex, file);
            this.updateUI({ speciesIndex, updateType: 'waveform' });
            console.log(`✅ Audio sample loaded for Species ${String.fromCharCode(65 + speciesIndex)}`);
            return true;
        } catch (error) {
            console.error('Sample loading failed:', error);
            throw error; // Propagate error for better handling
        }
    },

    /**
     * Check if audio system is active and ready
     *
     * @returns {boolean} True if AudioContext is running and worklet is connected
     * @public
     */
    isActive() {
        return audioEngine && audioEngine.isActive;
    },

    /**
     * Get comprehensive audio system state information
     *
     * @returns {Object} Complete system state
     * @returns {boolean} .isActive - Whether audio system is running
     * @returns {number} .activeParticles - Number of particles producing audio
     * @returns {string} .context - AudioContext state ('running', 'suspended', 'closed')
     * @returns {number} .sampleRate - Audio sample rate in Hz
     * @public
     */
    getState() {
        return {
            isActive: this.isActive(),
            activeParticles: audioEngine?.activeParticleCount || 0,
            context: audioEngine?.context?.state,
            sampleRate: audioEngine?.context?.sampleRate
        };
    }
};