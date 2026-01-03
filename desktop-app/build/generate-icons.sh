#!/bin/bash
# Generate app icons from a source PNG
# Usage: ./generate-icons.sh source.png

SOURCE=$1

if [ -z "$SOURCE" ]; then
  echo "Usage: ./generate-icons.sh source.png"
  echo "The source should be a 1024x1024 PNG"
  exit 1
fi

# macOS icon sizes
mkdir -p icon.iconset
sips -z 16 16     "$SOURCE" --out icon.iconset/icon_16x16.png
sips -z 32 32     "$SOURCE" --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     "$SOURCE" --out icon.iconset/icon_32x32.png
sips -z 64 64     "$SOURCE" --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   "$SOURCE" --out icon.iconset/icon_128x128.png
sips -z 256 256   "$SOURCE" --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   "$SOURCE" --out icon.iconset/icon_256x256.png
sips -z 512 512   "$SOURCE" --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   "$SOURCE" --out icon.iconset/icon_512x512.png
sips -z 1024 1024 "$SOURCE" --out icon.iconset/icon_512x512@2x.png

# Create .icns file
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset

# Copy to icon.png for electron
cp "$SOURCE" icon.png

echo "Icons generated: icon.icns, icon.png"
echo "For Windows .ico, use an online converter or ImageMagick"
