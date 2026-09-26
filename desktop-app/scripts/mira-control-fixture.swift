import AppKit
final class Fixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let field = NSTextField(frame: NSRect(x: 20, y: 120, width: 360, height: 30))
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 420, height: 220), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "MIRA isolated input test"
        window.contentView!.addSubview(field)
        let button = NSButton(title: "Verify test input", target: self, action: #selector(verify))
        button.frame = NSRect(x: 20, y: 50, width: 180, height: 32)
        window.contentView!.addSubview(button)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if CommandLine.arguments.contains("--file-picker") {
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false
            panel.beginSheetModal(for: window) { result in
                print(result == .OK ? "SELECTED \(panel.url!.path)" : "CANCELLED"); fflush(stdout)
                NSApp.terminate(nil)
            }
        }
        func point(_ view: NSView) -> [String: Double] {
            let p = window.convertPoint(toScreen: view.convert(NSPoint(x: view.bounds.midX, y: view.bounds.midY), to: nil))
            return ["x":p.x,"y":NSScreen.screens[0].frame.height - p.y]
        }
        let data = try! JSONSerialization.data(withJSONObject: ["field":point(field),"button":point(button)])
        print(String(data:data,encoding:.utf8)!); fflush(stdout)
        Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { _ in
            print("TEST_STATE field=\(self.field.stringValue) active=\(NSApp.isActive) key=\(self.window.isKeyWindow)"); fflush(stdout)
        }
    }
    @objc func verify() {
        print(field.stringValue == "MIRA native smoke test" ? "PASS" : "FAIL"); fflush(stdout)
        NSApp.terminate(nil)
    }
}
let app = NSApplication.shared
let delegate = Fixture()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
