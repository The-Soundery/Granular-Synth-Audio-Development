/**
 * Particle System - Main particles with physics simulation and trail particles for visual effects
 */

import { CONFIG, state } from '../config.js';

/**
 * Calculate force falloff using different curve modes
 * @param {number} distance - Normalized distance (0-1)
 * @param {number} forceStrength - Base force strength from relationship matrix
 * @returns {number} Final force value
 */
function calculateForceCurve(distance, forceStrength) {
    const mode = CONFIG.physics.forceCurveMode;

    switch(mode) {
        case 'piecewise': {
            // Piecewise force curve inspired by Tom Mohr's particle-life
            const repulsionZone = CONFIG.physics.piecewise.repulsionZone;
            const attractionZone = CONFIG.physics.piecewise.attractionZone;

            if (distance < repulsionZone) {
                // Strong repulsion in close range
                const normalized = distance / repulsionZone;
                const repulsionForce = (normalized - 1.0) * CONFIG.physics.piecewise.repulsionStrength;
                return repulsionForce; // Always negative (repulsion)
            } else if (distance < attractionZone) {
                // Attraction/interaction zone
                const normalized = (distance - repulsionZone) / (attractionZone - repulsionZone);
                const falloff = 1.0 - normalized;
                return forceStrength * falloff * falloff * CONFIG.physics.piecewise.attractionStrength;
            } else {
                // Weak interaction zone
                const normalized = (distance - attractionZone) / (1.0 - attractionZone);
                const falloff = 1.0 - normalized;
                return forceStrength * falloff * falloff * 0.2; // 20% strength
            }
        }

        case 'beta': {
            // Beta function force curve - creates smooth attraction/repulsion with equilibrium point
            const eq = CONFIG.physics.beta.equilibriumDistance;
            const power = CONFIG.physics.beta.power;
            const deviation = Math.abs(distance - eq);
            const normalized = Math.pow(2 * deviation, power);
            const sign = distance < eq ? -1 : 1; // Repulsion when too close, attraction when far
            return forceStrength * (normalized - 1) * sign;
        }

        case 'classic':
        default: {
            // Original quadratic falloff
            const falloff = 1.0 - distance;
            return forceStrength * falloff * falloff;
        }
    }
}

// Particle class with motion blur trails
export class Particle {
    constructor(species) {
        this.species = species;
        this.x = Math.random() * CONFIG.canvas.width;
        this.y = Math.random() * CONFIG.canvas.height;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.updateSize();
        this.color = [...CONFIG.species.colors[species]];
        this.age = 0;
        this.velocityMagnitude = 0;
        this.velocityMagnitudeSquared = 0;

        // Audio-specific properties
        this.audioId = Math.random().toString(36).substr(2, 9); // Unique ID for audio tracking

        // Trail spawning optimization - track last spawn position
        this.lastTrailX = this.x;
        this.lastTrailY = this.y;
    }

    updateSize() {
        this.size = CONFIG.species.sizes[this.species];
        this.visualSize = this.size >= 10 ? this.size * 1.5 : this.size;
    }

    update() {
        // Store old position for movement detection
        const oldX = this.x;
        const oldY = this.y;

        // Calculate forces from nearby particles only (using spatial grid)
        let fx = 0;
        let fy = 0;

        // Get nearby particles from spatial grid instead of all particles
        const nearbyParticles = state.spatialGrid.getNearbyParticles(this.x, this.y);

        for (let i = 0; i < nearbyParticles.length; i++) {
            const other = nearbyParticles[i];
            if (other === this) continue;

            // Calculate distance with toroidal wrapping (if enabled)
            let dx = other.x - this.x;
            let dy = other.y - this.y;

            // Handle toroidal space - find shortest distance across wrapping edges
            if (CONFIG.physics.toroidalSpace) {
                if (Math.abs(dx) > CONFIG.canvas.width / 2) {
                    dx = dx > 0 ? dx - CONFIG.canvas.width : dx + CONFIG.canvas.width;
                }
                if (Math.abs(dy) > CONFIG.canvas.height / 2) {
                    dy = dy > 0 ? dy - CONFIG.canvas.height : dy + CONFIG.canvas.height;
                }
            }

            let distance = Math.sqrt(dx * dx + dy * dy);

            // Skip if particles are at exact same position
            if (distance < 1) continue;

            // Normalize direction vector once (reused for both collision and force calculations)
            let normalizedDx = dx / distance;
            let normalizedDy = dy / distance;

            // Calculate collision distance using visual sizes to prevent visual overlap
            let collisionDistance = this.visualSize + other.visualSize;

            // Handle collision - push particles apart if they're overlapping
            if (distance < collisionDistance) {
                let overlap = collisionDistance - distance;
                let separationForce = overlap * 1.0; // Increased separation strength

                // Apply separation force (push away from each other)
                fx -= separationForce * normalizedDx;
                fy -= separationForce * normalizedDy;

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
            if (distance > CONFIG.physics.maxForceDistance) continue;

            // Get force strength from relationship matrix
            let forceStrength = CONFIG.relationships[this.species][other.species];

            // Calculate force using selected curve mode
            const normalizedDistance = distance / CONFIG.physics.maxForceDistance;
            let force = calculateForceCurve(normalizedDistance, forceStrength);

            // Apply radial force components
            fx += force * normalizedDx;
            fy += force * normalizedDy;

            // Add orbital/tangential force if enabled
            if (CONFIG.physics.enableOrbitalForces) {
                // Tangential force perpendicular to radial direction
                // Creates rotation/vortex effects
                const tangentialForce = CONFIG.physics.orbitalStrength * force;
                fx += tangentialForce * (-normalizedDy); // Perpendicular component
                fy += tangentialForce * normalizedDx;
            }
        }

        // Apply gravity force if active
        if (state.gravityPoint.active && CONFIG.physics.gravityStrength > 0) {
            const gravityDx = state.gravityPoint.x - this.x;
            const gravityDy = state.gravityPoint.y - this.y;
            const gravityDistance = Math.sqrt(gravityDx * gravityDx + gravityDy * gravityDy);

            if (gravityDistance > 1) {
                const minDistance = 10;
                const effectiveDistance = Math.max(gravityDistance, minDistance);
                const gravityForce = CONFIG.physics.gravityStrength / (effectiveDistance * effectiveDistance) * 5000;

                const normalizedGravityDx = gravityDx / gravityDistance;
                const normalizedGravityDy = gravityDy / gravityDistance;

                fx += gravityForce * normalizedGravityDx;
                fy += gravityForce * normalizedGravityDy;
            }
        }

        // Velocity Verlet Integration (more accurate) or Euler (faster)
        if (CONFIG.physics.useVerletIntegration) {
            // Verlet: half-step velocity update
            const dt = CONFIG.physics.simulationSpeed * 0.1;
            const halfVx = this.vx + fx * dt * 0.5;
            const halfVy = this.vy + fy * dt * 0.5;

            // Update position with half-step velocity
            this.x += halfVx * CONFIG.physics.simulationSpeed;
            this.y += halfVy * CONFIG.physics.simulationSpeed;

            // Complete velocity update (will be done in next frame with new forces)
            this.vx = halfVx + fx * dt * 0.5;
            this.vy = halfVy + fy * dt * 0.5;
        } else {
            // Standard Euler integration
            this.vx += fx * 0.1 * CONFIG.physics.simulationSpeed;
            this.vy += fy * 0.1 * CONFIG.physics.simulationSpeed;

            // Update position (scaled by simulation speed)
            this.x += this.vx * CONFIG.physics.simulationSpeed;
            this.y += this.vy * CONFIG.physics.simulationSpeed;
        }

        // Calculate velocity magnitude for friction and speed limiting
        this.velocityMagnitudeSquared = this.vx * this.vx + this.vy * this.vy;
        this.velocityMagnitude = Math.sqrt(this.velocityMagnitudeSquared);

        // Apply dynamic friction (velocity-dependent) or constant friction
        if (CONFIG.physics.useDynamicFriction) {
            // Faster particles experience more drag
            const dynamicFriction = CONFIG.physics.friction - (this.velocityMagnitude * CONFIG.physics.dynamicFrictionScale);
            const effectiveFriction = Math.max(0.85, Math.min(dynamicFriction, CONFIG.physics.friction));
            this.vx *= effectiveFriction;
            this.vy *= effectiveFriction;
        } else {
            // Constant friction
            this.vx *= CONFIG.physics.friction;
            this.vy *= CONFIG.physics.friction;
        }

        // Recalculate velocity magnitude after friction
        this.velocityMagnitudeSquared = this.vx * this.vx + this.vy * this.vy;
        this.velocityMagnitude = Math.sqrt(this.velocityMagnitudeSquared);

        // Limit maximum speed using cached velocity
        if (this.velocityMagnitude > CONFIG.physics.maxSpeed) {
            const scale = CONFIG.physics.maxSpeed / this.velocityMagnitude;
            this.vx *= scale;
            this.vy *= scale;
            this.velocityMagnitude = CONFIG.physics.maxSpeed;
            this.velocityMagnitudeSquared = CONFIG.physics.maxSpeed * CONFIG.physics.maxSpeed;
        }

        // Handle boundary conditions based on toroidal space setting
        if (CONFIG.physics.toroidalSpace) {
            if (this.x < 0) this.x += CONFIG.canvas.width;
            if (this.x > CONFIG.canvas.width) this.x -= CONFIG.canvas.width;
            if (this.y < 0) this.y += CONFIG.canvas.height;
            if (this.y > CONFIG.canvas.height) this.y -= CONFIG.canvas.height;
        } else {
            if (this.x < this.size) {
                this.x = this.size;
                this.vx = Math.abs(this.vx) * CONFIG.physics.bounceDamping;
            }
            if (this.x > CONFIG.canvas.width - this.size) {
                this.x = CONFIG.canvas.width - this.size;
                this.vx = -Math.abs(this.vx) * CONFIG.physics.bounceDamping;
            }
            if (this.y < this.size) {
                this.y = this.size;
                this.vy = Math.abs(this.vy) * CONFIG.physics.bounceDamping;
            }
            if (this.y > CONFIG.canvas.height - this.size) {
                this.y = CONFIG.canvas.height - this.size;
                this.vy = -Math.abs(this.vy) * CONFIG.physics.bounceDamping;
            }
        }

        // Spawn trail particle based on distance traveled (ensures continuous coverage)
        const speciesTrailLength = CONFIG.species.trailLengths[this.species] || 0.0;

        if (speciesTrailLength > 0.01) {
            // Calculate distance moved since last trail spawn
            const dx = this.x - this.lastTrailX;
            const dy = this.y - this.lastTrailY;
            const distanceMoved = Math.sqrt(dx * dx + dy * dy);

            // Spawn threshold: 50% of particle size (ensures overlap, no gaps)
            // This gives smooth trails while reducing spawns by 50-80% vs every frame
            const spawnThreshold = this.visualSize * 0.5;

            if (distanceMoved >= spawnThreshold) {
                state.trailParticles.push(new TrailParticle(
                    this.x, this.y, this.species, this.color, this.visualSize, this.audioId
                ));

                // Update last spawn position
                this.lastTrailX = this.x;
                this.lastTrailY = this.y;
            }
        }

        // Simple age increment for temporal sorting
        this.age++;
    }
}

// TrailParticle class - lightweight, visual-only particles for trail effects
export class TrailParticle {
    constructor(x, y, species, color, size, parentAudioId) {
        // Position (fixed - trail particles don't move)
        this.x = x;
        this.y = y;

        // Visual properties inherited from parent particle
        this.species = species;
        this.color = [...color];
        this.size = size;

        // Parent particle reference for voice activity tracking
        this.parentAudioId = parentAudioId;

        // Trail-specific properties
        this.creationTime = performance.now();
        this.age = 0;
        this.alpha = 1.0; // Start fully visible
    }

    updateTrailParticle() {
        const currentTime = performance.now();
        this.age = currentTime - this.creationTime;

        const speciesTrailLength = CONFIG.species.trailLengths[this.species] || 0.0;

        if (speciesTrailLength <= 0.01) {
            this.alpha = 0;
            return true;
        }

        const maxFadeTime = 2000;
        const fadeTime = speciesTrailLength * maxFadeTime;
        this.alpha = Math.max(0, 1.0 - (this.age / fadeTime));

        return this.alpha <= 0;
    }
}