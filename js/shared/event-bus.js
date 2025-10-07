/**
 * Event Bus - Simple event emitter for cross-module communication
 *
 * Provides a decoupled communication mechanism between modules without
 * creating circular dependencies. Follows the Observer pattern.
 *
 * @module EventBus
 *
 * @example
 * // Module A emits an event
 * import { eventBus } from './shared/event-bus.js';
 * eventBus.emit('particles:updated', { count: 100 });
 *
 * // Module B listens for the event
 * eventBus.on('particles:updated', (data) => {
 *   console.log('Particles updated:', data.count);
 * });
 *
 * // Clean up when done
 * const handler = (data) => console.log(data);
 * eventBus.on('some:event', handler);
 * eventBus.off('some:event', handler);
 */

class EventBus {
    constructor() {
        /**
         * Map of event names to arrays of listener functions
         * @private
         */
        this.listeners = new Map();

        /**
         * Enable debug logging for all events
         * @type {boolean}
         */
        this.debug = false;
    }

    /**
     * Register an event listener
     *
     * @param {string} event - Event name (e.g., 'particles:updated')
     * @param {Function} handler - Callback function to invoke when event fires
     * @returns {void}
     * @public
     *
     * @example
     * eventBus.on('simulation:paused', (isPaused) => {
     *   console.log('Simulation paused:', isPaused);
     * });
     */
    on(event, handler) {
        if (typeof event !== 'string') {
            console.error('EventBus.on: event must be a string');
            return;
        }

        if (typeof handler !== 'function') {
            console.error('EventBus.on: handler must be a function');
            return;
        }

        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        this.listeners.get(event).push(handler);

        if (this.debug) {
            console.log(`[EventBus] Registered listener for '${event}' (${this.listeners.get(event).length} total)`);
        }
    }

    /**
     * Unregister an event listener
     *
     * @param {string} event - Event name
     * @param {Function} handler - Handler function to remove
     * @returns {boolean} True if handler was found and removed
     * @public
     *
     * @example
     * const handler = (data) => console.log(data);
     * eventBus.on('some:event', handler);
     * eventBus.off('some:event', handler); // Removes the handler
     */
    off(event, handler) {
        if (!this.listeners.has(event)) {
            return false;
        }

        const handlers = this.listeners.get(event);
        const index = handlers.indexOf(handler);

        if (index === -1) {
            return false;
        }

        handlers.splice(index, 1);

        // Clean up empty listener arrays
        if (handlers.length === 0) {
            this.listeners.delete(event);
        }

        if (this.debug) {
            console.log(`[EventBus] Removed listener for '${event}'`);
        }

        return true;
    }

    /**
     * Register a one-time event listener
     * Handler is automatically removed after first invocation
     *
     * @param {string} event - Event name
     * @param {Function} handler - Callback function
     * @returns {void}
     * @public
     *
     * @example
     * eventBus.once('audio:initialized', () => {
     *   console.log('Audio started!'); // Only fires once
     * });
     */
    once(event, handler) {
        const onceHandler = (...args) => {
            handler(...args);
            this.off(event, onceHandler);
        };

        this.on(event, onceHandler);
    }

    /**
     * Emit an event to all registered listeners
     *
     * @param {string} event - Event name
     * @param {...any} args - Arguments to pass to handlers
     * @returns {number} Number of handlers invoked
     * @public
     *
     * @example
     * eventBus.emit('particles:updated', { count: 50, active: 25 });
     * eventBus.emit('simulation:paused', true);
     */
    emit(event, ...args) {
        if (!this.listeners.has(event)) {
            if (this.debug) {
                console.log(`[EventBus] No listeners for '${event}'`);
            }
            return 0;
        }

        const handlers = this.listeners.get(event);
        let invokedCount = 0;

        if (this.debug) {
            console.log(`[EventBus] Emitting '${event}' to ${handlers.length} listeners`, args);
        }

        // Iterate over a copy to allow handlers to unregister themselves
        for (const handler of [...handlers]) {
            try {
                handler(...args);
                invokedCount++;
            } catch (error) {
                console.error(`[EventBus] Error in handler for '${event}':`, error);
            }
        }

        return invokedCount;
    }

    /**
     * Remove all listeners for a specific event, or all events if no event specified
     *
     * @param {string} [event] - Event name to clear, or omit to clear all events
     * @returns {void}
     * @public
     *
     * @example
     * eventBus.clear('particles:updated'); // Clear specific event
     * eventBus.clear(); // Clear all events
     */
    clear(event) {
        if (event) {
            this.listeners.delete(event);
            if (this.debug) {
                console.log(`[EventBus] Cleared all listeners for '${event}'`);
            }
        } else {
            this.listeners.clear();
            if (this.debug) {
                console.log('[EventBus] Cleared all listeners');
            }
        }
    }

    /**
     * Get the number of listeners for an event
     *
     * @param {string} event - Event name
     * @returns {number} Number of registered listeners
     * @public
     */
    listenerCount(event) {
        return this.listeners.has(event) ? this.listeners.get(event).length : 0;
    }

    /**
     * Get all registered event names
     *
     * @returns {string[]} Array of event names
     * @public
     */
    eventNames() {
        return Array.from(this.listeners.keys());
    }

    /**
     * Enable or disable debug logging
     *
     * @param {boolean} enabled - True to enable debug logs
     * @returns {void}
     * @public
     */
    setDebug(enabled) {
        this.debug = enabled;
        console.log(`[EventBus] Debug logging ${enabled ? 'enabled' : 'disabled'}`);
    }
}

/**
 * Global event bus instance
 * @type {EventBus}
 */
export const eventBus = new EventBus();

/**
 * Standard event names used throughout the application
 * Helps prevent typos and provides documentation
 *
 * @enum {string}
 */
export const Events = {
    // Physics events
    PARTICLES_UPDATED: 'particles:updated',
    PARTICLES_COUNTS_CHANGED: 'particles:counts-changed',
    SIMULATION_PAUSED: 'simulation:paused',
    SIMULATION_RESET: 'simulation:reset',
    PERFORMANCE_UPDATED: 'performance:updated',
    CANVAS_RESIZED: 'canvas:resized',

    // Audio events
    AUDIO_INITIALIZED: 'audio:initialized',
    AUDIO_SHUTDOWN: 'audio:shutdown',
    AUDIO_PERFORMANCE_UPDATED: 'audio:performance-updated',
    SAMPLE_LOADED: 'sample:loaded',

    // UI events
    UI_INITIALIZED: 'ui:initialized',
    SPECIES_CHANGED: 'species:changed',
    PRESET_LOADED: 'preset:loaded',
    PRESET_SAVED: 'preset:saved'
};
