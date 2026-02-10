export const $ = (id) => document.getElementById(id);

export const status = (s) => {
    const el = $("status");
    if (el) el.textContent = s || "";
};

export function setConnBadge(state, text) {
    const dot = $("connDot");
    const label = $("connText");
    if (!dot || !label) return;

    dot.className = "dot";
    if (state === "connected") dot.classList.add("connected");
    else if (state === "connecting") dot.classList.add("connecting");
    else if (state === "error") dot.classList.add("error");

    label.textContent = text || "";
}
