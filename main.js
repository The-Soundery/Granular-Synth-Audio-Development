/**
 * Main Application Entry Point
 * Coordinates initialization of all systems and sets up global handlers
 */

import { PhysicsEngine } from './physics/physics-engine.js';
import { AudioSystem } from './audio/audio-system.js';
import { UISystem } from './ui/ui-system.js';
import { CONFIG, state } from './config.js';
import { randomizeForceMatrix } from './ui/force-matrix.js';
import { toggleCollapsible } from './ui/tab-system.js';
import { savePreset, loadPreset, deletePreset, exportPreset } from './ui/preset-system.js';
import { disableAudioControls } from './audio/audio-engine.js';

// Initialize all systems
async function initApp() {
    console.log('🚀 Initializing Granular Particle Synthesizer...');

    try {
        // Initialize UI system first
        console.log('🎨 Initializing UI System...');
        await UISystem.init();

        // Initialize physics engine
        console.log('⚛️ Initializing Physics Engine...');
        await PhysicsEngine.init();

        // Initialize audio system UI
        console.log('🎵 Initializing Audio System UI...');
        AudioSystem.updateUI({ updateType: 'all' });

        // Disable audio controls until user starts the audio engine
        console.log('🔒 Disabling audio controls (audio engine not started)');
        disableAudioControls();

        console.log('✅ All systems initialized successfully');
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        throw error;
    }
}

// Make key functions globally available for onclick handlers in HTML
window.togglePause = () => {
    try {
        PhysicsEngine.togglePause();
    } catch (error) {
        console.error('Error toggling pause:', error);
    }
};

window.resetSimulation = () => {
    try {
        PhysicsEngine.resetSimulation();
    } catch (error) {
        console.error('Error resetting simulation:', error);
    }
};

window.randomizeForceMatrix = () => {
    try {
        randomizeForceMatrix();
    } catch (error) {
        console.error('Error randomizing force matrix:', error);
    }
};

window.toggleCollapsible = (sectionId) => {
    try {
        toggleCollapsible(sectionId);
    } catch (error) {
        console.error('Error toggling collapsible:', error);
    }
};

window.savePreset = () => {
    try {
        savePreset();
    } catch (error) {
        console.error('Error saving preset:', error);
    }
};

window.loadPreset = () => {
    try {
        loadPreset();
    } catch (error) {
        console.error('Error loading preset:', error);
    }
};

window.deletePreset = () => {
    try {
        deletePreset();
    } catch (error) {
        console.error('Error deleting preset:', error);
    }
};

window.exportPreset = () => {
    try {
        exportPreset();
    } catch (error) {
        console.error('Error exporting preset:', error);
    }
};

// Make AudioSystem globally available for onclick handlers
window.AudioSystem = AudioSystem;

// Start the application when page loads
document.addEventListener('DOMContentLoaded', initApp);

// Export for debugging
window.GranularParticleSynth = {
    CONFIG,
    state,
    PhysicsEngine,
    AudioSystem,
    UISystem
};