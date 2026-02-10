import { state } from "./state.js";

export function normalizeNode(node) {
    return node.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

export function loadPexRTC(nodeRaw) {
    return new Promise((resolve, reject) => {
        const node = normalizeNode(nodeRaw);
        if (!node) return reject(new Error("Node is empty"));

        if (state.pexrtcLoaded && window.PexRTC && state.lastLoadedNode === node) {
            return resolve();
        }

        const src = `https://${node}/static/webrtc/js/pexrtc.js`;

        // If tag exists, reuse only if PexRTC is present
        if ([...document.scripts].some((s) => s.src === src)) {
            state.lastLoadedNode = node;
            state.pexrtcLoaded = !!window.PexRTC;
            return state.pexrtcLoaded
                ? resolve()
                : reject(new Error("pexrtc.js tag exists but PexRTC not found (blocked?)"));
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;

        script.onload = () => {
            if (!window.PexRTC) return reject(new Error("pexrtc.js loaded but PexRTC not found"));
            state.lastLoadedNode = node;
            state.pexrtcLoaded = true;
            resolve();
        };

        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}
