import { invoke } from '@tauri-apps/api/core';

export interface Vault {
    id: string;
    title: string;
    path: string;
    created_at: string;
    accessed_at: string;
}

export async function getActiveVault(): Promise<Vault> {
    const vault = await invoke<Vault | null>('get_active_vault');
    if (!vault) throw new Error('No active vault');
    return vault;
}
