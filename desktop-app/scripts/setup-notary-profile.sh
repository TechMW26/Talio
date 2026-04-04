#!/usr/bin/env bash

set -euo pipefail

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required to configure Apple notarization credentials."
  exit 1
fi

if ! xcrun notarytool --help >/dev/null 2>&1; then
  echo "xcrun notarytool is not available on this machine."
  exit 1
fi

default_profile="talio-notary"
read -r -p "Notary profile name [${default_profile}]: " profile_name
profile_name="${profile_name:-$default_profile}"

read -r -p "Apple ID email: " apple_id
read -r -p "Apple Team ID: " apple_team_id
read -r -s -p "App-specific password: " apple_password
echo

if [[ -z "$apple_id" || -z "$apple_team_id" || -z "$apple_password" ]]; then
  echo "Apple ID, Team ID, and app-specific password are all required."
  exit 1
fi

xcrun notarytool store-credentials "$profile_name" \
  --apple-id "$apple_id" \
  --team-id "$apple_team_id" \
  --password "$apple_password"

echo
echo "Stored notarization credentials successfully."
echo "Use this in future builds:"
echo "  export APPLE_KEYCHAIN_PROFILE=\"$profile_name\""