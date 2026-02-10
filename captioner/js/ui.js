import { state } from "./state.js";
import { $, setConnBadge } from "./dom.js";
import { renderRoster, clearCaptionActivityTimers } from "./roster.js";
import { toTxt } from "./exporters.js";

export function updateMediaUI() {
    $("toggleMic").textContent = state.micMuted ? "Unmute mic" : "Mute mic";
    $("toggleCam").textContent = state.camMuted ? "Unmute camera" : "Mute camera";
    $("toggleShare").textContent = state.sharing ? "Stop share" : "Start share";
    $("mediaState").textContent =
        `mic: ${state.micMuted ? "muted" : "on"} · cam: ${state.camMuted ? "muted" : "on"} · share: ${state.sharing ? "on" : "off"}`;
}

export function renderTranscript() {
    $("out").value = toTxt(state.lines);
}

export function clearMediaElements() {
    $("remote").srcObject = null;
    $("remote").removeAttribute("src");
    $("presentation").srcObject = null;
    $("presentation").removeAttribute("src");
}

export function setConnectedUI(connected, hasMedia) {
    $("join").disabled = connected;
    $("leave").disabled = !connected;

    $("captionsOn").disabled = !connected;
    $("captionsOff").disabled = !connected;

    $("downloadFormat").disabled = !connected;
    $("download").disabled = !connected;

    $("clear").disabled = !connected;

    $("toggleMic").disabled = !connected || !hasMedia;
    $("toggleCam").disabled = !connected || !hasMedia;
    $("toggleShare").disabled = !connected;

    $("refreshRoster").disabled = !connected;
}

export function cancelDisconnectWatchdog() {
    if (state.disconnectWatchdog) {
        clearTimeout(state.disconnectWatchdog);
        state.disconnectWatchdog = null;
    }
}

export function resetCallState({ keepStatusText = null } = {}) {
    cancelDisconnectWatchdog();
    clearCaptionActivityTimers();

    state.rtc = null;

    state.micMuted = false;
    state.camMuted = false;
    state.sharing = false;

    state.participantsByUuid.clear();
    state.activeSpeakerUuids.clear();

    clearMediaElements();
    setConnectedUI(false, false);
    updateMediaUI();

    renderRoster(); // show "not connected"
    if (keepStatusText !== null) {
        const el = $("status");
        if (el) el.textContent = keepStatusText;
    }

    setConnBadge("disconnected", "Disconnected");
}
