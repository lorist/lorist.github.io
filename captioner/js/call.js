import { state } from "./state.js";
import { $, status, setConnBadge } from "./dom.js";
import { loadPexRTC, normalizeNode } from "./pexrtc-loader.js";
import { renderRoster, setActiveSpeakers, markCaptionActivity, getBestParticipantName } from "./roster.js";
import { renderTranscript, setConnectedUI, updateMediaUI, resetCallState } from "./ui.js";

function isoNow() { return new Date().toISOString(); }

function buildEntryFromCaption(msg) {
    const speakerUuid = msg?.sources?.[0]?.participant_uuid || null;
    const speakerName = speakerUuid ? getBestParticipantName(speakerUuid) : "Unknown";
    return {
        ts_ms: Date.now(),
        ts_iso: isoNow(),
        speaker_uuid: speakerUuid,
        speaker_name: speakerName,
        src_lang: msg?.src_lang || null,
        tgt_lang: msg?.tgt_lang || null,
        text: msg.data
    };
}

export async function joinCall() {
    // If already connected, reset first
    if (state.rtc) {
        try { state.rtc.disconnect(); } catch { }
        resetCallState({ keepStatusText: "Disconnected (local reset)" });
    }

    const nodeRaw = $("node").value.trim();
    const node = normalizeNode(nodeRaw);
    const alias = $("alias").value.trim();
    const name = $("name").value.trim() || "Captions Bot";
    const mode = $("mode").value;
    const pin = $("pin").value.trim();


    if (!node || !alias) {
        alert("Please enter Node and Conference alias.");
        return;
    }

    try {
        status(`Loading PexRTC from ${node}…`);
        setConnBadge("connecting", "Loading PexRTC…");
        await loadPexRTC(node);
    } catch (e) {
        console.error(e);
        alert(`Unable to load PexRTC from ${node}\n\n${e.message}`);
        status("PexRTC load failed");
        setConnBadge("error", "PexRTC load failed");
        return;
    }

    state.rtc = new PexRTC();
    const rtc = state.rtc;

    // Roster callbacks
    rtc.onRosterList = (roster) => {
        try {
            state.participantsByUuid.clear();
            if (Array.isArray(roster)) {
                for (const p of roster) {
                    if (p?.uuid) state.participantsByUuid.set(p.uuid, p);
                }
            }
            renderRoster();
        } catch (e) {
            console.warn("onRosterList parse failed:", e);
        }
    };

    rtc.onParticipantCreate = (p) => {
        if (p?.uuid) state.participantsByUuid.set(p.uuid, p);
        renderRoster();
    };
    rtc.onParticipantUpdate = (p) => {
        if (p?.uuid) state.participantsByUuid.set(p.uuid, { ...(state.participantsByUuid.get(p.uuid) || {}), ...p });
        renderRoster();
    };
    rtc.onParticipantDelete = (p) => {
        if (p?.uuid) state.participantsByUuid.delete(p.uuid);
        state.activeSpeakerUuids.delete(p.uuid);
        renderRoster();
    };

    rtc.onActiveSpeakerChange = (uuids) => {
        if (Array.isArray(uuids)) setActiveSpeakers(uuids);
    };

    // Presentation: call getPresentation() when a presentation starts
    rtc.onPresentation = (setting) => {
        if (setting) {
            rtc.getPresentation();
        } else {
            if (!rtc.screenshare_requested) {
                $("presentation").srcObject = null;
                $("presentation").removeAttribute("src");
            }
        }
    };

    rtc.onPresentationConnected = (stream) => {
        try { $("presentation").srcObject = stream; }
        catch { $("presentation").src = stream; }
    };

    rtc.onPresentationDisconnected = () => {
        if (!rtc.screenshare_requested) {
            $("presentation").srcObject = null;
            $("presentation").removeAttribute("src");
        }
    };

    rtc.onSetup = (_stream, pin_status /*, conference_extension, idp_selection */) => {
        // pin_status is one of: "none" | "required" | "optional" :contentReference[oaicite:1]{index=1}

        let pinToUse;

        if (pin_status === "required") {
            if (!pin) {
                alert("This conference requires a PIN. Please enter it and try again.");
                // Don't call connect() yet — user needs to enter the PIN
                return;
            }
            pinToUse = pin;
        } else if (pin_status === "optional") {
            // Hosts need a PIN; Guests may enter with empty string ("") :contentReference[oaicite:2]{index=2}
            pinToUse = pin || "";
        } else {
            // "none" => must be undefined :contentReference[oaicite:3]{index=3}
            pinToUse = undefined;
        }

        rtc.connect(pinToUse);
    };


    rtc.onConnect = (remoteStream) => {
        if (remoteStream) $("remote").srcObject = remoteStream;

        const hasMedia = (mode !== "none");
        state.micMuted = !!$("startMuted").checked;
        state.camMuted = !!$("startCamOff").checked;

        if (hasMedia) {
            rtc.muteAudio(state.micMuted);
            rtc.muteVideo(state.camMuted);
        }

        setConnectedUI(true, hasMedia);
        updateMediaUI();
        renderRoster();

        status(`Connected (uuid=${rtc.uuid})`);
        setConnBadge("connected", "Connected");
    };

    rtc.onDisconnect = (reason) => {
        const msg = `Disconnected${reason ? ": " + reason : ""}`;
        resetCallState({ keepStatusText: msg });
    };

    rtc.onError = (err) => {
        console.error(err);
        alert("PexRTC error: " + (err?.message || err));
        resetCallState({ keepStatusText: "Call error (reset)" });
        setConnBadge("error", "Error");
    };

    rtc.onLiveCaptions = (msg) => {
        if (!msg?.data) return;
        const speakerUuid = msg?.sources?.[0]?.participant_uuid;

        if (msg.is_final) {
            state.lines.push(buildEntryFromCaption(msg));
            renderTranscript();
            if (speakerUuid) markCaptionActivity(speakerUuid);
        } else {
            if (speakerUuid) markCaptionActivity(speakerUuid, 1200);
        }
    };

    rtc.onScreenshareConnected = () => { state.sharing = true; updateMediaUI(); };
    rtc.onScreenshareStopped = () => { state.sharing = false; updateMediaUI(); };

    const callType =
        mode === "audioonly" ? "audioonly" :
            mode === "recvonly" ? "recvonly" :
                mode === "none" ? "none" :
                    null;

    status("Connecting…");
    setConnBadge("connecting", "Connecting…");
    renderRoster();

    rtc.makeCall(node, alias, name, null, callType);
}

export function leaveCall() {
    if (!state.rtc) return;

    status("Disconnecting…");
    $("leave").disabled = true;

    if (state.disconnectWatchdog) clearTimeout(state.disconnectWatchdog);
    state.disconnectWatchdog = setTimeout(() => {
        if (state.rtc) resetCallState({ keepStatusText: "Disconnected (watchdog)" });
    }, 2500);

    try {
        state.rtc.disconnect();
    } catch (e) {
        console.warn("disconnect() threw:", e);
        resetCallState({ keepStatusText: "Disconnected (local reset)" });
    }
}
