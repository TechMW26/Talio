import AppKit
import ApplicationServices

func output(_ value: [String: Any]) { let data = try! JSONSerialization.data(withJSONObject: value); print(String(data: data, encoding: .utf8)!) }
guard CommandLine.arguments.count == 2, let data = CommandLine.arguments[1].data(using: .utf8), let action = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = action["type"] as? String else { output(["success": false]); exit(1) }
let front = NSWorkspace.shared.frontmostApplication
if type == "status" { let point = CGEvent(source:nil)?.location ?? .zero; output(["success": true, "accessibility": AXIsProcessTrusted(), "app": front?.localizedName ?? "Unknown", "pid": front?.processIdentifier ?? 0,"x":point.x,"y":point.y]); exit(0) }
guard AXIsProcessTrusted() else { output(["success": false, "message": "Enable Accessibility for Talio in System Settings."]); exit(0) }
func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down); event?.flags = flags; event?.post(tap: .cghidEventTap) }
}
switch type {
case "click":
    guard let x = action["x"] as? Double, let y = action["y"] as? Double else { exit(1) }
    let point = CGPoint(x: x, y: y)
    let start = CGEvent(source: nil)?.location ?? point
    for step in 1...12 {
        let t = Double(step) / 12.0
        let eased = t * t * (3 - 2 * t)
        let intermediate = CGPoint(x: start.x + (point.x - start.x) * eased, y: start.y + (point.y - start.y) * eased)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: intermediate, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(16000)
    }
    for kind in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(50000) }
case "type":
    guard let text = action["text"] as? String, text.count <= 2000 else { exit(1) }
    let chars = Array(text.utf16)
    for offset in stride(from: 0, to: chars.count, by: 20) {
        let chunk = Array(chars[offset..<min(offset + 20, chars.count)])
        for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down); event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk); event?.post(tap: .cghidEventTap) }
    }
case "key":
    let keys: [String: CGKeyCode] = ["enter":36,"tab":48,"escape":53,"backspace":51,"up":126,"down":125,"left":123,"right":124,"select_all":0,"copy":8,"paste":9,"find":3]
    guard let name = action["key"] as? String, let code = keys[name] else { exit(1) }
    key(code, ["select_all","copy","paste","find"].contains(name) ? .maskCommand : [])
case "scroll":
    guard let amount = action["amount"] as? Int, abs(amount) <= 10 else { exit(1) }
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(-amount), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
case "lock": key(12, [.maskCommand, .maskControl])
case "open_app":
    guard let name = action["name"] as? String else { exit(1) }
    if let running = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName?.caseInsensitiveCompare(name) == .orderedSame && $0.activationPolicy == .regular }) {
        running.unhide()
        let activated = running.activate(options: [.activateAllWindows])
        output(["success": activated, "message": activated ? "Existing application brought to front; verify the screen." : "Application could not be focused."])
        exit(0)
    }
    let roots = ["/Applications", NSHomeDirectory() + "/Applications", "/System/Applications", "/System/Applications/Utilities"]
    let matches = roots.flatMap { root -> [URL] in
        ((try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []).filter { $0.hasSuffix(".app") && String($0.dropLast(4)).caseInsensitiveCompare(name) == .orderedSame }.map { URL(fileURLWithPath: root).appendingPathComponent($0) }
    }
    guard let app = matches.first else { output(["success":false,"notInstalled":true,"message":"No installed app matched that exact name."]); exit(0) }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
        output(["success":error == nil,"message":error == nil ? "Application opened." : "The application could not be opened."]); exit(0)
    }
    RunLoop.main.run()
default: output(["success":false]); exit(1)
}
usleep(50000)
output(["success":true,"message":"Input delivered; verify the updated screen."])
