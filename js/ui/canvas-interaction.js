/**
 * Canvas Interaction - Mouse and canvas-based interactions
 * Handles gravity point interaction and canvas cursor management
 */

import { CONFIG, state } from '../config.js';
import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement } from '../shared/dom-utils.js';

// Event listener manager
const eventManager = new EventListenerManager('CanvasInteraction');

export function setupCanvasInteraction(canvas) {
    // Clear old listeners
    eventManager.removeAll();

    // Helper to update mouse position
    const updateMousePosition = (e) => {
        const rect = canvas.getBoundingClientRect();
        state.gravityPoint.x = e.clientX - rect.left;
        state.gravityPoint.y = e.clientY - rect.top;
    };

    const updateCanvasCursor = () => {
        canvas.style.cursor = CONFIG.physics.gravityStrength > 0 ? 'crosshair' : 'default';
    };

    const handleMouseEvent = (e, isDown) => {
        if (CONFIG.physics.gravityStrength > 0) {
            updateMousePosition(e);
            state.gravityPoint.active = isDown;
            console.log(`🌍 Gravity point ${isDown ? 'activated' : 'deactivated'}`);
        }
        e.preventDefault();
    };

    const mousedownHandler = (e) => handleMouseEvent(e, true);
    const mouseupHandler = (e) => handleMouseEvent(e, false);
    const mouseleaveHandler = (e) => handleMouseEvent(e, false);

    eventManager.add(canvas, 'mousedown', mousedownHandler);
    eventManager.add(canvas, 'mouseup', mouseupHandler);
    eventManager.add(canvas, 'mouseleave', mouseleaveHandler);

    const mousemoveHandler = (e) => {
        if (state.gravityPoint.active && CONFIG.physics.gravityStrength > 0) {
            updateMousePosition(e);
        }
        e.preventDefault();
    };
    eventManager.add(canvas, 'mousemove', mousemoveHandler);

    updateCanvasCursor();
    const gravityStrength = safeGetElement('gravityStrength');
    if (gravityStrength) {
        eventManager.add(gravityStrength, 'input', updateCanvasCursor);
    }

    console.log('🖱️ Canvas interaction initialized');
}