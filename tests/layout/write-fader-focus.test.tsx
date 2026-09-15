import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { Mixer } from "../../src/ui/mixer/Mixer";
import { editorFormFocus, isTextEditFocus } from "../../src/app/screens";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";

const Pointer = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;

describe("write fader focus / first movement", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("pointerdown on the mixer fader blurs it so Space is not captured by the range", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Mixer
          project={createEmptyProject()}
          selectedTrackId="A1"
          peaks={{ V1: 0, V2: 0, A1: 0, A2: 0, master: 0 }}
          playing
          volumeWriteArmedIds={["A1"]}
          onSelectTrack={() => undefined}
          onVolume={() => undefined}
          onMasterVolume={() => undefined}
          onToggleMute={() => undefined}
          onToggleSolo={() => undefined}
        />,
      );
    });
    const fader = host.querySelector('[data-testid="mix-fader-A1"]') as HTMLInputElement;
    expect(fader).toBeTruthy();
    expect(fader.type).toBe("range");
    act(() => {
      fader.focus();
    });
    expect(document.activeElement).toBe(fader);
    expect(editorFormFocus(fader)).toBe(true);
    expect(isTextEditFocus(fader)).toBe(false);
    act(() => {
      fader.dispatchEvent(new Pointer("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.activeElement === fader).toBe(false);
    const start = createSession(createMemoryBlobStore());
    const action = dispatchEditorKey(start, false, {
      key: " ",
      formFocus: editorFormFocus(document.activeElement),
      textEditFocus: isTextEditFocus(document.activeElement),
    });
    expect(action.type).toBe("session");
    if (action.type === "session") expect(action.session.playing).toBe(true);
  });
});
