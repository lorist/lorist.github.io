// Central app state (shared singletons)
export const state = {
    rtc: null,

    // pexrtc loader
    pexrtcLoaded: false,
    lastLoadedNode: null,

    // captions transcript entries
    // { ts_ms, ts_iso, speaker_uuid, speaker_name, src_lang, tgt_lang, text }
    lines: [],

    // local media UI state
    micMuted: false,
    camMuted: false,
    sharing: false,

    // roster cache for speaker name resolution
    participantsByUuid: new Map(),

    // active speaker set + activity timers
    activeSpeakerUuids: new Set(),
    captionActivityTimers: new Map(),

    // disconnect watchdog
    disconnectWatchdog: null,
};
