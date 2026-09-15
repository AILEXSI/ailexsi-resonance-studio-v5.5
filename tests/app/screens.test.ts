import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SCREENS,
  cycleProductionScreen,
  editorFormFocus,
  editorTextEditFocus,
  isFormFocus,
  isTextEditFocus,
  tracksForScreen,
} from "../../src/app/screens";

describe("production screens", () => {
  it("TAB cycles arrange → cutter → arrange", () => {
    expect(PRODUCTION_SCREENS).toEqual(["arrange", "cutter"]);
    expect(cycleProductionScreen("arrange", 1)).toBe("cutter");
    expect(cycleProductionScreen("cutter", 1)).toBe("arrange");
    expect(tracksForScreen("arrange")).toEqual(["V1", "V2", "A1", "A2"]);
    expect(tracksForScreen("cutter")).toEqual(["V1", "V2"]);
  });

  it("Shift+TAB cycles reverse", () => {
    expect(cycleProductionScreen("arrange", -1)).toBe("cutter");
    expect(cycleProductionScreen("cutter", -1)).toBe("arrange");
  });

  it("isFormFocus matches input/textarea/select/contenteditable/spinbutton", () => {
    const input = document.createElement("input");
    input.type = "number";
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const spin = document.createElement("div");
    spin.setAttribute("role", "spinbutton");
    const edit = document.createElement("div");
    edit.contentEditable = "true";
    const div = document.createElement("div");
    expect(isFormFocus(input)).toBe(true);
    expect(isFormFocus(textarea)).toBe(true);
    expect(isFormFocus(select)).toBe(true);
    expect(isFormFocus(spin)).toBe(true);
    expect(isFormFocus(edit)).toBe(true);
    expect(isFormFocus(div)).toBe(false);
    expect(isFormFocus(null)).toBe(false);
  });

  it("editorFormFocus treats a focused inspector number field as form focus even if the event target is body", () => {
    const input = document.createElement("input");
    input.type = "number";
    document.body.appendChild(input);
    input.focus();
    expect(editorFormFocus(document.body)).toBe(true);
    expect(editorFormFocus(input)).toBe(true);
    input.blur();
    input.remove();
    expect(editorFormFocus(document.body)).toBe(false);
  });

  it("isTextEditFocus is true for typed fields and false for mixer range / checkbox / button", () => {
    const text = document.createElement("input");
    text.type = "text";
    const number = document.createElement("input");
    number.type = "number";
    const range = document.createElement("input");
    range.type = "range";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const button = document.createElement("button");
    button.type = "button";
    const textarea = document.createElement("textarea");
    expect(isTextEditFocus(text)).toBe(true);
    expect(isTextEditFocus(number)).toBe(true);
    expect(isTextEditFocus(textarea)).toBe(true);
    expect(isTextEditFocus(range)).toBe(false);
    expect(isTextEditFocus(checkbox)).toBe(false);
    expect(isTextEditFocus(button)).toBe(false);
    expect(isFormFocus(range)).toBe(true);
    document.body.appendChild(range);
    range.focus();
    expect(editorFormFocus(document.body)).toBe(true);
    expect(editorTextEditFocus(document.body)).toBe(false);
    range.blur();
    range.remove();
  });
});
