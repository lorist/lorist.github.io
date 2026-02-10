import { $ } from "./dom.js";

const FORM_STORAGE_KEY = "pexip-captions-form-v1";

export function saveFormState() {
    const state = {
        node: $("node").value.trim(),
        alias: $("alias").value.trim(),
        name: $("name").value.trim(),
        mode: $("mode").value,
        pin: $("pin").value.trim(),
        startMuted: $("startMuted").checked,
        startCamOff: $("startCamOff").checked,
    };

    try {
        localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Failed to save form state:", e);
    }
}

export function loadFormState() {
    try {
        const raw = localStorage.getItem(FORM_STORAGE_KEY);
        if (!raw) return;

        const state = JSON.parse(raw);
        if (!state || typeof state !== "object") return;

        if (state.node) $("node").value = state.node;
        if (state.alias) $("alias").value = state.alias;
        if (state.name) $("name").value = state.name;
        if (state.mode) $("mode").value = state.mode;
        if (state.pin) $("pin").value = state.pin;

        $("startMuted").checked = !!state.startMuted;
        $("startCamOff").checked = !!state.startCamOff;
    } catch (e) {
        console.warn("Failed to load form state:", e);
    }
}

export function wireFormAutoSave() {
    ["node", "alias", "pin", "name", "mode", "startMuted", "startCamOff"].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("input", saveFormState);
        el.addEventListener("change", saveFormState);
    });
}
