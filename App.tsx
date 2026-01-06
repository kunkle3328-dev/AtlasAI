import React, { useState, useEffect, useRef } from 'react';
import { NavTab, Source, ExportItem, TeachSessionPlan, IntelligenceMode, SearchResult } from './types';
import { Icons } from './constants';
import VoiceVisualizer from './components/VoiceVisualizer';
import { VoiceLab } from './components/VoiceLab';
import { LiveClient, LiveState } from './services/liveApi';
import { db } from './utils/store';
import { retrieveContext, processFile } from './utils/rag';
import { resolveVoiceSettings, INTELLIGENCE_MODES } from './utils/voiceEngine';
import { GoogleGenAI, Modality } from '@google/genai';

// --- COMPONENTS ---

const CommandBar: React.FC<{ isOpen: boolean; onClose: () => void; onAction: (action: string) => void }> = ({ isOpen, onClose, onAction }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="w-full max-w-xl glass-card rounded-2xl overflow-hidden shadow-2xl animate-float" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <Icons.Search className="w-5 h-5 text-gray-400" />
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Type a command or search..." 
            className="bg-transparent w-full text-white outline-none placeholder-gray-500"
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          />
        </div>
        <div className="p-2">
           <div className="text-xs font-medium text-gray-500 px-2 py-2">SUGGESTED ACTIONS</div>
           {[{ id: 'talk', icon: Icons.Mic, label: 'Start Voice Session' }, { id: 'library', icon: Icons.Add, label: 'Upload New Source' }, { id: 'learn', icon: Icons.Learn, label: 'New Teach Session' }, { id: 'exports', icon: Icons.Exports, label: 'View Exports' }, { id: 'tuning', icon: Icons.Tuning, label: 'Open Voice Lab' }, { id: 'settings', icon: Icons.Settings, label: 'Settings & Profile' }].map(action => (
             <button key={action.id} onClick={() => { onAction(action.id); onClose(); }} className="w-full text-left flex items-center gap-3 px-3 py-3 hover:bg-white/5 rounded-lg group transition-colors">
                <div className="p-1.5 rounded bg-gray-800 group-hover:bg-atlas-600/20 text-gray-400 group-hover:text-atlas-400 transition-colors"><action.icon className="w-4 h-4" /></div>
                <span className="text-gray-300 group-hover:text-white">{action.label}</span>
             </button>
           ))}
        </div>
      </div>
    </div>
  );
};

const SettingsPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const [name, setName] = useState(db.getSettings().userName);
    const [saved, setSaved] = useState(false);

    const save = () => {
        db.updateSettings({ userName: name });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="p-6 pb-24 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
             <div className="flex items-center gap-4">
                 <button onClick={onBack} className="p-2 rounded-full hover:bg-white/10 transition-colors"><Icons.ArrowLeft className="w-6 h-6 text-gray-400 hover:text-white" /></button>
                 <h2 className="text-3xl font-light text-white tracking-tight">Settings</h2>
             </div>
             
             <div className="glass-card p-6 rounded-2xl space-y-4">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-full bg-atlas-600 flex items-center justify-center text-xl font-bold text-white">
                        {name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-white">Personalization</h3>
                        <p className="text-sm text-gray-400">How Atlas addresses you</p>
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Display Name</label>
                    <input 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white text-lg focus:border-atlas-500 outline-none transition-colors"
                        placeholder="Enter your name..."
                    />
                </div>
                
                <div className="pt-2">
                    <button 
                        onClick={save} 
                        className={`w-full py-3 rounded-xl font-medium transition-all ${saved ? 'bg-green-500 text-white' : 'bg-white text-black hover:bg-gray-200'}`}
                    >
                        {saved ? 'Saved!' : 'Save Changes'}
                    </button>
                </div>
             </div>

             <div className="glass-panel p-6 rounded-2xl">
                 <h3 className="text-lg font-medium text-white mb-2">About Atlas Desk</h3>
                 <p className="text-sm text-gray-400 leading-relaxed">
                     Atlas Desk is a voice-first knowledge assistant designed to help you learn and create using your own sources. 
                     Powered by Gemini Multimodal Live API.
                 </p>
             </div>
        </div>
    );
};

const LibraryPage: React.FC<{ sources: Source[], refresh: () => void }> = ({ sources, refresh }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'upload' | 'text' | 'link' | 'discovery'>('upload');
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [searchTopic, setSearchTopic] = useState('');

  // Audio Playback State
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch (e) {}
    }
    if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
    }
    setPlayingId(null);
  };

  const playOverview = async (source: Source) => {
    if (playingId === source.id) {
        stopAudio();
        return;
    }
    stopAudio(); // Stop any other playing audio

    setGeneratingId(source.id);
    try {
        if (!process.env.API_KEY) throw new Error("API Key missing");
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        let script = "";

        // 1. Generate Script (Summary) with Fallback
        try {
            const scriptPrompt = `
              Task: Create a concise, engaging audio overview script (approx 45 seconds spoken) for this content.
              Content Title: ${source.title}
              Content Preview: ${source.content.substring(0, 8000)}
              
              Format: Just the spoken text. No scene directions. Natural, conversational tone.
            `;
            const scriptRes = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: scriptPrompt,
            });
            script = scriptRes.text || "";
        } catch (scriptError: any) {
            console.warn("Script generation failed, falling back to raw content.", scriptError);
            const rawContent = source.summary || source.content.substring(0, 800);
            script = `Here is an overview of ${source.title}. ${rawContent}`;
        }

        if (!script) throw new Error("No script available");

        // 2. Generate Audio (TTS)
        const activeProfile = db.getActiveProfile();
        // Map profile warmth to a compatible voice
        const voiceName = activeProfile.warmth > 0.6 ? 'Kore' : activeProfile.directness > 0.6 ? 'Fenrir' : 'Puck';

        try {
            const ttsRes = await ai.models.generateContent({
                model: 'gemini-2.5-flash-preview-tts',
                contents: [{ parts: [{ text: script }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName } }
                    }
                }
            });

            const base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("Failed to generate audio output");

            // 3. Decode & Play (PCM 24kHz)
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioCtxRef.current = ctx;

            // Base64 -> Uint8Array
            const binaryString = atob(base64Audio);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

            // Int16 PCM -> Float32
            const float32 = new Float32Array(bytes.length / 2);
            const view = new DataView(bytes.buffer);
            for (let i = 0; i < float32.length; i++) {
                float32[i] = view.getInt16(i * 2, true) / 32768.0;
            }

            const buffer = ctx.createBuffer(1, float32.length, 24000);
            buffer.getChannelData(0).set(float32);

            const node = ctx.createBufferSource();
            node.buffer = buffer;
            node.connect(ctx.destination);
            node.start();
            sourceNodeRef.current = node;
            
            setPlayingId(source.id);
            
            node.onended = () => {
                setPlayingId(null);
                ctx.close();
                audioCtxRef.current = null;
            };
        } catch (ttsError: any) {
             // Handle Quota Error specifically for TTS
             if (JSON.stringify(ttsError).includes("429") || ttsError?.status === 429 || ttsError?.message?.includes('quota')) {
                 alert("Voice generation limit reached. Please wait a moment or try again later.");
             } else {
                 throw ttsError;
             }
        }

    } catch (e: any) {
        if (JSON.stringify(e).includes("429") || e.status === 429) {
            alert("Rate limit reached. Please wait.");
            return;
        }
        console.error("Audio Overview Error", e);
        alert("Could not generate audio overview.");
    } finally {
        setGeneratingId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const text = await processFile(file);
      db.addSource({ id: crypto.randomUUID(), workspaceId: 'ws-1', title: file.name, type: file.type.includes('pdf') ? 'pdf' : 'text', dateAdded: new Date().toLocaleDateString(), content: text, summary: text.substring(0, 100) + '...' });
      refresh();
    } catch (err) { alert("Failed to read file."); } finally { setIsLoading(false); }
  };

  const handlePasteImport = () => {
    if (!inputText) return;
    db.addSource({ id: crypto.randomUUID(), workspaceId: 'ws-1', title: 'Pasted Text', type: 'text', dateAdded: new Date().toLocaleDateString(), content: inputText, summary: inputText.substring(0, 100) + '...' });
    setInputText('');
    refresh();
    alert('Text added to library.');
  };

  const handleUrlImport = () => {
    if (!inputUrl) return;
    setIsLoading(true);
    setTimeout(() => {
        db.addSource({ id: crypto.randomUUID(), workspaceId: 'ws-1', title: 'Web Source', type: 'url', dateAdded: new Date().toLocaleDateString(), content: `Content fetched from ${inputUrl}...`, url: inputUrl });
        setInputUrl('');
        setIsLoading(false);
        refresh();
        alert('Link imported.');
    }, 1000);
  };

  const handleDiscovery = () => {
    if (!searchTopic) return;
    setIsLoading(true);
    setTimeout(() => {
        const dummySources = [
            { title: `Overview of ${searchTopic}`, content: `General introduction to ${searchTopic}...` },
            { title: `History of ${searchTopic}`, content: `Historical context regarding ${searchTopic}...` },
            { title: `Key Concepts in ${searchTopic}`, content: `Critical points to understand about ${searchTopic}...` },
        ];
        dummySources.forEach(s => {
            db.addSource({ id: crypto.randomUUID(), workspaceId: 'ws-1', title: s.title, type: 'discovery', dateAdded: new Date().toLocaleDateString(), content: s.content });
        });
        setSearchTopic('');
        setIsLoading(false);
        refresh();
        alert(`Discovered 3 sources for "${searchTopic}"`);
    }, 2000);
  };

  return (
    <div className="p-4 md:p-6 pb-24 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div><h2 className="text-3xl font-light text-white tracking-tight">Library</h2><p className="text-gray-400 text-sm mt-1">{sources.length} sources indexed</p></div>
      </div>
      <div className="glass-card rounded-2xl p-4 md:p-6 space-y-4">
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {['upload', 'text', 'link', 'discovery'].map(mode => (
                  <button key={mode} onClick={() => setImportMode(mode as any)} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${importMode === mode ? 'bg-atlas-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>{mode}</button>
              ))}
          </div>
          <div className="animate-in fade-in slide-in-from-top-2">
              {importMode === 'upload' && (
                 <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-atlas-500/50 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                     <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.md,.json,.csv" onChange={handleFileUpload} />
                     <Icons.Add className="w-8 h-8 text-gray-500 mx-auto mb-2" />
                     <p className="text-gray-400 text-sm">{isLoading ? 'Processing...' : 'Click to upload files (PDF, Text, MD)'}</p>
                 </div>
              )}
              {importMode === 'text' && (
                  <div className="space-y-2">
                      <textarea className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-4 text-white resize-none outline-none focus:border-atlas-500" placeholder="Paste text notes here..." value={inputText} onChange={e => setInputText(e.target.value)} />
                      <button onClick={handlePasteImport} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm">Add Text</button>
                  </div>
              )}
              {importMode === 'link' && (
                  <div className="flex gap-2">
                      <input className="flex-1 bg-black/30 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-atlas-500" placeholder="Paste URL or YouTube link..." value={inputUrl} onChange={e => setInputUrl(e.target.value)} />
                      <button onClick={handleUrlImport} disabled={isLoading} className="bg-atlas-600 hover:bg-atlas-500 text-white px-6 rounded-xl text-sm font-medium disabled:opacity-50">{isLoading ? 'Fetching...' : 'Import'}</button>
                  </div>
              )}
              {importMode === 'discovery' && (
                  <div className="space-y-4">
                      <div className="flex gap-2">
                          <input className="flex-1 bg-black/30 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-atlas-500" placeholder="Enter a topic..." value={searchTopic} onChange={e => setSearchTopic(e.target.value)} />
                          <button onClick={handleDiscovery} disabled={isLoading} className="bg-purple-600 hover:bg-purple-500 text-white px-6 rounded-xl text-sm font-medium disabled:opacity-50">{isLoading ? 'Researching...' : 'Discover'}</button>
                      </div>
                      <p className="text-xs text-gray-500">Atlas will search and import key sources about this topic automatically.</p>
                  </div>
              )}
          </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sources.length === 0 && <div className="col-span-full py-12 text-center border border-dashed border-white/10 rounded-2xl"><p className="text-gray-500">No sources yet.</p></div>}
        {sources.map(s => (
          <div key={s.id} className={`glass-card p-5 rounded-2xl hover:bg-white/5 transition-colors group relative overflow-hidden ${playingId === s.id ? 'ring-1 ring-atlas-500 bg-atlas-500/5' : ''}`}>
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${s.type === 'pdf' ? 'border-red-500/30 text-red-400' : s.type === 'discovery' ? 'border-purple-500/30 text-purple-400' : 'border-blue-500/30 text-blue-400'}`}>{s.type}</span>
              <div className="flex items-center gap-2">
                  <button 
                    onClick={() => playOverview(s)}
                    disabled={generatingId === s.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${playingId === s.id ? 'bg-atlas-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                  >
                      {generatingId === s.id ? (
                          <>
                           <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                           Generating...
                          </>
                      ) : playingId === s.id ? (
                          <>
                           <Icons.Stop className="w-3 h-3 fill-current" />
                           Stop
                          </>
                      ) : (
                          <>
                           <Icons.Play className="w-3 h-3 fill-current" />
                           Overview
                          </>
                      )}
                  </button>
                  <button onClick={() => { db.deleteSource(s.id); refresh(); }} className="text-gray-600 hover:text-red-400 transition-colors"><Icons.Stop className="w-4 h-4" /></button>
              </div>
            </div>
            <h3 className="text-lg font-medium text-gray-200 group-hover:text-white transition-colors line-clamp-1">{s.title}</h3>
            <p className="text-sm text-gray-400 mt-2 line-clamp-3 leading-relaxed">{s.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const ExportsPage: React.FC<{ exports: ExportItem[], refresh: () => void }> = ({ exports, refresh }) => {
    const download = (item: ExportItem) => {
        const blob = new Blob([item.content], { type: 'text/markdown' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${item.title}.md`; a.click();
    };
    return (
      <div className="p-6 pb-24 space-y-6 max-w-7xl mx-auto">
        <h2 className="text-3xl font-light text-white tracking-tight">Exports</h2>
        <div className="space-y-3">
          {exports.length === 0 && <p className="text-gray-500">No exports generated yet.</p>}
          {exports.map(e => (
            <div key={e.id} className="glass-panel p-4 rounded-xl flex items-center justify-between group hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${e.type === 'quiz' ? 'bg-orange-500/20 text-orange-400' : 'bg-atlas-500/20 text-atlas-400'}`}>{e.type === 'quiz' ? <Icons.Check className="w-5 h-5" /> : <Icons.Exports className="w-5 h-5" />}</div>
                <div><h4 className="font-medium text-gray-200">{e.title}</h4><p className="text-xs text-gray-500 capitalize">{e.type} • {e.dateCreated}</p></div>
              </div>
              <button onClick={() => download(e)} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-gray-300 transition-colors">Download</button>
            </div>
          ))}
        </div>
      </div>
    );
};

const LearnPage: React.FC<{ sources: Source[], refreshExports: () => void }> = ({ sources, refreshExports }) => {
    const [step, setStep] = useState<'setup' | 'generating' | 'session'>('setup');
    const [config, setConfig] = useState({ goal: '', difficulty: 'Intermediate' });
    const [plan, setPlan] = useState<TeachSessionPlan | null>(null);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [aiResponse, setAiResponse] = useState('');
    const [isThinking, setIsThinking] = useState(false);

    const generatePlan = async () => {
        if (!process.env.API_KEY || !config.goal) return;
        setStep('generating');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const context = retrieveContext(sources, config.goal, 5);
            const prompt = `Create a structured lesson plan for: "${config.goal}". Difficulty: ${config.difficulty}. Context: ${context}. Return JSON: { "goal": string, "difficulty": string, "steps": [{ "title": string, "description": string, "keyPoints": string[] }] }`;
            
            const result = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: { responseMimeType: 'application/json' }
            });
            const text = result.text;
            if (!text) throw new Error("No plan generated");
            const json = JSON.parse(text);
            
            setPlan(json);
            setStep('session');
            await teachStep(0, json);
        } catch (e) { alert("Failed to generate plan."); setStep('setup'); }
    };

    const teachStep = async (index: number, currentPlan: TeachSessionPlan) => {
        setIsThinking(true);
        try {
            const stepData = currentPlan.steps[index];
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const context = retrieveContext(sources, stepData.title, 3);
            const activeProfile = db.getActiveProfile();
            const resolvedVoice = resolveVoiceSettings(activeProfile);
            const prompt = `You are a teacher. Teach this step: "${stepData.title}". Description: ${stepData.description}. Context: ${context}. TONE: ${resolvedVoice.systemInstruction}. Format Markdown.`;
            
            const result = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt
            });
            const shapedText = resolvedVoice.scriptTransforms(result.text || '');
            
            setAiResponse(shapedText);
        } finally { setIsThinking(false); }
    };

    const nextStep = () => {
        if (!plan) return;
        if (currentStepIndex < plan.steps.length - 1) {
            const next = currentStepIndex + 1;
            setCurrentStepIndex(next);
            teachStep(next, plan);
        } else {
            if (confirm("Session complete! Save notes?")) {
                db.addExport({ id: crypto.randomUUID(), workspaceId: 'ws-1', title: `Lesson: ${plan.goal}`, type: 'note', dateCreated: new Date().toLocaleDateString(), content: `# ${plan.goal}\n\n${aiResponse}` });
                refreshExports();
                alert("Notes saved!");
            }
            setStep('setup');
        }
    };

    return (
        <div className="p-6 pb-24 max-w-3xl mx-auto min-h-full flex flex-col">
            {step === 'setup' && (
                <div className="glass-card p-8 rounded-3xl space-y-6 animate-float my-auto">
                    <div className="flex items-center gap-4 mb-4"><div className="p-3 bg-atlas-500/20 rounded-xl text-atlas-400"><Icons.Learn className="w-8 h-8"/></div><h2 className="text-2xl font-light text-white">New Session</h2></div>
                    <div className="space-y-2"><label className="text-sm text-gray-400">Learning Goal</label><input value={config.goal} onChange={e => setConfig({...config, goal: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder-gray-600 focus:border-atlas-500 outline-none" placeholder="e.g. Understand Quantum Entanglement" /></div>
                    <div className="space-y-2"><label className="text-sm text-gray-400">Difficulty</label><div className="flex gap-2">{['Beginner', 'Intermediate', 'Expert'].map(d => (<button key={d} onClick={() => setConfig({...config, difficulty: d})} className={`flex-1 py-3 rounded-lg text-sm border ${config.difficulty === d ? 'bg-atlas-600 border-transparent text-white' : 'bg-transparent border-white/10 text-gray-400 hover:border-white/30'}`}>{d}</button>))}</div></div>
                    <button onClick={generatePlan} disabled={!config.goal} className="w-full bg-white text-black font-semibold py-4 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50">Generate Lesson Plan</button>
                </div>
            )}
            {step === 'generating' && (<div className="flex flex-col items-center justify-center flex-1 space-y-4"><div className="w-12 h-12 border-4 border-atlas-500 border-t-transparent rounded-full animate-spin"></div><p className="text-atlas-400 animate-pulse">Consulting sources...</p></div>)}
            {step === 'session' && plan && (
                <div className="flex flex-col h-full gap-6">
                    <div className="flex justify-between items-center"><h2 className="text-xl font-medium text-white">{plan.goal}</h2><span className="text-xs font-mono text-gray-500">STEP {currentStepIndex + 1} / {plan.steps.length}</span></div>
                    <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-atlas-500 transition-all duration-500" style={{ width: `${((currentStepIndex + 1) / plan.steps.length) * 100}%` }} /></div>
                    <div className="flex-1 glass-card p-6 rounded-2xl overflow-y-auto"><h3 className="text-2xl text-atlas-400 mb-4">{plan.steps[currentStepIndex].title}</h3>{isThinking ? (<div className="space-y-3"><div className="h-4 bg-white/5 rounded w-3/4 animate-pulse"></div><div className="h-4 bg-white/5 rounded w-full animate-pulse"></div></div>) : (<div className="prose prose-invert prose-lg max-w-none"><div className="whitespace-pre-wrap">{aiResponse}</div></div>)}</div>
                    <div className="flex gap-4"><button className="p-4 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300"><Icons.Mic className="w-6 h-6" /></button><button onClick={nextStep} className="flex-1 bg-atlas-600 hover:bg-atlas-500 text-white font-medium py-4 rounded-xl shadow-lg shadow-atlas-600/20 transition-all">{currentStepIndex === plan.steps.length - 1 ? 'Finish & Save' : 'Next Step'}</button></div>
                </div>
            )}
        </div>
    );
};

const TalkPage: React.FC<{ sources: Source[] }> = ({ sources }) => {
    const [connected, setConnected] = useState(false);
    const [state, setState] = useState<LiveState>('idle');
    const [volume, setVolume] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [client, setClient] = useState<LiveClient | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [citations, setCitations] = useState<SearchResult[]>([]);
    
    // Config State
    const [mode, setMode] = useState<IntelligenceMode>('explain');
    const [searchEnabled, setSearchEnabled] = useState(true);
    const [showDebug, setShowDebug] = useState(false);

    const toggleConnection = async () => {
        if (connected && client) {
            client.disconnect();
            setConnected(false);
            setClient(null);
            setState('idle');
            setVolume(0);
            setCitations([]);
            return;
        }

        if (!process.env.API_KEY) { setError("API Key not set."); return; }

        const newClient = new LiveClient(process.env.API_KEY);
        newClient.onVolume = setVolume;
        newClient.onStateChange = (s) => setState(s);
        newClient.onCitations = (results) => setCitations(results);
        newClient.onError = (err) => setError(err);
        
        const activeProfile = db.getActiveProfile();
        newClient.setBargeInSensitivity(activeProfile.bargeInSensitivity || 0.5);

        // REDUCE CONTEXT LIMIT TO AVOID CONNECTION ERRORS
        const topContext = retrieveContext(sources, "overview", 2); 
        const resolvedVoice = resolveVoiceSettings(activeProfile, mode);
        const userName = db.getSettings().userName;

        const baseInstruction = `
            CONTEXT:
            ${topContext}
            
            INSTRUCTIONS:
            Use the provided context to answer questions.
            If context is missing, use your general knowledge or the 'search_web' tool if enabled.
        `;

        try {
            await newClient.connect(baseInstruction, resolvedVoice, userName, searchEnabled);
            setClient(newClient);
            setConnected(true);
            setError(null);
        } catch (e) { console.error(e); setError("Connection failed."); }
    };

    const toggleMute = () => {
        if (!client) return;
        const newState = !isMuted;
        setIsMuted(newState);
        client.setMute(newState);
    };

    useEffect(() => () => client?.disconnect(), []);

    return (
        <div className="flex flex-col h-full items-center justify-center p-6 pb-32 relative overflow-hidden">
            {/* Background Orb */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] blur-[150px] rounded-full transition-all duration-1000 ${state === 'speaking' ? 'bg-atlas-500/30' : state === 'listening' ? 'bg-emerald-500/10' : 'bg-transparent'}`} />
            
            {/* Top Bar Config */}
            <div className="absolute top-4 left-0 right-0 px-4 flex justify-between items-start z-20 pointer-events-none">
                <div className="flex flex-col gap-2 pointer-events-auto">
                    {/* Mode Selector */}
                    <div className="glass-panel p-1 rounded-lg flex gap-1">
                        {(['quick', 'explain', 'teach', 'brief'] as IntelligenceMode[]).map(m => (
                            <button key={m} onClick={() => setMode(m)} disabled={connected} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                                {m.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    {/* Search Toggle */}
                    <button onClick={() => setSearchEnabled(!searchEnabled)} disabled={connected} className={`glass-panel px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-medium transition-colors ${searchEnabled ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' : 'text-gray-500'}`}>
                        <div className={`w-2 h-2 rounded-full ${searchEnabled ? 'bg-blue-400' : 'bg-gray-600'}`} />
                        Web Search {searchEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
                
                {/* Debug Toggle */}
                <button onClick={() => setShowDebug(!showDebug)} className="pointer-events-auto text-gray-600 hover:text-white"><Icons.Settings className="w-4 h-4" /></button>
            </div>

            {/* Debug Panel */}
            {showDebug && (
                <div className="absolute top-20 right-4 w-64 glass-card p-4 rounded-xl text-[10px] font-mono text-green-400 space-y-2 z-30 pointer-events-auto">
                    <div>STATE: {state.toUpperCase()}</div>
                    <div>VOL: {volume.toFixed(3)}</div>
                    <div>SEARCH: {searchEnabled.toString()}</div>
                    <div>MODE: {mode}</div>
                    {error && <div className="text-red-400">ERR: {error}</div>}
                </div>
            )}

            {/* Main Content */}
            <div className="relative z-10 w-full max-w-lg flex flex-col items-center gap-12">
                <div className="text-center space-y-3">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono tracking-wider border transition-colors duration-300 ${state === 'speaking' ? 'border-atlas-500/50 text-atlas-300 bg-atlas-500/10' : state === 'listening' ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10' : state === 'processing' ? 'border-yellow-500/50 text-yellow-300 bg-yellow-500/10' : 'border-white/10 text-gray-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${state !== 'idle' ? 'animate-pulse' : ''} ${state === 'speaking' ? 'bg-atlas-400' : state === 'listening' ? 'bg-emerald-400' : state === 'processing' ? 'bg-yellow-400' : 'bg-gray-500'}`} />
                        {state === 'processing' ? 'THINKING' : state.toUpperCase()}
                    </div>
                    <h2 className="text-5xl font-light text-white tracking-tight">{state === 'idle' ? 'Atlas' : state === 'listening' ? 'Listening...' : state === 'processing' ? 'Thinking...' : 'Speaking'}</h2>
                </div>
                
                <VoiceVisualizer isActive={connected && !isMuted} volume={volume} />
                
                {/* Citations/Grounding Cards */}
                {citations.length > 0 && (
                    <div className="w-full max-h-32 overflow-y-auto space-y-2 px-2 scrollbar-hide animate-in fade-in slide-in-from-bottom-4">
                        <div className="text-xs text-gray-500 uppercase tracking-wider font-medium ml-1">Sources Used</div>
                        {citations.map((c, i) => (
                            <a key={i} href={c.url} target="_blank" rel="noreferrer" className="block p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group">
                                <div className="text-xs font-medium text-blue-300 group-hover:text-blue-200 truncate">{c.title}</div>
                                <div className="text-[10px] text-gray-500 mt-0.5 truncate">{c.snippet}</div>
                            </a>
                        ))}
                    </div>
                )}
                
                <div className="flex items-center gap-6">
                    {connected && (
                        <button 
                            onClick={toggleMute}
                            className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'}`}
                        >
                            {isMuted ? <Icons.Mic className="w-6 h-6 rotate-45" /> : <Icons.Mic className="w-6 h-6" />}
                        </button>
                    )}

                    <button onClick={toggleConnection} className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 group ${connected ? 'bg-red-500/10 hover:bg-red-500 border border-red-500/50 hover:border-red-500' : 'bg-white hover:bg-gray-200 shadow-[0_0_40px_rgba(255,255,255,0.15)]'}`}>
                        {connected ? (<Icons.Stop className="w-8 h-8 text-red-400 group-hover:text-white transition-colors" />) : (<Icons.Mic className="w-8 h-8 text-black" />)}
                    </button>
                </div>

                {error && <p className="text-red-400 text-sm bg-red-500/10 px-4 py-2 rounded-lg border border-red-500/20">{error}</p>}
            </div>
        </div>
    );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('talk');
  const [sources, setSources] = useState<Source[]>(db.getSources());
  const [exports, setExports] = useState<ExportItem[]>(db.getExports());
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setIsCommandBarOpen(prev => !prev); } };
    window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const refreshData = () => { setSources(db.getSources()); setExports(db.getExports()); };
  const handleCommandAction = (actionId: string) => { if (['talk', 'library', 'learn', 'exports', 'tuning', 'settings'].includes(actionId)) { setActiveTab(actionId as NavTab); } };

  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans selection:bg-atlas-500/30">
      <CommandBar isOpen={isCommandBarOpen} onClose={() => setIsCommandBarOpen(false)} onAction={handleCommandAction} />
      <div className="fixed top-0 left-0 right-0 h-16 glass-panel z-40 flex items-center justify-between px-6">
        <div className="flex items-center gap-3"><div className="w-8 h-8 bg-gradient-to-br from-white to-gray-400 rounded-lg flex items-center justify-center shadow-lg"><span className="text-black font-bold text-lg">A</span></div><span className="font-semibold tracking-wide text-lg hidden sm:block">Atlas Desk</span></div>
        <div className="flex items-center gap-3">
             <button onClick={() => setIsCommandBarOpen(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs text-gray-400 transition-colors"><Icons.Search className="w-3.5 h-3.5" /><span>Search</span><span className="ml-2 px-1 rounded bg-white/10">⌘K</span></button>
             <button onClick={() => setActiveTab('settings')} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"><Icons.User className="w-4 h-4 text-gray-300" /></button>
        </div>
      </div>
      <main className="pt-16 pb-24 min-h-screen relative">
        {activeTab === 'talk' && <TalkPage sources={sources} />}
        {activeTab === 'library' && <LibraryPage sources={sources} refresh={refreshData} />}
        {activeTab === 'learn' && <LearnPage sources={sources} refreshExports={refreshData} />}
        {activeTab === 'exports' && <ExportsPage exports={exports} refresh={refreshData} />}
        {activeTab === 'tuning' && <VoiceLab />}
        {activeTab === 'settings' && <SettingsPage onBack={() => setActiveTab('talk')} />}
      </main>
      <div className="fixed bottom-0 left-0 right-0 glass-panel border-t border-white/5 pb-safe z-40">
        <div className="flex justify-around items-center h-20 px-2 max-w-md mx-auto">
          {[{ id: 'talk', icon: Icons.Mic, label: 'Talk' }, { id: 'library', icon: Icons.Library, label: 'Library' }, { id: 'learn', icon: Icons.Learn, label: 'Learn' }, { id: 'exports', icon: Icons.Exports, label: 'Exports' }, { id: 'tuning', icon: Icons.Tuning, label: 'Voice Lab' }].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as NavTab)} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all w-16 group ${isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                <div className={`p-1.5 rounded-full transition-all group-hover:-translate-y-1 ${isActive ? 'bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'bg-transparent'}`}><tab.icon className={`w-6 h-6 ${isActive ? 'stroke-2' : 'stroke-1.5'}`} /></div>
                <span className={`text-[10px] font-medium tracking-wide transition-opacity ${isActive ? 'opacity-100' : 'opacity-60'}`}>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  );
}