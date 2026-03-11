#!/bin/bash
set -e

# Carapace — Visual terminal wrapper for Claude Code
# This script installs dependencies and builds the app.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "  Carapace Installer"
echo "  ==================="
echo ""

# ─── Check prerequisites ───

# Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}Error: Node.js is not installed.${NC}"
  echo "Install it from https://nodejs.org/ or via Homebrew: brew install node"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Error: Node.js >= 18 is required (found $(node -v)).${NC}"
  echo "Update via: brew upgrade node  or  nvm install 18"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  echo -e "${RED}Error: npm is not installed.${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm -v)"

# Python (needed by node-gyp to build node-pty)
if command -v python3 &>/dev/null; then
  echo -e "${GREEN}✓${NC} Python3 $(python3 --version 2>&1 | awk '{print $2}')"
elif command -v python &>/dev/null; then
  echo -e "${GREEN}✓${NC} Python $(python --version 2>&1 | awk '{print $2}')"
else
  echo -e "${YELLOW}Warning: Python not found. node-pty requires Python for native compilation.${NC}"
  echo "Install via: brew install python3  or  xcode-select --install"
fi

# Xcode Command Line Tools (macOS — needed for node-gyp)
if [ "$(uname)" = "Darwin" ]; then
  if xcode-select -p &>/dev/null; then
    echo -e "${GREEN}✓${NC} Xcode Command Line Tools"
  else
    echo -e "${YELLOW}Warning: Xcode CLT not found. Installing...${NC}"
    xcode-select --install 2>/dev/null || true
    echo "After installation completes, re-run this script."
    exit 1
  fi
fi

# Claude Code CLI
if command -v claude &>/dev/null; then
  echo -e "${GREEN}✓${NC} Claude Code CLI ($(which claude))"
else
  echo -e "${YELLOW}Warning: 'claude' CLI not found in PATH.${NC}"
  echo "  Carapace will still build, but sessions require the Claude Code CLI."
  echo "  Install via: npm install -g @anthropic-ai/claude-code"
fi

echo ""

# ─── Install dependencies ───

echo "Installing dependencies..."
npm install
echo ""

# ─── Build ───

echo "Building production bundle..."
npm run build
echo ""

# ─── Done ───

echo -e "${GREEN}✓ Carapace is ready!${NC}"
echo ""
echo "  Run the app:"
echo "    npx electron out/main/index.js"
echo ""
echo "  Or in development mode:"
echo "    npm run dev"
echo ""
