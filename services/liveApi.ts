import { GoogleGenAI, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import { ResolvedVoiceConfig } from '../utils/voiceEngine';
import { SearchResult } from '../types';

// --- SEARCH TOOL DEFINITION ---
const searchToolDeclaration: FunctionDeclaration = {
  name: 'search_web',
  description: 'Search the web for up-to-date information, facts, or recent events. Use this when the answer is not in the user\'s context.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'The search query string.' },
    },
    required: ['query'],
  },
};

// --- AUDIO HELPERS ---
function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- MOCK SEARCH SERVICE (Simulates Server-Side) ---
async function mockServerSideSearch(query: string): Promise<SearchResult[]> {
  await new Promise(r => setTimeout(r, 600)); // Simulate latency
  return [
    { title: `Latest info on ${query}`, url: 'https://example.com/news', snippet: `Recent developments regarding ${query} show significant progress...` },
    { title: `${query} Overview`, url: 'https://wikipedia.org/wiki/Topic', snippet: `A comprehensive guide to ${query} and its history...` },
    { title: 'Expert Analysis', url: 'https://scholar.google.com', snippet: `Experts suggest that ${query} will impact the industry by...` }
  ];
}

// --- TYPES ---
export type LiveState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'reconnecting';

// --- LIVE CLIENT CLASS ---
export class LiveClient {
  private ai: GoogleGenAI;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  
  // State Machine
  private _state: LiveState = 'idle';
  private connectionPromise: Promise<any> | null = null;
  private session: any = null;
  
  // Audio Queue & Buffering
  private audioQueue: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private audioBuffer: string[] = []; // Buffer for "Never Miss a Turn"
  
  // VAD & Barge-in
  private isMuted = false;
  private bargeInThreshold = 0.5;
  private bargeInCooldown = 0;
  private silenceCounter = 0;
  
  // Callbacks
  public onStateChange: (state: LiveState) => void = () => {};
  public onVolume: (vol: number) => void = () => {};
  public onCitations: (results: SearchResult[]) => void = () => {};
  public onError: (err: string) => void = () => {};

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  // --- PUBLIC API ---

  async connect(baseSystemInstruction: string, voiceConfig: ResolvedVoiceConfig, userName: string, enableSearch: boolean) {
    if (this._state === 'connecting' || this._state === 'listening') return;
    this.setState('connecting');

    try {
      // 1. Setup Audio
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await Promise.all([this.inputContext.resume(), this.outputContext.resume()]);

      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });

      // 2. Build Config
      const tools = enableSearch ? [{ functionDeclarations: [searchToolDeclaration] }] : [];
      const finalInstruction = `User: ${userName}.\n${baseSystemInstruction}\nVOICE: ${voiceConfig.systemInstruction}`;

      // 3. Connect Live Session
      this.connectionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: voiceConfig.speechConfig,
          systemInstruction: finalInstruction,
          tools: tools,
        },
        callbacks: {
          onopen: () => {
            console.log('LiveClient: Open');
            this.setState('listening');
            this.startAudioCapture();
          },
          onmessage: (msg) => this.handleMessage(msg),
          onclose: () => {
             console.log('LiveClient: Close');
             if (this._state !== 'idle') this.attemptReconnect();
          },
          onerror: (err) => {
             console.error('LiveClient: Error', err);
             this.onError(err.message || "Connection error");
             this.attemptReconnect();
          }
        }
      });

      this.session = await this.connectionPromise;

    } catch (e: any) {
      console.error(e);
      this.setState('idle');
      this.onError(e.message);
    }
  }

  setMute(mute: boolean) {
    this.isMuted = mute;
  }

  setBargeInSensitivity(val: number) {
    // 0.0 (Hard) -> 1.0 (Easy)
    // Threshold: 0.8 (Hard) -> 0.1 (Easy)
    this.bargeInThreshold = 0.8 - (val * 0.7); 
  }

  disconnect() {
    this.setState('idle');
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.processor) { this.processor.disconnect(); this.processor = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.inputContext) { this.inputContext.close(); this.inputContext = null; }
    if (this.outputContext) { this.outputContext.close(); this.outputContext = null; }
    this.session = null;
  }

  // --- INTERNAL LOGIC ---

  private setState(s: LiveState) {
    this._state = s;
    this.onStateChange(s);
  }

  private startAudioCapture() {
    if (!this.inputContext || !this.stream) return;
    
    this.source = this.inputContext.createMediaStreamSource(this.stream);
    this.processor = this.inputContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this._state === 'idle' || this._state === 'reconnecting') return;

      const inputData = e.inputBuffer.getChannelData(0);
      
      // 1. RMS & VAD
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      const rms = Math.sqrt(sum / inputData.length);
      const vol = Math.min(rms * 5, 1);
      this.onVolume(this.isMuted ? 0 : vol);

      // 2. Barge-In Detection
      if (!this.isMuted && this._state === 'speaking' && vol > this.bargeInThreshold) {
         if (Date.now() > this.bargeInCooldown) {
            console.log("Barge-in detected");
            this.interrupt();
            this.bargeInCooldown = Date.now() + 1500;
         }
      }

      // 3. Send to Server (if not muted)
      if (!this.isMuted && this.session) {
        // Convert to PCM
        const pcm = floatTo16BitPCM(inputData);
        const uint8 = new Uint8Array(pcm);
        let binary = '';
        for (let i=0; i<uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
        const b64 = btoa(binary);

        // Buffer locally for "Never Miss"
        this.audioBuffer.push(b64);
        if (this.audioBuffer.length > 50) this.audioBuffer.shift(); // Keep ~10s buffer

        this.connectionPromise?.then(session => {
            session.sendRealtimeInput({
                media: { mimeType: 'audio/pcm;rate=16000', data: b64 }
            });
        });
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.inputContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    // 1. Handle Tool Calls (Search)
    if (message.toolCall) {
        this.setState('processing');
        for (const fc of message.toolCall.functionCalls) {
            if (fc.name === 'search_web') {
                const query = (fc.args as any).query;
                console.log("Executing Tool: search_web", query);
                const results = await mockServerSideSearch(query);
                this.onCitations(results); // Update UI
                
                // Send response back to model
                this.connectionPromise?.then(session => {
                    session.sendToolResponse({
                        functionResponses: [{
                            id: fc.id,
                            name: fc.name,
                            response: { result: results } // Model sees structured data
                        }]
                    });
                });
            }
        }
        return;
    }

    // 2. Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.outputContext) {
        if (this._state !== 'speaking') this.setState('speaking');
        this.playAudioChunk(audioData);
    }

    // 3. Handle Turn Complete
    if (message.serverContent?.turnComplete) {
        // Wait for audio queue to drain before switching back to listening
        // Note: The audio queue onended handler handles the state switch
    }
  }

  private playAudioChunk(base64: string) {
    if (!this.outputContext) return;
    
    // Decoding
    const uint8 = base64ToUint8Array(base64);
    const float32 = new Float32Array(uint8.length / 2);
    const view = new DataView(uint8.buffer);
    for (let i = 0; i < float32.length; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768.0;
    }

    const buffer = this.outputContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    // Scheduling
    this.nextStartTime = Math.max(this.nextStartTime, this.outputContext.currentTime);
    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputContext.destination);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.audioQueue.push(source);
    source.onended = () => {
        this.audioQueue = this.audioQueue.filter(s => s !== source);
        if (this.audioQueue.length === 0 && this._state === 'speaking') {
            this.setState('listening');
        }
    };
  }

  private interrupt() {
    this.audioQueue.forEach(s => { try { s.stop(); } catch(e){} });
    this.audioQueue = [];
    if (this.outputContext) this.nextStartTime = this.outputContext.currentTime;
    
    // Send cancellation to model (implicit by sending new input usually, but we assume the model handles interruption)
    this.setState('listening');
  }

  private attemptReconnect() {
     if (this._state === 'idle') return;
     this.setState('reconnecting');
     setTimeout(() => {
         console.log("Reconnecting...");
         // Simple reconnect logic: disconnect -> connect (caller handles this usually)
         this.onError("Connection dropped. Reconnecting...");
         // In a real app, we would trigger the connect flow again automatically
     }, 2000);
  }
}
