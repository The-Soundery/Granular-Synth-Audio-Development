/**
 * Keyboard Shortcuts - Keyboard navigation and shortcut system
 * Handles all keyboard shortcuts and their display management
 */

import { CONFIG, state } from '../config.js';
import { Utils } from '../utils.js';
import { togglePause, resetSimulation } from '../physics/physics-engine.js';
import { selectSpeciesTab } from './force-matrix.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement } from '../shared/dom-utils.js';

// Event listener manager
const eventManager = new EventListenerManager('KeyboardShortcuts');

export function initKeyboardShortcuts() {
    // Clear previous listeners
    eventManager.removeAll();

    const keyboardListener = (e) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || !state.keyboardEnabled) return;

        const actions = {
            'Space': () => {
                togglePause();
                Utils.showToast('Simulation ' + (state.isPaused ? 'Paused' : 'Resumed'));
            },
            'KeyR': () => {
                if (e.ctrlKey || e.metaKey) return;
                resetSimulation();
                Utils.showToast('Simulation Reset');
            },
            'KeyH': () => toggleKeyboardShortcuts(),
            'KeyA': () => {
                // Switch to audio tab
                const audioTab = document.querySelector('[data-tab="audio"]');
                if (audioTab) {
                    audioTab.click();
                    Utils.showToast('Audio Tab');
                }
            }
        };

        // Handle digit keys for species selection
        if (e.code.startsWith('Digit')) {
            const speciesIndex = parseInt(e.code.slice(-1)) - 1;
            if (speciesIndex < CONFIG.species.count) {
                selectSpeciesTab(speciesIndex);
                Utils.showToast(`Species ${String.fromCharCode(65 + speciesIndex)} Selected`);
            }
            e.preventDefault();
            return;
        }

        if (actions[e.code]) {
            e.preventDefault();
            actions[e.code]();
        }
    };

    eventManager.add(document, 'keydown', keyboardListener);

    console.log('⌨️ Keyboard shortcuts initialized');
}

export function toggleKeyboardShortcuts() {
    const shortcuts = safeGetElement('keyboardShortcuts');
    if (!shortcuts) return;

    const isHidden = shortcuts.classList.toggle('hidden');
    Utils.showToast(isHidden ? 'Shortcuts hidden' : 'Shortcuts shown');
    localStorage.setItem('keyboardShortcuts-hidden', isHidden.toString());
}

export function initKeyboardShortcutsDisplay() {
    const shortcuts = safeGetElement('keyboardShortcuts');
    if (!shortcuts) return;

    if (localStorage.getItem('keyboardShortcuts-hidden') === 'true') {
        shortcuts.classList.add('hidden');
    }
    console.log('⌨️ Keyboard shortcuts display initialized');
}