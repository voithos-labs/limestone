export function serializeProofOfConceptDocument(document) {
    return `${document.prefix}${document.blocks.map((block) => `${block.leadingTrivia}${block.source}`).join("")}${document.suffix}`;
}
