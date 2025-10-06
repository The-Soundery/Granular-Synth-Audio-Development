/**
 * Preset System - Save, load, import, export preset configurations
 * Handles complete state management and preset persistence
 */

import { CONFIG, state } from '../config.js';
import { Utils } from '../utils.js';
import { updateCanvasSize, adjustParticleCounts } from '../physics/physics-engine.js';
import { ensureMatrixSize, createForceMatrix, createSpeciesTabs } from './force-matrix.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement, updateElementValue, updateElementText } from '../shared/dom-utils.js';

export function getCurrentState() {
    return {
        version: '1.0',
        timestamp: new Date().toISOString(),
        canvasWidth: CONFIG.canvas.width,
        canvasHeight: CONFIG.canvas.height,
        speciesCount: CONFIG.species.count,
        particleCounts: [...CONFIG.species.counts],
        particleSizes: [...CONFIG.species.sizes],
        speciesTrailLengths: [...CONFIG.species.trailLengths],
        speciesColors: CONFIG.species.colors.map(color => [...color]),
        friction: CONFIG.physics.friction,
        maxForceDistance: CONFIG.physics.maxForceDistance,
        simulationSpeed: CONFIG.physics.simulationSpeed,
        toroidalSpace: CONFIG.physics.toroidalSpace,
        gravityStrength: CONFIG.physics.gravityStrength,
        bounceDamping: CONFIG.physics.bounceDamping,
        relationshipMatrix: CONFIG.relationships.map(row => [...row])
    };
}

export function applyState(presetState) {
    try {
        if (!presetState.version || presetState.version !== '1.0') {
            throw new Error('Incompatible preset version');
        }

        updateCanvasSize(presetState.canvasWidth || 1200, presetState.canvasHeight || 800);

        CONFIG.species.count = presetState.speciesCount || 2;
        updateElementValue('speciesCount', CONFIG.species.count);
        updateElementText('speciesCount-value', CONFIG.species.count);

        if (presetState.particleCounts) CONFIG.species.counts.splice(0, CONFIG.species.counts.length, ...presetState.particleCounts);
        if (presetState.particleSizes) CONFIG.species.sizes.splice(0, CONFIG.species.sizes.length, ...presetState.particleSizes);
        if (presetState.speciesTrailLengths) CONFIG.species.trailLengths.splice(0, CONFIG.species.trailLengths.length, ...presetState.speciesTrailLengths);
        if (presetState.speciesColors) CONFIG.species.colors.splice(0, CONFIG.species.colors.length, ...presetState.speciesColors.map(color => [...color]));

        CONFIG.physics.friction = presetState.friction || 0.95;
        CONFIG.physics.maxForceDistance = presetState.maxForceDistance || 60;
        CONFIG.physics.simulationSpeed = presetState.simulationSpeed || 1.0;
        CONFIG.physics.toroidalSpace = presetState.toroidalSpace !== undefined ? presetState.toroidalSpace : true;
        CONFIG.physics.gravityStrength = presetState.gravityStrength || 0.0;
        CONFIG.physics.bounceDamping = presetState.bounceDamping || 0.8;

        if (presetState.relationshipMatrix) {
            CONFIG.relationships.splice(0, CONFIG.relationships.length, ...presetState.relationshipMatrix.map(row => [...row]));
        }

        // Update physics UI
        const updates = [
            ['friction', CONFIG.physics.friction, 2],
            ['forceRadius', CONFIG.physics.maxForceDistance, 0],
            ['simSpeed', CONFIG.physics.simulationSpeed, 1],
            ['gravityStrength', CONFIG.physics.gravityStrength, 1],
            ['bounceDamping', CONFIG.physics.bounceDamping, 1]
        ];

        updates.forEach(([id, value, decimals]) => {
            updateElementValue(id, value);
            updateElementText(`${id}-value`, value.toFixed(decimals));
        });

        const toroidalSpaceEl = safeGetElement('toroidalSpace');
        if (toroidalSpaceEl) toroidalSpaceEl.checked = CONFIG.physics.toroidalSpace;

        ensureMatrixSize();
        createForceMatrix();
        createSpeciesTabs();
        adjustParticleCounts();

        if (state.spatialGrid) {
            state.spatialGrid.updateCellSize(CONFIG.physics.maxForceDistance);
        }

        console.log('⚙️ Preset applied successfully');
        return true;

    } catch (error) {
        console.error('Failed to apply preset:', error);
        Utils.showToast('Failed to load preset: ' + error.message, 3000);
        return false;
    }
}

export function savePreset() {
    const name = prompt('Enter preset name:');
    if (!name || !name.trim()) return;

    const presetState = getCurrentState();
    presetState.name = name.trim();

    // Save to localStorage
    const presets = getStoredPresets();
    presets[name] = presetState;
    localStorage.setItem('granular-presets', JSON.stringify(presets));

    updatePresetSelect();
    Utils.showToast(`Preset "${name}" saved`);

    console.log(`💾 Preset saved: ${name}`);
}

// Helper to get selected preset name
function getSelectedPresetName() {
    const select = safeGetElement('presetSelect');
    return select?.value || null;
}

export function loadPreset() {
    const presetName = getSelectedPresetName();

    if (!presetName) {
        Utils.showToast('Please select a preset to load');
        return;
    }

    const presets = getStoredPresets();
    const preset = presets[presetName];

    if (!preset) {
        Utils.showToast('Preset not found');
        return;
    }

    if (applyState(preset)) {
        Utils.showToast(`Preset "${presetName}" loaded`);
        console.log(`📁 Preset loaded: ${presetName}`);
    }
}

export function deletePreset() {
    const presetName = getSelectedPresetName();

    if (!presetName) {
        Utils.showToast('Please select a preset to delete');
        return;
    }

    if (!confirm(`Delete preset "${presetName}"?`)) {
        return;
    }

    const presets = getStoredPresets();
    delete presets[presetName];
    localStorage.setItem('granular-presets', JSON.stringify(presets));

    updatePresetSelect();
    Utils.showToast(`Preset "${presetName}" deleted`);

    console.log(`🗑️ Preset deleted: ${presetName}`);
}

export function exportPreset() {
    const presetName = getSelectedPresetName();

    let preset, filename;

    if (presetName) {
        const presets = getStoredPresets();
        preset = presets[presetName];
        filename = `granular-preset-${presetName.replace(/[^a-zA-Z0-9]/g, '-')}.json`;
    } else {
        preset = getCurrentState();
        preset.name = 'Current State';
        filename = `granular-preset-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    }

    if (!preset) {
        Utils.showToast('No preset to export');
        return;
    }

    // Create download link
    const dataStr = JSON.stringify(preset, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);

    const exportLink = document.createElement('a');
    exportLink.setAttribute('href', dataUri);
    exportLink.setAttribute('download', filename);
    exportLink.click();

    Utils.showToast(`Preset exported as ${filename}`);

    console.log(`📤 Preset exported: ${filename}`);
}

export function importPreset() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    const changeHandler = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const preset = JSON.parse(e.target.result);

                if (applyState(preset)) {
                    // Also save to localStorage if it has a name
                    if (preset.name) {
                        const presets = getStoredPresets();
                        presets[preset.name] = preset;
                        localStorage.setItem('granular-presets', JSON.stringify(presets));
                        updatePresetSelect();
                        Utils.showToast(`Preset "${preset.name}" imported and saved`);
                    } else {
                        Utils.showToast('Preset imported (not saved)');
                    }
                }
            } catch (error) {
                console.error('Import error:', error);
                Utils.showToast('Invalid preset file');
            }
        };
        reader.readAsText(file);
    };

    input.addEventListener('change', changeHandler);
    input.click();
}

export function getStoredPresets() {
    try {
        return JSON.parse(localStorage.getItem('granular-presets') || '{}');
    } catch (error) {
        console.error('Failed to load presets:', error);
        return {};
    }
}

export function updatePresetSelect() {
    const select = safeGetElement('presetSelect');
    if (!select) return;

    const presets = getStoredPresets();

    select.innerHTML = '<option value="">Select Preset...</option>';

    Object.keys(presets).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

// Event listener manager
const eventManager = new EventListenerManager('PresetSystem');

export function initPresetSystem() {
    updatePresetSelect();

    // Clear previous listeners
    eventManager.removeAll();

    // Add import functionality to the load button's context menu
    const loadButton = document.querySelector('button[onclick="loadPreset()"]');
    if (loadButton) {
        const importListener = (e) => {
            e.preventDefault();
            importPreset();
        };

        eventManager.add(loadButton, 'contextmenu', importListener);
        loadButton.title = 'Left-click: Load selected preset\nRight-click: Import preset file';
    }

    console.log('🎯 Preset system initialized');
}