/**
 * Sample Manager - Audio file loading, validation, storage, and waveform analysis
 * Handles UI updates, event listeners, and visualization for the audio system
 */

import { CONFIG, audioEngine } from '../config.js';
import { AudioSystem } from './audio-system.js';
import { Utils } from '../utils.js';
import { createAudioSampleControls as createAudioSampleControlsUI, updateWaveformDisplay as updateWaveformUI } from '../ui/audio-controls.js';

export async function loadAudioSample(speciesIndex, file) {
    try {
        // Enhanced validation with comprehensive error checking
        if (!audioEngine || !audioEngine.context) {
            throw new Error('Audio engine not initialized or not started');
        }

        if (audioEngine.context.state === 'closed') {
            throw new Error('Audio context has been closed');
        }

        if (!Number.isInteger(speciesIndex) || speciesIndex < 0 || speciesIndex >= CONFIG.species.maxCount) {
            throw new Error(`Invalid species index: ${speciesIndex}. Must be an integer between 0 and ${CONFIG.species.maxCount - 1}`);
        }

        if (!file || typeof file !== 'object') {
            throw new Error('Invalid file object provided');
        }

        if (typeof file.arrayBuffer !== 'function') {
            throw new Error('File object does not support arrayBuffer() method');
        }

        // Validate file type
        const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/flac'];
        if (file.type && !validTypes.includes(file.type)) {
            console.warn(`File type ${file.type} may not be supported. Supported types: ${validTypes.join(', ')}`);
        }

        // Check file size (limit to 50MB)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size: 50MB`);
        }

        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioEngine.context.decodeAudioData(arrayBuffer);

        // Validate audio buffer properties
        if (!audioBuffer || audioBuffer.length === 0) {
            throw new Error('Invalid audio file: No audio data found');
        }

        // Check duration (limit to 60 seconds)
        const maxDuration = 60; // seconds
        if (audioBuffer.duration > maxDuration) {
            throw new Error(`Audio file too long: ${audioBuffer.duration.toFixed(1)}s. Maximum duration: ${maxDuration}s`);
        }

        // Store the buffer
        CONFIG.species.audioBuffers[speciesIndex] = audioBuffer;

        // Send to worklet
        if (audioEngine.workletNode) {
            try {
                // Transfer the audio buffer data to the worklet
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
            } catch (workletError) {
                throw new Error(`Failed to send audio data to worklet: ${workletError.message}`);
            }
        } else {
            throw new Error('Audio worklet not available');
        }

        // Update waveform display using UI module version
        updateWaveformUI(speciesIndex);

        Utils.showToast(`Audio sample loaded for Species ${String.fromCharCode(65 + speciesIndex)}`);
        console.log(`🎵 Audio sample loaded for species ${speciesIndex}`);

    } catch (error) {
        console.error('Failed to load audio sample:', error);

        // Provide specific error messages based on error type
        const errorMap = {
            decode: 'Invalid or corrupted audio file format',
            worklet: 'Audio processing error - try restarting audio engine'
        };

        let userMessage = 'Failed to load audio sample: ';
        const errorKey = Object.keys(errorMap).find(key =>
            error.name === 'EncodingError' || error.message.toLowerCase().includes(key)
        );

        if (errorKey) {
            userMessage += errorMap[errorKey];
        } else if (error.message.includes('size') || error.message.includes('duration') || error.message.includes('species')) {
            userMessage += error.message;
        } else {
            userMessage += error.message || 'Unknown error occurred';
        }

        Utils.showToast(userMessage, 4000);
    }
}

export function updateAudioUI(options = {}) {
    const { speciesIndex, updateType = 'all', debounce = false } = options;

    // Enhanced debouncing with different timers for different update types
    if (debounce) {
        const timers = updateAudioUI._timers || (updateAudioUI._timers = {});
        const timeouts = {
            waveform: 16,    // ~60fps for waveforms
            controls: 100,   // Less frequent for controls
            curve: 50,       // Medium for curve updates
            all: 100         // Conservative for full updates
        };

        clearTimeout(timers[updateType]);
        timers[updateType] = setTimeout(() => {
            updateAudioUI({ ...options, debounce: false });
        }, timeouts[updateType] || 100);
        return;
    }

    try {
        // Performance: Early exit if no visible audio panel
        const audioPanel = document.getElementById('audio-panel');
        if (!audioPanel || !audioPanel.classList.contains('active')) {
            return; // Don't update UI if audio panel isn't visible
        }

        if (updateType === 'waveform' && speciesIndex !== undefined) {
            // Update specific waveform with validation
            if (speciesIndex >= 0 && speciesIndex < CONFIG.species.count) {
                updateWaveformUI(speciesIndex); // Use UI module version
            }
        } else if (updateType === 'waveforms' || updateType === 'all') {
            // Update all waveforms efficiently
            const speciesCount = CONFIG.species.count;
            for (let i = 0; i < speciesCount; i++) {
                if (CONFIG.species.audioBuffers[i]) {
                    updateWaveformUI(i); // Use UI module version
                }
            }
        }

        if (updateType === 'controls' || updateType === 'all') {
            // Recreate audio sample controls using UI module version
            createAudioSampleControlsUI();
        }

        if (updateType === 'curve' || updateType === 'all') {
            // Update curve graph
            updateCurveGraph();
        }
    } catch (error) {
        console.error('Error updating audio UI:', error);
        // Graceful degradation - continue without UI updates
    }
}

export function setupAudioControlEventListeners() {
    // Existing granular parameter sliders
    const curveParameterSlider = document.getElementById('curveParameter');
    if (curveParameterSlider) {
        curveParameterSlider.addEventListener('input', (e) => {
            document.getElementById('curveParameter-value').textContent = e.target.value;
            updateCurveGraph();
            AudioSystem.updateParameters({ curves: true });
        });
    }

    // Note: Volume Scale and Show Active Voices are handled in audio-controls.js
    console.log('🎚️ Sample manager event listeners initialized');
}

export function updateCurveGraph() {
    const canvas = document.getElementById('curveGraph');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const power = parseFloat(document.getElementById('curveParameter').value);

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);

    // Vertical grid lines
    for (let i = 1; i < 4; i++) {
        const x = (i / 4) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    // Horizontal grid lines
    for (let i = 1; i < 4; i++) {
        const y = (i / 4) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Draw curve
    ctx.setLineDash([]);
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i <= width; i++) {
        const x = i / width; // 0 to 1
        const y = Math.pow(x, power); // Power curve
        const pixelX = i;
        const pixelY = height - (y * height); // Flip Y axis

        if (i === 0) {
            ctx.moveTo(pixelX, pixelY);
        } else {
            ctx.lineTo(pixelX, pixelY);
        }
    }
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = '#888';
    ctx.font = '10px Arial';
    ctx.fillText('0', 2, height - 2);
    ctx.fillText('1', width - 8, height - 2);
    ctx.fillText('1', 2, 12);
    ctx.fillText('Velocity →', width / 2 - 25, height - 2);

    // Draw power value
    ctx.fillStyle = '#4CAF50';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`x^${power.toFixed(1)}`, width - 40, 15);
}

export function updateVolumeMeter(volumeLevel) {
    const meter = document.getElementById('volumeMeter');
    const text = document.getElementById('volumeText');

    if (!meter || !text) return;

    // Apply logarithmic scaling for better visual representation
    // Map 0.001 to 1% and 1.0 to 100% with logarithmic curve
    let scaledLevel = 0;
    if (volumeLevel > 0.001) {
        // Logarithmic scale: log10(volumeLevel / 0.001) / log10(1000)
        scaledLevel = Math.log10(volumeLevel / 0.001) / Math.log10(1000);
        scaledLevel = Math.max(0, Math.min(1, scaledLevel));
    }

    const percentage = scaledLevel * 100;

    // Update meter width
    meter.style.width = percentage + '%';

    // Update text
    text.textContent = Math.round(percentage) + '%';
}

// Note: updateWaveformDisplay and createAudioSampleControls have been moved to
// js/ui/audio-controls.js to follow the module separation principle.
// They are imported at the top of this file as updateWaveformUI and createAudioSampleControlsUI.