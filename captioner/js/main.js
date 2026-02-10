import { $ } from "./dom.js";
import { state } from "./state.js";
import { loadFormState, wireFormAutoSave, saveFormState } from "./storage.js";
import { updateMediaUI, resetCallState, renderTranscript } from "./ui.js";
import { joinCall, leaveCall } from "./call.js";
import { toTxt, toJson, toCsv, toSrt, downloadText } from "./exporters.js";

// ---- Button wiring ----
$("join").onclick = async () => {
    saveFormState();
    await joinCall();
};

$("leave").onclick = () => leaveCall();

// Media controls
$("toggleMic").onclick = () => {
    if (!state.rtc) return;
    state.micMuted = !state.micMuted;
    state.rtc.muteAudio(state.micMuted);
    updateMediaUI();
};

$("toggleCam").onclick = () => {
    if (!state.rtc) return;
    state.camMuted = !state.camMuted;
    state.rtc.muteVideo(state.camMuted);
    updateMediaUI();
};

$("toggleShare").onclick = () => {
    if (!state.rtc) return;
    state.rtc.present(state.sharing ? null : "screen");
};

// Captions controls
$("captionsOn").onclick = () => {
    if (!state.rtc) return;
    state.rtc.showLiveCaptions(state.rtc.uuid);
    document.getElementById("status").textContent = "Captions enabled.";
};

$("captionsOff").onclick = () => {
    if (!state.rtc) return;
    state.rtc.hideLiveCaptions(state.rtc.uuid);
    document.getElementById("status").textContent = "Captions disabled.";
};

// Download
$("download").onclick = () => {
    const fmt = $("downloadFormat").value;
    const safeStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `pexip-captions-${safeStamp}`;

    let body = "";
    let ext = fmt;

    if (fmt === "txt") body = toTxt(state.lines);
    else if (fmt === "json") body = toJson(state.lines);
    else if (fmt === "csv") body = toCsv(state.lines);
    else if (fmt === "srt") body = toSrt(state.lines);
    else body = toTxt(state.lines);

    const mime =
        fmt === "json" ? "application/json;charset=utf-8" :
            fmt === "csv" ? "text/csv;charset=utf-8" :
                fmt === "srt" ? "application/x-subrip;charset=utf-8" :
                    "text/plain;charset=utf-8";

    downloadText(`${base}.${ext}`, body, mime);
};

$("clear").onclick = () => {
    state.lines = [];
    renderTranscript();
    document.getElementById("status").textContent = "Buffer cleared.";
};

// Roster refresh (manual)
$("refreshRoster").onclick = () => {
    // renderRoster is invoked by reset state / callbacks; keep as no-op or add direct call if desired
    // We'll call it via dynamic import to avoid circular deps:
    import("./roster.js").then(({ renderRoster }) => renderRoster());
};

// initial
loadFormState();
wireFormAutoSave();
resetCallState({ keepStatusText: "" });
updateMediaUI();
