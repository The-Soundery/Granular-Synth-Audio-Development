/**
 * Event Manager - Centralized event listener management
 * Prevents memory leaks from accumulating event listeners
 */

/**
 * Event Listener Manager
 * Tracks and manages event listeners with automatic cleanup
 */
export class EventListenerManager {
    constructor(name = 'EventManager') {
        this.name = name;
        this.listeners = [];
    }

    /**
     * Add tracked event listener with automatic duplicate prevention
     * @param {HTMLElement} element - Element to attach listener to
     * @param {string} event - Event name
     * @param {Function} handler - Event handler function
     */
    add(element, event, handler) {
        if (!element || !event || !handler) {
            console.warn(`${this.name}: Invalid add() parameters`);
            return;
        }

        // Remove any existing listener for same element/event to prevent duplicates
        this.remove(element, event);

        // Add new listener
        element.addEventListener(event, handler);
        this.listeners.push({ element, event, handler });
    }

    /**
     * Remove specific event listener
     * @param {HTMLElement} element - Element to remove listener from
     * @param {string} event - Event name
     */
    remove(element, event) {
        this.listeners = this.listeners.filter(listener => {
            if (listener.element === element && listener.event === event) {
                element.removeEventListener(event, listener.handler);
                return false; // Remove from array
            }
            return true; // Keep in array
        });
    }

    /**
     * Remove all tracked listeners
     */
    removeAll() {
        this.listeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.listeners = [];
    }

    /**
     * Get count of tracked listeners
     * @returns {number} Number of active listeners
     */
    count() {
        return this.listeners.length;
    }

    /**
     * Get list of tracked listeners for debugging
     * @returns {Array} Listener information
     */
    getListeners() {
        return this.listeners.map(({ element, event }) => ({
            element: element.id || element.tagName,
            event
        }));
    }
}

/**
 * Simplified Map-based event listener tracker
 * Useful for cases where element has an ID
 */
export class EventListenerMapManager {
    constructor(name = 'MapEventManager') {
        this.name = name;
        this.listeners = new Map();
    }

    /**
     * Add tracked event listener using unique key
     * @param {HTMLElement} element - Element to attach listener to
     * @param {string} event - Event name
     * @param {Function} handler - Event handler function
     */
    add(element, event, handler) {
        if (!element || !element.id) {
            console.warn(`${this.name}: Element must have an ID`);
            return;
        }

        const key = `${element.id}-${event}`;

        // Remove old listener if exists
        const oldListener = this.listeners.get(key);
        if (oldListener) {
            element.removeEventListener(event, oldListener);
        }

        // Add new listener
        element.addEventListener(event, handler);
        this.listeners.set(key, handler);
    }

    /**
     * Remove all tracked listeners
     */
    removeAll() {
        // Cannot remove without storing elements - warn user
        console.warn(`${this.name}: Cannot remove listeners without element references. Use EventListenerManager instead.`);
        this.listeners.clear();
    }

    /**
     * Get count of tracked listeners
     * @returns {number} Number of active listeners
     */
    count() {
        return this.listeners.size;
    }
}

/**
 * Create a new event listener manager instance
 * @param {string} name - Manager name for debugging
 * @returns {EventListenerManager} New manager instance
 */
export function createEventManager(name) {
    return new EventListenerManager(name);
}
