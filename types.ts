export type NavTab = 'talk' | 'library' | 'learn' | 'exports' | 'tuning' | 'settings' | 'admin';

export type UserRole = 'owner' | 'editor' | 'viewer';

export type IntelligenceMode = 'quick' | 'explain' | 'teach' | 'brief';

export interface Workspace {
  id: string;
  name: string;
  role: UserRole;
}

export interface Source {
  id: string;
  workspaceId: string;
  title: string;
  type: 'pdf' | 'url' | 'text' | 'youtube' | 'discovery';
  dateAdded: string;
  summary?: string;
  content: string;
  tokens?: number;
  url?: string;
}

export interface ExportItem {
  id: string;
  workspaceId: string;
  title: string;
  type: 'note' | 'flashcards' | 'quiz' | 'pdf' | 'bundle';
  dateCreated: string;
  content: string; // The actual generated content
  tags?: string[];
}

export interface VoiceHumanizerConfig {
  microPauses: boolean;
  sentenceVariety: boolean;
  discourseMarkers: boolean;
  avoidRoboticLists: boolean;
  prosodyEmphasis: boolean;
  deMonotone: boolean;
  noReadingVoice: boolean;
}

export interface VoiceProfile {
  id: string;
  name: string;
  isDefault?: boolean;
  // Core Sliders (0.0 to 1.0 mostly, Speed 0.5-2.0)
  speed: number; 
  pauseDensity: number;
  warmth: number;
  energy: number;
  clarity: number;
  expressiveness: number;
  directness: number;
  conciseness: number;
  confidence: number;
  positivity: number;
  breathiness: number; // 0=off, 1=high
  disfluency: number; // 0=clean, 1=natural messiness
  fillers: number;
  laughs: number;
  empathy: number;
  bargeInSensitivity: number; // 0.0 (Hard) to 1.0 (Easy)
  
  humanizer: VoiceHumanizerConfig;
}

export interface TeachSessionPlan {
  goal: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Expert';
  steps: {
    title: string;
    description: string;
    keyPoints: string[];
  }[];
}

export interface AppSettings {
  userName: string;
  activeVoiceProfileId: string;
  dailyUsageMinutes: number;
  plan: 'free' | 'pro' | 'team';
  intelligenceMode: IntelligenceMode;
  webSearchEnabled: boolean;
}

export interface VoicePreviewResult {
  id: string;
  timestamp: number;
  duration: number;
  qualityScore: number;
  profileId: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}
