/**
 * Build System - Combines all modular components for testing and development
 * Creates a development server and handles module bundling
 */

import { createServer } from 'http';
import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

async function serveFile(filePath) {
    try {
        const content = await readFile(filePath);
        const ext = extname(filePath);
        const mimeType = MIME_TYPES[ext] || 'text/plain';
        return { content, mimeType };
    } catch (error) {
        throw new Error(`File not found: ${filePath}`);
    }
}

async function listDirectory(dirPath) {
    try {
        const files = await readdir(dirPath);
        const fileList = [];

        for (const file of files) {
            const fullPath = join(dirPath, file);
            const stats = await stat(fullPath);
            fileList.push({
                name: file,
                isDirectory: stats.isDirectory(),
                size: stats.size,
                modified: stats.mtime
            });
        }

        return fileList;
    } catch (error) {
        throw new Error(`Directory not found: ${dirPath}`);
    }
}

function generateDirectoryListing(path, files) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Directory: ${path}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #1a1a1a; color: #fff; }
        h1 { color: #4CAF50; }
        .file { margin: 5px 0; }
        .directory { color: #64B5F6; }
        .file-name { text-decoration: none; color: inherit; }
        .file-name:hover { text-decoration: underline; }
        .file-size { color: #999; margin-left: 20px; }
        .back { margin-bottom: 20px; }
        .back a { color: #4CAF50; text-decoration: none; }
        .back a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Granular Particle Synth - Directory: ${path}</h1>
    ${path !== '/' ? '<div class="back"><a href="../">← Back</a></div>' : ''}
    <div>
        ${files.map(file => `
            <div class="file ${file.isDirectory ? 'directory' : ''}">
                <a href="${file.name}${file.isDirectory ? '/' : ''}" class="file-name">
                    ${file.isDirectory ? '📁' : '📄'} ${file.name}
                </a>
                ${!file.isDirectory ? `<span class="file-size">(${(file.size / 1024).toFixed(1)} KB)</span>` : ''}
            </div>
        `).join('')}
    </div>
</body>
</html>`;
    return html;
}

const server = createServer(async (req, res) => {
    try {
        let requestPath = req.url === '/' ? '/index.html' : req.url;

        // Remove query string
        const queryIndex = requestPath.indexOf('?');
        if (queryIndex !== -1) {
            requestPath = requestPath.substring(0, queryIndex);
        }

        // Resolve file path
        const filePath = join(__dirname, requestPath);

        // Security check - prevent directory traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

        try {
            const stats = await stat(filePath);

            if (stats.isDirectory()) {
                // Check for index.html in directory
                const indexPath = join(filePath, 'index.html');
                try {
                    const { content, mimeType } = await serveFile(indexPath);
                    res.writeHead(200, { 'Content-Type': mimeType });
                    res.end(content);
                } catch {
                    // Generate directory listing
                    const files = await listDirectory(filePath);
                    const html = generateDirectoryListing(requestPath, files);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html);
                }
            } else {
                // Serve file
                const { content, mimeType } = await serveFile(filePath);
                res.writeHead(200, { 'Content-Type': mimeType });
                res.end(content);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
    }
});

server.listen(PORT, () => {
    console.log('🚀 Granular Particle Synth Development Server');
    console.log('================================================');
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${__dirname}`);
    console.log('📋 Available endpoints:');
    console.log(`   • http://localhost:${PORT}/           - Main application`);
    console.log(`   • http://localhost:${PORT}/js/        - JavaScript modules`);
    console.log(`   • http://localhost:${PORT}/styles/    - CSS stylesheets`);
    console.log('');
    console.log('💡 To test the modularized system:');
    console.log('   1. Open http://localhost:${PORT} in your browser');
    console.log('   2. Test all functionality matches the original HTML file');
    console.log('   3. Check browser console for any module loading errors');
    console.log('');
    console.log('⚡ Hot reload: Restart server to pick up file changes');
    console.log('🛑 Press Ctrl+C to stop the server');
    console.log('================================================');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\\n🛑 Shutting down development server...');
    server.close(() => {
        console.log('✅ Server stopped gracefully');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\\n🛑 Received SIGTERM, shutting down...');
    server.close(() => {
        console.log('✅ Server stopped gracefully');
        process.exit(0);
    });
});