export const BYTE_ORDER_MARK = "\uFEFF";
export const LF = "\n";
export const CRLF = "\r\n";
export function createDefaultFileEncodingMetadata() {
    return {
        hasBom: false,
        lineEnding: LF,
        hasFinalNewline: false,
    };
}
export function hasFinalNewline(text) {
    return text.endsWith(CRLF) || text.endsWith(LF);
}
export function detectPreferredLineEnding(text) {
    const firstCrLf = text.indexOf(CRLF);
    const firstLf = text.indexOf(LF);
    if (firstCrLf === -1 && firstLf === -1) {
        return LF;
    }
    if (firstCrLf !== -1 && (firstLf === -1 || firstCrLf <= firstLf)) {
        return CRLF;
    }
    return LF;
}
export function analyzeDocumentText(rawText) {
    const hasBom = rawText.startsWith(BYTE_ORDER_MARK);
    const text = hasBom ? rawText.slice(BYTE_ORDER_MARK.length) : rawText;
    return {
        text,
        metadata: {
            hasBom,
            lineEnding: detectPreferredLineEnding(text),
            hasFinalNewline: hasFinalNewline(text),
        },
    };
}
export function normalizeLineEndings(text, lineEnding) {
    const normalized = text.replace(/\r\n|\r|\n/g, LF);
    if (lineEnding === LF) {
        return normalized;
    }
    return normalized.replace(/\n/g, CRLF);
}
export function normalizeTextInsertion(text, metadata) {
    return normalizeLineEndings(text, metadata.lineEnding);
}
export function serializeDocumentText(text, metadata) {
    return `${metadata.hasBom ? BYTE_ORDER_MARK : ""}${text}`;
}
