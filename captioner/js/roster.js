import { state } from "./state.js";
import { $ } from "./dom.js";

export function getBestParticipantName(uuid) {
    if (!uuid) return "Unknown";
    const p = state.participantsByUuid.get(uuid);

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

export function renderRoster() {
    const container = $("rosterList");
    const meta = $("rosterMeta");
    if (!container || !meta) return;

    if (!state.rtc) {
        meta.textContent = "Not connected";
        container.innerHTML = `<div class="muted">Join a conference to see participants.</div>`;
        return;
    }

    const items = Array.from(state.participantsByUuid.values())
        .filter((p) => p && p.uuid)
        .sort((a, b) =>
            String(a.display_name || a.name || a.uuid)
                .localeCompare(String(b.display_name || b.name || b.uuid))
        );

    meta.textContent = `${items.length} participant${items.length === 1 ? "" : "s"}`;

    if (items.length === 0) {
        container.innerHTML = `<div class="muted">Waiting for roster…</div>`;
        return;
    }

    container.innerHTML = items.map((p) => {
        const uuid = p.uuid;
        const isActive = state.activeSpeakerUuids.has(uuid);
        const name = getBestParticipantName(uuid);
        const stateBits = getParticipantState(p);

        return `
      <div class="rosterItem ${isActive ? "activeSpeaker" : ""}" data-uuid="${uuid}">
        <div class="rosterTop">
          <div class="rosterName" title="${name}">${name}</div>
          <span class="rosterBadge">${isActive ? "ACTIVE" : shortUuid(uuid)}</span>
        </div>
        <div class="rosterSub">
          ${stateBits.map((s) => `<span class="kv">${s}</span>`).join("")}
        </div>
      </div>
    `;
    }).join("");
}

export function setActiveSpeakers(uuids) {
    state.activeSpeakerUuids.clear();
    for (const u of (uuids || [])) if (u) state.activeSpeakerUuids.add(u);
    renderRoster();
}

export function clearCaptionActivityTimers() {
    for (const t of state.captionActivityTimers.values()) clearTimeout(t);
    state.captionActivityTimers.clear();
}

export function markCaptionActivity(uuid, ms = 2200) {
    if (!uuid) return;

    state.activeSpeakerUuids.add(uuid);
    renderRoster();

    if (state.captionActivityTimers.has(uuid)) clearTimeout(state.captionActivityTimers.get(uuid));

    const t = setTimeout(() => {
        state.captionActivityTimers.delete(uuid);
        state.activeSpeakerUuids.delete(uuid);
        renderRoster();
    }, ms);

    state.captionActivityTimers.set(uuid, t);
}
