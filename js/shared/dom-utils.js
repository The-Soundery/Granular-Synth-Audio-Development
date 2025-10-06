/**
 * DOM Utilities - Safe DOM access and manipulation helpers
 * Provides null-safe wrappers for common DOM operations
 */

/**
 * Safely get element by ID with optional warning
 * @param {string} id - Element ID
 * @param {HTMLElement|null} defaultValue - Default value if element not found
 * @param {boolean} warn - Whether to log warning if not found
 * @returns {HTMLElement|null} Element or default value
 */
export function safeGetElement(id, defaultValue = null, warn = true) {
    const el = document.getElementById(id);
    if (!el && warn) {
        console.warn(`Element not found: #${id}`);
    }
    return el || defaultValue;
}

/**
 * Safely query selector with optional warning
 * @param {string} selector - CSS selector
 * @param {HTMLElement|null} defaultValue - Default value if element not found
 * @param {boolean} warn - Whether to log warning if not found
 * @returns {HTMLElement|null} Element or default value
 */
export function safeQuerySelector(selector, defaultValue = null, warn = true) {
    const el = document.querySelector(selector);
    if (!el && warn) {
        console.warn(`Selector not found: ${selector}`);
    }
    return el || defaultValue;
}

/**
 * Safely query all elements
 * @param {string} selector - CSS selector
 * @returns {NodeListOf<Element>} NodeList (may be empty)
 */
export function safeQuerySelectorAll(selector) {
    return document.querySelectorAll(selector);
}

/**
 * Safely update element value
 * @param {string} id - Element ID
 * @param {any} value - Value to set
 * @returns {boolean} Success status
 */
export function updateElementValue(id, value) {
    const el = safeGetElement(id, null, false);
    if (el && 'value' in el) {
        el.value = value;
        return true;
    }
    return false;
}

/**
 * Safely update element text content
 * @param {string} id - Element ID
 * @param {string} text - Text to set
 * @returns {boolean} Success status
 */
export function updateElementText(id, text) {
    const el = safeGetElement(id, null, false);
    if (el) {
        el.textContent = text;
        return true;
    }
    return false;
}

/**
 * Safely update both element value and display text
 * @param {string} sliderId - Slider element ID
 * @param {any} value - Value to set
 * @param {number} decimals - Number of decimal places for display
 * @returns {boolean} Success status
 */
export function updateSliderAndValue(sliderId, value, decimals = 0) {
    const slider = safeGetElement(sliderId, null, false);
    const valueDisplay = safeGetElement(`${sliderId}-value`, null, false);

    let success = false;
    if (slider) {
        slider.value = value;
        success = true;
    }
    if (valueDisplay) {
        valueDisplay.textContent = typeof decimals === 'number'
            ? parseFloat(value).toFixed(decimals)
            : value.toString();
    }

    return success;
}

/**
 * Safely get element checked state
 * @param {string} id - Element ID
 * @param {boolean} defaultValue - Default value if element not found
 * @returns {boolean} Checked state
 */
export function getElementChecked(id, defaultValue = false) {
    const el = safeGetElement(id, null, false);
    return el && 'checked' in el ? el.checked : defaultValue;
}

/**
 * Safely set element checked state
 * @param {string} id - Element ID
 * @param {boolean} checked - Checked state
 * @returns {boolean} Success status
 */
export function setElementChecked(id, checked) {
    const el = safeGetElement(id, null, false);
    if (el && 'checked' in el) {
        el.checked = checked;
        return true;
    }
    return false;
}

/**
 * Safely set element display style
 * @param {string} id - Element ID
 * @param {string} display - Display value ('none', 'block', 'inline', etc.)
 * @returns {boolean} Success status
 */
export function setElementDisplay(id, display) {
    const el = safeGetElement(id, null, false);
    if (el) {
        el.style.display = display;
        return true;
    }
    return false;
}

/**
 * Show/hide element helper
 * @param {string} id - Element ID
 * @param {boolean} show - Whether to show or hide
 * @returns {boolean} Success status
 */
export function toggleElementVisibility(id, show) {
    return setElementDisplay(id, show ? 'block' : 'none');
}
