/**
 * Validation Utilities - Common validation and formatting helpers
 * Provides reusable validation logic and species-related utilities
 */

import { CONFIG } from '../config.js';

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Validate and clamp a value with optional warning
 * @param {number} value - Value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {string} name - Parameter name for warning message
 * @param {boolean} warn - Whether to log warning if clamped
 * @returns {number} Validated and clamped value
 */
export function validateRange(value, min, max, name = 'Value', warn = true) {
    const clamped = clamp(value, min, max);
    if (warn && clamped !== value) {
        console.warn(`${name} clamped from ${value} to ${clamped} (range: ${min}-${max})`);
    }
    return clamped;
}

/**
 * Validate integer in range
 * @param {any} value - Value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Validated integer
 */
export function validateInt(value, min, max, defaultValue = min) {
    const num = parseInt(value);
    if (isNaN(num)) return defaultValue;
    return clamp(num, min, max);
}

/**
 * Validate float in range
 * @param {any} value - Value to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} defaultValue - Default if invalid
 * @returns {number} Validated float
 */
export function validateFloat(value, min, max, defaultValue = min) {
    const num = parseFloat(value);
    if (isNaN(num)) return defaultValue;
    return clamp(num, min, max);
}

/**
 * Convert species index to letter (0 → 'A', 1 → 'B', etc.)
 * @param {number} index - Species index (0-7)
 * @returns {string} Species letter
 */
export function getSpeciesLetter(index) {
    return String.fromCharCode(65 + index); // 65 = ASCII 'A'
}

/**
 * Get species name from index
 * @param {number} index - Species index (0-7)
 * @returns {string} Species name (e.g., "Species A")
 */
export function getSpeciesName(index) {
    return `Species ${getSpeciesLetter(index)}`;
}

/**
 * Check if species index is valid
 * @param {number} index - Species index to check
 * @returns {boolean} True if valid
 */
export function isValidSpeciesIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < CONFIG.species.count;
}

/**
 * Ensure species index is within bounds
 * @param {number} index - Species index
 * @returns {number} Valid species index (clamped to 0 if invalid)
 */
export function ensureValidSpeciesIndex(index) {
    if (!isValidSpeciesIndex(index)) {
        console.warn(`Invalid species index: ${index}, using 0`);
        return 0;
    }
    return index;
}

/**
 * Format number to fixed decimal places
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted number
 */
export function formatNumber(value, decimals = 2) {
    return parseFloat(value).toFixed(decimals);
}

/**
 * Parse number safely with default value
 * @param {any} value - Value to parse
 * @param {number} defaultValue - Default if parsing fails
 * @returns {number} Parsed number or default
 */
export function parseNumberSafe(value, defaultValue = 0) {
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
}

/**
 * Check if value is within range (inclusive)
 * @param {number} value - Value to check
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {boolean} True if in range
 */
export function isInRange(value, min, max) {
    return value >= min && value <= max;
}

/**
 * Normalize value from one range to another
 * @param {number} value - Value to normalize
 * @param {number} fromMin - Source range minimum
 * @param {number} fromMax - Source range maximum
 * @param {number} toMin - Target range minimum
 * @param {number} toMax - Target range maximum
 * @returns {number} Normalized value
 */
export function normalizeRange(value, fromMin, fromMax, toMin, toMax) {
    const normalized = (value - fromMin) / (fromMax - fromMin);
    return toMin + normalized * (toMax - toMin);
}

/**
 * Lerp (linear interpolation) between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
}
