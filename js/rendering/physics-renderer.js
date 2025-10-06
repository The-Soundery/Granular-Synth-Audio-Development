/**
 * Physics Renderer - Handles all canvas rendering for physics simulation
 *
 * Separates rendering concerns from physics simulation logic.
 * Physics engine should be testable without DOM/canvas dependencies.
 *
 * @module PhysicsRenderer
 */

import { CONFIG, state, audioEngine } from '../config.js';

/**
 * Physics Renderer Class
 * Manages canvas rendering for particles and trails
 */
export class PhysicsRenderer {
    /**
     * Create a new physics renderer
     * @param {string} canvasId - ID of canvas element to render to
     */
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.canvasId = canvasId;

        console.log(`🎨 PhysicsRenderer initialized for canvas '${canvasId}'`);
    }

    /**
     * Initialize canvas dimensions
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    initCanvas(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        console.log(`🖥️ Canvas initialized to ${width}×${height}`);
    }

    /**
     * Clear canvas and initialize trail system
     */
    clearCanvas() {
        this.ctx.fillStyle = CONFIG.canvas.backgroundColor || 'black';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Helper: Calculate brightness based on voice allocation and crossfade state
     * @private
     */
    calculateVoiceActivityBrightness(audioId, species) {
        if (!state.showActiveVoices || !audioEngine) {
            return 1.0;
        }

        // Check if particle has allocated voice
        const allocatedVoices = audioEngine.voiceAllocations?.get(species);
        const hasVoice = allocatedVoices && allocatedVoices.has(audioId);

        // Check crossfade state
        const crossfade = audioEngine.particleAudioCrossfade?.get(audioId);

        if (crossfade) {
            // Particle is crossfading
            const progress = crossfade.progress || 0; // 0 to 1
            if (crossfade.type === 'fadeIn') {
                // Fade in: 30% -> 100%
                return 0.3 + (progress * 0.7);
            } else if (crossfade.type === 'fadeOut') {
                // Fade out: 100% -> 30%
                return 1.0 - (progress * 0.7);
            }
        }

        // No crossfade: either fully active or fully inactive
        return hasVoice ? 1.0 : 0.3;
    }

    /**
     * Helper: Apply voice activity brightness to RGB color
     * @private
     */
    applyVoiceActivityBrightness(r, g, b, audioId, species) {
        const brightness = this.calculateVoiceActivityBrightness(audioId, species);
        return [
            Math.round(r * brightness),
            Math.round(g * brightness),
            Math.round(b * brightness)
        ];
    }

    /**
     * Render particles and trails to canvas
     * Renders trail particles first (oldest to newest), then current particles
     */
    render() {
        // Clear canvas
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.fillStyle = CONFIG.canvas.backgroundColor || '#000000';
        this.ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);

        // Render trail particles first (oldest to newest)
        this.ctx.globalCompositeOperation = 'source-over';

        // Sort trail particles by creation time (oldest first)
        const sortedTrailParticles = [...state.trailParticles].sort((a, b) => a.creationTime - b.creationTime);

        for (let trailParticle of sortedTrailParticles) {
            // Skip invisible trail particles
            if (trailParticle.alpha <= 0) continue;

            // Set alpha for this trail particle
            this.ctx.globalAlpha = trailParticle.alpha;

            // Get particle color and apply voice activity brightness
            let r = Math.round(trailParticle.color[0] * 255);
            let g = Math.round(trailParticle.color[1] * 255);
            let b = Math.round(trailParticle.color[2] * 255);

            [r, g, b] = this.applyVoiceActivityBrightness(r, g, b, trailParticle.parentAudioId, trailParticle.species);

            // Render trail particle
            this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            this.ctx.beginPath();
            this.ctx.arc(trailParticle.x, trailParticle.y, trailParticle.size, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Render current species particles at full opacity (newest last)
        this.ctx.globalAlpha = 1.0;

        // Sort species particles by age (oldest first, newest last)
        const sortedParticles = [...state.particles].sort((a, b) => a.age - b.age);

        for (let particle of sortedParticles) {
            // Get particle color and apply voice activity brightness
            let r = Math.round(particle.color[0] * 255);
            let g = Math.round(particle.color[1] * 255);
            let b = Math.round(particle.color[2] * 255);

            [r, g, b] = this.applyVoiceActivityBrightness(r, g, b, particle.audioId, particle.species);

            // Render species particle
            this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.visualSize, 0, Math.PI * 2);
            this.ctx.fill();

            // Add stroke for definition
            this.ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }

        // Reset alpha
        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Get canvas reference (for external operations if needed)
     * @returns {HTMLCanvasElement}
     */
    getCanvas() {
        return this.canvas;
    }

    /**
     * Get 2D rendering context
     * @returns {CanvasRenderingContext2D}
     */
    getContext() {
        return this.ctx;
    }

    /**
     * Update canvas size
     * @param {number} newWidth - New width in pixels
     * @param {number} newHeight - New height in pixels
     */
    updateCanvasSize(newWidth, newHeight) {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
    }
}
