/**
 * Physics Engine - Main simulation loop, particle management, and rendering
 */

import { CONFIG, state, audioEngine } from '../config.js';
import { Particle, TrailParticle } from './particle.js';
import { SpatialGrid } from './spatial-grid.js';
import { eventBus, Events } from '../shared/event-bus.js';
import { PhysicsRenderer } from '../rendering/physics-renderer.js';
import { updateVoiceSliders } from '../ui/audio-controls.js';
import { AudioSystem } from '../audio/audio-system.js';

// Animation loop variables
let lastFrameTime = performance.now();
let frameCount = 0;
let fpsUpdateTime = performance.now();
let frameTimeHistory = [];

// Renderer instance
let renderer = null;

// Initialize particles
export function initParticles() {
    const newParticles = [];
    for (let species = 0; species < CONFIG.species.count; species++) {
        for (let i = 0; i < CONFIG.species.counts[species]; i++) {
            newParticles.push(new Particle(species));
        }
    }
    state.particles = newParticles;
    updateParticleCountDisplay();
}

// Initialize spatial grid system
export function initSpatialGrid() {
    const grid = new SpatialGrid(CONFIG.canvas.width, CONFIG.canvas.height, CONFIG.physics.maxForceDistance);
    console.log('🚀 Spatial partitioning enabled! Force calculations optimized from O(N²) to O(N)');
    return grid;
}

// Initialize trail particle system
export function initTrailSystem() {
    if (renderer) {
        renderer.clearCanvas();
    }
    state.trailParticles = [];
    console.log('🎨 Trail particle system initialized!');
}

// Adjust particle counts dynamically
export function adjustParticleCounts() {
    let currentCounts = new Array(CONFIG.species.maxCount).fill(0);
    for (let particle of state.particles) {
        currentCounts[particle.species]++;
    }

    for (let species = 0; species < CONFIG.species.count; species++) {
        let currentCount = currentCounts[species];
        let targetCount = CONFIG.species.counts[species];

        if (currentCount < targetCount) {
            for (let i = currentCount; i < targetCount; i++) {
                state.particles.push(new Particle(species));
            }
        } else if (currentCount > targetCount) {
            let toRemove = currentCount - targetCount;
            for (let i = state.particles.length - 1; i >= 0 && toRemove > 0; i--) {
                if (state.particles[i].species === species) {
                    state.particles.splice(i, 1);
                    toRemove--;
                }
            }
        }
    }

    // Remove particles from inactive species
    state.particles = state.particles.filter(p => p.species < CONFIG.species.count);
    updateParticleCountDisplay();

    // Update voice sliders to reflect new particle counts
    updateVoiceSliders();

    // CRITICAL: Sync updated particle counts to audio worklet for voice allocation
    // This ensures maxVoices comparisons use correct particle counts
    AudioSystem.updateParameters({ voices: true });
}

// Update particle sizes - function moved to end of file
// Note: updateVoiceSliders is now imported from audio-controls.js

// Update particle positions
export function updateParticles() {
    if (state.isPaused) return;

    // Rebuild spatial grid each frame for optimal performance
    state.spatialGrid.clear();

    // Insert all particles into spatial grid
    for (let i = 0; i < state.particles.length; i++) {
        state.spatialGrid.insertParticle(state.particles[i]);
    }

    // Update particles using spatial optimization
    for (let particle of state.particles) {
        particle.update();
    }

    // Update trail particles and remove expired ones
    updateTrailParticles();

    // Emit event with particle data for audio processing
    // This replaces the direct call to sendParticleDataToAudio()
    if (audioEngine && audioEngine.isActive) {
        eventBus.emit(Events.PARTICLES_UPDATED);
    }
}

// Update trail particles and remove expired ones
export function updateTrailParticles() {
    for (let i = state.trailParticles.length - 1; i >= 0; i--) {
        const trailParticle = state.trailParticles[i];
        const shouldRemove = trailParticle.updateTrailParticle();

        if (shouldRemove) {
            state.trailParticles.splice(i, 1);
        }
    }
}

// Render function - delegates to renderer
export function render() {
    if (renderer) {
        renderer.render();
    }
}

// Animation loop with FPS tracking
export function animate() {
    const currentTime = performance.now();
    const frameTime = currentTime - lastFrameTime;

    updateParticles();
    render();

    // Track frame time for performance metrics
    frameTimeHistory.push(frameTime);
    if (frameTimeHistory.length > 60) {
        frameTimeHistory.shift(); // Keep only last 60 frames
    }

    // FPS and performance tracking
    frameCount++;
    if (currentTime - fpsUpdateTime >= 500) { // Update every 500ms
        const fps = Math.round((frameCount * 1000) / (currentTime - fpsUpdateTime));
        const avgFrameTime = frameTimeHistory.reduce((a, b) => a + b, 0) / frameTimeHistory.length;

        // Emit performance metrics event instead of directly updating DOM
        eventBus.emit(Events.PERFORMANCE_UPDATED, {
            fps: fps,
            frameTime: avgFrameTime,
            canvasSize: `${CONFIG.canvas.width}×${CONFIG.canvas.height}`,
            totalParticles: state.particles.length,
            trailParticles: state.trailParticles.length,
            audioParticles: audioEngine?.activeParticleCount || 0,
            gridInfo: state.spatialGrid ? `${state.spatialGrid.gridWidth}×${state.spatialGrid.gridHeight}` : '-'
        });

        frameCount = 0;
        fpsUpdateTime = currentTime;
    }

    lastFrameTime = currentTime;
    requestAnimationFrame(animate);
}

// Control functions
export function resetSimulation() {
    if (renderer) {
        renderer.clearCanvas();
    }
    state.trailParticles = [];
    initParticles();
    state.isPaused = false;

    // Send pause state to audio worklet
    if (audioEngine && audioEngine.workletNode && audioEngine.isActive) {
        audioEngine.workletNode.port.postMessage({
            type: 'pauseStateUpdate',
            isPaused: false
        });
    }
}

export function togglePause() {
    const newPausedState = !state.isPaused;
    state.isPaused = newPausedState;

    // Send pause state to audio worklet
    if (audioEngine && audioEngine.workletNode && audioEngine.isActive) {
        audioEngine.workletNode.port.postMessage({
            type: 'pauseStateUpdate',
            isPaused: newPausedState
        });
    }
}

export function updateParticleCountDisplay() {
    // Compatibility function - will be implemented in UI module
}

// Initialize canvas
export function initCanvas() {
    if (!renderer) {
        renderer = new PhysicsRenderer('canvas');
    }
    renderer.initCanvas(CONFIG.canvas.width, CONFIG.canvas.height);

    // Emit event to update UI displays with initial canvas size
    eventBus.emit(Events.CANVAS_RESIZED, { width: CONFIG.canvas.width, height: CONFIG.canvas.height });
}

// Update canvas size and scale particles accordingly
export function updateCanvasSize(newWidth, newHeight) {
    const oldWidth = CONFIG.canvas.width;
    const oldHeight = CONFIG.canvas.height;

    CONFIG.canvas.width = newWidth;
    CONFIG.canvas.height = newHeight;

    if (renderer) {
        renderer.updateCanvasSize(newWidth, newHeight);
    }

    if (state.particles.length > 0 && oldWidth > 0 && oldHeight > 0) {
        const scaleX = newWidth / oldWidth;
        const scaleY = newHeight / oldHeight;
        state.particles.forEach(particle => {
            particle.x *= scaleX;
            particle.y *= scaleY;
        });
    }

    if (state.spatialGrid) {
        state.spatialGrid.canvasWidth = newWidth;
        state.spatialGrid.canvasHeight = newHeight;
        state.spatialGrid.updateCellSize(state.spatialGrid.cellSize);
    }

    if (state.gravityPoint.active && oldWidth > 0 && oldHeight > 0) {
        state.gravityPoint.x *= (newWidth / oldWidth);
        state.gravityPoint.y *= (newHeight / oldHeight);
    }

    // Emit event for UI to update canvas size displays
    eventBus.emit(Events.CANVAS_RESIZED, { width: newWidth, height: newHeight });
}

// Update particle sizes for a specific species
export function updateParticleSizes() {
    for (let particle of state.particles) {
        particle.updateSize();
    }
}

// Remove trail particles for a specific species
export function removeTrailParticlesForSpecies(speciesIndex) {
    state.trailParticles = state.trailParticles.filter(tp => tp.species !== speciesIndex);
}

/**
 * Physics Engine Public API
 *
 * Manages particle simulation, collision detection, spatial optimization, and rendering.
 *
 * @namespace PhysicsEngine
 * @public
 *
 * @example
 * // Initialize the physics engine
 * await PhysicsEngine.init();
 *
 * // Control simulation
 * PhysicsEngine.togglePause();
 * PhysicsEngine.resetSimulation();
 *
 * // Get current state
 * const state = PhysicsEngine.getState();
 * console.log(`Active particles: ${state.particleCount}`);
 */
export const PhysicsEngine = {
    /**
     * Initialize the physics engine
     * Sets up canvas, spatial grid, particles, and starts animation loop
     *
     * @returns {Promise<boolean>} True if initialization successful
     * @public
     */
    init: async function() {
        console.log('🖥️ Initializing Physics Engine...');
        initCanvas();
        const grid = initSpatialGrid();
        state.spatialGrid = grid;
        initTrailSystem();
        initParticles();
        animate();
        console.log('✅ Physics Engine initialized');
        return true;
    },

    /**
     * Toggle simulation pause state
     * Also notifies audio worklet of pause state change
     *
     * @returns {void}
     * @public
     */
    togglePause,

    /**
     * Reset simulation to initial state
     * Clears all particles and trails, reinitializes, and resumes simulation
     *
     * @returns {void}
     * @public
     */
    resetSimulation,

    /**
     * Update canvas dimensions and scale particles proportionally
     *
     * @param {number} newWidth - New canvas width in pixels
     * @param {number} newHeight - New canvas height in pixels
     * @returns {void}
     * @public
     */
    updateCanvasSize,

    /**
     * Update particle sizes based on CONFIG.species.sizes
     * Call after modifying species size configuration
     *
     * @returns {void}
     * @public
     */
    updateParticleSizes,

    /**
     * Remove all trail particles for a specific species
     * Useful when disabling trails or changing trail settings
     *
     * @param {number} speciesIndex - Species index (0-7)
     * @returns {void}
     * @public
     */
    removeTrailParticlesForSpecies,

    /**
     * Adjust particle counts to match CONFIG.species.counts
     * Adds or removes particles as needed, updates UI voice sliders
     *
     * @returns {void}
     * @public
     */
    adjustParticleCounts,

    /**
     * Get current physics engine state snapshot
     *
     * @returns {Object} Current state
     * @returns {number} .particleCount - Number of active particles
     * @returns {number} .trailParticleCount - Number of trail particles
     * @returns {boolean} .isPaused - Whether simulation is paused
     * @returns {boolean} .spatialGridActive - Whether spatial grid is initialized
     * @public
     */
    getState: () => ({
        particleCount: state.particles.length,
        trailParticleCount: state.trailParticles.length,
        isPaused: state.isPaused,
        spatialGridActive: !!state.spatialGrid
    })
};