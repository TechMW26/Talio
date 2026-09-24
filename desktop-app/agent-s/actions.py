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
        """Press one of enter, tab, escape, backspace, up, down, left, right, select_all, copy, paste, find."""
        if key not in ("enter", "tab", "escape", "backspace", "up", "down", "left", "right", "select_all", "copy", "paste", "find"):
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

    def wait(self, seconds):
        # Upstream uses wait as its invalid-plan fallback: fail closed, never invent input.
        return {"question": "I could not verify the next desktop action, so I stopped."}


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
