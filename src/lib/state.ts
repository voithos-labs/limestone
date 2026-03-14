import { readTextFile, writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";

export interface VaultState {
    activeTheme: string;
}

const DEFAULT_STATE: VaultState = {
    activeTheme: "default-dark",
};

function statePath(vaultPath: string): string {
    return `${vaultPath}/.limestone/state.json`;
}

export async function loadState(vaultPath: string): Promise<VaultState> {
    const path = statePath(vaultPath);
    if (!(await exists(path))) {
        return { ...DEFAULT_STATE };
    }
    const raw = await readTextFile(path);
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
}

export async function saveState(vaultPath: string, state: VaultState): Promise<void> {
    const dir = `${vaultPath}/.limestone`;
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
    await writeTextFile(statePath(vaultPath), JSON.stringify(state, null, 2));
}

export async function updateState(vaultPath: string, partial: Partial<VaultState>): Promise<void> {
    const current = await loadState(vaultPath);
    await saveState(vaultPath, { ...current, ...partial });
}
