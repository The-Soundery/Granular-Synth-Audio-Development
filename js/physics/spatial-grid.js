/**
 * Spatial Grid System for O(N) force calculation optimization
 * Divides the simulation space into a grid to efficiently find nearby particles
 */

export class SpatialGrid {
    constructor(canvasWidth, canvasHeight, cellSize) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.cellSize = cellSize;

        // Calculate grid dimensions
        this.gridWidth = Math.ceil(canvasWidth / cellSize);
        this.gridHeight = Math.ceil(canvasHeight / cellSize);

        // Create 2D grid array - each cell contains array of particles
        this.grid = Array(this.gridWidth * this.gridHeight).fill(null).map(() => []);

        console.log(`Spatial Grid: ${this.gridWidth}x${this.gridHeight} cells, cell size: ${cellSize}`);
    }

    // Convert world coordinates to grid coordinates
    worldToGrid(x, y) {
        // Handle toroidal wrapping
        x = ((x % this.canvasWidth) + this.canvasWidth) % this.canvasWidth;
        y = ((y % this.canvasHeight) + this.canvasHeight) % this.canvasHeight;

        const gridX = Math.floor(x / this.cellSize);
        const gridY = Math.floor(y / this.cellSize);

        return { x: gridX, y: gridY };
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
            this.grid = Array(newSize).fill(null).map(() => []);
            console.log(`Spatial Grid resized: ${this.gridWidth}x${this.gridHeight} cells`);
        } else {
            // Same size but different cell dimensions - clear old data
            this.clear();
        }
    }
}