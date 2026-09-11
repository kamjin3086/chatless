"""
Automated UI evidence capture for the OrcaRouter integration.

Drives real Chromium against the project's own built static export served from a local
HTTP server. The page renders the real `OrcaRouterConnectPanel` and a real
`role="listbox"` model dropdown, and its option lists are produced by the project's own
`@/lib/orcarouter/catalog` filter.

The OrcaRouter catalog is fetched live server-side with the user's API key and handed to
the page over same-origin HTTP, so the API key never reaches the browser.

Writes three PNGs plus manifest.json to /work/evidence.

Usage: ORCAROUTER_API_KEY=... python3 scripts/screenshot_evidence.py
"""

import hashlib
import http.server
import json
import os
import pathlib
import socketserver
import sys
import threading
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EVIDENCE = pathlib.Path("/work/evidence")

CATALOG_URL = "https://api.orcarouter.ai/v1/models?capability=chat"
CATALOG_SOURCE = "https://api.orcarouter.ai/v1/models?capability=chat"
PAGE_PATH = "/dev-tools/orcarouter-preview.html"

VIEWPORT = {"width": 1280, "height": 900}


def fail(msg: str):
    print(f"EVIDENCE FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def fetch_catalog() -> dict:
    """Server-side fetch with the user's key. The key is never sent to the browser."""
    key = os.environ.get("ORCAROUTER_API_KEY")
    if not key:
        fail("ORCAROUTER_API_KEY is not set")
    req = urllib.request.Request(CATALOG_URL, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves dist/ and injects the live catalog at a same-origin path."""

    catalog: dict = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/orcarouter-catalog.json":
            body = json.dumps(self.catalog).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, *args):
        pass


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def css(testid: str) -> str:
    return f'[data-testid="{testid}"]'


def assert_dropdown(page, label: str):
    """Assert the listbox is open, styled, and right-aligned with its trigger."""
    listbox = page.locator('[role="listbox"]:visible').first
    listbox.wait_for(state="visible", timeout=15000)

    trigger = page.locator(css("orcarouter-model-trigger"))
    expanded = trigger.get_attribute("aria-expanded")
    if expanded != "true":
        fail(f"[{label}] trigger aria-expanded={expanded!r}, expected 'true'")

    box = listbox.bounding_box()
    tbox = trigger.bounding_box()
    if not box or not tbox:
        fail(f"[{label}] missing bounding box")

    style = listbox.evaluate(
        "el => { const s = getComputedStyle(el); return {"
        " background: s.backgroundColor, borderTop: s.borderTopWidth,"
        " borderColor: s.borderTopColor, opacity: s.opacity }; }"
    )

    right_delta = abs((box["x"] + box["width"]) - (tbox["x"] + tbox["width"]))

    def alpha(color: str) -> float:
        if color.startswith("rgba"):
            parts = color[color.index("(") + 1 : color.index(")")].split(",")
            return float(parts[3]) if len(parts) == 4 else 1.0
        return 1.0

    opaque = alpha(style["background"]) >= 0.95 and float(style["opacity"]) >= 0.95
    bordered = float(style["borderTop"].replace("px", "")) >= 1.0

    if right_delta > 2:
        fail(f"[{label}] panel/trigger right edge delta {right_delta:.2f}px > 2px")
    if not opaque:
        fail(f"[{label}] dropdown background is not opaque: {style['background']}")
    if not bordered:
        fail(f"[{label}] dropdown has no visible border: {style['borderTop']}")

    item_count = listbox.locator('[role="option"]').count()
    if item_count == 0:
        fail(f"[{label}] dropdown lists no models")

    return {
        "item_count": item_count,
        "geometry": {
            "panel_width": int(round(box["width"])),
            "trigger_panel_right_delta": int(round(right_delta)),
            "opaque_background": opaque,
            "visible_border": bordered,
        },
    }


def main():
    if not DIST.exists():
        fail("dist/ not found — run `next build` first")
    if not (DIST / "dev-tools" / "orcarouter-preview.html").exists():
        fail("preview page not built — expected dist/dev-tools/orcarouter-preview.html")

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    catalog = fetch_catalog()
    Handler.catalog = catalog
    print(f"catalog fetched server-side: {len(catalog.get('data', []))} records")

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print(f"serving dist/ at {base}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(viewport=VIEWPORT, device_scale_factor=2)
            page.goto(base + PAGE_PATH, wait_until="networkidle")
            page.wait_for_selector(css("orcarouter-api-key-input"), state="visible", timeout=20000)

            # ── 1. Auth methods ────────────────────────────────────────────
            api_key_input = page.locator(css("orcarouter-api-key-input"))
            connect_btn = page.locator(css("orcarouter-connect-button"))

            input_type = api_key_input.get_attribute("type")
            if input_type != "password":
                fail(f"API key control must be masked (type=password), got {input_type!r}")
            if not api_key_input.is_enabled() or not connect_btn.is_enabled():
                fail("an authentication control is disabled")
            if not connect_btn.is_visible():
                fail("Connect with OrcaRouter is not visible")

            page.screenshot(path=str(EVIDENCE / "auth-methods.png"))
            print("captured auth-methods.png")

            # ── 2. Text model dropdown ─────────────────────────────────────
            page.evaluate("window.__orcaSetModalities([])")
            page.wait_for_timeout(500)
            page.click(css("orcarouter-model-trigger"))
            page.wait_for_timeout(600)
            text_state = assert_dropdown(page, "text")
            page.screenshot(path=str(EVIDENCE / "text-model-dropdown.png"))
            print(f"captured text-model-dropdown.png ({text_state['item_count']} items)")

            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            page.click(css("orcarouter-model-trigger"))  # close
            page.wait_for_timeout(400)

            # ── 3. Multimodal (image attachment) dropdown ──────────────────
            page.evaluate("window.__orcaSetModalities(['image'])")
            page.wait_for_timeout(700)
            page.click(css("orcarouter-model-trigger"))
            page.wait_for_timeout(600)
            image_state = assert_dropdown(page, "image")
            page.screenshot(path=str(EVIDENCE / "multimodal-model-dropdown.png"))
            print(f"captured multimodal-model-dropdown.png ({image_state['item_count']} items)")

            totals = page.evaluate("window.__orcaCatalog")
            browser.close()
    finally:
        httpd.shutdown()

    text_count = text_state["item_count"]
    image_count = image_state["item_count"]

    if image_count >= text_count:
        fail(f"image attachment must narrow the list: image={image_count} text={text_count}")

    manifest = {
        "automation": {
            "framework": "playwright",
            "test_command": "ORCAROUTER_API_KEY=*** python3 scripts/screenshot_evidence.py",
            "passed": True,
            "catalog_source": CATALOG_SOURCE,
            "catalog_model_count": totals["chatTotal"],
            "image_model_count": totals["imageTotal"],
        },
        "artifacts": [
            {
                "kind": "auth-methods",
                "path": str(EVIDENCE / "auth-methods.png"),
                "sha256": sha256(EVIDENCE / "auth-methods.png"),
                "ui": {
                    "api_key_visible": True,
                    "pkce_visible": True,
                    "secret_masked": True,
                    "controls_enabled": True,
                },
            },
            {
                "kind": "text-model-dropdown",
                "path": str(EVIDENCE / "text-model-dropdown.png"),
                "sha256": sha256(EVIDENCE / "text-model-dropdown.png"),
                "ui": {"dropdown_open": True, "item_count": text_count, **text_state["geometry"]},
            },
            {
                "kind": "multimodal-model-dropdown",
                "path": str(EVIDENCE / "multimodal-model-dropdown.png"),
                "sha256": sha256(EVIDENCE / "multimodal-model-dropdown.png"),
                "ui": {"dropdown_open": True, "item_count": image_count, **image_state["geometry"]},
            },
        ],
    }

    (EVIDENCE / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("\nmanifest.json written")
    print(f"catalog_model_count={totals['chatTotal']} image_model_count={totals['imageTotal']}")
    print("EVIDENCE PASSED")


if __name__ == "__main__":
    main()
