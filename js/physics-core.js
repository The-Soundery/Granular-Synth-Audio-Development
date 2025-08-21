// ===== PHYSICS CORE =====
// Particle simulation, spatial optimization, and trail system

// ===== SPATIAL GRID SYSTEM =====
// Spatial Grid Class for O(N) force calculation optimization
class SpatialGrid {
    constructor(canvasWidth, canvasHeight, cellSize) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.cellSize = cellSize;
        
        // Calculate grid dimensions
        this.gridWidth = Math.ceil(canvasWidth / cellSize);
        this.gridHeight = Math.ceil(canvasHeight / cellSize);
        
        // Create 2D grid array - each cell contains array of particles
        this.grid = [];
        for (let i = 0; i < this.gridWidth * this.gridHeight; i++) {
            this.grid[i] = [];
        }
        
        console.log(`Spatial Grid: ${this.gridWidth}x${this.gridHeight} cells, cell size: ${cellSize}`);
    }
    
    // Convert world coordinates to grid coordinates
    worldToGrid(x, y) {
        // Handle toroidal wrapping
        x = ((x % this.canvasWidth) + this.canvasWidth) % this.canvasWidth;
        y = ((y % this.canvasHeight) + this.canvasHeight) % this.canvasHeight;
        
        const gridX = Math.floor(x / this.cellSize);
        const gridY = Math.floor(y / this.cellSize);
        
        return {
            x: Math.max(0, Math.min(this.gridWidth - 1, gridX)),
            y: Math.max(0, Math.min(this.gridHeight - 1, gridY))
        };
    }
    
    // Convert grid coordinates to linear index
    gridToIndex(gridX, gridY) {
        return gridY * this.gridWidth + gridX;
    }
    
    // Clear all grid cells
    clear() {
        for (let i = 0; i < this.grid.length; i++) {
            this.grid[i].length = 0; // Fast array clear
        }
    }
    
    // Add particle to appropriate grid cell
    insertParticle(particle) {
        const gridPos = this.worldToGrid(particle.x, particle.y);
        const index = this.gridToIndex(gridPos.x, gridPos.y);
        this.grid[index].push(particle);
    }
    
    // Get all particles in neighboring cells (including current cell)
    // Returns particles that could potentially interact with a particle at (x, y)
    getNearbyParticles(x, y) {
        const centerGrid = this.worldToGrid(x, y);
        const nearbyParticles = [];
        
        // Check 3x3 neighborhood (including center cell)
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                let gridX = centerGrid.x + dx;
                let gridY = centerGrid.y + dy;
                
                // Handle toroidal wrapping for grid coordinates
                gridX = ((gridX % this.gridWidth) + this.gridWidth) % this.gridWidth;
                gridY = ((gridY % this.gridHeight) + this.gridHeight) % this.gridHeight;
                
                const index = this.gridToIndex(gridX, gridY);
                
                // Add all particles from this cell
                const cell = this.grid[index];
                for (let i = 0; i < cell.length; i++) {
                    nearbyParticles.push(cell[i]);
                }
            }
        }
        
        return nearbyParticles;
    }
    
    // Update grid cell size (when force radius changes)
    updateCellSize(newCellSize) {
        this.cellSize = newCellSize;
        this.gridWidth = Math.ceil(this.canvasWidth / newCellSize);
        this.gridHeight = Math.ceil(this.canvasHeight / newCellSize);
        
        // Recreate grid with new dimensions
        const newSize = this.gridWidth * this.gridHeight;
        if (this.grid.length !== newSize) {
            this.grid = [];
            for (let i = 0; i < newSize; i++) {
                this.grid[i] = [];
            }
            console.log(`Spatial Grid resized: ${this.gridWidth}x${this.gridHeight} cells`);
        }
    }
}


// ===== PARTICLE SYSTEM =====
// Particle class with motion blur trails
class Particle {
    constructor(species) {
        this.species = species;
        this.x = Math.random() * canvasWidth;
        this.y = Math.random() * canvasHeight;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.updateSize();
        this.visualSize = this.size; // Initialize visual size
        
        // Set color based on species
        this.color = [...speciesColors[species]];
        
        // Audio fade state for smooth threshold transitions
        this.audioFadeState = 0.0; // 0.0 = silent, 1.0 = full volume
        this.wasAboveThreshold = false; // Track previous threshold state
        
        // Simple age tracking for particle sorting (temporal priority)
        this.age = 0;
        
        // Track previous position for trail particle spawning
        this.prevX = this.x;
        this.prevY = this.y;
        
        // Collision tracking for audio
        this.collisionEvents = []; // Array of recent collision events
        this.lastCollisionTime = 0;
        this.collisionForce = 0; // Current collision force magnitude
    }

    updateSize() {
        this.size = particleSizes[this.species];
        
        // Calculate visual size (enhanced when size = 10)
        this.visualSize = this.size;
        if (this.size >= 10) {
            this.visualSize = this.size * 1.5; // 50% larger visual representation
        }
    }

    update() {
        // Store old position for movement detection
        const oldX = this.x;
        const oldY = this.y;
        
        // Calculate forces from nearby particles only (using spatial grid)
        let fx = 0;
        let fy = 0;

        // Get nearby particles from spatial grid instead of all particles
        const nearbyParticles = spatialGrid.getNearbyParticles(this.x, this.y);

        for (let i = 0; i < nearbyParticles.length; i++) {
            const other = nearbyParticles[i];
            if (other === this) continue;

            // Calculate distance with toroidal wrapping (if enabled)
            let dx = other.x - this.x;
            let dy = other.y - this.y;
            
            // Handle toroidal space - find shortest distance across wrapping edges
            if (TOROIDAL_SPACE) {
                if (Math.abs(dx) > canvasWidth / 2) {
                    dx = dx > 0 ? dx - canvasWidth : dx + canvasWidth;
                }
                if (Math.abs(dy) > canvasHeight / 2) {
                    dy = dy > 0 ? dy - canvasHeight : dy + canvasHeight;
                }
            }
            
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            // Calculate collision distance using visual sizes to prevent visual overlap
            let collisionDistance = this.visualSize + other.visualSize;
            
            // Handle collision - push particles apart if they're overlapping
            if (distance < collisionDistance && distance > 0) {
                let overlap = collisionDistance - distance;
                let separationForce = overlap * 1.0; // Increased separation strength
                
                // Normalize direction vector
                let normalizedDx = dx / distance;
                let normalizedDy = dy / distance;
                
                // Apply separation force (push away from each other)
                fx -= separationForce * normalizedDx;
                fy -= separationForce * normalizedDy;
                
                // Calculate collision force magnitude for audio
                const velocityMagnitude = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                const otherVelocityMagnitude = Math.sqrt(other.vx * other.vx + other.vy * other.vy);
                const totalVelocity = velocityMagnitude + otherVelocityMagnitude;
                const collisionForce = (separationForce + totalVelocity) * 0.5; // Combined force measure
                
                // Record collision event for audio processing
                const currentTime = performance.now();
                const collisionEvent = {
                    time: currentTime,
                    force: collisionForce,
                    otherSpecies: other.species,
                    distance: distance,
                    relativeVelocity: totalVelocity
                };
                
                // Add collision event to both particles
                this.collisionEvents.push(collisionEvent);
                other.collisionEvents.push({
                    ...collisionEvent,
                    otherSpecies: this.species
                });
                
                // Update current collision force
                this.collisionForce = Math.max(this.collisionForce, collisionForce);
                other.collisionForce = Math.max(other.collisionForce, collisionForce);
                this.lastCollisionTime = currentTime;
                other.lastCollisionTime = currentTime;
                
                // Apply mutual velocity damping on collision (both particles affected)
                this.vx *= 0.7;
                this.vy *= 0.7;
                other.vx *= 0.7;
                other.vy *= 0.7;
                
                // Add a small repulsion force to ensure separation
                const repulsionForce = 0.2;
                fx -= repulsionForce * normalizedDx;
                fy -= repulsionForce * normalizedDy;
            }

            // Skip normal force calculation if outside force range
            if (distance > MAX_FORCE_DISTANCE || distance < 1) continue;

            // Get force strength from relationship matrix
            let forceStrength = RELATIONSHIP_MATRIX[this.species][other.species];

            // Calculate force falloff (smooth falloff to 0)
            let falloff = 1 - (distance / MAX_FORCE_DISTANCE);
            falloff = falloff * falloff; // Quadratic falloff for smoother effect

            // Calculate force components
            let force = forceStrength * falloff;
            let normalizedDx = dx / distance;
            let normalizedDy = dy / distance;

            fx += force * normalizedDx;
            fy += force * normalizedDy;
        }

        // Apply gravity force if active
        if (gravityPoint.active && GRAVITY_STRENGTH > 0) {
            const gravityDx = gravityPoint.x - this.x;
            const gravityDy = gravityPoint.y - this.y;
            const gravityDistance = Math.sqrt(gravityDx * gravityDx + gravityDy * gravityDy);
            
            if (gravityDistance > 1) { // Avoid division by zero
                // Calculate gravity force (inverse square law with minimum distance)
                const minDistance = 10; // Minimum distance to prevent extreme forces (reduced for better close-range control)
                const effectiveDistance = Math.max(gravityDistance, minDistance);
                const gravityForce = GRAVITY_STRENGTH / (effectiveDistance * effectiveDistance) * 5000; // Increased scale factor for stronger response
                
                // Normalize and apply gravity
                const normalizedGravityDx = gravityDx / gravityDistance;
                const normalizedGravityDy = gravityDy / gravityDistance;
                
                fx += gravityForce * normalizedGravityDx;
                fy += gravityForce * normalizedGravityDy;
            }
        }

        // Apply forces to velocity (scaled by simulation speed)
        this.vx += fx * 0.1 * SIMULATION_SPEED;
        this.vy += fy * 0.1 * SIMULATION_SPEED;

        // Apply friction
        this.vx *= FRICTION;
        this.vy *= FRICTION;

        // Limit maximum speed
        let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > MAX_SPEED) {
            this.vx = (this.vx / speed) * MAX_SPEED;
            this.vy = (this.vy / speed) * MAX_SPEED;
        }

        // Update position (scaled by simulation speed)
        this.x += this.vx * SIMULATION_SPEED;
        this.y += this.vy * SIMULATION_SPEED;

        // Handle boundary conditions based on toroidal space setting
        if (TOROIDAL_SPACE) {
            // Implement toroidal wrapping
            if (this.x < 0) this.x += canvasWidth;
            if (this.x > canvasWidth) this.x -= canvasWidth;
            if (this.y < 0) this.y += canvasHeight;
            if (this.y > canvasHeight) this.y -= canvasHeight;
        } else {
            // Implement bouncing off walls
            if (this.x < this.size) {
                this.x = this.size;
                this.vx = Math.abs(this.vx) * BOUNCE_DAMPING; // Bounce with configurable damping
            }
            if (this.x > canvasWidth - this.size) {
                this.x = canvasWidth - this.size;
                this.vx = -Math.abs(this.vx) * BOUNCE_DAMPING;
            }
            if (this.y < this.size) {
                this.y = this.size;
                this.vy = Math.abs(this.vy) * BOUNCE_DAMPING;
            }
            if (this.y > canvasHeight - this.size) {
                this.y = canvasHeight - this.size;
                this.vy = -Math.abs(this.vy) * BOUNCE_DAMPING;
            }
        }
        
        // Spawn trail particle if moved significantly
        const dx = this.x - this.prevX;
        const dy = this.y - this.prevY;
        const movement = Math.sqrt(dx * dx + dy * dy);
        
        if (movement > 2.0) { // Spawn trail when particle moves > 2 pixels
            // Only spawn trail particles if species has trails enabled
            const speciesTrailLength = speciesTrailLengths[this.species] !== undefined ? speciesTrailLengths[this.species] : 0.75;
            
            if (speciesTrailLength > 0.01) { // Use 0.01 threshold to handle floating point precision
                // Create trail particle at previous position
                trailParticles.push(new TrailParticle(
                    this.prevX, 
                    this.prevY, 
                    this.species, 
                    this.color, 
                    this.visualSize
                ));
            }
            
            // Update previous position
            this.prevX = this.x;
            this.prevY = this.y;
        }
        
        // Simple age increment for temporal sorting
        this.age++;
        
        // Update collision tracking for audio
        const currentTime = performance.now();
        
        // Remove old collision events (older than 100ms)
        this.collisionEvents = this.collisionEvents.filter(event => 
            currentTime - event.time < 100
        );
        
        // Decay collision force over time
        const timeSinceCollision = currentTime - this.lastCollisionTime;
        if (timeSinceCollision > 50) { // Start decaying after 50ms
            const decayFactor = Math.exp(-(timeSinceCollision - 50) / 100); // Exponential decay
            this.collisionForce *= decayFactor;
            if (this.collisionForce < 0.01) {
                this.collisionForce = 0;
            }
        }
    }
}

// ===== TRAIL PARTICLE SYSTEM =====
// TrailParticle class - lightweight, visual-only particles for trail effects
class TrailParticle {
    constructor(x, y, species, color, size) {
        // Position (fixed - trail particles don't move)
        this.x = x;
        this.y = y;
        
        // Visual properties inherited from parent particle
        this.species = species;
        this.color = [...color]; // Copy color array
        this.size = size;
        
        // Trail-specific properties
        this.creationTime = performance.now();
        this.age = 0;
        this.alpha = 1.0; // Start fully visible
    }
    
    // Update trail particle age and alpha based on species trail settings
    updateTrailParticle() {
        const currentTime = performance.now();
        this.age = currentTime - this.creationTime;
        
        // Get species trail length setting (0.0 to 0.99)
        const speciesTrailLength = speciesTrailLengths[this.species] !== undefined ? speciesTrailLengths[this.species] : 0.75;
        
        // If trail length is 0 or very close to 0, remove immediately (no trails)
        if (speciesTrailLength <= 0.01) {
            this.alpha = 0;
            return true;
        }
        
        // Calculate fade based on age and species setting
        const maxAge = 3000; // 3 seconds maximum trail life
        const ageRatio = Math.min(this.age / maxAge, 1.0);
        
        // Convert trail length to much more aggressive fade curve
        // Scale the 0.0-0.99 range to behave like the old 0.5-0.99 range
        const scaledTrailLength = 0.5 + (speciesTrailLength * 0.49); // Maps 0.0->0.5, 0.99->0.99
        const fadeRate = 1.0 - scaledTrailLength;
        
        // Calculate alpha: trails fade from 1.0 to 0.0 with more aggressive scaling
        this.alpha = Math.max(0, 1.0 - (ageRatio * fadeRate * 4.0)); // Increased multiplier for faster fade
        
        // Return true if trail particle should be removed
        return this.alpha <= 0;
    }
}

// Trail particles array - separate from main particles
let trailParticles = [];

// Initialize particles
function initParticles() {
    particles = [];
    
    // Create particles for each active species
    for (let species = 0; species < speciesCount; species++) {
        for (let i = 0; i < particleCounts[species]; i++) {
            particles.push(new Particle(species));
        }
    }
    
    updateParticleCountDisplay();
}

// Initialize spatial grid system
function initSpatialGrid() {
    // Use force radius as cell size for optimal performance
    spatialGrid = new SpatialGrid(canvasWidth, canvasHeight, MAX_FORCE_DISTANCE);
    console.log('🚀 Spatial partitioning enabled! Force calculations optimized from O(N²) to O(N)');
}

// ===== TRAIL PARTICLE TRAIL SYSTEM =====
// Initialize trail particle system
function initTrailSystem() {
    // Set up main 2D canvas context
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Clear main canvas to black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Initialize empty trail particles array
    trailParticles = [];
    
    // Remove any existing off-screen canvases
    window.speciesTrailCanvases = null;
    window.speciesTrailContexts = null;
    
    console.log('🎨 Trail particle system initialized with individual species control!');
}



// ===== PARTICLE MANAGEMENT =====
// Adjust particle counts dynamically
function adjustParticleCounts() {
    // Count current particles by species
    let currentCounts = new Array(maxSpecies).fill(0);
    for (let particle of particles) {
        currentCounts[particle.species]++;
    }

    // Adjust each active species
    for (let species = 0; species < speciesCount; species++) {
        let currentCount = currentCounts[species];
        let targetCount = particleCounts[species];

        if (currentCount < targetCount) {
            // Add particles
            for (let i = currentCount; i < targetCount; i++) {
                particles.push(new Particle(species));
            }
        } else if (currentCount > targetCount) {
            // Remove particles
            let toRemove = currentCount - targetCount;
            for (let i = particles.length - 1; i >= 0 && toRemove > 0; i--) {
                if (particles[i].species === species) {
                    particles.splice(i, 1);
                    toRemove--;
                }
            }
        }
    }

    // Remove particles from inactive species
    for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].species >= speciesCount) {
            particles.splice(i, 1);
        }
    }

    updateParticleCountDisplay();
}

// Update particle sizes
function updateParticleSizes() {
    for (let particle of particles) {
        particle.updateSize();
    }
}

// Update particle positions with audio integration
function updateParticles() {
    if (isPaused) return;
    
    // Rebuild spatial grid each frame for optimal performance
    spatialGrid.clear();
    
    // Insert all particles into spatial grid
    for (let i = 0; i < particles.length; i++) {
        spatialGrid.insertParticle(particles[i]);
    }
    
    // Update particles using spatial optimization
    for (let particle of particles) {
        particle.update();
    }
    
    // Update trail particles and remove expired ones
    updateTrailParticles();
    
    // Update audio system with new particle positions
    updateAudioSystem();
}

// Update trail particles and remove expired ones
function updateTrailParticles() {
    for (let i = trailParticles.length - 1; i >= 0; i--) {
        const trailParticle = trailParticles[i];
        const shouldRemove = trailParticle.updateTrailParticle();
        
        if (shouldRemove) {
            trailParticles.splice(i, 1);
        }
    }
}

// Remove all trail particles for a specific species (called when trail length set to 0)
function removeTrailParticlesForSpecies(speciesIndex) {
    for (let i = trailParticles.length - 1; i >= 0; i--) {
        if (trailParticles[i].species === speciesIndex) {
            trailParticles.splice(i, 1);
        }
    }
    console.log(`🧹 Cleared all trail particles for Species ${String.fromCharCode(65 + speciesIndex)}`);
}

// ===== RENDERING =====
// Render trail particles and species particles with temporal priority
function render() {
    // Get main canvas context
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Disable anti-aliasing for crisp effect
    ctx.imageSmoothingEnabled = false;
    
    // Step 1: Apply canvas fade only if any species have trails enabled
    let anyTrailsEnabled = false;
    for (let i = 0; i < speciesCount; i++) {
        const trailLength = speciesTrailLengths[i] !== undefined ? speciesTrailLengths[i] : 0.75;
        if (trailLength > 0.01) {
            anyTrailsEnabled = true;
            break;
        }
    }
    
    if (anyTrailsEnabled) {
        // Apply subtle fade for smoothing only when trails are active
        ctx.fillStyle = 'rgba(0, 0, 0, 0.02)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } else {
        // Complete clear when no trails are enabled
        ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }
    
    // Step 2: Render trail particles first (oldest to newest)
    ctx.globalCompositeOperation = 'source-over';
    
    // Sort trail particles by creation time (oldest first)
    const sortedTrailParticles = [...trailParticles].sort((a, b) => a.creationTime - b.creationTime);
    
    for (let trailParticle of sortedTrailParticles) {
        // Skip invisible trail particles
        if (trailParticle.alpha <= 0) continue;
        
        // Set alpha for this trail particle
        ctx.globalAlpha = trailParticle.alpha;
        
        // Get particle color
        const r = Math.round(trailParticle.color[0] * 255);
        const g = Math.round(trailParticle.color[1] * 255);
        const b = Math.round(trailParticle.color[2] * 255);
        
        // Render trail particle
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(trailParticle.x, trailParticle.y, trailParticle.size, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Step 3: Render current species particles at full opacity (newest last)
    ctx.globalAlpha = 1.0;
    
    // Sort species particles by age (oldest first, newest last)
    const sortedParticles = [...particles].sort((a, b) => a.age - b.age);
    
    for (let particle of sortedParticles) {
        // Get particle color
        const r = Math.round(particle.color[0] * 255);
        const g = Math.round(particle.color[1] * 255);
        const b = Math.round(particle.color[2] * 255);
        
        // Render species particle at full opacity
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.visualSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Add stroke for definition
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    
    // Reset alpha
    ctx.globalAlpha = 1.0;
}


// ===== ANIMATION LOOP =====
// Animation loop with FPS tracking
let lastFrameTime = performance.now();
let frameCount = 0;
let fpsUpdateTime = performance.now();
let frameTimeHistory = [];

function animate() {
    const currentTime = performance.now();
    const frameTime = currentTime - lastFrameTime;
    
    updateParticles();
    render();
    
    // Track frame time for performance metrics
    frameTimeHistory.push(frameTime);
    if (frameTimeHistory.length > 60) {
        frameTimeHistory.shift(); // Keep only last 60 frames
    }
    
    // FPS and performance tracking
    frameCount++;
    if (currentTime - fpsUpdateTime >= 500) { // Update every 500ms
        const fps = Math.round((frameCount * 1000) / (currentTime - fpsUpdateTime));
        const avgFrameTime = frameTimeHistory.reduce((a, b) => a + b, 0) / frameTimeHistory.length;
        
        // Update performance displays
        const fpsElement = document.getElementById('fps-display');
        if (fpsElement) fpsElement.textContent = fps;
        
        const frameTimeElement = document.getElementById('frame-time');
        if (frameTimeElement) frameTimeElement.textContent = `${avgFrameTime.toFixed(1)}ms`;
        
        const canvasSizeElement = document.getElementById('canvas-size');
        if (canvasSizeElement) canvasSizeElement.textContent = `${canvasWidth}×${canvasHeight}`;
        
        const totalParticlesElement = document.getElementById('total-particles');
        if (totalParticlesElement) totalParticlesElement.textContent = particles.length;
        
        const trailParticlesElement = document.getElementById('trail-particles');
        if (trailParticlesElement) trailParticlesElement.textContent = trailParticles.length;
        
        // Update grid info
        if (spatialGrid) {
            const gridInfo = `${spatialGrid.gridWidth}×${spatialGrid.gridHeight}`;
            const gridElement = document.getElementById('grid-info');
            if (gridElement) gridElement.textContent = gridInfo;
        }
        
        // Update audio grain count
        let totalGrains = 0;
        if (typeof speciesAudioSynths !== 'undefined' && speciesAudioSynths.length > 0) {
            for (let synth of speciesAudioSynths) {
                if (synth && synth.grains) {
                    totalGrains += synth.grains.length;
                }
            }
        }
        const totalGrainsElement = document.getElementById('total-grains');
        if (totalGrainsElement) totalGrainsElement.textContent = totalGrains;
        
        // Update audio latency
        const audioLatencyElement = document.getElementById('audio-latency');
        if (audioLatencyElement && typeof audioContext !== 'undefined' && audioContext) {
            const latency = (audioContext.baseLatency * 1000).toFixed(1) + 'ms';
            audioLatencyElement.textContent = latency;
        }
        
        // Update species tab info
        if (typeof updateSpeciesTabInfo === 'function') {
            updateSpeciesTabInfo();
        }
        
        frameCount = 0;
        fpsUpdateTime = currentTime;
    }
    
    lastFrameTime = currentTime;
    requestAnimationFrame(animate);
}

// ===== CONTROL FUNCTIONS =====
// Control functions
function resetSimulation() {
    // Clear main canvas
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Clear trail particles
    trailParticles = [];
    
    // Reset particles
    initParticles();
    isPaused = false;
}

function togglePause() {
    isPaused = !isPaused;
}

function updateParticleCountDisplay() {
    // This function is no longer needed but kept for compatibility
}

// Setup canvas mouse interaction for gravity
function setupCanvasInteraction() {
    const canvas = document.getElementById('canvas');
    
    canvas.addEventListener('mousedown', (e) => {
        if (GRAVITY_STRENGTH > 0) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            gravityPoint.x = x;
            gravityPoint.y = y;
            gravityPoint.active = true;
            isMouseDown = true;
            
            console.log(`🌍 Gravity point activated at (${Math.round(x)}, ${Math.round(y)})`);
        }
        e.preventDefault();
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isMouseDown && GRAVITY_STRENGTH > 0) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            gravityPoint.x = x;
            gravityPoint.y = y;
        }
        e.preventDefault();
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (isMouseDown) {
            gravityPoint.active = false;
            isMouseDown = false;
            console.log('🌍 Gravity point deactivated');
        }
        e.preventDefault();
    });
    
    canvas.addEventListener('mouseleave', (e) => {
        if (isMouseDown) {
            gravityPoint.active = false;
            isMouseDown = false;
            console.log('🌍 Gravity point deactivated (mouse left canvas)');
        }
    });
    
    // Update cursor based on gravity setting
    function updateCanvasCursor() {
        if (GRAVITY_STRENGTH > 0) {
            canvas.style.cursor = 'crosshair';
        } else {
            canvas.style.cursor = 'default';
        }
    }
    
    // Update cursor initially and when gravity changes
    updateCanvasCursor();
    
    // Update cursor when gravity strength changes
    document.getElementById('gravityStrength').addEventListener('input', updateCanvasCursor);
}