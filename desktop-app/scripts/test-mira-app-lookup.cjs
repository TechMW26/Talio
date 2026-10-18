'use strict';
// Read-only native lookup acceptance: never launches an app or sends UI input.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
if (process.platform !== 'darwin') { console.log('macOS app lookup test skipped on this platform.'); process.exit(0); }
const source = fs.readFileSync(path.join(__dirname, '../src/miraControl.swift'), 'utf8');
const functions = source.slice(source.indexOf('func appKey('), source.indexOf('func attribute('));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talio-app-lookup-'));
const fixture = `import AppKit
${functions}
let root = URL(fileURLWithPath: CommandLine.arguments[1])
func fixture(_ relative: String, _ display: String) {
    let contents = root.appendingPathComponent(relative).appendingPathComponent("Contents")
    try! FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
    let info = ["CFBundleDisplayName": display, "CFBundleName": display, "CFBundlePackageType": "APPL", "CFBundleIdentifier": "test." + UUID().uuidString]
    let bytes = try! PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    try! bytes.write(to: contents.appendingPathComponent("Info.plist"))
}
fixture("Chrome Apps.localized/YouTube Music.app", "YouTube Music")
fixture("Vendor/Editor.app", "Code Studio")
fixture("Decoy.app/Contents/Nested.app", "Hidden Internal App")
fixture("Extra/YouTube Music Player.app", "YouTube Music Player")
let roots = [root.path]
assert(installedAppMatches("youtube music", roots: roots).count == 1)
assert(installedAppMatches("YouTube-Music", roots: roots).count == 1)
assert(installedAppMatches("Code Studio", roots: roots).count == 1)
assert(installedAppMatches("YouTube", roots: roots).isEmpty)
assert(installedAppMatches("Hidden Internal App", roots: roots).isEmpty)
assert(installedAppMatches("Missing", roots: roots).isEmpty)
fixture("Other/YouTube Music.app", "YouTube Music")
assert(installedAppMatches("YouTube Music", roots: roots).count == 2)
print("7 native lookup fixture assertions passed")
if CommandLine.arguments.count > 2 {
    let started = Date()
    let matches = installedAppMatches(CommandLine.arguments[2], roots: applicationRoots)
    print("Installed lookup: \\(matches.map { $0.path }); \\(Int(Date().timeIntervalSince(started) * 1000)) ms")
    assert(matches.count == 1, "Expected one installed application")
}
`;
try {
  const swift = path.join(tmp, 'main.swift'), binary = path.join(tmp, 'lookup');
  fs.writeFileSync(swift, fixture);
  execFileSync('xcrun', ['swiftc', '-O', swift, '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [path.join(tmp, 'Applications'), ...process.argv.slice(2)], { stdio: 'inherit' });
} finally {
  // Only the unique test directory created by this script is removed.
  fs.rmSync(tmp, { recursive: true, force: true });
}
