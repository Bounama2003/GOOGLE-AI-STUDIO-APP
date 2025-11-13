import React, { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob } from '@google/genai';
import { Language, ConversationTurn } from './types';
import { encode, decode, decodeAudioData } from './utils/audio';
import MicIcon from './components/icons/MicIcon';
import StopIcon from './components/icons/StopIcon';

const LanguageSelector: React.FC<{ onSelect: (lang: Language) => void }> = ({ onSelect }) => (
    <div className="flex flex-col items-center justify-center h-full">
        <h1 className="text-4xl font-bold mb-8 text-center">Assistant Vocal</h1>
        <p className="text-lg text-gray-300 mb-12">Sélectionnez votre langue</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-md px-4">
            <button onClick={() => onSelect(Language.FR)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-transform transform hover:scale-105">Français</button>
            <button onClick={() => onSelect(Language.WO)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-transform transform hover:scale-105">Wolof</button>
            <button onClick={() => onSelect(Language.EN)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-transform transform hover:scale-105">English</button>
        </div>
    </div>
);

const ConversationView: React.FC<{ conversation: ConversationTurn[], currentUserInput: string, currentModelOutput: string }> = ({ conversation, currentUserInput, currentModelOutput }) => (
    <div className="flex-grow p-4 md:p-6 overflow-y-auto space-y-4 w-full">
        {conversation.map((turn, index) => (
            <div key={index} className={`flex ${turn.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl ${turn.speaker === 'user' ? 'bg-blue-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'}`}>
                    <p className="text-white">{turn.text}</p>
                </div>
            </div>
        ))}
        {currentUserInput && (
            <div className="flex justify-end">
                <div className="max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl bg-blue-600 rounded-br-none opacity-60">
                    <p className="text-white">{currentUserInput}</p>
                </div>
            </div>
        )}
        {currentModelOutput && (
            <div className="flex justify-start">
                 <div className="max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-2xl bg-gray-700 rounded-bl-none opacity-60">
                    <p className="text-white">{currentModelOutput}</p>
                </div>
            </div>
        )}
    </div>
);

const MicButton: React.FC<{ isSessionActive: boolean; onClick: () => void }> = ({ isSessionActive, onClick }) => {
    const buttonClass = isSessionActive 
        ? "bg-red-600 hover:bg-red-700 animate-pulse" 
        : "bg-blue-600 hover:bg-blue-700";
    
    return (
        <button
            onClick={onClick}
            className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-white shadow-lg transition-all duration-300 transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-opacity-50 ${isSessionActive ? 'focus:ring-red-400' : 'focus:ring-blue-400'} ${buttonClass}`}
            aria-label={isSessionActive ? 'Stop session' : 'Start session'}
        >
            {isSessionActive ? <StopIcon className="w-10 h-10" /> : <MicIcon className="w-10 h-10" />}
        </button>
    );
};


export default function App() {
    const [language, setLanguage] = useState<Language | null>(null);
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [conversation, setConversation] = useState<ConversationTurn[]>([]);
    const [currentUserInput, setCurrentUserInput] = useState('');
    const [currentModelOutput, setCurrentModelOutput] = useState('');

    const sessionPromise = useRef<Promise<LiveSession> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    
    const nextAudioStartTime = useRef(0);
    const audioSources = useRef(new Set<AudioBufferSourceNode>());
    
    const currentInputTranscription = useRef('');
    const currentOutputTranscription = useRef('');

    const createBlob = (data: Float32Array): Blob => {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            // Clamp the value to the [-1, 1] range
            const s = Math.max(-1, Math.min(1, data[i]));
            // Scale to the 16-bit integer range.
            // For positive values, max is 32767. For negative, min is -32768.
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return {
            data: encode(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
    };

    const handleLanguageSelect = (lang: Language) => {
        setLanguage(lang);
    };

    const getSystemInstruction = (lang: Language) => {
        switch(lang) {
            case Language.FR: return "Tu es un assistant vocal amical et serviable. Réponds en français.";
            case Language.WO: return "Yaw ab ndimbalu baat nga bu bëgga jàppale tey fonk. Tontul ci wolof.";
            case Language.EN: return "You are a friendly and helpful voice assistant. Respond in English.";
            default: return "You are a friendly and helpful voice assistant.";
        }
    };

    const startSession = useCallback(async () => {
        if (!language) return;

        setConversation([]);
        setCurrentUserInput('');
        setCurrentModelOutput('');
        setIsSessionActive(true);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            sessionPromise.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            if (sessionPromise.current) {
                                sessionPromise.current.then((session) => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            }
                        };
                        
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle transcription
                        if (message.serverContent?.inputTranscription) {
                            setCurrentUserInput(currentInputTranscription.current + message.serverContent.inputTranscription.text);
                            currentInputTranscription.current += message.serverContent.inputTranscription.text;
                        }
                        if (message.serverContent?.outputTranscription) {
                            setCurrentModelOutput(currentOutputTranscription.current + message.serverContent.outputTranscription.text);
                            currentOutputTranscription.current += message.serverContent.outputTranscription.text;
                        }

                        if (message.serverContent?.turnComplete) {
                            setConversation(prev => [
                                ...prev,
                                { speaker: 'user', text: currentInputTranscription.current.trim() },
                                { speaker: 'assistant', text: currentOutputTranscription.current.trim() }
                            ]);
                            currentInputTranscription.current = '';
                            currentOutputTranscription.current = '';
                            setCurrentUserInput('');
                            setCurrentModelOutput('');
                        }

                        // Handle audio playback
                        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (audioData) {
                             if (!outputAudioContextRef.current) {
                                outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                            }
                            const outputCtx = outputAudioContextRef.current;
                            nextAudioStartTime.current = Math.max(nextAudioStartTime.current, outputCtx.currentTime);

                            const audioBuffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
                            const source = outputCtx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputCtx.destination);
                            
                            source.addEventListener('ended', () => {
                                audioSources.current.delete(source);
                            });

                            source.start(nextAudioStartTime.current);
                            nextAudioStartTime.current += audioBuffer.duration;
                            audioSources.current.add(source);
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error:', e);
                        stopSession();
                    },
                    onclose: () => {
                        console.log('Session closed');
                    },
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction: getSystemInstruction(language),
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
            });
        } catch (error) {
            console.error('Failed to start session:', error);
            alert('Could not access microphone. Please check permissions.');
            setIsSessionActive(false);
        }
    }, [language]);
    
    const stopSession = useCallback(async () => {
        setIsSessionActive(false);
    
        if (sessionPromise.current) {
            const session = await sessionPromise.current;
            session.close();
            sessionPromise.current = null;
        }
    
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if(mediaStreamSourceRef.current && scriptProcessorRef.current){
             mediaStreamSourceRef.current.disconnect();
             scriptProcessorRef.current.disconnect();
             mediaStreamSourceRef.current = null;
             scriptProcessorRef.current = null;
        }
    
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            await inputAudioContextRef.current.close();
            inputAudioContextRef.current = null;
        }
        
        if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
             audioSources.current.forEach(source => source.stop());
             audioSources.current.clear();
             await outputAudioContextRef.current.close();
             outputAudioContextRef.current = null;
        }
        
        nextAudioStartTime.current = 0;
        currentInputTranscription.current = '';
        currentOutputTranscription.current = '';
        setCurrentUserInput('');
        setCurrentModelOutput('');

    }, []);

    const handleMicClick = () => {
        if (isSessionActive) {
            stopSession();
        } else {
            startSession();
        }
    };
    
    if (!language) {
        return <LanguageSelector onSelect={handleLanguageSelect} />;
    }

    return (
        <div className="flex flex-col h-screen w-screen bg-gray-900 text-white font-sans">
            <header className="p-4 bg-gray-800 shadow-md flex justify-between items-center">
                <h1 className="text-xl font-bold">Assistant Vocal</h1>
                <button onClick={() => { stopSession(); setLanguage(null); }} className="text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded-md">Changer Langue</button>
            </header>
            
            <main className="flex-grow flex flex-col items-center justify-between overflow-hidden">
                <ConversationView conversation={conversation} currentUserInput={currentUserInput} currentModelOutput={currentModelOutput} />
            </main>
            
            <footer className="p-4 md:p-6 bg-gray-800 flex flex-col items-center justify-center">
                <MicButton isSessionActive={isSessionActive} onClick={handleMicClick} />
                <p className="mt-4 text-gray-400 text-sm">
                    {isSessionActive ? "Session active. Parlez maintenant..." : "Appuyez pour commencer"}
                </p>
            </footer>
        </div>
    );
}
