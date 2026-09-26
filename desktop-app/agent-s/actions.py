"""Talio's data-only Agent S action interface. Never evaluates generated code."""
import ast
import math


def action(method):
    method.is_agent_action = True
    return method


class SafeACI:
    env = None

    def __init__(self):
        self.notes = []

    def assign_screenshot(self, observation):
        self.observation = observation

    def set_task_instruction(self, instruction):
        self.instruction = instruction

    @action
    def create_file(self, name: str, content: str):
        """Create a NEW txt/md/csv/json data file in Documents/MIRA. Never overwrite. Maximum 4000 characters. Only when requested by the user. Read the tool result for the exact path."""
        if not isinstance(name, str) or len(name) > 110 or not isinstance(content, str) or len(content) > 4000:
            raise ValueError('Invalid file')
        return {"type": "create_file", "name": name, "content": content}

    @action
    def reveal_file(self, name: str):
        """Reveal a file created in this task in Finder, Explorer or the system file manager. Prefer attachment picker plus open_location for uploads."""
        if not isinstance(name, str) or len(name) > 110:
            raise ValueError('Invalid filename')
        return {"type": "reveal_file", "name": name}

    @action
    def drag(self, x: float, y: float, toX: float, toY: float):
        """Drag a verified visible file to a verified visible drop target, both in the same screenshot. Normalized 0..1 coordinates. Never drag an unknown file or repeat an uncertain upload."""
        if any(type(v) not in (float, int) or not math.isfinite(v) or not 0 <= v <= 1 for v in (x,y,toX,toY)):
            raise ValueError('Invalid drag')
        return {"type":"drag", "x":x, "y":y, "toX":toX, "toY":toY}

    @action
    def click(self, x: float, y: float):
        """Click a visible target. x and y are normalized screenshot coordinates from 0 to 1."""
        if any(type(v) not in (float, int) or not math.isfinite(v) or not 0 <= v <= 1 for v in (x, y)):
            raise ValueError("Invalid coordinates")
        return {"type": "click", "x": x, "y": y}

    @action
    def type(self, text: str):
        """Type literal text into the currently focused input, maximum 2000 characters."""
        if not isinstance(text, str) or len(text) > 2000:
            raise ValueError("Invalid text")
        return {"type": "type", "text": text}

    @action
    def key(self, key: str):
        """Press enter, tab, escape, backspace, arrows, select_all, copy, paste, find, or open_location (file picker location: Cmd+Shift+G on Mac, Ctrl+L elsewhere)."""
        if key not in ("enter", "tab", "escape", "backspace", "up", "down", "left", "right", "select_all", "copy", "paste", "find", "open_location"):
            raise ValueError("Unsupported key")
        return {"type": "key", "key": key}

    @action
    def scroll(self, amount: int):
        """Scroll by -10 to 10 notches; positive values scroll down."""
        if type(amount) is not int or abs(amount) > 10:
            raise ValueError("Invalid scroll")
        return {"type": "scroll", "amount": amount}

    @action
    def open_app(self, name: str):
        """Launch or focus an installed app by name, e.g. WhatsApp. Prefer this to searching Talio contacts."""
        if not isinstance(name, str) or not 1 <= len(name) <= 80 or not all(c.isalnum() or c in " ._-" for c in name):
            raise ValueError("Invalid app name")
        return {"type": "open_app", "name": name}

    @action
    def done(self, message: str):
        """Finish only after the current screenshot verifies the requested result. Reply in the user's language."""
        if not isinstance(message, str) or not 1 <= len(message) <= 500:
            raise ValueError("Invalid result")
        return {"done": True, "message": message}

    @action
    def ask(self, question: str):
        """Stop for ambiguous recipients, missing information, authentication or unsupported operations."""
        if not isinstance(question, str) or not 1 <= len(question) <= 500:
            raise ValueError("Invalid question")
        return {"question": question}

    @action
    def lock(self):
        """Lock the laptop only when explicitly requested. Cannot unlock or bypass the lock screen."""
        return {"type": "lock"}

    @action
    def wait(self, seconds=1):
        """Wait briefly for the app to settle, then observe and plan again. Sends no input."""
        if type(seconds) not in (int, float) or not math.isfinite(seconds) or not 0 <= seconds <= 5:
            raise ValueError("Invalid wait")
        # Upstream also calls wait after an invalid plan. Recover without input,
        # rather than turning a formatting failure into a user clarification.
        return {"retryable": True, "retryAfterMs": max(200, int(seconds * 1000)),
                "message": "Refreshing the screen and planning the next step."}


def parse_action(agent, code, observation):
    if not isinstance(code, str) or len(code) > 6000:
        raise ValueError("Invalid action")
    tree = ast.parse(code.strip(), mode="eval")
    call = tree.body
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
            and isinstance(call.func.value, ast.Name) and call.func.value.id == "agent"):
        raise ValueError("Only a single literal agent action is accepted")
    method = getattr(type(agent), call.func.attr, None)
    if not method or not getattr(method, "is_agent_action", False):
        raise ValueError("Unsupported action")
    if any(k.arg is None for k in call.keywords):
        raise ValueError("Expanded arguments are forbidden")
    args = [ast.literal_eval(arg) for arg in call.args]
    kwargs = {k.arg: ast.literal_eval(k.value) for k in call.keywords}
    if len(kwargs) != len(call.keywords):
        raise ValueError("Duplicate argument")
    agent.assign_screenshot(observation)
    return method(agent, *args, **kwargs)
