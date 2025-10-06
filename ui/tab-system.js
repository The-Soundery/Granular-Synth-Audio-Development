/**
 * Tab System - Main navigation tabs and collapsible sections
 * Handles primary tab navigation and collapsible section management
 */

import { EventListenerManager } from '../shared/event-manager.js';
import { safeGetElement } from '../shared/dom-utils.js';

// Track listeners for cleanup
const eventManager = new EventListenerManager('TabSystem');

// ===== TAB SYSTEM =====
export function initTabSystem() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanels = document.querySelectorAll('.tab-panel');

    // Clear old listeners
    eventManager.removeAll();

    tabButtons.forEach(button => {
        const listener = () => {
            const targetTab = button.getAttribute('data-tab');
            const targetPanel = safeGetElement(`${targetTab}-panel`, null, false);
            if (!targetPanel) return;

            // If clicking active tab, toggle visibility
            if (button.classList.contains('active')) {
                button.classList.remove('active');
                targetPanel.classList.remove('active');
            } else {
                // Remove active class from all buttons and panels
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanels.forEach(panel => panel.classList.remove('active'));

                // Add active class to clicked button and show panel
                button.classList.add('active');
                targetPanel.classList.add('active');
            }
        };

        eventManager.add(button, 'click', listener);
    });

    console.log('🎯 Tab system initialized');
}

// ===== COLLAPSIBLE SECTIONS =====
export function toggleCollapsible(sectionId) {
    const section = safeGetElement(sectionId);
    if (!section) return;

    const content = section.querySelector('.collapsible-content');
    if (!content) return;

    section.classList.toggle('collapsed');
    content.classList.toggle('collapsed');

    // Save state to localStorage
    const isCollapsed = section.classList.contains('collapsed');
    localStorage.setItem(`collapsible-${sectionId}`, isCollapsed.toString());
}

// Helper to set section collapsed state
function setSectionCollapsed(section, collapsed) {
    const content = section.querySelector('.collapsible-content');
    if (!content) return;

    if (collapsed) {
        section.classList.add('collapsed');
        content.classList.add('collapsed');
    } else {
        section.classList.remove('collapsed');
        content.classList.remove('collapsed');
    }
}

// Initialize collapsible sections from saved state
export function initCollapsibleSections() {
    const sections = document.querySelectorAll('.collapsible-section');
    sections.forEach(section => {
        const sectionId = section.id;
        const saved = localStorage.getItem(`collapsible-${sectionId}`);
        if (saved === 'true') {
            setSectionCollapsed(section, true);
        }
    });
}