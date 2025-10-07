/**
 * Audio Engine - Core audio system initialization and management
 * Handles AudioContext, worklet setup, and engine lifecycle
 */

import { WORKLET_PROCESSOR_CODE } from './worklet-processor.js';
import { updateVolumeMeter } from './sample-manager.js';
import { audioEngine, state } from '../config.js';
import { Utils } from '../utils.js';
import { setElementDisplay, updateElementText, safeGetElement } from '../shared/dom-utils.js';
import { eventBus, Events } from '../shared/event-bus.js';

// Helper: Enable all audio controls
export function enableAudioControls() {
    // Enable granular parameter controls
    const controls = [
        'curveParameter',
        'volumeScale',
        'showActiveVoices',
        'voiceStealingDelay',
        'voiceStealingCrossfade'
    ];

    controls.forEach(id => {
        const element = safeGetElement(id);
        if (element) {
            if (element.tagName === 'INPUT') {
                element.disabled = false;
            } else {
                element.classList.remove('disabled');
            }
        }
    });

    // Enable collapsible sections
    const sections = ['audioSamplesSection', 'granularParametersSection'];
    sections.forEach(id => {
        const section = safeGetElement(id);
        if (section) section.classList.remove('disabled');
    });

    // Enable all audio species tabs
    const audioTabs = document.querySelectorAll('#audioSpeciesTabs .species-tab');
    audioTabs.forEach(tab => tab.classList.remove('disabled'));

    // Enable all file input buttons
    const fileButtons = document.querySelectorAll('.file-input-button');
    fileButtons.forEach(btn => btn.classList.remove('disabled'));

    // Enable all audio sample controls (sliders and values)
    const audioSliders = document.querySelectorAll('#audioSamplesContainer .slider');
    audioSliders.forEach(slider => slider.disabled = false);

    const audioValues = document.querySelectorAll('#audioSamplesContainer .audio-control-value');
    audioValues.forEach(value => value.classList.remove('disabled'));

    // Enable waveform canvases
    const waveforms = document.querySelectorAll('.waveform-canvas');
    waveforms.forEach(canvas => canvas.classList.remove('disabled'));

    // Enable mute toggles
    const muteToggles = document.querySelectorAll('.species-mute-toggle');
    muteToggles.forEach(toggle => toggle.classList.remove('disabled'));

    console.log('✅ Audio controls enabled');
}

// Helper: Disable all audio controls
export function disableAudioControls() {
    // Disable granular parameter controls
    const controls = [
        'curveParameter',
        'volumeScale',
        'showActiveVoices',
        'voiceStealingDelay',
        'voiceStealingCrossfade'
    ];

    controls.forEach(id => {
        const element = safeGetElement(id);
        if (element) {
            if (element.tagName === 'INPUT') {
                element.disabled = true;
            } else {
                element.classList.add('disabled');
            }
        }
    });

    // Disable collapsible sections
    const sections = ['audioSamplesSection', 'granularParametersSection'];
    sections.forEach(id => {
        const section = safeGetElement(id);
        if (section) section.classList.add('disabled');
    });

    // Disable all audio species tabs
    const audioTabs = document.querySelectorAll('#audioSpeciesTabs .species-tab');
    audioTabs.forEach(tab => tab.classList.add('disabled'));

    // Disable all file input buttons
    const fileButtons = document.querySelectorAll('.file-input-button');
    fileButtons.forEach(btn => btn.classList.add('disabled'));

    // Disable all audio sample controls (sliders and values)
    const audioSliders = document.querySelectorAll('#audioSamplesContainer .slider');
    audioSliders.forEach(slider => slider.disabled = true);

    const audioValues = document.querySelectorAll('#audioSamplesContainer .audio-control-value');
    audioValues.forEach(value => value.classList.add('disabled'));

    // Disable waveform canvases
    const waveforms = document.querySelectorAll('.waveform-canvas');
    waveforms.forEach(canvas => canvas.classList.add('disabled'));

    // Disable mute toggles
    const muteToggles = document.querySelectorAll('.species-mute-toggle');
    muteToggles.forEach(toggle => toggle.classList.add('disabled'));

    console.log('🔒 Audio controls disabled');
}

// Helper: Update audio UI state
function updateAudioUIState(isRunning, sampleRate = null) {
    if (isRunning) {
        setElementDisplay('startAudio', 'none');
        setElementDisplay('stopAudio', 'block');
        updateElementText('audioStatus', 'Running');
        updateElementText('sampleRate', sampleRate ? `${sampleRate} Hz` : '-');
        updateElementText('bufferSize', '128 samples'); // Typical AudioWorklet size
        enableAudioControls();
    } else {
        setElementDisplay('startAudio', 'block');
        setElementDisplay('stopAudio', 'none');
        updateElementText('audioStatus', 'Stopped');
        updateElementText('sampleRate', '-');
        updateElementText('bufferSize', '-');
        disableAudioControls();
    }
}

export async function startAudioEngine() {
    try {
        // Check if AudioWorklet is supported (implies AudioContext support)
        if (!window.AudioContext && !window.webkitAudioContext) {
            throw new Error('Web Audio API not supported in this browser');
        }

        // Create audio context
        audioEngine.context = new (window.AudioContext || window.webkitAudioContext)();

        // Resume context if suspended (required for user gesture)
        if (audioEngine.context.state === 'suspended') {
            await audioEngine.context.resume();
        }

        // Check if AudioWorklet is supported
        if (!audioEngine.context.audioWorklet) {
            throw new Error('AudioWorklet not supported in this browser');
        }

        console.log('AudioContext created, state:', audioEngine.context.state);

        // Use data URL for file:// protocol compatibility (encodes Unicode safely)
        const workletUrl = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(WORKLET_PROCESSOR_CODE)));

        await audioEngine.context.audioWorklet.addModule(workletUrl);
        console.log('AudioWorklet module added successfully');

        // Create worklet node with stereo output
        audioEngine.workletNode = new AudioWorkletNode(audioEngine.context, 'granular-processor', {
            outputChannelCount: [2]
        });

        // Connect to output
        audioEngine.workletNode.connect(audioEngine.context.destination);

        // Setup message handling
        audioEngine.workletNode.port.onmessage = (event) => {
            if (event.data.type === 'particleCount') {
                audioEngine.activeParticleCount = event.data.count;

                if (event.data.volumeLevel !== undefined) {
                    updateVolumeMeter(event.data.volumeLevel);
                }
            } else if (event.data.type === 'voiceState') {
                // Sync voice allocations and crossfade state from worklet for visual feedback
                if (event.data.allocations) {
                    audioEngine.voiceAllocations.clear();
                    for (const [species, particleIds] of Object.entries(event.data.allocations)) {
                        audioEngine.voiceAllocations.set(parseInt(species), new Set(particleIds));
                    }
                }
                if (event.data.crossfades) {
                    audioEngine.particleAudioCrossfade.clear();
                    for (const [particleId, fadeState] of Object.entries(event.data.crossfades)) {
                        audioEngine.particleAudioCrossfade.set(particleId, fadeState);
                    }
                }

                // Emit audio CPU usage event if included
                if (event.data.cpuUsage !== null && event.data.cpuUsage !== undefined) {
                    eventBus.emit(Events.AUDIO_PERFORMANCE_UPDATED, {
                        audioCpuUsage: event.data.cpuUsage
                    });
                }
            }
        };

        audioEngine.isActive = true;

        // Update UI
        updateAudioUIState(true, audioEngine.context.sampleRate);

        // Emit event so AudioSystem can send initial parameters
        // This breaks the circular dependency with AudioSystem
        eventBus.emit(Events.AUDIO_INITIALIZED);

        // Send initial voice stealing delay and crossfade
        audioEngine.workletNode.port.postMessage({
            type: 'voiceStealingDelay',
            delay: state.voiceStealingDelay
        });
        audioEngine.workletNode.port.postMessage({
            type: 'voiceStealingCrossfade',
            duration: state.voiceStealingCrossfade
        });

        Utils.showToast('Audio engine started successfully!');
        console.log('🎵 Audio engine started');

    } catch (error) {
        console.error('Failed to start audio engine:', error);

        // Cleanup partial initialization
        if (audioEngine.workletNode) {
            audioEngine.workletNode.disconnect();
            audioEngine.workletNode = null;
        }
        if (audioEngine.context) {
            await audioEngine.context.close();
            audioEngine.context = null;
        }
        audioEngine.isActive = false;
        audioEngine.activeParticleCount = 0;

        updateAudioUIState(false);
        Utils.showToast('Failed to start audio engine: ' + error.message, 3000);
    }
}

export async function stopAudioEngine() {
    if (audioEngine.context) {
        await audioEngine.context.close();
        audioEngine.context = null;
        audioEngine.workletNode = null;
        audioEngine.isActive = false;
        audioEngine.activeParticleCount = 0;
        audioEngine.voiceAllocations.clear();
        audioEngine.particleAudioCrossfade.clear();

        // Update UI
        updateAudioUIState(false);

        Utils.showToast('Audio engine stopped');
        console.log('🔇 Audio engine stopped');
    }
}