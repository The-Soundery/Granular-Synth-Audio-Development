#!/bin/bash

# GitHub Pages Deployment Script for Granular Particle Synth
#
# DEPLOYMENT ARCHITECTURE:
# This project uses a two-branch system to separate development from production:
#   - main branch: Development code (all source files, build tools, docs)
#   - gh-pages branch: Production deployment (only runtime files)
#
# WHAT THIS SCRIPT DOES:
# 1. Packages only production files (HTML, JS, CSS, favicon)
# 2. Switches to gh-pages branch (creates if needed)
# 3. Replaces all files with new deployment
# 4. Force-pushes to origin/gh-pages
# 5. Returns to your original branch
#
# IMPORTANT: Changes to main branch do NOT automatically update the live site.
# You must run this script (npm run deploy) after every change you want published.
#
# Live Site: https://the-soundery.github.io/Granular-Synth-Audio-Development/

set -e  # Exit on error

echo "🚀 Deploying to GitHub Pages..."

# Check if we're in a git repository
if [ ! -d .git ]; then
    echo "❌ Error: Not a git repository. Please run 'git init' first."
    exit 1
fi

# Check if there are uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo "⚠️  Warning: You have uncommitted changes."
    echo "   It's recommended to commit your changes before deploying."
    read -p "   Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Deployment cancelled."
        exit 1
    fi
fi

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "📍 Current branch: $CURRENT_BRANCH"

# Create a temporary directory for deployment
TEMP_DIR=$(mktemp -d)
echo "📦 Creating deployment package in $TEMP_DIR..."

# Copy all necessary files to temp directory
# Important: Preserve directory structure (styles/, js/) for correct file paths
cp index.html "$TEMP_DIR/" 2>/dev/null || true
cp favicon.ico "$TEMP_DIR/" 2>/dev/null || true
cp .nojekyll "$TEMP_DIR/" 2>/dev/null || true
cp -r js/ "$TEMP_DIR/js/" 2>/dev/null || true
cp -r styles/ "$TEMP_DIR/styles/" 2>/dev/null || true

# Check if gh-pages branch exists
if git show-ref --verify --quiet refs/heads/gh-pages; then
    echo "✓ gh-pages branch exists"
    # Switch to gh-pages branch
    git checkout gh-pages

    # Remove old files (but keep .git)
    find . -maxdepth 1 ! -name '.git' ! -name '.' ! -name '..' -exec rm -rf {} +
else
    echo "📝 Creating gh-pages branch..."
    # Create orphan gh-pages branch
    git checkout --orphan gh-pages

    # Remove all files from staging
    git rm -rf . 2>/dev/null || true
fi

# Copy deployment files from temp directory
cp -r "$TEMP_DIR"/* .

# Add all files
git add -A

# Create commit
COMMIT_MSG="Deploy to GitHub Pages - $(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "$COMMIT_MSG" || echo "No changes to commit"

# Push to gh-pages
echo "📤 Pushing to gh-pages branch..."
git push origin gh-pages --force

# Switch back to original branch
git checkout "$CURRENT_BRANCH"

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your site will be available at:"
echo "   https://the-soundery.github.io/Granular-Synth-Audio-Development/"
echo ""
echo "⏱️  Note: It may take a few minutes for GitHub Pages to build and deploy."
echo "   Check your repository settings > Pages for deployment status."
echo ""
