#!/usr/bin/env python3
"""Capture every room through the model's existing main-Chrome DOM controls."""

import argparse
import base64
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-id", required=True, type=int)
    parser.add_argument("--tab-id", required=True, type=int)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--asset", required=True)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--rooms", nargs="*")
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("Use a new evidence directory; prior captures are immutable.")
    model = json.loads(args.model.read_text())
    rooms = [r for r in model["rooms"] if not args.rooms or r["id"] in args.rooms]
    if args.rooms and len(rooms) != len(set(args.rooms)):
        raise SystemExit("A requested room does not exist in the source model.")

    def evaluate(source):
        guarded = "(() => { if (location.origin !== " + json.dumps(args.origin)
        guarded += ") throw new Error('Unexpected tab origin'); " + source + " })()"
        script = (
            'tell application "Google Chrome" to execute '
            f"(first tab of window id {args.window_id} whose id is {args.tab_id}) "
            "javascript " + json.dumps(guarded, ensure_ascii=False)
        )
        result = subprocess.run(
            ["/Users/gregspero/bin/gregbot-run", "--timeout", "25",
             "/usr/bin/osascript", "-e", script],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            raise RuntimeError("Existing Chrome evaluation failed: " + result.stderr[:300])
        return result.stdout.strip()

    initial = json.loads(evaluate(
        "const viewport=document.getElementById('viewport');"
        "if(!viewport.dataset.modelState)document.dispatchEvent(new Event('trc-capture-frame'));"
        "const state=JSON.parse(viewport.dataset.modelState||viewport.dataset.captureState);"
        "if(state.navigationReady===undefined)state.navigationReady=!document.getElementById('walk').disabled;"
        "return JSON.stringify({url:location.href,title:document.title,"
        "visibility:document.visibilityState,animationObserved:!!viewport.dataset.modelState,state});"
    ))
    if not initial["state"].get("detailed") or not initial["state"].get("navigationReady"):
        raise SystemExit("The existing tab has not finished loading the detailed model.")
    if initial["state"].get("dirty"):
        raise SystemExit("The tab contains unsaved planning edits; use a separate owned tab.")
    args.output.mkdir(parents=True)
    report = {
        "scope": "Existing main Chrome; DOM room selection, walk entry, and actual WebGL captures. "
                 "Not physical-site accuracy or sustained movement performance.",
        "origin": args.origin,
        "expectedAsset": args.asset,
        "windowId": args.window_id,
        "tabId": args.tab_id,
        "initial": initial,
        "rooms": [],
    }
    try:
        for room in rooms:
            target = json.dumps({"room": room["id"], "floor": room["floorId"]})
            evaluate(
                "const target=" + target + ";"
                "const v=document.getElementById('viewport');"
                "v.dataset.captureState='';v.dataset.captureFrame='';"
                "const mode=document.querySelector('[data-mode=explore]');mode.click();"
                "const floor=document.getElementById('floor-select');"
                "floor.value=target.floor;floor.dispatchEvent(new Event('change',{bubbles:true}));"
                "const room=document.getElementById('room-select');room.value=target.room;"
                "if(room.value!==target.room)throw new Error('Missing room option');"
                "room.dispatchEvent(new Event('change',{bubbles:true}));"
                "document.getElementById('walk').click();"
                "setTimeout(()=>document.dispatchEvent(new Event('trc-capture-frame')),350);"
                "return 'queued';"
            )
            state = None
            for _ in range(30):
                raw = evaluate("return document.getElementById('viewport').dataset.captureState || ''; ")
                if raw:
                    state = json.loads(raw)
                    break
                time.sleep(0.5)
            if state is None:
                raise RuntimeError("Timed out capturing " + room["id"])
            checks = {
                "correctRoom": state["activeRoom"] == room["id"],
                "correctFloor": state["activeFloor"] == room["floorId"],
                "correctAsset": state["asset"] == args.asset,
                "correctRevision": state["modelRevision"] == model["revision"],
                "walkEntered": state["walk"] is True,
                "detailedLoaded": state["detailed"] is True,
                "webglClean": state["webglError"] == 0,
                "planningUntouched": state["dirty"] is False,
                "gridHiddenInside": state["gridVisible"] is False,
            }
            encoded = evaluate("return document.getElementById('viewport').dataset.captureFrame;")
            prefix = "data:image/png;base64,"
            if not encoded.startswith(prefix):
                raise RuntimeError("Missing PNG capture for " + room["id"])
            png = base64.b64decode(encoded[len(prefix):], validate=True)
            if not png.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("Invalid PNG capture")
            filename = room["id"] + ".png"
            (args.output / filename).write_bytes(png)
            entry = {"room": room["id"], "checks": checks, "state": state,
                     "capture": filename, "captureBytes": len(png),
                     "pass": all(checks.values())}
            report["rooms"].append(entry)
            print(json.dumps({"room": room["id"], "pass": entry["pass"],
                              "drawCalls": state["drawCalls"], "captureBytes": len(png)}), flush=True)
            if not entry["pass"]:
                raise RuntimeError("Room verification failed: " + room["id"])
        report["status"] = "pass"
    except Exception as error:
        report["status"] = "fail"
        report["error"] = str(error)
        raise
    finally:
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
