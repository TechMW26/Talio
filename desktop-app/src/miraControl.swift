import AppKit
import ApplicationServices

func output(_ value: [String: Any]) { let data = try! JSONSerialization.data(withJSONObject: value); print(String(data: data, encoding: .utf8)!) }
// Some installed apps prefix their display names with invisible bidi marks.
func appKey(_ name: String) -> String {
    String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && ![0x200B, 0x200E, 0x200F, 0xFEFF].contains(Int($0.value)) }).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}
guard CommandLine.arguments.count == 2, let data = CommandLine.arguments[1].data(using: .utf8), let action = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = action["type"] as? String else { output(["success": false]); exit(1) }
let front = NSWorkspace.shared.frontmostApplication
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?; AXUIElementCopyAttributeValue(element, name as CFString, &value); return value
}
func windows(_ pid: pid_t) -> [AXUIElement] { attribute(AXUIElementCreateApplication(pid), kAXWindowsAttribute) as? [AXUIElement] ?? [] }
func geometry(_ window: AXUIElement) -> [String: Double]? {
    guard let p = attribute(window, kAXPositionAttribute), let s = attribute(window, kAXSizeAttribute), CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
    return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}
func resize(_ window: AXUIElement, _ frame: [String: Double]) -> Bool {
    guard let x = frame["x"], let y = frame["y"], let width = frame["width"], let height = frame["height"] else { return false }
    var point = CGPoint(x: x, y: y), size = CGSize(width: width, height: height)
    let p = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &point)!)
    let s = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!)
    return p == .success && s == .success
}
if let session = CGSessionCopyCurrentDictionary() as? [String: Any], session["CGSSessionScreenIsLocked"] as? Bool == true {
    output(["success": false, "message": "Unlock your Mac before using desktop controls."]); exit(0)
}
if type == "status" {
    let point = CGEvent(source:nil)?.location ?? .zero
    var result: [String: Any] = ["success": true, "accessibility": AXIsProcessTrusted(), "app": front?.localizedName ?? "Unknown", "pid": front?.processIdentifier ?? 0,"x":point.x,"y":point.y]
    result["keyIdleSeconds"] = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
    if let pid = front?.processIdentifier, let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) {
        let window = focused as! AXUIElement
        if let index = windows(pid).firstIndex(where: { CFEqual($0, window) }), let frame = geometry(window) {
            result["windowId"] = "\(pid):\(index)"
            result["frame"] = frame
            result["center"] = ["x": frame["x"]! + frame["width"]! / 2, "y": frame["y"]! + frame["height"]! / 2]
        }
    }
    output(result); exit(0)
}
guard AXIsProcessTrusted() else { output(["success": false, "message": "Enable Accessibility for Talio in System Settings."]); exit(0) }
func key(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down); event?.flags = flags; event?.post(tap: .cghidEventTap) }
}
switch type {
case "prepare_window":
    guard let pid = front?.processIdentifier, let focused = attribute(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute) else { output(["success":false]); exit(0) }
    let window = focused as! AXUIElement
    guard let index = windows(pid).firstIndex(where: { CFEqual($0, window) }), let frame = geometry(window), attribute(window, kAXSubroleAttribute) as? String == kAXStandardWindowSubrole else { output(["success":false]); exit(0) }
    if attribute(window, "AXFullScreen") as? Bool == true { output(["success":true]); exit(0) }
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    let center = CGPoint(x: frame["x"]! + frame["width"]! / 2, y: top - frame["y"]! - frame["height"]! / 2)
    guard let display = NSScreen.screens.first(where: { $0.frame.contains(center) }) else { output(["success":false]); exit(0) }
    let visible = display.visibleFrame
    let expanded: [String: Double] = ["x":Double(visible.minX), "y":Double(top - visible.maxY), "width":Double(visible.width), "height":Double(visible.height)]
    let success = resize(window, expanded)
    usleep(150000)
    output(["success":success, "state":["pid":pid,"index":index,"title":attribute(window, kAXTitleAttribute) as? String ?? "", "frame":frame,"expanded":geometry(window) ?? expanded]]); exit(0)
case "restore_window":
    guard let state = action["state"] as? [String:Any], let pid = state["pid"] as? Int32, let index = state["index"] as? Int, let frame = state["frame"] as? [String:Double], let expanded = state["expanded"] as? [String:Double] else { exit(1) }
    let list = windows(pid)
    // Do not undo a resize performed by the user while MIRA was active.
    if list.indices.contains(index), (attribute(list[index], kAXTitleAttribute) as? String ?? "") == state["title"] as? String, let current = geometry(list[index]), current.allSatisfy({ abs($0.value - (expanded[$0.key] ?? -99999)) < 3 }) { _ = resize(list[index], frame) }
    output(["success":true]); exit(0)
case "drag":
    guard let x = action["x"] as? Double, let y = action["y"] as? Double, let tx = action["toX"] as? Double, let ty = action["toY"] as? Double else { exit(1) }
    let start = CGPoint(x:x,y:y)
    CGEvent(mouseEventSource:nil, mouseType:.leftMouseDown, mouseCursorPosition:start, mouseButton:.left)?.post(tap:.cghidEventTap)
    for step in 1...30 {
        let t = Double(step) / 30
        CGEvent(mouseEventSource:nil, mouseType:.leftMouseDragged, mouseCursorPosition:CGPoint(x:x+(tx-x)*t,y:y+(ty-y)*t), mouseButton:.left)?.post(tap:.cghidEventTap)
        usleep(20000)
    }
    CGEvent(mouseEventSource:nil, mouseType:.leftMouseUp, mouseCursorPosition:CGPoint(x:tx,y:ty), mouseButton:.left)?.post(tap:.cghidEventTap)
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
    // Catalyst apps (including WhatsApp) can ignore synthetic Unicode key
    // payloads. Paste into the verified focused field, preserving all clipboard
    // formats and never overwriting a concurrent user clipboard change.
    if appKey(front?.localizedName ?? "") != "whatsapp" {
        let chars = Array(text.utf16)
        for offset in stride(from: 0, to: chars.count, by: 20) {
            let chunk = Array(chars[offset..<min(offset + 20, chars.count)])
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
                event?.flags = []
                event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                event?.post(tap: .cghidEventTap)
            }
        }
        usleep(50000)
        output(["success":true,"message":"Input delivered; verify the updated screen."])
        exit(0)
    }
    let board = NSPasteboard.general
    let previous = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
        return copy
    }
    board.clearContents()
    board.setString(text, forType: .string)
    let ownedChange = board.changeCount
    key(9, .maskCommand)
    usleep(300000)
    if board.changeCount == ownedChange {
        board.clearContents()
        if !previous.isEmpty { board.writeObjects(previous) }
    }
case "key":
    if action["key"] as? String == "open_location" { key(5, [.maskCommand, .maskShift]); break }
    let keys: [String: CGKeyCode] = ["enter":36,"tab":48,"escape":53,"backspace":51,"up":126,"down":125,"left":123,"right":124,"select_all":0,"copy":8,"paste":9,"find":3]
    guard let name = action["key"] as? String, let code = keys[name] else { exit(1) }
    key(code, ["select_all","copy","paste","find"].contains(name) ? .maskCommand : [])
case "scroll":
    guard let amount = action["amount"] as? Int, abs(amount) <= 10 else { exit(1) }
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(-amount), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
case "lock": key(12, [.maskCommand, .maskControl])
case "open_app":
    guard let name = action["name"] as? String else { exit(1) }
    if let running = NSWorkspace.shared.runningApplications.first(where: { appKey($0.localizedName ?? "") == appKey(name) && $0.activationPolicy == .regular }) {
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
