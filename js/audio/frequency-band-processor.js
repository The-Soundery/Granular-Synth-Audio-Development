/**
 * Frequency Band Processor - Pre-filters audio samples into frequency bands
 * PHASE 3 OPTIMIZATION: Eliminates runtime filtering by pre-computing bands at upload time
 *
 * This approach uses Web Audio API's native filtering (GPU-accelerated) to create
 * multiple frequency bands from the source audio. At runtime, grains select the
 * appropriate pre-filtered band based on Y-position instead of filtering per-sample.
 *
 * Performance Impact: ~20-30% CPU reduction by eliminating all runtime filtering
 * Memory Impact: ~10x larger memory footprint (10 bands per sample)
 * Processing Time: 2-5 seconds per sample upload
 */

import { CONFIG } from '../config.js';

export class FrequencyBandProcessor {
    constructor(audioContext) {
        this.context = audioContext;
        this.numBands = CONFIG.granular.numFrequencyBands;
        this.freqMin = CONFIG.granular.freqRangeMin;
        this.freqMax = CONFIG.granular.freqRangeMax;
        this.gamma = CONFIG.granular.freqGamma;
    }

    /**
     * Process an audio buffer into multiple frequency bands
     * @param {AudioBuffer} sourceBuffer - Original audio buffer
     * @returns {Promise<Array<AudioBuffer>>} - Array of filtered AudioBuffers (one per band)
     */
    async processSampleIntoBands(sourceBuffer) {
        if (!CONFIG.granular.usePreFilteredBands) {
            // Pre-filtering disabled, return original buffer wrapped in array
            return [sourceBuffer];
        }

        const bands = [];
        const numBands = this.numBands;

        console.log(`🎛️ Pre-filtering sample into ${numBands} frequency bands...`);
        const startTime = performance.now();

        // Create frequency bands in parallel for better performance
        const bandPromises = [];

        for (let i = 0; i < numBands; i++) {
            // Calculate Y-position for this band (0 = bottom, 1 = top)
            const yPosition = i / (numBands - 1);
            bandPromises.push(this.createFilteredBand(sourceBuffer, yPosition, i));
        }

        // Wait for all bands to complete
        const filteredBands = await Promise.all(bandPromises);

        const elapsed = performance.now() - startTime;
        console.log(`✅ Pre-filtering complete in ${elapsed.toFixed(0)}ms`);

        return filteredBands;
    }

    /**
     * Create a single filtered band using Web Audio API
     * @param {AudioBuffer} sourceBuffer - Original audio buffer
     * @param {number} yPosition - Normalized Y position (0-1)
     * @param {number} bandIndex - Band index for logging
     * @returns {Promise<AudioBuffer>} - Filtered audio buffer
     */
    async createFilteredBand(sourceBuffer, yPosition, bandIndex) {
        // Calculate center frequency using same algorithm as runtime filtering
        // Inverted Y: top = high freq, bottom = low freq
        const y = 1.0 - yPosition;
        const centerFreq = this.freqMin * Math.pow(this.freqMax / this.freqMin, Math.pow(y, this.gamma));

        // Calculate bandwidth (same as runtime logic)
        const particleSize = 8; // Use default size for band creation
        const canvasHeight = CONFIG.canvas.height;
        const sizeNormalized = particleSize / canvasHeight;
        const bandwidthOctaves = Math.max(0.5, sizeNormalized * CONFIG.granular.bandwidthOctavesMax);

        // Create offline audio context for processing
        const offlineContext = new OfflineAudioContext(
            sourceBuffer.numberOfChannels,
            sourceBuffer.length,
            sourceBuffer.sampleRate
        );

        // Create source node
        const sourceNode = offlineContext.createBufferSource();
        sourceNode.buffer = sourceBuffer;

        // Create bandpass filter using Web Audio API's native BiquadFilterNode
        // This is GPU-accelerated and much faster than per-sample filtering
        const lowpassFilter = offlineContext.createBiquadFilter();
        const highpassFilter = offlineContext.createBiquadFilter();

        // Calculate filter frequencies
        const lowFreq = centerFreq / Math.pow(2, bandwidthOctaves / 2);
        const highFreq = centerFreq * Math.pow(2, bandwidthOctaves / 2);

        // Configure filters
        highpassFilter.type = 'highpass';
        highpassFilter.frequency.value = Math.max(this.freqMin, lowFreq);
        highpassFilter.Q.value = 0.7071; // Butterworth response

        lowpassFilter.type = 'lowpass';
        lowpassFilter.frequency.value = Math.min(this.freqMax, highFreq);
        lowpassFilter.Q.value = 0.7071;

        // Connect audio graph: source → highpass → lowpass → destination
        sourceNode.connect(highpassFilter);
        highpassFilter.connect(lowpassFilter);
        lowpassFilter.connect(offlineContext.destination);

        // Start processing
        sourceNode.start(0);

        // Render the filtered audio
        const renderedBuffer = await offlineContext.startRendering();

        // Log band info (only for first and last bands to reduce console spam)
        if (bandIndex === 0 || bandIndex === this.numBands - 1) {
            console.log(`  Band ${bandIndex}: ${lowFreq.toFixed(0)}-${highFreq.toFixed(0)} Hz (center: ${centerFreq.toFixed(0)} Hz)`);
        }

        return renderedBuffer;
    }

    /**
     * Convert filtered bands to the format expected by the worklet
     * @param {Array<AudioBuffer>} bands - Array of filtered AudioBuffers
     * @returns {Array<Object>} - Array of band data with channel arrays
     */
    convertBandsToWorkletFormat(bands) {
        return bands.map(band => {
            const channelData = [];
            for (let i = 0; i < band.numberOfChannels; i++) {
                channelData.push(band.getChannelData(i));
            }
            return {
                sampleRate: band.sampleRate,
                length: band.length,
                numberOfChannels: band.numberOfChannels,
                channels: channelData
            };
        });
    }
}
