/**
 * Utility Functions
 * Common helper functions used throughout the application
 */

export const Utils = {
    rgbToHex: (rgbArray) => {
        const [r, g, b] = rgbArray.map(c => Math.round(c * 255));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    },

    hexToRgb: (hex) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
    },

    createElement: (tag, className, styles = {}) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        Object.assign(element.style, styles);
        return element;
    },

    showToast: function(message, duration = 2000) {
        const existingToast = document.getElementById('toast');
        if (existingToast) existingToast.remove();

        const toast = this.createElement('div', '', {
            position: 'fixed', top: '80px', right: '20px', background: '#333',
            color: '#fff', padding: '10px 20px', borderRadius: '6px',
            border: '1px solid #555', fontSize: '14px', fontWeight: 'bold',
            zIndex: '10000', opacity: '0', transform: 'translateX(100%)',
            transition: 'all 0.3s ease', fontFamily: 'Arial, sans-serif',
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)', maxWidth: '300px'
        });
        toast.id = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        }, 10);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};