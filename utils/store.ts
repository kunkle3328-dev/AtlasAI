import { Source, ExportItem, AppSettings, Workspace, VoiceProfile } from '../types';
import { INITIAL_SOURCES, INITIAL_EXPORTS } from '../constants';
import { PRESET_PROFILES } from './voiceEngine';

// Keys for localStorage
const STORAGE_KEYS = {
  SOURCES: 'atlas_sources_v2',
  EXPORTS: 'atlas_exports_v2',
  SETTINGS: 'atlas_settings_v2',
  WORKSPACES: 'atlas_workspaces_v2',
  VOICE_PROFILES: 'atlas_voice_profiles_v3'
};

// Default Settings
const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Explorer',
  activeVoiceProfileId: 'teacher-warm',
  dailyUsageMinutes: 0,
  plan: 'free',
  intelligenceMode: 'explain',
  webSearchEnabled: true
};

class Store {
  
  getSources(): Source[] {
    const data = localStorage.getItem(STORAGE_KEYS.SOURCES);
    return data ? JSON.parse(data) : INITIAL_SOURCES;
  }

  addSource(source: Source) {
    const sources = this.getSources();
    const newSources = [source, ...sources];
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(newSources));
    return newSources;
  }

  deleteSource(id: string) {
    const sources = this.getSources().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEYS.SOURCES, JSON.stringify(sources));
    return sources;
  }

  getExports(): ExportItem[] {
    const data = localStorage.getItem(STORAGE_KEYS.EXPORTS);
    return data ? JSON.parse(data) : INITIAL_EXPORTS;
  }

  addExport(item: ExportItem) {
    const items = this.getExports();
    const newItems = [item, ...items];
    localStorage.setItem(STORAGE_KEYS.EXPORTS, JSON.stringify(newItems));
    return newItems;
  }

  getSettings(): AppSettings {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return data ? JSON.parse(data) : DEFAULT_SETTINGS;
  }

  updateSettings(partial: Partial<AppSettings>) {
    const current = this.getSettings();
    const updated = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    return updated;
  }

  // Voice Profiles
  getVoiceProfiles(): VoiceProfile[] {
      const data = localStorage.getItem(STORAGE_KEYS.VOICE_PROFILES);
      if (!data) {
          // Initialize with presets
          localStorage.setItem(STORAGE_KEYS.VOICE_PROFILES, JSON.stringify(PRESET_PROFILES));
          return PRESET_PROFILES;
      }
      return JSON.parse(data);
  }

  saveVoiceProfile(profile: VoiceProfile) {
      const profiles = this.getVoiceProfiles();
      const index = profiles.findIndex(p => p.id === profile.id);
      if (index >= 0) {
          profiles[index] = profile;
      } else {
          profiles.push(profile);
      }
      localStorage.setItem(STORAGE_KEYS.VOICE_PROFILES, JSON.stringify(profiles));
      return profiles;
  }

  deleteVoiceProfile(id: string) {
      let profiles = this.getVoiceProfiles();
      // Don't delete presets if you want to be safe, but for now we allow full control except active
      profiles = profiles.filter(p => p.id !== id);
      localStorage.setItem(STORAGE_KEYS.VOICE_PROFILES, JSON.stringify(profiles));
      return profiles;
  }

  getActiveProfile(): VoiceProfile {
      const settings = this.getSettings();
      const profiles = this.getVoiceProfiles();
      return profiles.find(p => p.id === settings.activeVoiceProfileId) || PRESET_PROFILES[0];
  }

  // Workspaces (Simulated)
  getWorkspaces(): Workspace[] {
    return [{ id: 'ws-1', name: 'Personal', role: 'owner' }];
  }
}

export const db = new Store();