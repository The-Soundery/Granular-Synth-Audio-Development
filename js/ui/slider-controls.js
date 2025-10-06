/**
 * Slider Controls - Main slider and physics parameter controls
 * Handles all slider interactions and physics parameter updates
 */

import { CONFIG, state, audioEngine } from '../config.js';
import { createForceMatrix, createSpeciesTabs, createSpeciesControls } from './force-matrix.js';
import { updateAudioParameters } from '../audio/parameter-manager.js';
import { updateAudioUI } from '../audio/sample-manager.js';
import { adjustParticleCounts, updateParticleSizes, removeTrailParticlesForSpecies, updateCanvasSize } from '../physics/physics-engine.js';
import { updateCurveGraph, updateVoiceSliders } from './audio-controls.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement, updateElementText } from '../shared/dom-utils.js';
import { clamp, validateInt, validateFloat } from '../shared/validation-utils.js';

// Helper function to send messages to AudioWorklet
function sendWorkletMessage(type, data) {
    if (audioEngine?.workletNode?.port && audioEngine.isActive) {
        audioEngine.workletNode.port.postMessage({ type, ...data });
    }
}

// Event listener managers
const sliderEventManager = new EventListenerManager('SliderControls');
const dragEventManager = new EventListenerManager('DraggableNumbers');

export function setupSliders() {
    // Clear previous listeners
    sliderEventManager.removeAll();

    // Species count slider
    const speciesCount = safeGetElement('speciesCount');
    if (speciesCount) {
        sliderEventManager.add(speciesCount, 'input', (e) => {
            CONFIG.species.count = validateInt(e.target.value, 1, 10);
            updateElementText('speciesCount-value', CONFIG.species.count);

            // Regenerate UI and adjust particles
            createForceMatrix();
            setupDraggableNumbers();
            adjustParticleCounts();

            // Regenerate species tabs
            createSpeciesTabs();

            // Ensure current tab is valid
            if (state.currentSpeciesTab >= CONFIG.species.count) {
                state.currentSpeciesTab = 0;
            }

            // Update species controls
            createSpeciesControls();

            // Update audio sample controls
            updateAudioUI({ updateType: 'controls' });
        });
    }

    // Physics sliders
    const friction = safeGetElement('friction');
    if (friction) {
        sliderEventManager.add(friction, 'input', (e) => {
            CONFIG.physics.friction = validateFloat(e.target.value, 0, 1);
            updateElementText('friction-value', CONFIG.physics.friction.toFixed(2));
        });
    }

    const forceRadius = safeGetElement('forceRadius');
    if (forceRadius) {
        sliderEventManager.add(forceRadius, 'input', (e) => {
            CONFIG.physics.maxForceDistance = validateInt(e.target.value, 10, 500);
            updateElementText('forceRadius-value', CONFIG.physics.maxForceDistance);

            // Update spatial grid cell size
            if (state.spatialGrid) {
                state.spatialGrid.updateCellSize(CONFIG.physics.maxForceDistance);
            }
        });
    }

    const simSpeed = safeGetElement('simSpeed');
    if (simSpeed) {
        sliderEventManager.add(simSpeed, 'input', (e) => {
            CONFIG.physics.simulationSpeed = validateFloat(e.target.value, 0.1, 10);
            updateElementText('simSpeed-value', CONFIG.physics.simulationSpeed.toFixed(1));
        });
    }

    const gravityStrength = safeGetElement('gravityStrength');
    if (gravityStrength) {
        sliderEventManager.add(gravityStrength, 'input', (e) => {
            CONFIG.physics.gravityStrength = validateFloat(e.target.value, 0, 10);
            updateElementText('gravityStrength-value', CONFIG.physics.gravityStrength.toFixed(1));
        });
    }

    const bounceDamping = safeGetElement('bounceDamping');
    if (bounceDamping) {
        sliderEventManager.add(bounceDamping, 'input', (e) => {
            CONFIG.physics.bounceDamping = validateFloat(e.target.value, 0, 1);
            updateElementText('bounceDamping-value', CONFIG.physics.bounceDamping.toFixed(1));
        });
    }

    const toroidalSpace = safeGetElement('toroidalSpace');
    if (toroidalSpace) {
        sliderEventManager.add(toroidalSpace, 'change', (e) => {
            CONFIG.physics.toroidalSpace = e.target.checked;
        });
    }

    // Stage 2: Granular parameter controls
    const curveParameter = safeGetElement('curveParameter');
    if (curveParameter) {
        sliderEventManager.add(curveParameter, 'input', (e) => {
            updateElementText('curveParameter-value', parseFloat(e.target.value).toFixed(1));
            updateCurveGraph();
            updateAudioParameters({ curves: true });
        });
    }

    const volumeScale = safeGetElement('volumeScale');
    if (volumeScale) {
        sliderEventManager.add(volumeScale, 'input', (e) => {
            updateElementText('volumeScale-value', parseFloat(e.target.value).toFixed(2));
            // This will affect the main thread volume calculation, handled in sendParticleDataToAudio
        });
    }
}

export function setupDraggableNumbers() {
    // Clear previous drag listeners
    dragEventManager.removeAll();

    const draggableNumbers = document.querySelectorAll('.draggable-number');

    // Track the currently dragging element
    let currentDragElement = null;
    let startY = 0;
    let startValue = 0;

    // Set up mousedown for each element
    draggableNumbers.forEach(element => {
        const mousedownHandler = (e) => {
            currentDragElement = element;
            startY = e.clientY;
            startValue = parseFloat(element.textContent);
            element.classList.add('dragging');
            e.preventDefault();
        };

        dragEventManager.add(element, 'mousedown', mousedownHandler);
    });

    // Single mousemove handler on document for all elements
    const mousemoveHandler = (e) => {
        if (!currentDragElement) return;

        const element = currentDragElement;
        const deltaY = startY - e.clientY; // Inverted for natural feel
        let sensitivity = 1;
        let newValue = startValue;

            // Determine parameter type and apply appropriate sensitivity
            if (element.id.includes('count')) {
                sensitivity = 0.5;
                newValue = clamp(Math.round(startValue + deltaY * sensitivity), 1, 1000);

                // Update particle count
                const speciesIndex = parseInt(element.id.split('-')[1]);
                CONFIG.species.counts[speciesIndex] = newValue;
                adjustParticleCounts();
                // Update voice sliders since particle count changed
                updateVoiceSliders();

            } else if (element.id.includes('size')) {
                sensitivity = 0.1;
                newValue = clamp(Math.round((startValue + deltaY * sensitivity) * 10) / 10, 2, 20);

                // Update particle size
                const speciesIndex = parseInt(element.id.split('-')[1]);
                CONFIG.species.sizes[speciesIndex] = newValue;
                updateParticleSizes();

            } else if (element.id.includes('trail')) {
                sensitivity = 0.01;
                newValue = clamp(Math.round((startValue + deltaY * sensitivity) * 100) / 100, 0.0, 0.99);

                // Update trail length
                const speciesIndex = parseInt(element.id.split('-')[1]);
                CONFIG.species.trailLengths[speciesIndex] = newValue;

                if (newValue <= 0.01) {
                    removeTrailParticlesForSpecies(speciesIndex);
                }

            } else if (element.id === 'voiceStealingDelay') {
                sensitivity = 1;
                newValue = clamp(Math.round(startValue + deltaY * sensitivity), 1, 500);

                // Update voice stealing delay
                state.voiceStealingDelay = newValue;
                console.log('Voice Stealing Delay set to: ' + newValue + 'ms');

                // Send to AudioWorklet
                sendWorkletMessage('voiceStealingDelay', { delay: newValue });

            } else if (element.id === 'voiceStealingCrossfade') {
                sensitivity = 1;
                newValue = clamp(Math.round(startValue + deltaY * sensitivity), 10, 500);

                // Update voice stealing crossfade
                state.voiceStealingCrossfade = newValue;
                console.log('Voice Stealing Crossfade set to: ' + newValue + 'ms');

                // Send to AudioWorklet
                sendWorkletMessage('voiceStealingCrossfade', { duration: newValue });

            } else if (element.id === 'canvas-width') {
                sensitivity = 5;
                newValue = clamp(Math.round(startValue + deltaY * sensitivity), 400, 1600);

                // Update canvas width
                updateCanvasSize(newValue, CONFIG.canvas.height);

            } else if (element.id === 'canvas-height') {
                sensitivity = 3;
                newValue = clamp(Math.round(startValue + deltaY * sensitivity), 300, 1200);

                // Update canvas height
                updateCanvasSize(CONFIG.canvas.width, newValue);
            }

        if (element.id.includes('trail')) {
            element.textContent = newValue.toFixed(2);
        } else {
            element.textContent = newValue;
        }
    };

    // Single mouseup handler on document for all elements
    const mouseupHandler = () => {
        if (currentDragElement) {
            currentDragElement.classList.remove('dragging');
            currentDragElement = null;
        }
    };

    // Add document-level listeners once
    dragEventManager.add(document, 'mousemove', mousemoveHandler);
    dragEventManager.add(document, 'mouseup', mouseupHandler);
}