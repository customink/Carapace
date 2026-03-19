#!/bin/bash
# Fix macOS Gatekeeper for Carapace
# Run this once after installing: ./fix-gatekeeper.sh

APP="/Applications/Carapace.app"

if [ ! -d "$APP" ]; then
  echo "Carapace.app not found in /Applications"
  echo "Please drag Carapace to Applications first, then run this script."
  exit 1
fi

echo "Removing quarantine attribute from Carapace..."
xattr -cr "$APP"
echo "Done! You can now open Carapace normally."
