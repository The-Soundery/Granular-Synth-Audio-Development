/**
 * Performance Display - Updates performance metrics UI
 *
 * Listens to performance events from physics engine and updates DOM displays.
 * This separates UI concerns from physics simulation logic.
 *
 * @module PerformanceDisplay
 */

import { updateElementText } from '../shared/dom-utils.js';
import { eventBus, Events } from '../shared/event-bus.js';

/**
 * Initialize performance display event listeners
 */
export function initPerformanceDisplay() {
    // Listen for performance updates from physics engine
    eventBus.on(Events.PERFORMANCE_UPDATED, (metrics) => {
        updatePerformanceMetrics(metrics);
    });

    // Listen for audio performance updates
    eventBus.on(Events.AUDIO_PERFORMANCE_UPDATED, (metrics) => {
        updateAudioPerformanceMetrics(metrics);
    });

    // Listen for canvas resize events
    eventBus.on(Events.CANVAS_RESIZED, ({ width, height }) => {
        updateElementText('canvas-size', `${width}×${height}`);
        updateElementText('canvas-width', width);
        updateElementText('canvas-height', height);
    });

    console.log('📊 Performance display initialized');
}

/**
 * Update all performance metric displays
 * @param {Object} metrics - Performance metrics data
 * @private
 */
function updatePerformanceMetrics(metrics) {
    updateElementText('fps-display', metrics.fps);
    updateElementText('frame-time', `${metrics.frameTime.toFixed(1)}ms`);
    updateElementText('canvas-size', metrics.canvasSize);
    updateElementText('total-particles', metrics.totalParticles);
    updateElementText('trail-particles', metrics.trailParticles);
    updateElementText('audio-particles', metrics.audioParticles);
    updateElementText('grid-info', metrics.gridInfo);

    // Update main CPU with color coding
    if (metrics.mainCpuUsage !== undefined) {
        updateCpuDisplay('main-cpu', metrics.mainCpuUsage);
    }
}

/**
 * Update audio performance metric displays
 * @param {Object} metrics - Audio performance metrics data
 * @private
 */
function updateAudioPerformanceMetrics(metrics) {
    // Update audio CPU with color coding
    if (metrics.audioCpuUsage !== undefined) {
        updateCpuDisplay('audio-cpu', metrics.audioCpuUsage);
    }
}

/**
 * Update CPU display with color coding
 * @param {string} elementId - ID of the element to update
 * @param {number} cpuUsage - CPU usage percentage
 * @private
 */
function updateCpuDisplay(elementId, cpuUsage) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const formattedValue = `${cpuUsage.toFixed(1)}%`;
    element.textContent = formattedValue;

    // Color coding based on CPU usage
    if (cpuUsage < 60) {
        element.style.color = '#4ade80'; // Green - good
    } else if (cpuUsage < 80) {
        element.style.color = '#fbbf24'; // Yellow - warning
    } else {
        element.style.color = '#f87171'; // Red - critical
    }
}
