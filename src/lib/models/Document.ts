// @ts-ignore > Document is reserved??

// External
import {v4 as uuidv4} from 'uuid';


// Internal
import type Group from "./Group";


export interface DocumentJSON {
    id: string;
    relPath?: string;
    title: string;
    updatedAt: Date;
    createdAt: Date;
    groupIds: string[];
    properties: Record<string, unknown>;
}

/**
 * Document
 *
 * todo
 * As is, since for most of development we will simply be using this to represent markdown documents, the features for
 * such will remain here. Later, when we distinguish the different kinds of documents, I will likely separate out some
 * of the functionality to MarkdownDocument or FileDocument.
 *
 */
class Document {
    readonly id: string;
    private _relPath?: string;
    title: string;
    readonly createdAt: Date;
    updatedAt: Date;
    group_ids: string[];
    properties: Record<string, unknown>;

    constructor(documentJSON: DocumentJSON) {
        this.id = documentJSON.id;
        this.title = documentJSON.title;
        this.createdAt = documentJSON.createdAt;
        this.updatedAt = documentJSON.updatedAt;
        this.group_ids = documentJSON.groupIds;
        this.properties = documentJSON.properties;

    }

    static create(title: string, groupIds: string[], properties: Record<string, unknown>): Document {
        return new Document({
            id: uuidv4(),
            title: title,
            createdAt: new Date(),
            updatedAt: new Date(),
            groupIds: groupIds,
            properties: properties
        })
    }

    static fromJSON(jsonObject: Record<string, unknown>) {

    }

    get relPath(): string | undefined {
        return this._relPath;
    }

    async moveToPath(newPath: string) {

    }

    /**
     *
     * @param updateUpdatedAt update updatedAt value if true, default: true
     *
     * For markdown, should we handle this here or in rust?
     */
    async save(updateUpdatedAt: boolean = true): Promise<void> {
        // todo
    }

    async reload() {
        // todo
    }

}

export default Document;