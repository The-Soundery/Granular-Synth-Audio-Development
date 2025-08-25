#!/usr/bin/env node

// Simple build script to combine separated files back into single HTML
const fs = require('fs');
const path = require('path');

console.log('🔧 Building combined HTML file...');

// Read the main HTML template
const htmlPath = path.join(__dirname, 'Granular-Particle-Sim-Modular.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Read the JavaScript modules
const audioSystem = fs.readFileSync(path.join(__dirname, 'js/audio-system.js'), 'utf8');
const physicsCore = fs.readFileSync(path.join(__dirname, 'js/physics-core.js'), 'utf8');

// Remove the script imports and replace with embedded code
html = html.replace(
    /<script src="js\/audio-system\.js"><\/script>\s*<script src="js\/physics-core\.js"><\/script>/,
    ''
);

// Find the main script section and inject the modules
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.lastIndexOf('</script>');

if (scriptStart !== -1 && scriptEnd !== -1) {
    const beforeScript = html.substring(0, scriptStart + 8);
    const mainScript = html.substring(scriptStart + 8, scriptEnd);
    const afterScript = html.substring(scriptEnd);
    
    // Combine all JavaScript code
    const combinedScript = `
        // ===== AUDIO SYSTEM =====
        ${audioSystem.replace(/^\/\/ ===== AUDIO SYSTEM =====.*$/m, '').trim()}
        
        // ===== PHYSICS CORE =====
        ${physicsCore.replace(/^\/\/ ===== PHYSICS CORE =====.*$/m, '').trim()}
        
        // ===== MAIN APPLICATION =====
        ${mainScript.trim()}
    `;
    
    // Reconstruct the HTML
    const combinedHtml = beforeScript + combinedScript + afterScript;
    
    // Write the combined file
    const outputPath = path.join(__dirname, 'Granular-Particle-Sim-Combined.html');
    fs.writeFileSync(outputPath, combinedHtml, 'utf8');
    
    console.log(`✅ Combined file created: ${outputPath}`);
} else {
    console.error('❌ Could not find script sections in HTML file');
}