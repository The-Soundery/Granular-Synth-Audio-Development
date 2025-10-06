/**
 * Force Matrix - Interactive force relationship matrix and species color management
 * Handles the species force matrix, color pickers, and species tab system
 */

import { CONFIG, state } from '../config.js';
import { Utils } from '../utils.js';
import { setupDraggableNumbers } from './slider-controls.js';
import { createAudioSpeciesTabs, updateAudioSampleColors } from './audio-controls.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement } from '../shared/dom-utils.js';
import { clamp } from '../shared/validation-utils.js';

// Event listener manager
const eventManager = new EventListenerManager('ForceMatrix');

// Helper function to calculate background color based on force value
function getForceColor(value) {
    if (value > 0.1) {
        // Green for attraction (positive values)
        const intensity = Math.abs(value);
        return `rgb(${Math.round(50 * (1 - intensity))}, ${Math.round(150 + intensity * 105)}, ${Math.round(50 * (1 - intensity))})`;
    } else if (value < -0.1) {
        // Red for repulsion (negative values)
        const intensity = Math.abs(value);
        return `rgb(${Math.round(150 + intensity * 105)}, ${Math.round(50 * (1 - intensity))}, ${Math.round(50 * (1 - intensity))})`;
    } else {
        return '#666';
    }
}

export function createForceMatrix() {
    // Clear old listeners
    eventManager.removeAll();

    const matrixGrid = safeGetElement('forceMatrix');
    if (!matrixGrid) return;

    matrixGrid.innerHTML = '';

    matrixGrid.style.gridTemplateColumns = `repeat(${CONFIG.species.count + 1}, 1fr)`;

    // Add corner cell (empty)
    const cornerCell = document.createElement('div');
    cornerCell.className = 'matrix-header';
    matrixGrid.appendChild(cornerCell);

    // Add column headers
    for (let i = 0; i < CONFIG.species.count; i++) {
        const header = document.createElement('div');
        header.className = 'matrix-header';
        header.style.color = Utils.rgbToHex(CONFIG.species.colors[i]);

        const speciesLetter = document.createElement('span');
        speciesLetter.textContent = String.fromCharCode(65 + i);

        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.className = 'species-color-picker';
        colorPicker.value = Utils.rgbToHex(CONFIG.species.colors[i]);
        colorPicker.title = `Change color for Species ${String.fromCharCode(65 + i)}`;

        const colorChangeHandler = (e) => updateSpeciesColor(i, e.target.value);
        eventManager.add(colorPicker, 'change', colorChangeHandler);

        header.appendChild(speciesLetter);
        header.appendChild(colorPicker);
        matrixGrid.appendChild(header);
    }

    // Track currently dragging cell
    let currentDragCell = null;
    let dragStartY = 0;
    let dragStartValue = 0;
    let dragFromSpecies = -1;
    let dragToSpecies = -1;

    // Add row headers and matrix cells
    for (let fromSpecies = 0; fromSpecies < CONFIG.species.count; fromSpecies++) {
        const rowHeader = document.createElement('div');
        rowHeader.className = 'matrix-header';
        rowHeader.style.color = Utils.rgbToHex(CONFIG.species.colors[fromSpecies]);
        rowHeader.textContent = String.fromCharCode(65 + fromSpecies);
        matrixGrid.appendChild(rowHeader);

        for (let toSpecies = 0; toSpecies < CONFIG.species.count; toSpecies++) {
            const cell = document.createElement('div');
            cell.className = 'matrix-cell';
            cell.dataset.from = fromSpecies;
            cell.dataset.to = toSpecies;

            const value = CONFIG.relationships[fromSpecies][toSpecies];
            cell.textContent = value.toFixed(1);

            // Color coding based on force value
            cell.style.backgroundColor = getForceColor(value);

            // Add mousedown handler for this cell
            const handleMouseDown = (e) => {
                currentDragCell = cell;
                dragStartY = e.clientY;
                dragStartValue = CONFIG.relationships[fromSpecies][toSpecies];
                dragFromSpecies = fromSpecies;
                dragToSpecies = toSpecies;
                cell.classList.add('dragging');
                e.preventDefault();
            };

            eventManager.add(cell, 'mousedown', handleMouseDown);
            matrixGrid.appendChild(cell);
        }
    }

    // Single mousemove handler for all cells
    const handleMouseMove = (e) => {
        if (!currentDragCell) return;

        const deltaY = dragStartY - e.clientY;
        const sensitivity = 0.01;
        const newValue = clamp(dragStartValue + deltaY * sensitivity, -1, 1);
        const clampedValue = Math.round(newValue * 10) / 10;

        currentDragCell.textContent = clampedValue.toFixed(1);

        // Update color
        currentDragCell.style.backgroundColor = getForceColor(clampedValue);

        // Update the relationship matrix
        CONFIG.relationships[dragFromSpecies][dragToSpecies] = clampedValue;
    };

    // Single mouseup handler for all cells
    const handleMouseUp = () => {
        if (currentDragCell) {
            currentDragCell.classList.remove('dragging');
            currentDragCell = null;
        }
    };

    eventManager.add(document, 'mousemove', handleMouseMove);
    eventManager.add(document, 'mouseup', handleMouseUp);
}

// Ensure matrix size matches species count
export function ensureMatrixSize() {
    while (CONFIG.relationships.length < CONFIG.species.maxCount) {
        CONFIG.relationships.push(new Array(CONFIG.species.maxCount).fill(-0.1));
    }
    for (let i = 0; i < CONFIG.relationships.length; i++) {
        while (CONFIG.relationships[i].length < CONFIG.species.maxCount) {
            CONFIG.relationships[i].push(-0.1);
        }
    }
}

export function randomizeForceMatrix() {
    for (let i = 0; i < CONFIG.species.count; i++) {
        for (let j = 0; j < CONFIG.species.count; j++) {
            CONFIG.relationships[i][j] = Math.round((Math.random() * 2 - 1) * 10) / 10;
        }
    }
    createForceMatrix();
    console.log('🎲 Force matrix randomized');
}

function updateSpeciesColor(speciesIndex, hexColor) {
    const newColor = Utils.hexToRgb(hexColor);
    CONFIG.species.colors[speciesIndex] = newColor;

    // Update existing particle colors
    state.particles.forEach(p => {
        if (p.species === speciesIndex) {
            p.color = [...newColor];
        }
    });

    // Update existing trail particle colors
    state.trailParticles.forEach(tp => {
        if (tp.species === speciesIndex) {
            tp.color = [...newColor];
        }
    });

    // Update species tabs colors
    createSpeciesTabs();

    // Regenerate force matrix to update header colors
    createForceMatrix();

    // Update species controls to reflect new color in title
    createSpeciesControls();

    // Update audio species tabs to reflect new color (independent of audio engine state)
    createAudioSpeciesTabs();

    // Update audio sample section colors (header and waveform)
    updateAudioSampleColors();

    console.log(`🎨 Species ${String.fromCharCode(65 + speciesIndex)} color updated to ${hexColor}`);
}

// ===== SPECIES TAB SYSTEM =====
export function createSpeciesTabs() {
    const tabContainer = safeGetElement('speciesTabs');
    if (!tabContainer) return;

    tabContainer.innerHTML = '';

    for (let i = 0; i < CONFIG.species.count; i++) {
        const tab = Utils.createElement('div', 'species-tab');
        if (i === state.currentSpeciesTab) tab.classList.add('active');
        tab.style.color = Utils.rgbToHex(CONFIG.species.colors[i]);
        tab.addEventListener('click', () => selectSpeciesTab(i));

        const label = Utils.createElement('div', 'species-tab-label');
        label.textContent = `Species ${String.fromCharCode(65 + i)}`;

        const info = Utils.createElement('div', 'species-tab-info');
        const particleCount = Utils.createElement('span');
        particleCount.textContent = CONFIG.species.counts[i] || 0;
        particleCount.id = `species-count-${i}`;

        info.appendChild(particleCount);
        tab.appendChild(label);
        tab.appendChild(info);
        tabContainer.appendChild(tab);
    }

    console.log(`🎯 Created ${CONFIG.species.count} species tabs`);
}

export function selectSpeciesTab(speciesIndex) {
    if (speciesIndex === state.currentSpeciesTab) return;
    state.currentSpeciesTab = speciesIndex;

    document.querySelectorAll('.species-tab').forEach((tab, index) => {
        tab.classList.toggle('active', index === speciesIndex);
    });

    createSpeciesControls();
    console.log(`🎯 Selected species ${String.fromCharCode(65 + speciesIndex)}`);
}

// Create species-specific controls
export function createSpeciesControls() {
    const container = safeGetElement('speciesControls');
    if (!container || state.currentSpeciesTab >= CONFIG.species.count) return;

    container.innerHTML = '';
    const i = state.currentSpeciesTab;

    const controlsDiv = Utils.createElement('div', '', {
        padding: '15px', background: '#0f0f0f', border: '1px solid #333', borderRadius: '6px'
    });

    const title = Utils.createElement('h4', '', {
        margin: '0 0 15px 0', color: Utils.rgbToHex(CONFIG.species.colors[i]),
        fontSize: '14px', textAlign: 'center', borderBottom: '1px solid #333', paddingBottom: '8px'
    });
    title.textContent = `Species ${String.fromCharCode(65 + i)} Controls`;

    const controls = [
        { label: 'Count', id: `count-${i}`, value: CONFIG.species.counts[i] },
        { label: 'Size', id: `size-${i}`, value: CONFIG.species.sizes[i] },
        { label: 'Trail', id: `trail-${i}`, value: CONFIG.species.trailLengths[i].toFixed(2) }
    ];

    controlsDiv.appendChild(title);

    controls.forEach(control => {
        const row = Utils.createElement('div', '', {
            display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px'
        });
        row.innerHTML = `
            <span style="min-width: 60px; font-size: 12px; color: #ccc;">${control.label}:</span>
            <span class="draggable-number" id="${control.id}">${control.value}</span>
        `;
        controlsDiv.appendChild(row);
    });

    container.appendChild(controlsDiv);
    setupDraggableNumbers();
}

// Update species tab info (particle counts)
export function updateSpeciesTabInfo() {
    for (let i = 0; i < CONFIG.species.count; i++) {
        const countElement = safeGetElement(`species-count-${i}`);
        if (countElement) {
            countElement.textContent = CONFIG.species.counts[i] || 0;
        }
    }
}