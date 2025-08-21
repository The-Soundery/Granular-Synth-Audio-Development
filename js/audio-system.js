// ===== AUDIO SYSTEM =====
// Granular synthesis engine for particle-driven audio

// Audio System Variables
let audioContext = null;
let masterGainNode = null;
let compressorNode = null;
let isAudioEnabled = false;
let isMasterMuted = false;
let masterVolume = 0.3;
let frequencyRange = { low: 80, high: 8000 };

// Global velocity controls
let globalVelocityGainCurve = 1.0; // Exponential curve for velocity->gain (0.1-3.0)
let globalVelocityThreshold = 0.0; // Minimum velocity to trigger audio (0.0-1.0)
let globalVelocityThresholdSquared = 0.0; // Cached squared threshold for performance
let audioFadeDuration = 0.05; // Fade duration in seconds for threshold transitions (50ms)

// Species audio synthesizers
let speciesAudioSynths = [];

// Granular Synthesizer Class
class GranularSynth {
    constructor(speciesIndex, audioContext, masterGain) {
        this.speciesIndex = speciesIndex;
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        
        // Audio graph (only create if audioContext exists)
        if (audioContext && masterGain) {
            this.gainNode = audioContext.createGain();
            this.gainNode.connect(masterGain);
            this.gainNode.gain.value = 0.7;
        } else {
            this.gainNode = null;
        }
        
        // Sample buffer and selection
        this.audioBuffer = null;
        this.fileName = '';
        this.sampleStart = 0.0; // Start position in sample (0-1)
        this.sampleEnd = 1.0;   // End position in sample (0-1)
        
        // Grain management
        this.grains = [];
        this.maxGrains = 50;
        this.grainDuration = 0.1; // Default 100ms
        
        // Grain loop mode: 'forward', 'reverse', 'alternate'
        this.loopMode = 'forward';
        this.alternateDirection = 1; // 1 for forward, -1 for reverse
        
        // Audio parameters
        this.pitch = 0; // Semitones (0-24)
        this.detune = 0; // Cents (0-50, randomized per grain)
        this.fadeLength = 0.002; // Crossfade length (1ms-20ms)
        
        // State
        this.isMuted = false;
        this.volume = 0.7;
        this.activeGrains = 0;
        
        // Performance tracking
        this.lastUpdate = 0;
        this.updateInterval = 16; // ~60fps
        
        console.log(`🎵 Granular synth created for Species ${String.fromCharCode(65 + speciesIndex)}`);
    }
    
    // Connect audio graph when context becomes available
    connectAudioGraph(audioContext, masterGain) {
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        
        if (!this.gainNode && audioContext && masterGain) {
            this.gainNode = audioContext.createGain();
            this.gainNode.connect(masterGain);
            this.gainNode.gain.value = this.volume || 0.7;
        }
    }
    
    // Load audio sample
    async loadSample(arrayBuffer) {
        try {
            // If no audio context yet, create a temporary one for display purposes
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.rawAudioData = arrayBuffer;
                this.fileName = 'Sample loaded (awaiting audio start)';
                
                // Create temporary audioContext just for decoding and display
                try {
                    const tempContext = new (window.AudioContext || window.webkitAudioContext)();
                    this.audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0)); // Use copy of buffer
                    await tempContext.close(); // Clean up temporary context
                    console.log(`🎵 Sample decoded for display for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
                } catch (tempError) {
                    console.warn('Could not decode for display:', tempError);
                }
                
                return true;
            }
            
            // Make sure audioContext is in good state before decoding
            if (this.audioContext.state === 'suspended') {
                console.warn('AudioContext suspended, storing sample for later decode');
                this.rawAudioData = arrayBuffer;
                this.fileName = 'Sample loaded (awaiting audio start)';
                return true;
            }
            
            // Decode immediately if audio context exists and is running
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            console.log(`🎵 Sample loaded for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
            return true;
        } catch (error) {
            console.error('Audio decode error:', error);
            return false;
        }
    }
    
    // Decode stored audio data when audio context becomes available
    async decodeStoredAudio() {
        if (this.rawAudioData && this.audioContext) {
            try {
                // If we already have an audioBuffer from temp decode, re-decode with proper audioContext
                // This ensures the audioBuffer is compatible with the main audio system
                this.audioBuffer = await this.audioContext.decodeAudioData(this.rawAudioData);
                this.rawAudioData = null; // Clear raw data after decoding
                console.log(`🎵 Re-decoded sample for audio system for Species ${String.fromCharCode(65 + this.speciesIndex)}: ${this.audioBuffer.duration.toFixed(2)}s`);
                return true;
            } catch (error) {
                console.error('Stored audio decode error:', error);
                return false;
            }
        }
        return false;
    }
    
    // Create and manage audio grain with crossfading
    createGrain(particle) {
        if (!this.audioBuffer || this.isMuted || !isAudioEnabled) return null;
        if (this.grains.length >= this.maxGrains) return null;
        
        // FAST velocity threshold check and fade state update
        const velocitySquared = particle.vx * particle.vx + particle.vy * particle.vy;
        const isAboveThreshold = velocitySquared >= globalVelocityThresholdSquared;
        
        // Update fade state efficiently (60fps = ~16.67ms per frame)
        const fadeStep = (1.0 / 60.0) / audioFadeDuration; // Fade step per frame at 60fps
        
        if (isAboveThreshold && !particle.wasAboveThreshold) {
            // Started crossing threshold - begin fade in
            particle.wasAboveThreshold = true;
        } else if (!isAboveThreshold && particle.wasAboveThreshold) {
            // Started crossing threshold - begin fade out  
            particle.wasAboveThreshold = false;
        }
        
        // Update fade state smoothly
        if (particle.wasAboveThreshold) {
            particle.audioFadeState = Math.min(1.0, particle.audioFadeState + fadeStep);
        } else {
            particle.audioFadeState = Math.max(0.0, particle.audioFadeState - fadeStep);
        }
        
        // Exit early if no volume (avoids creating audio nodes for silent particles)
        if (particle.audioFadeState <= 0.001) {
            return null;
        }
        
        // Only now create audio nodes (expensive operations) for audible particles
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        const filterNode = this.audioContext.createBiquadFilter();
        const pannerNode = this.audioContext.createStereoPanner();
        
        // Setup audio graph: source -> filter -> gain -> panner -> species gain
        source.buffer = this.audioBuffer;
        source.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(this.gainNode);
        
        // Configure filter for Y-axis frequency control
        filterNode.type = 'bandpass';
        filterNode.Q.value = 2;
        
        // Calculate parameters from particle (expensive operations only for audible particles)
        const sampleRange = this.sampleEnd - this.sampleStart;
        const samplePosition = this.sampleStart + (Math.max(0, Math.min(1, particle.x / canvasWidth)) * sampleRange);
        const { frequency, bandwidth } = this.calculateFrequencyAndBandwidth(particle.y / canvasHeight, particle.size);
        
        // Calculate velocity and apply gain curve + fade
        const velocity = Math.sqrt(velocitySquared);
        const MAX_SPEED = 3;
        const normalizedVelocity = Math.min(1, velocity / MAX_SPEED);
        const curvedVelocity = Math.pow(normalizedVelocity, globalVelocityGainCurve);
        const volume = curvedVelocity * this.volume * particle.audioFadeState; // Apply fade multiplier
        
        const grainDuration = this.mapTrailLengthToGrainDuration(particle);
        const pan = (particle.x / canvasWidth) * 2 - 1; // -1 (left) to +1 (right)
        
        // Calculate pitch adjustment (semitones + random detune)
        const semitoneRatio = Math.pow(2, this.pitch / 12); // Convert semitones to frequency ratio
        const randomDetuneCents = (Math.random() - 0.5) * 2 * this.detune; // Random detune in cents
        const detuneRatio = Math.pow(2, randomDetuneCents / 1200); // Convert cents to frequency ratio
        const totalPitchRatio = semitoneRatio * detuneRatio;
        
        // Enhanced crossfading parameters using fadeLength setting
        const crossfadeTime = this.fadeLength; // Use species-specific fade length
        const fadeInTime = Math.min(crossfadeTime, grainDuration * 0.1); // Max 10% of grain duration
        const fadeOutTime = Math.min(crossfadeTime, grainDuration * 0.1);
        
        // Calculate sample start/end positions based on loop mode with crossfading
        let startTime, endTime, playbackRate = 1;
        
        if (this.loopMode === 'forward') {
            startTime = samplePosition * this.audioBuffer.duration;
            endTime = Math.min(startTime + grainDuration, this.audioBuffer.duration);
        } else if (this.loopMode === 'reverse') {
            // Play backwards by setting negative playback rate
            startTime = samplePosition * this.audioBuffer.duration;
            endTime = Math.max(startTime - grainDuration, 0);
            playbackRate = -1;
            // For reverse playback, we need to start from the end position
            const temp = startTime;
            startTime = endTime;
            endTime = temp;
        } else if (this.loopMode === 'alternate') {
            // Alternate between forward and reverse for each grain with crossfade
            if (this.alternateDirection === 1) {
                // Forward
                startTime = samplePosition * this.audioBuffer.duration;
                endTime = Math.min(startTime + grainDuration, this.audioBuffer.duration);
                playbackRate = 1;
            } else {
                // Reverse
                startTime = samplePosition * this.audioBuffer.duration;
                endTime = Math.max(startTime - grainDuration, 0);
                playbackRate = -1;
                const temp = startTime;
                startTime = endTime;
                endTime = temp;
            }
            // Toggle direction for next grain
            this.alternateDirection *= -1;
        }
        
        // Set playback rate for direction and pitch
        source.playbackRate.value = Math.abs(playbackRate) * totalPitchRatio;
        
        // Enhanced gain envelope with smooth crossfading
        const now = this.audioContext.currentTime;
        const sustainTime = grainDuration - fadeInTime - fadeOutTime;
        
        // Start with zero gain
        gainNode.gain.setValueAtTime(0, now);
        
        // Fade in (prevents clicks)
        gainNode.gain.linearRampToValueAtTime(volume, now + fadeInTime);
        
        // Sustain level
        if (sustainTime > 0) {
            gainNode.gain.setValueAtTime(volume, now + fadeInTime + sustainTime);
        }
        
        // Fade out (prevents clicks)
        gainNode.gain.linearRampToValueAtTime(0, now + grainDuration);
        
        // Set frequency and bandwidth (Y-axis mapping + particle size)
        filterNode.frequency.setValueAtTime(frequency, now);
        filterNode.Q.setValueAtTime(bandwidth, now);
        
        // Set panning (X-axis mapping)
        pannerNode.pan.setValueAtTime(pan, now);
        
        // Create grain object
        const grain = {
            source,
            gainNode,
            filterNode,
            pannerNode,
            startTime: now,
            duration: grainDuration,
            particle: particle,
            isPlaying: true,
            playbackRate: playbackRate,
            fadeInTime: fadeInTime,
            fadeOutTime: fadeOutTime
        };
        
        // Start playback with proper timing
        const actualDuration = Math.abs(endTime - startTime);
        if (actualDuration > 0) {
            source.start(now, startTime, actualDuration);
            source.stop(now + grainDuration);
        } else {
            // Handle edge case where duration is zero
            return null;
        }
        
        // Cleanup when finished
        source.onended = () => {
            this.removeGrain(grain);
        };
        
        this.grains.push(grain);
        return grain;
    }
    
    // Remove grain from pool
    removeGrain(grain) {
        const index = this.grains.indexOf(grain);
        if (index !== -1) {
            this.grains.splice(index, 1);
            grain.isPlaying = false;
        }
    }
    
    // Update grain parameters based on particle movement
    updateGrain(grain, particle) {
        if (!grain.isPlaying) return;
        
        const now = this.audioContext.currentTime;
        const { frequency, bandwidth } = this.calculateFrequencyAndBandwidth(particle.y / canvas.height, particle.size);
        const velocity = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy);
        const volume = Math.min(1, velocity / MAX_SPEED) * this.volume;
        const pan = (particle.x / canvas.width) * 2 - 1; // -1 (left) to +1 (right)
        
        // Update frequency and bandwidth smoothly
        grain.filterNode.frequency.setTargetAtTime(frequency, now, 0.01);
        grain.filterNode.Q.setTargetAtTime(bandwidth, now, 0.01);
        
        // Update volume based on velocity
        grain.gainNode.gain.setTargetAtTime(volume, now, 0.01);
        
        // Update panning based on X position
        grain.pannerNode.pan.setTargetAtTime(pan, now, 0.01);
    }
    
    // Calculate frequency and bandwidth from Y position and particle size (narrower bands for smaller particles)
    calculateFrequencyAndBandwidth(normalizedY, particleSize) {
        // Invert Y (top = high frequency, bottom = low frequency)
        const invY = 1 - normalizedY;
        
        // Logarithmic scaling for musical frequency perception
        const logLow = Math.log(frequencyRange.low);
        const logHigh = Math.log(frequencyRange.high);
        const logFreq = logLow + (invY * (logHigh - logLow));
        const frequency = Math.exp(logFreq);
        
        // Map particle size to filter bandwidth - REVERSED: smaller particles = narrower bands
        const minSize = 2; // Minimum particle size
        const maxSize = 10; // Maximum particle size
        const normalizedSize = Math.max(0, Math.min(1, (particleSize - minSize) / (maxSize - minSize)));
        
        // Smaller particles = higher Q (narrower band), larger particles = lower Q (wider band)
        // Adjusted for narrower base frequency at size 2.0
        const minQ = 1.0; // Wide bandwidth for large particles
        const maxQ = 12.0; // Very narrow bandwidth for small particles (size 2.0)
        const bandwidth = maxQ - (normalizedSize * (maxQ - minQ));
        
        return { frequency, bandwidth };
    }
    
    // Map trail length to grain duration - direct mapping to 2ms-200ms range
    mapTrailLengthToGrainDuration(particle) {
        const speciesTrailLength = (typeof speciesTrailLengths !== 'undefined' ? speciesTrailLengths[particle.species] : null) || 0.5;
        
        const minDuration = 0.002; // 2ms
        const maxDuration = 0.2;   // 200ms
        
        // Direct linear mapping of species trail length (0-1) to grain duration (2ms-200ms)
        return minDuration + (speciesTrailLength * (maxDuration - minDuration));
    }
    
    // Update all grains for this species
    update(particles) {
        const now = performance.now();
        if (now - this.lastUpdate < this.updateInterval) return;
        
        this.lastUpdate = now;
        this.activeGrains = this.grains.length;
        
        // Update existing grains with their particles
        for (let i = this.grains.length - 1; i >= 0; i--) {
            const grain = this.grains[i];
            if (grain.particle && grain.isPlaying) {
                this.updateGrain(grain, grain.particle);
            }
        }
        
        // Create new grains for particles that don't have them
        const speciesParticles = particles.filter(p => p.species === this.speciesIndex);
        const particlesWithGrains = new Set(this.grains.map(g => g.particle));
        
        for (let particle of speciesParticles) {
            if (!particlesWithGrains.has(particle) && this.grains.length < this.maxGrains) {
                this.createGrain(particle);
            }
        }
    }
    
    // Set volume
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.gainNode.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.audioContext.currentTime, 0.01);
    }
    
    // Mute/unmute
    setMute(muted) {
        this.isMuted = muted;
        this.gainNode.gain.setTargetAtTime(muted ? 0 : this.volume, this.audioContext.currentTime, 0.01);
    }
    
    // Set loop mode
    setLoopMode(mode) {
        this.loopMode = mode;
        this.alternateDirection = 1; // Reset alternate direction
        console.log(`🎵 Species ${String.fromCharCode(65 + this.speciesIndex)} loop mode: ${mode}`);
    }
    
    // Stop all grains
    stopAll() {
        for (let grain of this.grains) {
            if (grain.source && grain.isPlaying) {
                grain.source.stop();
            }
        }
        this.grains = [];
    }
}

// Initialize Audio System
async function initAudioSystem() {
    // Prevent multiple initializations
    if (isAudioEnabled && audioContext && audioContext.state === 'running') {
        console.log('🎵 Audio system already initialized');
        return true;
    }
    
    try {
        // Only create new context if one doesn't exist or is closed
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } else if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        // Create master audio graph only if needed
        if (!masterGainNode || !compressorNode) {
            masterGainNode = audioContext.createGain();
            compressorNode = audioContext.createDynamicsCompressor();
            
            // Setup audio chain: species synths -> master gain -> compressor -> destination
            masterGainNode.connect(compressorNode);
            compressorNode.connect(audioContext.destination);
        }
        
        // Configure compressor for safety
        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 10;
        compressorNode.ratio.value = 8;
        compressorNode.attack.value = 0.001;
        compressorNode.release.value = 0.1;
        
        // Set master volume
        masterGainNode.gain.value = masterVolume;
        
        // Connect existing synths to audio context and decode any stored audio
        for (let i = 0; i < speciesAudioSynths.length; i++) {
            if (speciesAudioSynths[i]) {
                speciesAudioSynths[i].connectAudioGraph(audioContext, masterGainNode);
                // Decode any stored audio data
                await speciesAudioSynths[i].decodeStoredAudio();
            }
        }
        
        // Update waveforms for any newly decoded audio
        for (let i = 0; i < speciesAudioSynths.length; i++) {
            const synth = speciesAudioSynths[i];
            if (synth && synth.audioBuffer) {
                const waveformCanvas = document.getElementById(`waveform${i}`);
                if (waveformCanvas) {
                    const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
                    drawWaveform(synth.audioBuffer, waveformCanvas, currentSpeciesColors[i] || [1,1,1], i);
                }
                
                // Update file name
                const fileNameElement = document.getElementById(`fileName${i}`);
                if (fileNameElement && synth.fileName) {
                    fileNameElement.textContent = synth.fileName;
                }
            }
        }
        
        isAudioEnabled = true;
        updateAudioStatus('Ready');
        
        console.log('🎵 Audio system initialized successfully');
        return true;
        
    } catch (error) {
        console.error('Audio initialization failed:', error);
        updateAudioStatus('Failed');
        return false;
    }
}

// Initialize audio UI only (no audio context required)
function initAudioUI() {
    speciesAudioSynths = [];
    
    // Create UI-only synths (no audioContext)
    for (let i = 0; i < maxSpecies; i++) {
        const synth = new GranularSynth(i, null, null);
        speciesAudioSynths.push(synth);
    }
    
    // Generate species audio UI
    createSpeciesAudioControls();
    
    // Setup draggable numbers for species parameters
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
    
    console.log('🎵 Audio UI initialized (controls ready, audio awaiting start)');
}

// Initialize species synthesizers (preserves existing audio buffers)
function initSpeciesSynths() {
    const existingData = [];
    
    // Preserve existing audio data
    for (let i = 0; i < speciesAudioSynths.length; i++) {
        if (speciesAudioSynths[i]) {
            existingData[i] = {
                audioBuffer: speciesAudioSynths[i].audioBuffer,
                fileName: speciesAudioSynths[i].fileName,
                volume: speciesAudioSynths[i].volume,
                isMuted: speciesAudioSynths[i].isMuted,
                loopMode: speciesAudioSynths[i].loopMode,
                sampleStart: speciesAudioSynths[i].sampleStart || 0.0,
                sampleEnd: speciesAudioSynths[i].sampleEnd || 1.0,
                pitch: speciesAudioSynths[i].pitch || 0,
                detune: speciesAudioSynths[i].detune || 0,
                fadeLength: speciesAudioSynths[i].fadeLength || 0.002
            };
        }
    }
    
    speciesAudioSynths = [];
    
    for (let i = 0; i < maxSpecies; i++) {
        const synth = new GranularSynth(i, audioContext, masterGainNode);
        
        // Restore existing data if available
        if (existingData[i]) {
            synth.audioBuffer = existingData[i].audioBuffer;
            synth.fileName = existingData[i].fileName || 'No Sample';
            synth.volume = existingData[i].volume;
            synth.isMuted = existingData[i].isMuted;
            synth.loopMode = existingData[i].loopMode;
            synth.sampleStart = existingData[i].sampleStart || 0.0;
            synth.sampleEnd = existingData[i].sampleEnd || 1.0;
            synth.pitch = existingData[i].pitch || 0;
            synth.detune = existingData[i].detune || 0;
            synth.fadeLength = existingData[i].fadeLength || 0.002;
            synth.alternateDirection = 1; // Reset alternate direction
        }
        
        speciesAudioSynths.push(synth);
    }
    
    // Generate species audio UI
    createSpeciesAudioControls();
    
    // Setup draggable numbers for species parameters (call from main script)
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
}

// Update audio system with particle data
function updateAudioSystem() {
    if (!isAudioEnabled || !audioContext || audioContext.state !== 'running') return;
    
    // Update each species synth with its particles
    for (let i = 0; i < speciesCount; i++) {
        if (speciesAudioSynths[i]) {
            speciesAudioSynths[i].update(particles);
        }
    }
    
    // Update UI indicators
    updateAudioUI();
}

// Update audio status display
function updateAudioStatus(status) {
    const statusElement = document.getElementById('audioStatus');
    if (statusElement) {
        statusElement.textContent = status;
        statusElement.style.color = status === 'Ready' ? '#4CAF50' : 
                                  status === 'Failed' ? '#ff4444' : '#888';
    }
}

// Audio control functions - defined globally for event handlers
function toggleSpeciesMute(speciesIndex) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    const synth = speciesAudioSynths[speciesIndex];
    synth.setMute(!synth.isMuted);
    
    const button = document.getElementById(`speciesMute${speciesIndex}`);
    if (button) {
        button.textContent = synth.isMuted ? '🔇' : '🔊';
        button.classList.toggle('active', !synth.isMuted);
    }
}

function setSpeciesVolume(speciesIndex, volume) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].setVolume(volume);
    
    const valueDisplay = document.getElementById(`speciesVolume${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = volume.toFixed(2);
    }
}

function setMasterVolume(volume) {
    masterVolume = volume;
    if (masterGainNode) {
        masterGainNode.gain.setTargetAtTime(isMasterMuted ? 0 : volume, audioContext.currentTime, 0.01);
    }
    
    const valueDisplay = document.getElementById('masterVolume-value');
    if (valueDisplay) {
        valueDisplay.textContent = volume.toFixed(2);
    }
}

function toggleMasterMute() {
    isMasterMuted = !isMasterMuted;
    if (masterGainNode) {
        masterGainNode.gain.setTargetAtTime(isMasterMuted ? 0 : masterVolume, audioContext.currentTime, 0.01);
    }
    
    const button = document.getElementById('masterMute');
    if (button) {
        button.textContent = isMasterMuted ? '🔇' : '🔊';
        button.classList.toggle('active', !isMasterMuted);
    }
}

function setFrequencyRange(low, high) {
    frequencyRange.low = low;
    frequencyRange.high = high;
    
    const lowDisplay = document.getElementById('freqLow-value');
    const highDisplay = document.getElementById('freqHigh-value');
    if (lowDisplay) lowDisplay.textContent = `${low}Hz`;
    if (highDisplay) highDisplay.textContent = `${high}Hz`;
}

function setGlobalVelocityGainCurve(curve) {
    globalVelocityGainCurve = curve;
    
    const valueDisplay = document.getElementById('velocityGainCurve-value');
    if (valueDisplay) {
        valueDisplay.textContent = curve.toFixed(1);
    }
}

function setGlobalVelocityThreshold(threshold) {
    globalVelocityThreshold = threshold;
    
    // Pre-calculate squared threshold for performance (MAX_SPEED = 3)
    const MAX_SPEED = 3;
    globalVelocityThresholdSquared = (threshold * MAX_SPEED) * (threshold * MAX_SPEED);
    
    const valueDisplay = document.getElementById('velocityThreshold-value');
    if (valueDisplay) {
        valueDisplay.textContent = threshold.toFixed(2);
    }
}

// New audio control functions
function setSpeciesPitch(speciesIndex, pitch) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].pitch = pitch;
    
    const valueDisplay = document.getElementById(`speciesPitch${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = `${pitch}st`;
    }
}

function setSpeciesDetune(speciesIndex, detune) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].detune = detune;
    
    const valueDisplay = document.getElementById(`speciesDetune${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = `${detune}¢`;
    }
}


function setSpeciesFadeLength(speciesIndex, fadeLength) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    speciesAudioSynths[speciesIndex].fadeLength = fadeLength;
    
    const valueDisplay = document.getElementById(`speciesFade${speciesIndex}-value`);
    if (valueDisplay) {
        valueDisplay.textContent = `${Math.round(fadeLength * 1000)}ms`;
    }
}

// Set species loop mode - defined globally for loop button handlers
function setSpeciesLoopMode(speciesIndex, mode) {
    if (!speciesAudioSynths[speciesIndex]) return;
    
    // Update the synth's loop mode
    speciesAudioSynths[speciesIndex].setLoopMode(mode);
    
    // Update UI to show selected mode
    const buttons = document.querySelectorAll(`[data-species="${speciesIndex}"][data-loop-mode]`);
    buttons.forEach(button => {
        button.classList.remove('active');
        if (button.dataset.loopMode === mode) {
            button.classList.add('active');
        }
    });
    
    console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} loop mode set to: ${mode}`);
}

// Load audio file for species - defined globally for file input handlers
async function loadAudioFile(event, speciesIndex) {
    const file = event.target.files[0];
    if (!file || !speciesAudioSynths[speciesIndex]) return;
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const success = await speciesAudioSynths[speciesIndex].loadSample(arrayBuffer);
        
        if (success) {
            // Update UI with actual file name
            const fileNameElement = document.getElementById(`fileName${speciesIndex}`);
            if (fileNameElement) {
                fileNameElement.textContent = file.name;
            }
            
            // Store the actual file name in the synth for proper display
            speciesAudioSynths[speciesIndex].fileName = file.name;
            
            // Update waveform if audioBuffer is available (should be available now even before Start Audio)
            const waveformCanvas = document.getElementById(`waveform${speciesIndex}`);
            if (waveformCanvas && speciesAudioSynths[speciesIndex].audioBuffer) {
                const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
                drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, waveformCanvas, currentSpeciesColors[speciesIndex] || [1,1,1], speciesIndex);
            }
            
            console.log(`🎵 Loaded audio file for Species ${String.fromCharCode(65 + speciesIndex)}: ${file.name}`);
        } else {
            alert('Failed to load audio file. Please try a different file.');
        }
    } catch (error) {
        console.error('File loading error:', error);
        alert('Error loading audio file.');
    }
}

// Waveform selection state
let waveformSelection = {
    isSelecting: false,
    speciesIndex: -1,
    startX: 0,
    currentX: 0,
    canvas: null
};

// Draw waveform visualization with selection overlay
function drawWaveform(audioBuffer, canvas, color, speciesIndex) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    if (!audioBuffer) return;
    
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    
    // Draw waveform
    ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    
    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        
        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
    }
    
    ctx.stroke();
    
    // Draw center line
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(width, amp);
    ctx.stroke();
    
    // Draw selection overlay if this species has selection data
    if (speciesAudioSynths[speciesIndex] && typeof speciesIndex !== 'undefined') {
        const synth = speciesAudioSynths[speciesIndex];
        if (synth.sampleStart !== 0 || synth.sampleEnd !== 1) {
            const startX = synth.sampleStart * width;
            const endX = synth.sampleEnd * width;
            const selectionWidth = endX - startX;
            
            // Draw selection rectangle
            ctx.fillStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, 0.3)`;
            ctx.fillRect(startX, 0, selectionWidth, height);
            
            // Draw selection borders
            ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(startX, 0, selectionWidth, height);
        }
    }
    
    // Draw current selection if actively selecting on this canvas
    if (waveformSelection.isSelecting && waveformSelection.canvas === canvas) {
        const startX = Math.min(waveformSelection.startX, waveformSelection.currentX);
        const endX = Math.max(waveformSelection.startX, waveformSelection.currentX);
        const selectionWidth = endX - startX;
        
        // Draw active selection
        ctx.fillStyle = `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, 0.4)`;
        ctx.fillRect(startX, 0, selectionWidth, height);
        
        ctx.strokeStyle = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, 0, selectionWidth, height);
        ctx.setLineDash([]); // Reset line dash
    }
}

// Setup waveform selection handlers
function setupWaveformSelection(canvas, speciesIndex) {
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        waveformSelection.isSelecting = true;
        waveformSelection.speciesIndex = speciesIndex;
        waveformSelection.startX = x;
        waveformSelection.currentX = x;
        waveformSelection.canvas = canvas;
        
        e.preventDefault();
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!waveformSelection.isSelecting || waveformSelection.canvas !== canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        waveformSelection.currentX = Math.max(0, Math.min(canvas.width, x));
        
        // Redraw waveform with current selection
        if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
            drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
        }
        
        e.preventDefault();
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (!waveformSelection.isSelecting || waveformSelection.canvas !== canvas) return;
        
        const startX = Math.min(waveformSelection.startX, waveformSelection.currentX);
        const endX = Math.max(waveformSelection.startX, waveformSelection.currentX);
        const width = canvas.width;
        
        // Convert pixels to normalized positions (0-1)
        const startPos = Math.max(0, Math.min(1, startX / width));
        const endPos = Math.max(0, Math.min(1, endX / width));
        
        // Only update if there's a meaningful selection (at least 2% of the waveform)
        if (Math.abs(endPos - startPos) > 0.02) {
            const synth = speciesAudioSynths[speciesIndex];
            if (synth) {
                synth.sampleStart = startPos;
                synth.sampleEnd = endPos;
                console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} sample selection: ${(startPos * 100).toFixed(1)}% - ${(endPos * 100).toFixed(1)}%`);
            }
        }
        
        // Reset selection state
        waveformSelection.isSelecting = false;
        waveformSelection.speciesIndex = -1;
        waveformSelection.canvas = null;
        
        // Final redraw
        if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
            drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
        }
        
        e.preventDefault();
    });
    
    // Handle mouse leaving the canvas
    canvas.addEventListener('mouseleave', (e) => {
        if (waveformSelection.isSelecting && waveformSelection.canvas === canvas) {
            // Cancel selection
            waveformSelection.isSelecting = false;
            waveformSelection.speciesIndex = -1;
            waveformSelection.canvas = null;
            
            // Redraw without selection
            if (speciesAudioSynths[speciesIndex] && speciesAudioSynths[speciesIndex].audioBuffer) {
                drawWaveform(speciesAudioSynths[speciesIndex].audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
            }
        }
    });
    
    // Double-click to reset selection to full waveform
    canvas.addEventListener('dblclick', (e) => {
        const synth = speciesAudioSynths[speciesIndex];
        if (synth) {
            synth.sampleStart = 0.0;
            synth.sampleEnd = 1.0;
            console.log(`🎵 Species ${String.fromCharCode(65 + speciesIndex)} sample selection reset to full waveform`);
            
            // Redraw waveform
            if (synth.audioBuffer) {
                drawWaveform(synth.audioBuffer, canvas, (typeof speciesColors !== 'undefined' ? speciesColors[speciesIndex] : [1,1,1]), speciesIndex);
            }
        }
        e.preventDefault();
    });
    
    // Make canvas cursor indicate it's selectable
    canvas.style.cursor = 'crosshair';
}

// RGB to Hex conversion function - ensure it's defined before createSpeciesAudioControls
function rgbToHex(rgbArray) {
    const r = Math.round(rgbArray[0] * 255);
    const g = Math.round(rgbArray[1] * 255);
    const b = Math.round(rgbArray[2] * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ===== UI GENERATION (Audio UI only) =====
// Global variable to track currently selected species for audio controls
let selectedSpeciesForAudio = 0;

// Species selector is now handled by the species tab system in main HTML

// Create species audio controls UI - defined globally (now shows single species)
function createSpeciesAudioControls() {
    const container = document.getElementById('speciesAudioControls');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Use window variables if available, fallback to defaults
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    const currentSpeciesColors = (typeof speciesColors !== 'undefined') ? speciesColors : [[1,0,0],[0,0,1]];
    const currentParticleCounts = (typeof particleCounts !== 'undefined') ? particleCounts : [200, 200];
    const currentParticleSizes = (typeof particleSizes !== 'undefined') ? particleSizes : [4, 4];
    const currentSpeciesTrailLengths = (typeof speciesTrailLengths !== 'undefined') ? speciesTrailLengths : [0.75, 0.65];
    
    // Only create panel for selected species
    const i = selectedSpeciesForAudio;
    if (i >= currentSpeciesCount) {
        selectedSpeciesForAudio = 0;
        return;
    }
    
    const synth = speciesAudioSynths[i];
    const panel = document.createElement('div');
    panel.className = 'species-audio-panel';
    
    // Add count/size/trail controls at top of panel
    const speciesParamsHeader = document.createElement('div');
    speciesParamsHeader.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #ccc; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 5px;">Species Parameters</h4>';
    
    const speciesParamsRow = document.createElement('div');
    speciesParamsRow.className = 'species-row';
    speciesParamsRow.style.marginBottom = '15px';

    const speciesLabel = document.createElement('div');
    speciesLabel.className = 'species-label';
    speciesLabel.style.color = rgbToHex(currentSpeciesColors[i] || [1,1,1]);
    speciesLabel.textContent = `Species ${String.fromCharCode(65 + i)}`;

    // Count parameter
    const countGroup = document.createElement('div');
    countGroup.className = 'param-group';
    
    const countLabel = document.createElement('span');
    countLabel.className = 'param-label';
    countLabel.textContent = 'Count:';
    
    const countValue = document.createElement('div');
    countValue.className = 'draggable-number';
    countValue.textContent = currentParticleCounts[i] || 200;
    countValue.id = `count-${i}`;
    
    countGroup.appendChild(countLabel);
    countGroup.appendChild(countValue);

    // Size parameter
    const sizeGroup = document.createElement('div');
    sizeGroup.className = 'param-group';
    
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'param-label';
    sizeLabel.textContent = 'Size:';
    
    const sizeValue = document.createElement('div');
    sizeValue.className = 'draggable-number';
    sizeValue.textContent = currentParticleSizes[i] || 4;
    sizeValue.id = `size-${i}`;
    
    sizeGroup.appendChild(sizeLabel);
    sizeGroup.appendChild(sizeValue);

    // Trail parameter
    const trailGroup = document.createElement('div');
    trailGroup.className = 'param-group';
    
    const trailLabel = document.createElement('span');
    trailLabel.className = 'param-label';
    trailLabel.textContent = 'Trail:';
    
    const trailValue = document.createElement('div');
    trailValue.className = 'draggable-number';
    trailValue.textContent = (currentSpeciesTrailLengths[i] || 0.75).toFixed(2);
    trailValue.id = `trail-${i}`;
    
    trailGroup.appendChild(trailLabel);
    trailGroup.appendChild(trailValue);

    speciesParamsRow.appendChild(speciesLabel);
    speciesParamsRow.appendChild(countGroup);
    speciesParamsRow.appendChild(sizeGroup);
    speciesParamsRow.appendChild(trailGroup);
    
    const header = document.createElement('div');
    header.className = 'species-audio-header';
    header.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #ccc; font-size: 14px; border-bottom: 1px solid #333; padding-bottom: 5px;">Audio Controls</h4>';
    
    const title = document.createElement('div');
    title.className = 'species-audio-title';
    title.style.color = rgbToHex(currentSpeciesColors[i] || [1,1,1]);
    title.textContent = `Species ${String.fromCharCode(65 + i)}`;
    
    const muteButton = document.createElement('button');
    muteButton.className = 'audio-button';
    muteButton.id = `speciesMute${i}`;
    muteButton.textContent = (synth && synth.isMuted) ? '🔇' : '🔊';
    if (synth && !synth.isMuted) muteButton.classList.add('active');
    muteButton.addEventListener('click', () => toggleSpeciesMute(i));
    
    header.appendChild(title);
    header.appendChild(muteButton);
    
    // File controls
    const fileControls = document.createElement('div');
    fileControls.className = 'audio-file-controls';
    
    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'file-input-wrapper';
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = `audioFile${i}`;
    fileInput.accept = '.wav,.mp3,.m4a,.ogg';
    fileInput.addEventListener('change', (e) => loadAudioFile(e, i));
    
    const fileLabel = document.createElement('label');
    fileLabel.className = 'file-input-label';
    fileLabel.htmlFor = `audioFile${i}`;
    fileLabel.textContent = '📁 Load Sample';
    
    const fileName = document.createElement('div');
    fileName.className = 'file-name';
    fileName.id = `fileName${i}`;
    fileName.textContent = (synth && synth.fileName) || 'No Sample';
    
    fileWrapper.appendChild(fileInput);
    fileWrapper.appendChild(fileLabel);
    fileControls.appendChild(fileWrapper);
    fileControls.appendChild(fileName);
    
    // Waveform display
    const waveformContainer = document.createElement('div');
    waveformContainer.className = 'waveform-container';
    
    const waveformCanvas = document.createElement('canvas');
    waveformCanvas.className = 'waveform-canvas';
    waveformCanvas.id = `waveform${i}`;
    waveformCanvas.width = 280;
    waveformCanvas.height = 40;
    
    waveformContainer.appendChild(waveformCanvas);
    
    // Setup waveform selection handlers
    setupWaveformSelection(waveformCanvas, i);
    
    // Volume control
    const volumeRow = document.createElement('div');
    volumeRow.className = 'audio-controls-row';
    
    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = 'Volume:';
    volumeLabel.style.minWidth = '50px';
    volumeLabel.style.fontSize = '12px';
    
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'slider';
    volumeSlider.id = `speciesVolume${i}`;
    volumeSlider.min = '0';
    volumeSlider.max = '1';
    volumeSlider.step = '0.05';
    const currentVolume = (synth && typeof synth.volume !== 'undefined') ? synth.volume : 0.7;
    volumeSlider.value = currentVolume.toString();
    volumeSlider.style.flex = '1';
    volumeSlider.addEventListener('input', (e) => setSpeciesVolume(i, parseFloat(e.target.value)));
    
    const volumeValue = document.createElement('span');
    volumeValue.className = 'value-display';
    volumeValue.id = `speciesVolume${i}-value`;
    volumeValue.textContent = currentVolume.toFixed(2);
    
    volumeRow.appendChild(volumeLabel);
    volumeRow.appendChild(volumeSlider);
    volumeRow.appendChild(volumeValue);
    
    // Loop Mode Controls
    const loopRow = document.createElement('div');
    loopRow.className = 'audio-controls-row';
    loopRow.style.marginBottom = '8px';
    
    const loopLabel = document.createElement('span');
    loopLabel.textContent = 'Loop:';
    loopLabel.style.minWidth = '50px';
    loopLabel.style.fontSize = '12px';
    loopLabel.style.color = '#ccc';
    
    const loopControls = document.createElement('div');
    loopControls.className = 'loop-controls';
    
    // Forward button
    const forwardBtn = document.createElement('button');
    forwardBtn.className = 'loop-button';
    if (!synth || synth.loopMode === 'forward') forwardBtn.classList.add('active');
    forwardBtn.textContent = '▶';
    forwardBtn.title = 'Forward Loop';
    forwardBtn.addEventListener('click', () => setSpeciesLoopMode(i, 'forward'));
    
    // Reverse button
    const reverseBtn = document.createElement('button');
    reverseBtn.className = 'loop-button';
    if (synth && synth.loopMode === 'reverse') reverseBtn.classList.add('active');
    reverseBtn.textContent = '◀';
    reverseBtn.title = 'Reverse Loop';
    reverseBtn.addEventListener('click', () => setSpeciesLoopMode(i, 'reverse'));
    
    // Alternate button
    const alternateBtn = document.createElement('button');
    alternateBtn.className = 'loop-button';
    if (synth && synth.loopMode === 'alternate') alternateBtn.classList.add('active');
    alternateBtn.textContent = '⇄';
    alternateBtn.title = 'Alternate Loop';
    alternateBtn.addEventListener('click', () => setSpeciesLoopMode(i, 'alternate'));
    
    loopControls.appendChild(forwardBtn);
    loopControls.appendChild(reverseBtn);
    loopControls.appendChild(alternateBtn);
    
    loopRow.appendChild(loopLabel);
    loopRow.appendChild(loopControls);
    
    // Pitch control
    const pitchRow = document.createElement('div');
    pitchRow.className = 'audio-controls-row';
    
    const pitchLabel = document.createElement('span');
    pitchLabel.textContent = 'Pitch:';
    pitchLabel.style.minWidth = '50px';
    pitchLabel.style.fontSize = '12px';
    
    const pitchSlider = document.createElement('input');
    pitchSlider.type = 'range';
    pitchSlider.className = 'slider';
    pitchSlider.id = `speciesPitch${i}`;
    pitchSlider.min = '0';
    pitchSlider.max = '24';
    pitchSlider.step = '1';
    const currentPitch = (synth && typeof synth.pitch !== 'undefined') ? synth.pitch : 0;
    pitchSlider.value = currentPitch.toString();
    pitchSlider.style.flex = '1';
    pitchSlider.addEventListener('input', (e) => setSpeciesPitch(i, parseInt(e.target.value)));
    
    const pitchValue = document.createElement('span');
    pitchValue.className = 'value-display';
    pitchValue.id = `speciesPitch${i}-value`;
    pitchValue.textContent = `${currentPitch}st`;
    
    pitchRow.appendChild(pitchLabel);
    pitchRow.appendChild(pitchSlider);
    pitchRow.appendChild(pitchValue);
    
    // Detune control
    const detuneRow = document.createElement('div');
    detuneRow.className = 'audio-controls-row';
    
    const detuneLabel = document.createElement('span');
    detuneLabel.textContent = 'Detune:';
    detuneLabel.style.minWidth = '50px';
    detuneLabel.style.fontSize = '12px';
    
    const detuneSlider = document.createElement('input');
    detuneSlider.type = 'range';
    detuneSlider.className = 'slider';
    detuneSlider.id = `speciesDetune${i}`;
    detuneSlider.min = '0';
    detuneSlider.max = '50';
    detuneSlider.step = '1';
    const currentDetune = (synth && typeof synth.detune !== 'undefined') ? synth.detune : 0;
    detuneSlider.value = currentDetune.toString();
    detuneSlider.style.flex = '1';
    detuneSlider.addEventListener('input', (e) => setSpeciesDetune(i, parseInt(e.target.value)));
    
    const detuneValue = document.createElement('span');
    detuneValue.className = 'value-display';
    detuneValue.id = `speciesDetune${i}-value`;
    detuneValue.textContent = `${currentDetune}¢`;
    
    detuneRow.appendChild(detuneLabel);
    detuneRow.appendChild(detuneSlider);
    detuneRow.appendChild(detuneValue);
    
    // Fade Length control
    const fadeRow = document.createElement('div');
    fadeRow.className = 'audio-controls-row';
    
    const fadeLabel = document.createElement('span');
    fadeLabel.textContent = 'Fade:';
    fadeLabel.style.minWidth = '50px';
    fadeLabel.style.fontSize = '12px';
    
    const fadeSlider = document.createElement('input');
    fadeSlider.type = 'range';
    fadeSlider.className = 'slider';
    fadeSlider.id = `speciesFade${i}`;
    fadeSlider.min = '0.001';
    fadeSlider.max = '0.02';
    fadeSlider.step = '0.001';
    const currentFade = (synth && typeof synth.fadeLength !== 'undefined') ? synth.fadeLength : 0.002;
    fadeSlider.value = currentFade.toString();
    fadeSlider.style.flex = '1';
    fadeSlider.addEventListener('input', (e) => setSpeciesFadeLength(i, parseFloat(e.target.value)));
    
    const fadeValue = document.createElement('span');
    fadeValue.className = 'value-display';
    fadeValue.id = `speciesFade${i}-value`;
    fadeValue.textContent = `${Math.round(currentFade * 1000)}ms`;
    
    fadeRow.appendChild(fadeLabel);
    fadeRow.appendChild(fadeSlider);
    fadeRow.appendChild(fadeValue);
    
    // Activity indicators
    const activityRow = document.createElement('div');
    activityRow.className = 'audio-controls-row';
    
    const activityLabel = document.createElement('span');
    activityLabel.textContent = 'Grains:';
    activityLabel.style.minWidth = '50px';
    activityLabel.style.fontSize = '12px';
    
    const grainActivity = document.createElement('div');
    grainActivity.className = 'grain-activity';
    grainActivity.id = `grainActivity${i}`;
    
    // Create grain indicators
    for (let j = 0; j < 10; j++) {
        const indicator = document.createElement('div');
        indicator.className = 'grain-indicator';
        grainActivity.appendChild(indicator);
    }
    
    const audioMeter = document.createElement('div');
    audioMeter.className = 'audio-meter';
    
    const meterBar = document.createElement('div');
    meterBar.className = 'meter-bar';
    
    const meterFill = document.createElement('div');
    meterFill.className = 'meter-fill';
    meterFill.id = `meterFill${i}`;
    
    meterBar.appendChild(meterFill);
    audioMeter.appendChild(meterBar);
    
    const grainCount = document.createElement('span');
    grainCount.id = `grainCount${i}`;
    grainCount.textContent = '0/50';
    grainCount.style.fontSize = '11px';
    grainCount.style.color = '#888';
    
    audioMeter.appendChild(grainCount);
    
    activityRow.appendChild(activityLabel);
    activityRow.appendChild(grainActivity);
    activityRow.appendChild(audioMeter);
    
    // Assemble panel
    panel.appendChild(speciesParamsHeader);
    panel.appendChild(speciesParamsRow);
    panel.appendChild(header);
    panel.appendChild(fileControls);
    panel.appendChild(waveformContainer);
    panel.appendChild(volumeRow);
    panel.appendChild(loopRow);
    panel.appendChild(pitchRow);
    panel.appendChild(detuneRow);
    panel.appendChild(fadeRow);
    panel.appendChild(activityRow);
    
    container.appendChild(panel);
    
    // Draw waveform if audio buffer exists
    if (synth && synth.audioBuffer) {
        drawWaveform(synth.audioBuffer, waveformCanvas, currentSpeciesColors[i] || [1,1,1], i);
    }
    
    // Setup draggable numbers for the species parameters (call from main script if available)
    if (typeof setupDraggableNumbers === 'function') {
        setTimeout(() => setupDraggableNumbers(), 0);
    }
}

// Update audio UI indicators - defined globally
function updateAudioUI() {
    const currentSpeciesCount = (typeof speciesCount !== 'undefined') ? speciesCount : 2;
    for (let i = 0; i < currentSpeciesCount; i++) {
        if (!speciesAudioSynths[i]) continue;
        
        const synth = speciesAudioSynths[i];
        const grainCount = synth.activeGrains;
        
        // Update grain count
        const grainCountElement = document.getElementById(`grainCount${i}`);
        if (grainCountElement) {
            grainCountElement.textContent = `${grainCount}/${synth.maxGrains}`;
        }
        
        // Update grain activity indicators
        const grainActivity = document.getElementById(`grainActivity${i}`);
        if (grainActivity) {
            const indicators = grainActivity.children;
            for (let j = 0; j < indicators.length; j++) {
                indicators[j].classList.toggle('active', j < Math.ceil(grainCount / 5));
            }
        }
        
        // Update audio level meter
        const meterFill = document.getElementById(`meterFill${i}`);
        if (meterFill) {
            const level = Math.min(100, (grainCount / synth.maxGrains) * 100);
            meterFill.style.width = `${level}%`;
        }
    }
}

