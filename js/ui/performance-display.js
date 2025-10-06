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
}
