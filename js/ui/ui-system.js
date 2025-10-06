/**
 * UI System Public API
 *
 * Central UI system interface that coordinates all UI modules including sliders,
 * tabs, keyboard shortcuts, presets, audio controls, and canvas interaction.
 *
 * @namespace UISystem
 * @public
 *
 * @example
 * // Initialize UI system
 * await UISystem.init();
 *
 * // Update specific UI components
 * UISystem.update({ forceMatrix: true, speciesTabs: true });
 *
 * // Get current state
 * const state = UISystem.getState();
 */

import { setupSliders } from './slider-controls.js';
import { createForceMatrix, ensureMatrixSize, createSpeciesTabs, createSpeciesControls } from './force-matrix.js';
import { initTabSystem, initCollapsibleSections } from './tab-system.js';
import { initKeyboardShortcuts, initKeyboardShortcutsDisplay } from './keyboard-shortcuts.js';
import { initPresetSystem } from './preset-system.js';
import { setupAudioControlEventListeners, createAudioSampleControls } from './audio-controls.js';
import { setupCanvasInteraction } from './canvas-interaction.js';
import { initPerformanceDisplay } from './performance-display.js';

export const UISystem = {
    /**
     * Initialize the complete UI system
     * Sets up all UI components, event listeners, and interaction systems
     *
     * @returns {Promise<boolean>} True if initialization successful
     * @public
     */
    async init() {
        try {
            // Initialize core UI components
            ensureMatrixSize();
            createForceMatrix();
            setupSliders();

            // Initialize tab and section management
            initTabSystem();
            initCollapsibleSections();

            // Initialize species-specific UI
            createSpeciesTabs();
            createSpeciesControls();

            // Initialize interaction systems
            initKeyboardShortcuts();
            initKeyboardShortcutsDisplay();
            initPresetSystem();

            // Initialize audio UI components
            setupAudioControlEventListeners();
            createAudioSampleControls();

            // Initialize canvas interaction
            const canvas = document.getElementById('canvas');
            if (canvas) {
                setupCanvasInteraction(canvas);
            }

            // Initialize performance display
            initPerformanceDisplay();

            console.log('🎨 UI System initialized successfully');
            return true;
        } catch (error) {
            console.error('UISystem init failed:', error);
            return false;
        }
    },

    /**
     * Update specific UI components
     * Rebuilds UI elements based on current CONFIG state
     *
     * @param {Object} [options={}] - Update options
     * @param {boolean} [options.forceMatrix] - Rebuild force relationship matrix
     * @param {boolean} [options.speciesTabs] - Rebuild species tab navigation
     * @param {boolean} [options.speciesControls] - Rebuild species-specific controls
     * @param {boolean} [options.audioControls] - Rebuild audio sample controls
     * @returns {void}
     * @public
     */
    update(options = {}) {
        if (options.forceMatrix) {
            createForceMatrix();
        }

        if (options.speciesTabs) {
            createSpeciesTabs();
        }

        if (options.speciesControls) {
            createSpeciesControls();
        }

        if (options.audioControls) {
            createAudioSampleControls();
        }
    },

    /**
     * Get current UI system state
     *
     * @returns {Object} UI state information
     * @returns {boolean} .initialized - Whether UI system is initialized
     * @public
     */
    getState() {
        return {
            initialized: true
        };
    }
};