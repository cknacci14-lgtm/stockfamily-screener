#!/bin/bash
# Cloudflare Pages build script
# Skip heavy dependencies (puppeteer, express, dll)

echo "=== Cloudflare Pages Build ==="
echo "Skip npm install — package.json not needed for Hono functions"
echo "Static files in ./public will be served as-is"
echo "Functions in ./functions will be bundled by Wrangler"
echo ""
echo "Dependencies needed by functions: hono (bundled by Wrangler at runtime)"
echo ""
echo "=== Build complete ==="