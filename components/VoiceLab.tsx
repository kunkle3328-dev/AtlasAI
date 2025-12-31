import React, { useState, useEffect } from 'react';
import { VoiceProfile, VoiceHumanizerConfig } from '../types';
import { Icons } from '../constants';
import { db } from '../utils/store';
import { resolveVoiceSettings, calculateQualityScore, optimizeVoiceProfile, TOOLTIPS } from '../utils/voiceEngine';
import { GoogleGenAI } from '@google/genai';

// --- SUB-COMPONENTS ---

const TooltipTrigger = ({ text }: { text: string }) => {
  const [visible, setVisible] = useState(false);
  
  return (
    <div className="relative inline-block ml-2">
      <button 
        type="button"
        className="text-gray-500 hover:text-atlas-400 transition-colors cursor-help focus:outline-none"
        onClick={() => setVisible(!visible)}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      </button>
      
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-900 border border-white/10 rounded-lg shadow-xl text-xs text-gray-300 z-50 animate-in fade-in zoom-in-95 pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
        </div>
      )}
    </div>
  );
};

const SliderControl = ({ label, value, onChange, min = 0, max = 1, step = 0.1, lowLabel = 'Low', highLabel = 'High', tooltipKey }: any) => (
  <div className="space-y-3 p-3 rounded-xl bg-white/5 md:bg-transparent md:p-0">
    <div className="flex justify-between items-end">
      <div className="flex items-center">
        <label className="text-sm font-medium text-gray-300">{label}</label>
        {tooltipKey && TOOLTIPS[tooltipKey] && <TooltipTrigger text={TOOLTIPS[tooltipKey]} />}
      </div>
      <span className="text-xs font-mono text-atlas-500 bg-atlas-500/10 px-2 py-0.5 rounded min-w-[3rem] text-center">{value.toFixed(1)}</span>
    </div>
    <div className="relative h-4 bg-gray-800 rounded-full cursor-pointer group">
      <input 
        type="range" min={min} max={max} step={step} value={value} 
        onChange={e => onChange(parseFloat(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
      />
      <div className="absolute top-1 left-1 right-1 bottom-1 bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-atlas-600 to-indigo-400 rounded-full transition-all duration-75" style={{ width: `${((value - min) / (max - min)) * 100}%` }} />
      </div>
      <div 
        className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full shadow-lg pointer-events-none transition-all z-10 group-active:scale-110" 
        style={{ left: `${((value - min) / (max - min)) * 100}%`, transform: 'translate(-50%, -50%)' }} 
      />
    </div>
    <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wider font-medium px-1">
      <span>{lowLabel}</span>
      <span>{highLabel}</span>
    </div>
  </div>
);

const ToggleControl = ({ label, checked, onChange, description }: any) => (
  <div className="flex items-start justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10" onClick={() => onChange(!checked)}>
    <div className="space-y-1 pr-4">
      <h4 className="text-sm font-medium text-gray-200">{label}</h4>
      {description && <p className="text-xs text-gray-500 leading-relaxed">{description}</p>}
    </div>
    <div className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${checked ? 'bg-atlas-600' : 'bg-gray-700'}`}>
      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </div>
  </div>
);

// --- MAIN COMPONENT ---

export const VoiceLab: React.FC = () => {
  const [profiles, setProfiles] = useState<VoiceProfile[]>(db.getVoiceProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string>(db.getSettings().activeVoiceProfileId);
  const [editingProfile, setEditingProfile] = useState<VoiceProfile>(profiles.find(p => p.id === activeProfileId) || profiles[0]);
  const [activeTab, setActiveTab] = useState<'profiles' | 'controls' | 'humanizer' | 'preview' | 'ab' | 'autotune'>('profiles');
  const [userName, setUserName] = useState(db.getSettings().userName);
  
  // Preview State
  const [previewText, setPreviewText] = useState("Hi there. I'm Atlas. I can help you learn anything you want.");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [qualityScore, setQualityScore] = useState<{score: number, feedback: string[]} | null>(null);

  // Auto-Tune State
  const [autoTuneTarget, setAutoTuneTarget] = useState<'human' | 'professional' | 'friendly'>('human');
  const [isOptimizing, setIsOptimizing] = useState(false);

  useEffect(() => {
    // Sync active profile when switching
    const p = profiles.find(p => p.id === activeProfileId);
    if (p) setEditingProfile({ ...p }); 
  }, [activeProfileId, profiles]);

  const saveProfile = () => {
    db.saveVoiceProfile(editingProfile);
    db.updateSettings({ activeVoiceProfileId: editingProfile.id, userName });
    setProfiles(db.getVoiceProfiles());
    setActiveProfileId(editingProfile.id);
    alert('Profile saved!');
  };

  const handleSliderChange = (key: keyof VoiceProfile, val: number) => {
    setEditingProfile(prev => ({ ...prev, [key]: val }));
  };

  const handleHumanizerChange = (key: keyof VoiceHumanizerConfig, val: boolean) => {
    setEditingProfile(prev => ({ ...prev, humanizer: { ...prev.humanizer, [key]: val } }));
  };

  const runPreview = async () => {
    if (!process.env.API_KEY) return alert("API Key Required");
    setPreviewLoading(true);
    try {
        const resolved = resolveVoiceSettings(editingProfile);
        const transformedScript = resolved.scriptTransforms(previewText);
        
        await new Promise(r => setTimeout(r, 1000));
        const qs = calculateQualityScore(transformedScript);
        setQualityScore(qs);
    } catch (e) {
        console.error(e);
    } finally {
        setPreviewLoading(false);
    }
  };

  const runAutoTune = () => {
      setIsOptimizing(true);
      setTimeout(() => {
          const optimized = optimizeVoiceProfile(editingProfile, autoTuneTarget);
          setEditingProfile(optimized);
          setIsOptimizing(false);
          setActiveTab('controls'); 
          alert(`Optimized for ${autoTuneTarget} target!`);
      }, 1500);
  };

  const createNewProfile = () => {
    const newProfile: VoiceProfile = {
        ...profiles[0],
        id: crypto.randomUUID(),
        name: 'New Profile',
    };
    db.saveVoiceProfile(newProfile);
    setProfiles(db.getVoiceProfiles());
    setActiveProfileId(newProfile.id);
  };

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto p-4 md:p-8 space-y-6 pb-40 md:pb-32">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h2 className="text-3xl font-light text-white tracking-tight">Voice Lab <span className="text-atlas-500 text-sm font-bold align-top px-1.5 py-0.5 bg-atlas-500/10 rounded ml-2">PRO</span></h2>
                <p className="text-gray-400 text-sm">Design your perfect AI persona.</p>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={createNewProfile} className="flex-1 md:flex-none px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-300">
                    <Icons.Add className="w-4 h-4 inline mr-2"/>New
                </button>
                <button onClick={saveProfile} className="flex-1 md:flex-none px-6 py-2 bg-atlas-600 hover:bg-atlas-500 text-white font-medium rounded-lg shadow-lg shadow-atlas-600/20">
                    Save
                </button>
            </div>
        </div>

        {/* User Name Input */}
        <div className="glass-card p-4 rounded-xl flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-atlas-500 to-indigo-500 flex items-center justify-center text-white font-bold">
                {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">CALL ME</label>
                <input 
                    className="bg-transparent text-white font-medium outline-none w-full placeholder-gray-600"
                    value={userName}
                    onChange={e => setUserName(e.target.value)}
                    placeholder="Enter your name..."
                />
            </div>
        </div>

        {/* Main Interface */}
        <div className="glass-card rounded-2xl flex flex-col md:flex-row min-h-[600px] h-full overflow-hidden">
            {/* Sidebar / Tabs - Horizontal scroll on mobile */}
            <div className="w-full md:w-64 bg-black/20 border-b md:border-b-0 md:border-r border-white/5 p-2 md:p-4 flex flex-row md:flex-col gap-2 overflow-x-auto shrink-0 scrollbar-hide">
                {[
                    { id: 'profiles', label: 'Profiles', icon: Icons.Library },
                    { id: 'controls', label: 'Controls', icon: Icons.Tuning },
                    { id: 'humanizer', label: 'Humanizer', icon: Icons.Mic },
                    { id: 'autotune', label: 'Auto-Tune', icon: Icons.Check },
                    { id: 'preview', label: 'Test', icon: Icons.Play },
                ].map(tab => (
                    <button 
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`whitespace-nowrap px-4 py-2 md:py-3 rounded-xl flex items-center gap-2 transition-colors ${activeTab === tab.id ? 'bg-atlas-600/20 text-atlas-400 border border-atlas-500/20' : 'hover:bg-white/5 text-gray-400'}`}
                    >
                        <tab.icon className="w-4 h-4" />
                        <span className="font-medium text-sm">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 p-4 md:p-8 bg-gradient-to-br from-gray-900/50 to-transparent overflow-y-auto pb-32">
                
                {activeTab === 'profiles' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {profiles.map(p => (
                            <div 
                                key={p.id} 
                                onClick={() => setActiveProfileId(p.id)}
                                className={`p-4 rounded-xl border cursor-pointer transition-all ${activeProfileId === p.id ? 'bg-atlas-500/10 border-atlas-500/50 ring-1 ring-atlas-500/50' : 'bg-white/5 border-transparent hover:border-white/10'}`}
                            >
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className={`font-medium ${activeProfileId === p.id ? 'text-white' : 'text-gray-300'}`}>{p.name}</h3>
                                    {activeProfileId === p.id && <span className="text-[10px] bg-atlas-500 text-white px-2 py-0.5 rounded-full">ACTIVE</span>}
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                                    <span className="bg-black/30 px-2 py-1 rounded">Speed: {p.speed}x</span>
                                    <span className="bg-black/30 px-2 py-1 rounded">Warmth: {(p.warmth * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'controls' && (
                    <div className="space-y-8 animate-in fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            <h3 className="col-span-full text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Delivery</h3>
                            <SliderControl label="Rate / Pace" tooltipKey="speed" value={editingProfile.speed} onChange={(v: number) => handleSliderChange('speed', v)} min={0.5} max={1.5} lowLabel="Slow" highLabel="Fast" />
                            <SliderControl label="Pause Density" tooltipKey="pauseDensity" value={editingProfile.pauseDensity} onChange={(v: number) => handleSliderChange('pauseDensity', v)} lowLabel="Continuous" highLabel="Breathy" />
                            
                            <h3 className="col-span-full text-xs font-mono text-gray-500 uppercase tracking-wider mb-2 mt-4">Tone & Persona</h3>
                            <SliderControl label="Warmth" tooltipKey="warmth" value={editingProfile.warmth} onChange={(v: number) => handleSliderChange('warmth', v)} lowLabel="Cool" highLabel="Warm" />
                            <SliderControl label="Energy" tooltipKey="energy" value={editingProfile.energy} onChange={(v: number) => handleSliderChange('energy', v)} lowLabel="Calm" highLabel="Dynamic" />
                            <SliderControl label="Directness" tooltipKey="directness" value={editingProfile.directness} onChange={(v: number) => handleSliderChange('directness', v)} lowLabel="Gentle" highLabel="Blunt" />
                            <SliderControl label="Confidence" tooltipKey="confidence" value={editingProfile.confidence} onChange={(v: number) => handleSliderChange('confidence', v)} lowLabel="Tentative" highLabel="Assertive" />
                            
                            <h3 className="col-span-full text-xs font-mono text-gray-500 uppercase tracking-wider mb-2 mt-4">Quirks</h3>
                            <SliderControl label="Disfluency (Ums/Ahs)" tooltipKey="disfluency" value={editingProfile.disfluency} onChange={(v: number) => handleSliderChange('disfluency', v)} lowLabel="Clean" highLabel="Natural" />
                            <SliderControl label="Laughs / Chuckles" tooltipKey="laughs" value={editingProfile.laughs} onChange={(v: number) => handleSliderChange('laughs', v)} lowLabel="Serious" highLabel="Playful" />
                            
                            <h3 className="col-span-full text-xs font-mono text-gray-500 uppercase tracking-wider mb-2 mt-4">Audio Settings</h3>
                            <SliderControl label="Barge-in Sensitivity" tooltipKey="bargeInSensitivity" value={editingProfile.bargeInSensitivity || 0.5} onChange={(v: number) => handleSliderChange('bargeInSensitivity', v)} lowLabel="Hard" highLabel="Easy" />

                        </div>
                    </div>
                )}

                {activeTab === 'humanizer' && (
                    <div className="space-y-6">
                        <div className="p-4 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-500/20 mb-6">
                            <h3 className="text-indigo-300 font-medium mb-1">Humanizer Engine™</h3>
                            <p className="text-sm text-gray-400">These settings subtly reshape the AI's script to sound less like a reading robot and more like a thinking human.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            <ToggleControl 
                                label="Micro-Pauses" 
                                description="Adds natural breathing room after clauses."
                                checked={editingProfile.humanizer.microPauses} 
                                onChange={(v: boolean) => handleHumanizerChange('microPauses', v)} 
                            />
                            <ToggleControl 
                                label="Sentence Variety" 
                                description="Prevents repetitive sentence structures and lengths."
                                checked={editingProfile.humanizer.sentenceVariety} 
                                onChange={(v: boolean) => handleHumanizerChange('sentenceVariety', v)} 
                            />
                            <ToggleControl 
                                label="Discourse Markers" 
                                description="Uses 'so', 'actually', 'you know' to connect thoughts."
                                checked={editingProfile.humanizer.discourseMarkers} 
                                onChange={(v: boolean) => handleHumanizerChange('discourseMarkers', v)} 
                            />
                            <ToggleControl 
                                label="Avoid Robotic Lists" 
                                description="Converts numbered lists into conversational narrative."
                                checked={editingProfile.humanizer.avoidRoboticLists} 
                                onChange={(v: boolean) => handleHumanizerChange('avoidRoboticLists', v)} 
                            />
                        </div>
                    </div>
                )}

                {activeTab === 'autotune' && (
                    <div className="space-y-8 animate-in fade-in h-full flex flex-col justify-center max-w-lg mx-auto">
                        <div className="text-center space-y-4">
                             <div className="w-16 h-16 bg-gradient-to-tr from-atlas-500 to-purple-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-atlas-500/30">
                                 <Icons.Check className="w-8 h-8 text-white" />
                             </div>
                             <h3 className="text-2xl font-light text-white">Auto-Tune Optimization</h3>
                             <p className="text-gray-400">Select a target personality and Atlas will automatically calibrate all sliders and humanizer settings for you.</p>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {[
                                { id: 'human', label: 'Maximum Human', desc: 'Optimized for natural imperfections, pauses, and warmth.' },
                                { id: 'professional', label: 'Executive Professional', desc: 'Crisp, clear, direct, and zero fluff.' },
                                { id: 'friendly', label: 'Friendly Companion', desc: 'High energy, positive, and conversational.' },
                            ].map(target => (
                                <button 
                                    key={target.id}
                                    onClick={() => setAutoTuneTarget(target.id as any)}
                                    className={`text-left p-4 rounded-xl border transition-all ${autoTuneTarget === target.id ? 'bg-atlas-500/20 border-atlas-500 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'}`}
                                >
                                    <div className="font-medium">{target.label}</div>
                                    <div className="text-xs opacity-70 mt-1">{target.desc}</div>
                                </button>
                            ))}
                        </div>

                        <button 
                            onClick={runAutoTune}
                            disabled={isOptimizing}
                            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors shadow-lg shadow-white/10 disabled:opacity-50"
                        >
                            {isOptimizing ? 'Calibrating...' : 'Apply Optimized Profile'}
                        </button>
                    </div>
                )}

                {activeTab === 'preview' && (
                    <div className="space-y-6 h-full flex flex-col">
                        <div className="flex-1 space-y-4">
                            <label className="text-sm font-medium text-gray-400">Test Prompt</label>
                            <textarea 
                                className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-4 text-white resize-none focus:border-atlas-500 outline-none"
                                value={previewText}
                                onChange={e => setPreviewText(e.target.value)}
                            />
                            <div className="flex gap-2">
                                <button onClick={() => setPreviewText("Hi, I'm Atlas. I'm here to help you learn faster.")} className="px-3 py-1 bg-white/5 rounded-full text-xs text-gray-400 hover:text-white">Intro</button>
                                <button onClick={() => setPreviewText("So, quantum entanglement is basically when two particles become linked...")} className="px-3 py-1 bg-white/5 rounded-full text-xs text-gray-400 hover:text-white">Explanation</button>
                            </div>
                        </div>

                        {qualityScore && (
                            <div className="p-4 bg-gray-800/50 rounded-xl border border-white/5 animate-in slide-in-from-bottom-2">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm text-gray-400">Human Voice Score</span>
                                    <span className={`text-xl font-bold ${qualityScore.score > 80 ? 'text-green-400' : 'text-yellow-400'}`}>{qualityScore.score}/100</span>
                                </div>
                                <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-3">
                                    <div className="h-full bg-gradient-to-r from-yellow-500 to-green-500 transition-all duration-1000" style={{ width: `${qualityScore.score}%` }} />
                                </div>
                                {qualityScore.feedback.length > 0 && (
                                    <ul className="text-xs text-gray-500 space-y-1">
                                        {qualityScore.feedback.map((f, i) => <li key={i}>• {f}</li>)}
                                    </ul>
                                )}
                            </div>
                        )}

                        <button 
                            onClick={runPreview} 
                            disabled={previewLoading}
                            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors flex justify-center items-center gap-2"
                        >
                            {previewLoading ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"/> : <Icons.Play className="w-5 h-5"/>}
                            {previewLoading ? 'Analyzing & Rendering...' : 'Generate Preview'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};
