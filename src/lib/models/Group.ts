export enum GroupType {
    Tag,
    Folder
}

export interface GroupJSON {
    id: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
    groupType: GroupType;
    parentGroupId?: string;
}

class Group {
    readonly id: string;
    // represents the title, in text.
    readonly _slug: string;
    readonly createdAt: Date;
    updatedAt: Date;
    readonly groupType: GroupType;
    parentGroupId?: string;

    constructor(groupJSON: GroupJSON) {
        this.id = groupJSON.id;
        this._slug = groupJSON.slug;
        this.createdAt = groupJSON.createdAt;
        this.updatedAt = groupJSON.updatedAt;
        this.groupType = groupJSON.groupType;
        this.parentGroupId = groupJSON.parentGroupId;
    }

    // toJSON(): GroupJSON {
    //     return {}
    // }
    //
    // static fromJSON(): Group {
    // }
    //

    get slug(): string {
        return this._slug;
    }

    async updateSlug(newSlug: string): Promise<void> {
        // todo
    }
}

export default Group;