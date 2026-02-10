function pad2(n) { return String(n).padStart(2, "0"); }
function pad3(n) { return String(n).padStart(3, "0"); }

function escapeCsvCell(v) {
    const s = (v === null || v === undefined) ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export function toTxt(entries) {
    return entries.map((e) => {
        const lang = (e.src_lang || e.tgt_lang) ? ` (${e.src_lang || "?"}→${e.tgt_lang || "?"})` : "";
        return `[${e.ts_iso}] ${e.speaker_name}${lang}: ${e.text}`;
    }).join("\n");
}

export function toJson(entries) {
    return JSON.stringify(entries, null, 2);
}

export function toCsv(entries) {
    const header = ["ts_iso", "ts_ms", "speaker_name", "speaker_uuid", "src_lang", "tgt_lang", "text"];
    const rows = entries.map((e) => [
        e.ts_iso, e.ts_ms, e.speaker_name, e.speaker_uuid, e.src_lang, e.tgt_lang, e.text
    ]);
    return [header.join(","), ...rows.map((r) => r.map(escapeCsvCell).join(","))].join("\n");
}

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
export function toSrt(entries) {
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

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
