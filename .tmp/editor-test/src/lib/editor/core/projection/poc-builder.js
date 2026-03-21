/**
 * Read-only view projection builder for the editor proof of concept.
 */
import { buildInputHarnessProofOfConcept } from "../input/poc-harness.js";
/**
 * Builds a disposable rendering projection directly from markdown source.
 */
export function buildViewProjectionProofOfConcept(source, metadata = {}) {
    return projectInputHarnessDocument(buildInputHarnessProofOfConcept(source, metadata));
}
/**
 * Builds a disposable rendering projection from the existing input-harness proof document.
 */
export function projectInputHarnessDocument(document) {
    return {
        source: document.source,
        blocks: document.blocks.map((block) => buildProjectionBlock(document, block)),
    };
}
/**
 * Finds the first projection block for a role, which keeps projection tests and demos readable.
 */
export function findFirstViewProjectionBlockByRole(document, role) {
    return document.blocks.find((block) => block.role === role);
}
function buildProjectionBlock(document, block) {
    const containerContext = createContainerContext(block);
    const editable = block.editable;
    const runs = editable ? buildProjectionRuns(document, block) : [];
    return {
        key: `projection:${block.key}`,
        blockKey: block.key,
        blockIndex: block.blockIndex,
        kind: block.kind,
        role: block.role,
        depth: containerContext.listDepth + containerContext.quoteDepth,
        containerContext,
        metadata: { ...block.block.metadata },
        editable,
        runs,
        rawSource: editable ? undefined : block.block.source,
    };
}
function createContainerContext(block) {
    const ordered = block.block.metadata.ordered === true;
    const listDepth = block.role === "listItem" ? 1 : 0;
    const quoteDepth = block.block.metadata.quoteDepth ?? 0;
    return {
        listDepth,
        quoteDepth,
        listKind: listDepth === 0 ? undefined : ordered ? "ordered" : "unordered",
        taskItem: block.block.metadata.taskItem,
        taskChecked: block.block.metadata.taskChecked,
    };
}
function buildProjectionRuns(document, block) {
    const runs = [];
    for (const part of block.parts) {
        if (part.kind === "atom") {
            runs.push({
                key: `run:${part.key}`,
                partKey: part.key,
                text: part.source,
                sourceRange: part.sourceRange,
                source: part.source,
                marks: [],
                editable: false,
                atomic: {
                    kind: part.atomKind,
                    source: part.source,
                },
            });
            continue;
        }
        const tokenRuns = buildTextRuns(document.source, block, part);
        if (tokenRuns.length > 0) {
            runs.push(...tokenRuns);
        }
    }
    return runs;
}
function buildTextRuns(source, block, part) {
    const inlineTokens = block.block.inlineTokens
        .filter((token) => token.kind !== "image" && intersectsRange(token.range, part.sourceRange))
        .sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
    if (part.sourceRange.start === part.sourceRange.end) {
        return [
            {
                key: `run:${part.key}:0`,
                partKey: part.key,
                text: "",
                sourceRange: part.sourceRange,
                source: "",
                marks: [],
                editable: true,
            },
        ];
    }
    const boundaries = new Set([part.sourceRange.start, part.sourceRange.end]);
    for (const token of inlineTokens) {
        boundaries.add(clamp(token.range.start, part.sourceRange.start, part.sourceRange.end));
        boundaries.add(clamp(token.range.end, part.sourceRange.start, part.sourceRange.end));
    }
    const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
    const runs = [];
    for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
        const segmentStart = sortedBoundaries[index];
        const segmentEnd = sortedBoundaries[index + 1];
        if (segmentStart === segmentEnd) {
            continue;
        }
        const segmentSource = source.slice(segmentStart, segmentEnd);
        const marks = inlineTokens
            .filter((token) => coversRange(token.range, { start: segmentStart, end: segmentEnd }))
            .map((token) => toProjectionMark(token.kind));
        runs.push({
            key: `run:${part.key}:${index}`,
            partKey: part.key,
            text: segmentSource,
            sourceRange: {
                start: segmentStart,
                end: segmentEnd,
            },
            source: segmentSource,
            marks,
            editable: true,
        });
    }
    return runs;
}
function toProjectionMark(kind) {
    switch (kind) {
        case "emphasis":
        case "strong":
        case "strikethrough":
        case "inlineCode":
        case "link":
        case "autolink":
            return kind;
        case "image":
            throw new Error("Image tokens should be projected as atomic runs, not marks.");
    }
}
function intersectsRange(left, right) {
    return left.start < right.end && right.start < left.end;
}
function coversRange(container, content) {
    return container.start <= content.start && container.end >= content.end;
}
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
