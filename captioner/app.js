// ----------------------------
// Globals / state
// ----------------------------
let rtc = null;

// pexrtc.js dynamic loading (based on Node)
let pexrtcLoaded = false;
let lastLoadedNode = null;

// transcript entries (structured)
// { ts_ms, ts_iso, speaker_uuid, speaker_name, src_lang, tgt_lang, text }
let lines = [];

// local media UI state
let micMuted = false;
let camMuted = false;
let sharing = false;

// roster cache for speaker name resolution
// uuid -> participant object
const participantsByUuid = new Map();

// active speaker set (uuid)
const activeSpeakerUuids = new Set();
// for fallback highlight when a caption arrives
const captionActivityTimers = new Map();

// DISCONNECT WATCHDOG
let disconnectWatchdog = null;

const $ = id => document.getElementById(id);
const status = s => $("status").textContent = s || "";

function isoNow() { return new Date().toISOString(); }

function setConnBadge(state, text) {
    const dot = $("connDot");
    const label = $("connText");
    dot.className = "dot";
    if (state === "connected") dot.classList.add("connected");
    else if (state === "connecting") dot.classList.add("connecting");
    else if (state === "error") dot.classList.add("error");
    label.textContent = text || "";
}

// ----------------------------
// Local storage (form memory)
// ----------------------------
const FORM_STORAGE_KEY = "pexip-captions-form-v1";

function saveFormState() {
    const state = {
        node: $("node").value.trim(),
        alias: $("alias").value.trim(),
        name: $("name").value.trim(),
        mode: $("mode").value,
        startMuted: $("startMuted").checked,
        startCamOff: $("startCamOff").checked
    };
    try {
        localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("Failed to save form state:", e);
    }
}

function loadFormState() {
    try {
        const raw = localStorage.getItem(FORM_STORAGE_KEY);
        if (!raw) return;

        const state = JSON.parse(raw);
        if (!state || typeof state !== "object") return;

        if (state.node) $("node").value = state.node;
        if (state.alias) $("alias").value = state.alias;
        if (state.name) $("name").value = state.name;
        if (state.mode) $("mode").value = state.mode;

        $("startMuted").checked = !!state.startMuted;
        $("startCamOff").checked = !!state.startCamOff;
    } catch (e) {
        console.warn("Failed to load form state:", e);
    }
}

function wireFormAutoSave() {
    ["node", "alias", "name", "mode", "startMuted", "startCamOff"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("input", saveFormState);
        el.addEventListener("change", saveFormState);
    });
}

// ----------------------------
// Export helpers (TXT / SRT / JSON / CSV)
// ----------------------------
function escapeCsvCell(v) {
    const s = (v === null || v === undefined) ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function toTxt(entries) {
    return entries.map(e => {
        const lang = (e.src_lang || e.tgt_lang) ? ` (${e.src_lang || "?"}→${e.tgt_lang || "?"})` : "";
        return `[${e.ts_iso}] ${e.speaker_name}${lang}: ${e.text}`;
    }).join("\n");
}

function toJson(entries) {
    return JSON.stringify(entries, null, 2);
}

function toCsv(entries) {
    const header = ["ts_iso", "ts_ms", "speaker_name", "speaker_uuid", "src_lang", "tgt_lang", "text"];
    const rows = entries.map(e => [
        e.ts_iso, e.ts_ms, e.speaker_name, e.speaker_uuid, e.src_lang, e.tgt_lang, e.text
    ]);
    return [header.join(","), ...rows.map(r => r.map(escapeCsvCell).join(","))].join("\n");
}

function pad2(n) { return String(n).padStart(2, "0"); }
function pad3(n) { return String(n).padStart(3, "0"); }

function msToSrtTime(ms) {
    if (ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const milli = ms % 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(milli)}`;
}

// SRT derived from wall-clock; end time is next cue start (or +2s for last cue)
function toSrt(entries) {
    if (!entries.length) return "";

    const sorted = [...entries].sort((a, b) => a.ts_ms - b.ts_ms);
    const t0 = sorted[0].ts_ms;

    return sorted.map((e, i) => {
        const startRel = e.ts_ms - t0;
        const next = sorted[i + 1];
        const endRel = next ? Math.max(startRel + 500, (next.ts_ms - t0)) : (startRel + 2000);

        const who = e.speaker_name ? `${e.speaker_name}: ` : "";
        return `${i + 1}\n${msToSrtTime(startRel)} --> ${msToSrtTime(endRel)}\n${who}${e.text}\n`;
    }).join("\n");
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ----------------------------
// Helpers
// ----------------------------
function normalizeNode(node) {
    return node.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}

function loadPexRTC(nodeRaw) {
    return new Promise((resolve, reject) => {
        const node = normalizeNode(nodeRaw);
        if (!node) return reject(new Error("Node is empty"));

        if (pexrtcLoaded && window.PexRTC && lastLoadedNode === node) return resolve();

        const src = `https://${node}/static/webrtc/js/pexrtc.js`;

        // If tag exists, reuse only if PexRTC is present
        if ([...document.scripts].some(s => s.src === src)) {
            lastLoadedNode = node;
            pexrtcLoaded = !!window.PexRTC;
            return pexrtcLoaded ? resolve() : reject(new Error("pexrtc.js tag exists but PexRTC not found (blocked?)"));
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;

        script.onload = () => {
            if (!window.PexRTC) return reject(new Error("pexrtc.js loaded but PexRTC not found"));
            lastLoadedNode = node;
            pexrtcLoaded = true;
            resolve();
        };

        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

function updateMediaUI() {
    $("toggleMic").textContent = micMuted ? "Unmute mic" : "Mute mic";
    $("toggleCam").textContent = camMuted ? "Unmute camera" : "Mute camera";
    $("toggleShare").textContent = sharing ? "Stop share" : "Start share";
    $("mediaState").textContent =
        `mic: ${micMuted ? "muted" : "on"} · cam: ${camMuted ? "muted" : "on"} · share: ${sharing ? "on" : "off"}`;
}

function renderTranscript() {
    $("out").value = toTxt(lines);
}

function clearMediaElements() {
    $("remote").srcObject = null;
    $("remote").removeAttribute("src");
    $("presentation").srcObject = null;
    $("presentation").removeAttribute("src");
}

function setConnectedUI(connected, hasMedia) {
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

function cancelDisconnectWatchdog() {
    if (disconnectWatchdog) {
        clearTimeout(disconnectWatchdog);
        disconnectWatchdog = null;
    }
}

function clearCaptionActivityTimers() {
    for (const t of captionActivityTimers.values()) clearTimeout(t);
    captionActivityTimers.clear();
}

function resetCallState(keepStatusText = null) {
    cancelDisconnectWatchdog();
    clearCaptionActivityTimers();

    rtc = null;

    micMuted = false;
    camMuted = false;
    sharing = false;

    participantsByUuid.clear();
    activeSpeakerUuids.clear();

    clearMediaElements();
    setConnectedUI(false, false);
    updateMediaUI();

    renderRoster(); // show "not connected"
    if (keepStatusText !== null) status(keepStatusText);

    setConnBadge("disconnected", "Disconnected");
}

function getBestParticipantName(uuid) {
    if (!uuid) return "Unknown";
    const p = participantsByUuid.get(uuid);

    const name =
        p?.display_name ||
        p?.remote_display_name ||
        p?.name ||
        p?.participant_name ||
        p?.alias ||
        p?.call_alias ||
        null;

    return (name && String(name).trim()) ? String(name).trim() : uuid;
}

function getParticipantState(p) {
    const parts = [];
    if (p?.call_state) parts.push(`state:${p.call_state}`);
    if (p?.service_type) parts.push(`svc:${p.service_type}`);
    if (p?.role) parts.push(`role:${p.role}`);
    if (typeof p?.is_muted === "boolean") parts.push(p.is_muted ? "muted" : "unmuted");
    if (typeof p?.is_video_muted === "boolean") parts.push(p.is_video_muted ? "camOff" : "camOn");
    if (p?.protocol) parts.push(`proto:${p.protocol}`);
    return parts.length ? parts : ["connected"];
}

function shortUuid(uuid) {
    if (!uuid) return "";
    return uuid.length > 8 ? uuid.slice(0, 8) : uuid;
}

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

// ----------------------------
// Roster rendering + active speaker highlighting
// ----------------------------
function renderRoster() {
    const container = $("rosterList");
    const meta = $("rosterMeta");

    if (!rtc) {
        meta.textContent = "Not connected";
        container.innerHTML = `<div class="muted">Join a conference to see participants.</div>`;
        return;
    }

    const items = Array.from(participantsByUuid.values())
        .filter(p => p && p.uuid)
        .sort((a, b) => (String(a.display_name || a.name || a.uuid)).localeCompare(String(b.display_name || b.name || b.uuid)));

    meta.textContent = `${items.length} participant${items.length === 1 ? "" : "s"}`;

    if (items.length === 0) {
        container.innerHTML = `<div class="muted">Waiting for roster…</div>`;
        return;
    }

    container.innerHTML = items.map(p => {
        const uuid = p.uuid;
        const isActive = activeSpeakerUuids.has(uuid);
        const name = getBestParticipantName(uuid);
        const stateBits = getParticipantState(p);

        return `
      <div class="rosterItem ${isActive ? "activeSpeaker" : ""}" data-uuid="${uuid}">
        <div class="rosterTop">
          <div class="rosterName" title="${name}">${name}</div>
          <span class="rosterBadge">${isActive ? "ACTIVE" : shortUuid(uuid)}</span>
        </div>
        <div class="rosterSub">
          ${stateBits.map(s => `<span class="kv">${s}</span>`).join("")}
        </div>
      </div>
    `;
    }).join("");
}

function setActiveSpeakers(uuids) {
    activeSpeakerUuids.clear();
    for (const u of (uuids || [])) if (u) activeSpeakerUuids.add(u);
    renderRoster();
}

function markCaptionActivity(uuid, ms = 2200) {
    if (!uuid) return;

    activeSpeakerUuids.add(uuid);
    renderRoster();

    if (captionActivityTimers.has(uuid)) clearTimeout(captionActivityTimers.get(uuid));

    const t = setTimeout(() => {
        captionActivityTimers.delete(uuid);
        activeSpeakerUuids.delete(uuid);
        renderRoster();
    }, ms);

    captionActivityTimers.set(uuid, t);
}

// ----------------------------
// Join / Leave
// ----------------------------
$("join").onclick = async () => {
    saveFormState();

    if (rtc) {
        try { rtc.disconnect(); } catch { }
        resetCallState("Disconnected (local reset)");
    }

    const nodeRaw = $("node").value.trim();
    const node = normalizeNode(nodeRaw);
    const alias = $("alias").value.trim();
    const name = $("name").value.trim() || "Captions Bot";
    const mode = $("mode").value;

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

    rtc = new PexRTC();

    // Roster callbacks
    rtc.onRosterList = (roster) => {
        try {
            participantsByUuid.clear();
            if (Array.isArray(roster)) {
                for (const p of roster) {
                    if (p?.uuid) participantsByUuid.set(p.uuid, p);
                }
            }
            renderRoster();
        } catch (e) {
            console.warn("onRosterList parse failed:", e);
        }
    };

    rtc.onParticipantCreate = (p) => {
        if (p?.uuid) participantsByUuid.set(p.uuid, p);
        renderRoster();
    };
    rtc.onParticipantUpdate = (p) => {
        if (p?.uuid) participantsByUuid.set(p.uuid, { ...(participantsByUuid.get(p.uuid) || {}), ...p });
        renderRoster();
    };
    rtc.onParticipantDelete = (p) => {
        if (p?.uuid) participantsByUuid.delete(p.uuid);
        activeSpeakerUuids.delete(p.uuid);
        renderRoster();
    };

    rtc.onActiveSpeakerChange = (uuids) => {
        if (Array.isArray(uuids)) setActiveSpeakers(uuids);
    };

    // Presentation: call getPresentation() when a presentation starts
    rtc.onPresentation = (setting, presenter, uuid, presenter_source) => {
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

    rtc.onSetup = () => rtc.connect();

    rtc.onConnect = (remoteStream) => {
        if (remoteStream) $("remote").srcObject = remoteStream;

        const hasMedia = (mode !== "none");
        micMuted = !!$("startMuted").checked;
        camMuted = !!$("startCamOff").checked;

        if (hasMedia) {
            rtc.muteAudio(micMuted);
            rtc.muteVideo(camMuted);
        }

        setConnectedUI(true, hasMedia);
        updateMediaUI();
        renderRoster();
        status(`Connected (uuid=${rtc.uuid})`);
        setConnBadge("connected", "Connected");
    };

    rtc.onDisconnect = (reason) => {
        const msg = `Disconnected${reason ? ": " + reason : ""}`;
        resetCallState(msg);
    };

    rtc.onError = (err) => {
        console.error(err);
        alert("PexRTC error: " + (err?.message || err));
        resetCallState("Call error (reset)");
        setConnBadge("error", "Error");
    };

    rtc.onLiveCaptions = (msg) => {
        if (!msg?.data) return;

        const speakerUuid = msg?.sources?.[0]?.participant_uuid;

        if (msg.is_final) {
            lines.push(buildEntryFromCaption(msg));
            renderTranscript();
            if (speakerUuid) markCaptionActivity(speakerUuid);
        } else {
            if (speakerUuid) markCaptionActivity(speakerUuid, 1200);
        }
    };

    rtc.onScreenshareConnected = () => { sharing = true; updateMediaUI(); };
    rtc.onScreenshareStopped = () => { sharing = false; updateMediaUI(); };

    const callType =
        mode === "audioonly" ? "audioonly" :
            mode === "recvonly" ? "recvonly" :
                mode === "none" ? "none" :
                    null;

    status("Connecting…");
    setConnBadge("connecting", "Connecting…");
    renderRoster();
    rtc.makeCall(node, alias, name, null, callType);
};

$("leave").onclick = () => {
    if (!rtc) return;

    status("Disconnecting…");
    $("leave").disabled = true;

    if (disconnectWatchdog) clearTimeout(disconnectWatchdog);
    disconnectWatchdog = setTimeout(() => {
        if (rtc) resetCallState("Disconnected (watchdog)");
    }, 2500);

    try {
        rtc.disconnect();
    } catch (e) {
        console.warn("disconnect() threw:", e);
        resetCallState("Disconnected (local reset)");
    }
};

// ----------------------------
// Media controls
// ----------------------------
$("toggleMic").onclick = () => {
    if (!rtc) return;
    micMuted = !micMuted;
    rtc.muteAudio(micMuted);
    updateMediaUI();
};

$("toggleCam").onclick = () => {
    if (!rtc) return;
    camMuted = !camMuted;
    rtc.muteVideo(camMuted);
    updateMediaUI();
};

$("toggleShare").onclick = () => {
    if (!rtc) return;
    rtc.present(sharing ? null : "screen");
};

// ----------------------------
// Captions controls
// ----------------------------
$("captionsOn").onclick = () => {
    if (!rtc) return;
    rtc.showLiveCaptions(rtc.uuid);
    status("Captions enabled.");
};

$("captionsOff").onclick = () => {
    if (!rtc) return;
    rtc.hideLiveCaptions(rtc.uuid);
    status("Captions disabled.");
};

$("download").onclick = () => {
    const fmt = $("downloadFormat").value;
    const safeStamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `pexip-captions-${safeStamp}`;

    let body = "";
    let ext = fmt;

    if (fmt === "txt") body = toTxt(lines);
    else if (fmt === "json") body = toJson(lines);
    else if (fmt === "csv") body = toCsv(lines);
    else if (fmt === "srt") body = toSrt(lines);
    else body = toTxt(lines);

    const mime =
        fmt === "json" ? "application/json;charset=utf-8" :
            fmt === "csv" ? "text/csv;charset=utf-8" :
                fmt === "srt" ? "application/x-subrip;charset=utf-8" :
                    "text/plain;charset=utf-8";

    downloadText(`${base}.${ext}`, body, mime);
};

$("clear").onclick = () => {
    lines = [];
    renderTranscript();
    status("Buffer cleared.");
};

// Roster refresh (manual)
$("refreshRoster").onclick = () => renderRoster();

// initial
loadFormState();
wireFormAutoSave();
resetCallState("");
updateMediaUI();
setConnBadge("disconnected", "Disconnected");
