/**
 * Audio Controls - Audio parameter controls and visualization
 * Handles audio control event listeners, curve graphs, and volume meters
 */

import { CONFIG, audioEngine, state } from '../config.js';
import { Utils } from '../utils.js';
import { AudioSystem } from '../audio/audio-system.js';
import { disableAudioControls } from '../audio/audio-engine.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement, updateElementText } from '../shared/dom-utils.js';
import { clamp, validateInt, validateFloat } from '../shared/validation-utils.js';

// Event listener managers
const audioControlEventManager = new EventListenerManager('AudioControls');
const sampleControlEventManager = new EventListenerManager('SampleControls');

// Track current audio species tab
let currentAudioSpeciesTab = 0;

// Getter for current audio species tab (used by slider-controls.js)
export function getCurrentAudioSpeciesTab() {
    return currentAudioSpeciesTab;
}

export function setupAudioControlEventListeners() {
    // Clear previous listeners
    audioControlEventManager.removeAll();

    // Existing granular parameter sliders
    const curveParameterSlider = safeGetElement('curveParameter');
    if (curveParameterSlider) {
        audioControlEventManager.add(curveParameterSlider, 'input', (e) => {
            updateElementText('curveParameter-value', e.target.value);
            updateCurveGraph();
            AudioSystem.updateParameters({ curves: true });
        });
    }

    const volumeScaleSlider = safeGetElement('volumeScale');
    if (volumeScaleSlider) {
        audioControlEventManager.add(volumeScaleSlider, 'input', (e) => {
            updateElementText('volumeScale-value', e.target.value);
        });
    }

    // Show Active Voices toggle
    const showActiveVoicesToggle = safeGetElement('showActiveVoices');
    if (showActiveVoicesToggle) {
        // Initialize checkbox state from config
        showActiveVoicesToggle.checked = state.showActiveVoices;

        audioControlEventManager.add(showActiveVoicesToggle, 'change', (e) => {
            state.showActiveVoices = e.target.checked;
            console.log('Show Active Voices: ' + (state.showActiveVoices ? 'ON' : 'OFF'));
            if (state.showActiveVoices) {
                console.log('Visual feedback enabled: Active particles will be bright, inactive particles will be dimmed');
            } else {
                console.log('Visual feedback disabled: All particles will render at normal brightness');
            }
        });
    }

    // Voice Stealing Delay will be handled by the existing draggable number system

    console.log('🎚️ Audio control event listeners initialized');
}

export function updateCurveGraph() {
    const canvas = safeGetElement('curveGraph');
    if (!canvas) return;

    const curveParameter = safeGetElement('curveParameter');
    if (!curveParameter) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const power = parseFloat(curveParameter.value);

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
    const meter = safeGetElement('volumeMeter');
    const text = safeGetElement('volumeText');

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

    // Update text with both raw and scaled values for debugging
    text.textContent = Math.round(percentage) + '%';

    // Debug log to compare scaling
    if (volumeLevel > 0.001 && Math.random() < 0.01) {
        console.log('Volume Meter - raw:', volumeLevel.toFixed(4), 'scaled:', scaledLevel.toFixed(3), 'percentage:', percentage.toFixed(1) + '%');
    }
}

export function updateWaveformDisplay(speciesIndex) {
    const canvas = safeGetElement(`waveform-${speciesIndex}`);
    if (!canvas || !CONFIG.species.audioBuffers[speciesIndex]) return;

    const ctx = canvas.getContext('2d');
    const buffer = CONFIG.species.audioBuffers[speciesIndex];
    const data = buffer.getChannelData(0); // Use first channel
    const speciesColor = Utils.rgbToHex(CONFIG.species.colors[speciesIndex]);

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw waveform
    ctx.strokeStyle = speciesColor;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const sliceWidth = canvas.width / data.length;
    let x = 0;

    for (let i = 0; i < data.length; i++) {
        // Apply volume scaling to show visual effect of volume adjustment
        const volumeScale = CONFIG.species.sampleVolumes[speciesIndex] || 1.0;
        const v = data[i] * 0.5 * volumeScale; // Scale amplitude with volume adjustment
        const y = (v + 1) * canvas.height / 2; // Center and scale to canvas height

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    ctx.stroke();

    // Draw range selection
    const range = CONFIG.species.sampleRanges[speciesIndex];
    const startX = range.start * canvas.width;
    const endX = range.end * canvas.width;

    ctx.fillStyle = speciesColor + '40'; // Add transparency
    ctx.fillRect(startX, 0, endX - startX, canvas.height);

    // Draw range markers
    ctx.strokeStyle = speciesColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, canvas.height);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, canvas.height);
    ctx.stroke();
}

// Toggle mute state for a species
export function toggleSpeciesMute(speciesIndex) {
    if (speciesIndex < 0 || speciesIndex >= CONFIG.species.count) return;

    // Toggle mute state
    CONFIG.species.mutedSpecies[speciesIndex] = !CONFIG.species.mutedSpecies[speciesIndex];
    const isMuted = CONFIG.species.mutedSpecies[speciesIndex];

    console.log(`🔇 Species ${String.fromCharCode(65 + speciesIndex)} ${isMuted ? 'muted' : 'unmuted'}`);

    // Update audio system with new mute state
    AudioSystem.updateParameters({ mute: true });

    // Refresh tabs to update toggle appearance
    createAudioSpeciesTabs();
}

// Create audio species tabs
export function createAudioSpeciesTabs() {
    const tabContainer = safeGetElement('audioSpeciesTabs');
    if (!tabContainer) return;

    tabContainer.innerHTML = '';

    for (let i = 0; i < CONFIG.species.count; i++) {
        const tab = Utils.createElement('div', 'species-tab');
        if (i === currentAudioSpeciesTab) tab.classList.add('active');
        tab.style.color = Utils.rgbToHex(CONFIG.species.colors[i]);

        const clickHandler = () => selectAudioSpeciesTab(i);
        sampleControlEventManager.add(tab, 'click', clickHandler);

        const label = Utils.createElement('div', 'species-tab-label');
        label.textContent = `Species ${String.fromCharCode(65 + i)}`;

        const info = Utils.createElement('div', 'species-tab-info');

        // Create mute toggle circle
        const muteToggle = Utils.createElement('div', 'species-mute-toggle');
        const isMuted = CONFIG.species.mutedSpecies[i];
        muteToggle.classList.add(isMuted ? 'muted' : 'active');
        muteToggle.id = `audio-mute-${i}`;
        muteToggle.title = isMuted ? 'Unmute species' : 'Mute species';

        const muteClickHandler = (e) => {
            e.stopPropagation(); // Prevent tab selection
            toggleSpeciesMute(i);
        };
        sampleControlEventManager.add(muteToggle, 'click', muteClickHandler);

        info.appendChild(muteToggle);
        tab.appendChild(label);
        tab.appendChild(info);
        tabContainer.appendChild(tab);
    }

    console.log(`🎵 Created ${CONFIG.species.count} audio species tabs`);
}

// Select audio species tab
export function selectAudioSpeciesTab(speciesIndex) {
    if (speciesIndex === currentAudioSpeciesTab) return;
    currentAudioSpeciesTab = clamp(speciesIndex, 0, CONFIG.species.count - 1);

    // Update tab active states
    const tabContainer = safeGetElement('audioSpeciesTabs');
    if (tabContainer) {
        const tabs = tabContainer.querySelectorAll('.species-tab');
        tabs.forEach((tab, index) => {
            tab.classList.toggle('active', index === currentAudioSpeciesTab);
        });
    }

    // Recreate controls for new species
    createAudioSampleControls();
    console.log(`🎯 Selected audio species ${String.fromCharCode(65 + currentAudioSpeciesTab)}`);
}

// Update audio sample colors without recreating all controls
export function updateAudioSampleColors() {
    const container = safeGetElement('audioSamplesContainer');
    if (!container) return;

    const i = currentAudioSpeciesTab;
    if (i >= CONFIG.species.count) return;

    const speciesColor = Utils.rgbToHex(CONFIG.species.colors[i]);

    // Update header color and border
    const header = container.querySelector('h4');
    if (header) {
        header.style.color = speciesColor;
        header.style.borderBottom = '2px solid ' + speciesColor;
    }

    // Update waveform display if sample exists
    if (CONFIG.species.audioBuffers[i]) {
        updateWaveformDisplay(i);
    }
}

// Create audio sample controls for the currently selected species
export function createAudioSampleControls() {
    const container = safeGetElement('audioSamplesContainer');
    if (!container) return;

    // Clear old listeners
    sampleControlEventManager.removeAll();

    // Recreate tabs
    createAudioSpeciesTabs();

    container.innerHTML = '';

    // Only show controls for current species
    const i = currentAudioSpeciesTab;
    const speciesColor = Utils.rgbToHex(CONFIG.species.colors[i]);

    // Species header with larger, centered title
    const header = Utils.createElement('h4', '', {
        margin: '0 0 20px 0',
        color: speciesColor,
        fontSize: '16px',
        textAlign: 'center',
        borderBottom: '2px solid ' + speciesColor,
        paddingBottom: '10px'
    });
    header.textContent = `Species ${String.fromCharCode(65 + i)}`;

    // File input section
    const fileSection = Utils.createElement('div', 'audio-file-section');
    const fileWrapper = Utils.createElement('div', 'file-input-wrapper');
    const fileInput = Utils.createElement('input', 'file-input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.id = `audio-file-${i}`;

    const fileButton = Utils.createElement('div', 'file-input-button');
    fileButton.textContent = '📁 Load Audio File';
    fileButton.onclick = () => fileInput.click();

    fileInput.onchange = async (e) => {
        if (e.target.files[0]) {
            try {
                await AudioSystem.loadSample(i, e.target.files[0]);
                Utils.showToast(`✅ Sample loaded for Species ${String.fromCharCode(65 + i)}`, 2000);
                // Update tab icon
                const statusIcon = safeGetElement(`audio-status-${i}`);
                if (statusIcon) {
                    statusIcon.textContent = '🎵';
                    statusIcon.title = 'Sample loaded';
                }
            } catch (error) {
                console.error('Failed to load audio sample:', error);
                if (error.message.includes('not initialized')) {
                    Utils.showToast('⚠️ Please start the audio engine first', 3000);
                } else {
                    Utils.showToast(`❌ Failed to load sample: ${error.message}`, 4000);
                }
            }
        }
    };

    fileWrapper.appendChild(fileInput);
    fileWrapper.appendChild(fileButton);
    fileSection.appendChild(fileWrapper);

    // Waveform display section
    const waveformSection = Utils.createElement('div', 'audio-waveform-section');

    const waveformCanvas = Utils.createElement('canvas', 'waveform-canvas');
    waveformCanvas.id = `waveform-${i}`;
    waveformCanvas.width = 350;
    waveformCanvas.height = 100; // Increased height for better visibility

    waveformSection.appendChild(waveformCanvas);

    // Audio controls in vertical layout - all sliders same width, values aligned
    const audioControlsGroup = Utils.createElement('div', 'audio-control-group');

    // Volume control
    const volumeControlDiv = Utils.createElement('div', 'audio-control-row');
    const volumeLabel = Utils.createElement('label', 'audio-control-label');
    volumeLabel.textContent = 'Volume';

    const volumeSliderContainer = Utils.createElement('div', 'audio-control-slider-container');
    const volumeSlider = Utils.createElement('input', 'slider');
    volumeSlider.type = 'range';
    volumeSlider.min = '0.1';
    volumeSlider.max = '2.0';
    volumeSlider.step = '0.1';
    volumeSlider.value = CONFIG.species.sampleVolumes[i] || 1.0;
    volumeSlider.id = `volume-${i}`;

    const volumeValue = Utils.createElement('span', 'audio-control-value');
    volumeValue.textContent = (CONFIG.species.sampleVolumes[i] || 1.0).toFixed(1);
    volumeValue.id = `volume-${i}-value`;

    const volumeHandler = (e) => {
        const value = validateFloat(e.target.value, 0.1, 2.0);
        CONFIG.species.sampleVolumes[i] = value;
        volumeValue.textContent = value.toFixed(1);
        AudioSystem.updateParameters({ audio: true });
        updateWaveformDisplay(i);
    };
    sampleControlEventManager.add(volumeSlider, 'input', volumeHandler);

    volumeSliderContainer.appendChild(volumeSlider);
    volumeSliderContainer.appendChild(volumeValue);
    volumeControlDiv.appendChild(volumeLabel);
    volumeControlDiv.appendChild(volumeSliderContainer);

    // Pitch control
    const pitchControlDiv = Utils.createElement('div', 'audio-control-row');
    const pitchLabel = Utils.createElement('label', 'audio-control-label');
    pitchLabel.textContent = 'Pitch (semitones)';

    const pitchSliderContainer = Utils.createElement('div', 'audio-control-slider-container');
    const pitchSlider = Utils.createElement('input', 'slider');
    pitchSlider.type = 'range';
    pitchSlider.min = '-24';
    pitchSlider.max = '24';
    pitchSlider.step = '1';
    pitchSlider.value = CONFIG.species.samplePitches[i] || 0;
    pitchSlider.id = `pitch-${i}`;

    const pitchValue = Utils.createElement('span', 'audio-control-value');
    const pitchNum = CONFIG.species.samplePitches[i] || 0;
    pitchValue.textContent = pitchNum > 0 ? `+${pitchNum}` : `${pitchNum}`;
    pitchValue.id = `pitch-${i}-value`;

    const pitchHandler = (e) => {
        const value = validateInt(e.target.value, -24, 24);
        CONFIG.species.samplePitches[i] = value;
        pitchValue.textContent = value > 0 ? `+${value}` : `${value}`;
        AudioSystem.updateParameters({ audio: true });
    };
    sampleControlEventManager.add(pitchSlider, 'input', pitchHandler);

    pitchSliderContainer.appendChild(pitchSlider);
    pitchSliderContainer.appendChild(pitchValue);
    pitchControlDiv.appendChild(pitchLabel);
    pitchControlDiv.appendChild(pitchSliderContainer);

    // Max Voices control
    const voicesControlDiv = Utils.createElement('div', 'audio-control-row');
    const voicesLabel = Utils.createElement('label', 'audio-control-label');
    const particleCount = CONFIG.species.counts[i];
    voicesLabel.textContent = `Max Voices (1-${particleCount})`;

    const voicesSliderContainer = Utils.createElement('div', 'audio-control-slider-container');
    const voicesSlider = Utils.createElement('input', 'slider');
    voicesSlider.type = 'range';
    voicesSlider.min = '1';
    voicesSlider.max = particleCount.toString();
    voicesSlider.step = '1';

    // Ensure maxVoices is clamped to current particle count
    let currentMaxVoices = CONFIG.species.maxVoicesPerSpecies[i] || 4;
    if (currentMaxVoices > particleCount) {
        currentMaxVoices = particleCount;
        CONFIG.species.maxVoicesPerSpecies[i] = particleCount;
    }
    voicesSlider.value = currentMaxVoices.toString();
    voicesSlider.id = `voices-${i}`;

    const voicesValue = Utils.createElement('span', 'audio-control-value');
    voicesValue.textContent = currentMaxVoices;
    voicesValue.id = `voices-${i}-value`;

    const voicesHandler = (e) => {
        const value = validateInt(e.target.value, 1, particleCount);
        CONFIG.species.maxVoicesPerSpecies[i] = value;
        voicesValue.textContent = value;
        AudioSystem.updateParameters({ voices: true });
    };
    sampleControlEventManager.add(voicesSlider, 'input', voicesHandler);

    voicesSliderContainer.appendChild(voicesSlider);
    voicesSliderContainer.appendChild(voicesValue);
    voicesControlDiv.appendChild(voicesLabel);
    voicesControlDiv.appendChild(voicesSliderContainer);

    audioControlsGroup.appendChild(volumeControlDiv);
    audioControlsGroup.appendChild(pitchControlDiv);
    audioControlsGroup.appendChild(voicesControlDiv);

    // Assemble everything
    container.appendChild(header);
    container.appendChild(fileSection);
    container.appendChild(waveformSection);
    container.appendChild(audioControlsGroup);

    // Add canvas interaction for range selection
    setupWaveformInteraction(waveformCanvas, i);

    // Draw waveform if sample exists
    if (CONFIG.species.audioBuffers[i]) {
        updateWaveformDisplay(i);
    }
}

// Setup waveform canvas interaction
function setupWaveformInteraction(canvas, speciesIndex) {
    let isDraggingRange = false;

    const handleMouseDown = (e) => {
        isDraggingRange = true;
        const position = getCanvasPosition(e, canvas);
        CONFIG.species.sampleRanges[speciesIndex].start = clamp(position, 0, 1);
        updateWaveformDisplay(speciesIndex);
        AudioSystem.updateParameters({ ranges: true });
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
        if (!isDraggingRange) return;
        const endPosition = getCanvasPosition(e, canvas);
        const startPos = CONFIG.species.sampleRanges[speciesIndex].start;
        CONFIG.species.sampleRanges[speciesIndex].end = clamp(endPosition, startPos + 0.01, 1);
        updateWaveformDisplay(speciesIndex);
        AudioSystem.updateParameters({ ranges: true });
    };

    const handleMouseUp = () => {
        isDraggingRange = false;
    };

    sampleControlEventManager.add(canvas, 'mousedown', handleMouseDown);
    sampleControlEventManager.add(canvas, 'mousemove', handleMouseMove);
    sampleControlEventManager.add(canvas, 'mouseup', handleMouseUp);
    sampleControlEventManager.add(canvas, 'mouseleave', handleMouseUp);
}

// Helper function to get normalized canvas position
function getCanvasPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width;
}

// Voice slider updates (referenced from force-matrix.js)
export function updateVoiceSliders() {
    console.log('[updateVoiceSliders] Called - updating ALL species');

    // Ensure current tab is valid
    if (currentAudioSpeciesTab >= CONFIG.species.count) {
        currentAudioSpeciesTab = Math.max(0, CONFIG.species.count - 1);
    }

    let needsAudioUpdate = false;

    // Update ALL species sliders, not just the currently visible one
    for (let i = 0; i < CONFIG.species.count; i++) {
        const voiceSlider = safeGetElement(`voices-${i}`);
        const voiceValue = safeGetElement(`voices-${i}-value`);
        const voiceLabel = voiceSlider?.parentElement?.previousElementSibling;

        // Only update if slider exists (it exists for the currently visible tab)
        if (voiceSlider && voiceValue) {
            // Update max attribute to match current particle count
            const particleCount = CONFIG.species.counts[i];
            const oldMax = voiceSlider.max;
            voiceSlider.max = particleCount.toString();

            // Update label to show new max
            if (voiceLabel) {
                voiceLabel.textContent = `Max Voices (1-${particleCount})`;
            }

            console.log(`[updateVoiceSliders] Species ${i}: Updated max from ${oldMax} to ${particleCount}`);

            // If current value exceeds new particle count, clamp it down
            if (CONFIG.species.maxVoicesPerSpecies[i] > particleCount) {
                CONFIG.species.maxVoicesPerSpecies[i] = particleCount;
                voiceSlider.value = particleCount;
                voiceValue.textContent = particleCount;
                console.log(`[updateVoiceSliders] Species ${i}: Clamped maxVoices to ${particleCount}`);
                needsAudioUpdate = true;
            }
        } else {
            // Slider doesn't exist (not currently visible tab), but still clamp the config value
            const particleCount = CONFIG.species.counts[i];
            if (CONFIG.species.maxVoicesPerSpecies[i] > particleCount) {
                CONFIG.species.maxVoicesPerSpecies[i] = particleCount;
                console.log(`[updateVoiceSliders] Species ${i}: Clamped maxVoices to ${particleCount} (slider not visible)`);
                needsAudioUpdate = true;
            }
        }
    }

    // Send audio update once if any species was clamped
    if (needsAudioUpdate) {
        AudioSystem.updateParameters({ voices: true });
    }

    // Also update the tabs to refresh status icons
    createAudioSpeciesTabs();
}