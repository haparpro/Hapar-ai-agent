import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Chat } from "@google/genai";
import { marked } from 'marked';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
}

const App = () => {
  const [chatSessions, setChatSessions] = useState<Record<string, ChatSession>>({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showApkModal, setShowApkModal] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [previewSrcDoc, setPreviewSrcDoc] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<'chat' | 'build'>('chat');
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const thinkingModeRef = useRef(thinkingMode);
  const apiKeyReadyRef = useRef(apiKeyReady);
  
  const activeMessages = activeChatId ? chatSessions[activeChatId]?.messages : [];

  // Initial load from localStorage
  useEffect(() => {
    try {
      const savedSessions = localStorage.getItem('chatSessions');
      const savedActiveId = localStorage.getItem('activeChatId');
      if (savedSessions) {
        const parsedSessions = JSON.parse(savedSessions);
        setChatSessions(parsedSessions);
        if (savedActiveId && parsedSessions[savedActiveId]) {
          setActiveChatId(savedActiveId);
        } else if (Object.keys(parsedSessions).length > 0) {
          setActiveChatId(Object.keys(parsedSessions)[0]);
        } else {
            handleNewChat();
        }
      } else {
        handleNewChat();
      }
    } catch (error) {
      console.error("Failed to load chat history from localStorage:", error);
      handleNewChat();
    }
  }, []);
  
  // Check for selected API key on mount
  useEffect(() => {
    const checkApiKey = async () => {
        try {
            if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setApiKeyReady(hasKey);
                apiKeyReadyRef.current = hasKey;
            } else {
                // In environments where aistudio is not available, assume key is present via env
                setApiKeyReady(true);
                apiKeyReadyRef.current = true;
            }
        } catch (e) {
            console.error("Error checking for API key, assuming it's set.", e);
            // Assume key is available to not block app in case of unexpected error
            setApiKeyReady(true);
            apiKeyReadyRef.current = true;
        }
    };
    checkApiKey();
  }, []);
  
  useEffect(() => {
    try {
        setIsInIframe(window.self !== window.top);
    } catch (e) {
        setIsInIframe(true);
    }
  }, []);

  useEffect(() => {
    thinkingModeRef.current = thinkingMode;
  }, [thinkingMode]);
  
  useEffect(() => {
    apiKeyReadyRef.current = apiKeyReady;
  }, [apiKeyReady]);


  // Scroll to bottom of chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [activeMessages]);

  // Save to localStorage
  useEffect(() => {
    if (!isLoading && Object.keys(chatSessions).length > 0 && activeChatId) {
        try {
            localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
            localStorage.setItem('activeChatId', activeChatId);
        } catch (error) {
            console.error("Failed to save chat history to localStorage:", error);
        }
    }
  }, [chatSessions, activeChatId, isLoading]);
  
  const ensureApiKey = async () => {
    if (apiKeyReadyRef.current) {
        return true;
    }
    try {
        if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
            await window.aistudio.openSelectKey();
            // Assume success to handle race condition, as per guidelines.
            setApiKeyReady(true);
            apiKeyReadyRef.current = true;
            return true;
        }
        // If aistudio is not available, we can't prompt the user.
        // We proceed assuming the key is in process.env.API_KEY.
        return true; 
    } catch (e) {
        if (e.message && e.message.includes('dialog closed')) {
             console.log('User closed API key selection dialog.');
             return false;
        }
        console.error("Error opening API key selection:", e);
        alert("An error occurred while trying to select an API key. Please check the console and try again.");
        return false;
    }
  };
  
  const handleNewChat = () => {
    const newId = Date.now().toString();
    const newChatSession: ChatSession = {
        id: newId,
        title: 'New Chat',
        messages: [],
    };
    setChatSessions(prev => ({...prev, [newId]: newChatSession}));
    setActiveChatId(newId);
    if (window.innerWidth <= 768) {
        setIsSidebarOpen(false);
    }
  };

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    if (window.innerWidth <= 768) {
        setIsSidebarOpen(false);
    }
  };

  const handleThinkingModeChange = () => {
    if (activeMessages && activeMessages.length > 0 && !window.confirm("Changing modes will clear the current conversation. Are you sure you want to continue?")) {
      return;
    }
    if (activeChatId) {
        setChatSessions(prev => ({
            ...prev,
            [activeChatId]: {
                ...prev[activeChatId],
                messages: [],
            }
        }));
    }
    setThinkingMode(prev => !prev);
  };

  const handlePreviewClick = () => {
    let html = document.documentElement.outerHTML;
    
    // Clean the #root element to allow the app to re-initialize cleanly inside the iframe.
    html = html.replace(/<div id="root">[\s\S]*?<\/div>/, '<div id="root"></div>');

    const base = `<base href="${window.location.origin}">`;
    html = html.replace(/<head\b[^>]*>/, `$&${base}`);
    setPreviewSrcDoc(html);
    setShowPreview(true);
  };

  const handleClosePreview = () => {
    setShowPreview(false);
    setPreviewSrcDoc(undefined);
  };

  const handleOpenApkModal = () => {
    setShowApkModal(true);
  };

  const handleCloseApkModal = () => {
    setShowApkModal(false);
  };
  
  const handleDownloadManifestClick = async () => {
    try {
      const response = await fetch('AndroidManifest.xml');
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.statusText}`);
      }
      const xmlContent = await response.text();
      const blob = new Blob([xmlContent], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'AndroidManifest.xml';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Could not download the manifest file. Please try again later.');
    }
  };

  const handleBuildRequest = async () => {
    if (!inputValue.trim() || isLoading) return;

    const keyReady = await ensureApiKey();
    if (!keyReady) {
      return;
    }

    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const fullPrompt = `You are a world-class frontend engineer. Create a single, self-contained HTML file including all necessary CSS and JavaScript based on the following user request. The output must be only the raw HTML code, starting with <!DOCTYPE html>. Do not wrap it in markdown or any other formatting. User request: "${currentInput}"`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: fullPrompt,
        });
        
        const generatedHtml = response.text;
        
        let html = generatedHtml;
        const base = `<base href="${window.location.origin}">`;
        if (!html.includes('<base href')) {
             html = html.replace(/<head\b[^>]*>/, `$&${base}`);
        }

        setPreviewSrcDoc(html);
        setShowPreview(true);

    } catch (error) {
        console.error("Error building app:", error);
        const errorString = error instanceof Error ? error.message : JSON.stringify(error);
        if (errorString.includes("PERMISSION_DENIED") || errorString.includes("API key not valid")) {
            alert("There was an issue with your API Key. It might be invalid or lack the necessary permissions. Please select a valid key and try again.");
            setApiKeyReady(false);
            apiKeyReadyRef.current = false;
        } else {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
            alert(`Sorry, the build failed: ${errorMessage}`);
        }
    } finally {
        setIsLoading(false);
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'build') {
        handleBuildRequest();
    } else {
        handleSendMessage();
    }
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading || !activeChatId) return;
    
    const keyReady = await ensureApiKey();
    if (!keyReady) {
        return;
    }

    const userMessage: Message = { role: 'user', text: inputValue };
    const currentInput = inputValue;
    const currentChatSession = chatSessions[activeChatId];

    const isFirstMessage = currentChatSession.messages.length === 0;
    const newTitle = isFirstMessage ? currentInput.substring(0, 30) + (currentInput.length > 30 ? '...' : '') : currentChatSession.title;

    setChatSessions(prev => ({
        ...prev,
        [activeChatId]: {
            ...prev[activeChatId],
            title: newTitle,
            messages: [...prev[activeChatId].messages, userMessage],
        }
    }));
    
    setInputValue('');
    setIsLoading(true);

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const model = thinkingModeRef.current ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
        const config = thinkingModeRef.current ? { thinkingConfig: { thinkingBudget: 32768 } } : {};
        
        const history = currentChatSession.messages.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.text }]
        }));

        const chat = ai.chats.create({
            model: model,
            config: config,
            history: history,
        });
        
        const stream = await chat.sendMessageStream({ message: currentInput });
        
        let modelResponse = '';
        setChatSessions(prev => ({
            ...prev,
            [activeChatId]: {
                ...prev[activeChatId],
                messages: [...prev[activeChatId].messages, { role: 'model', text: '' }],
            }
        }));

        for await (const chunk of stream) {
            const chunkText = chunk.text;
            modelResponse += chunkText;
            setChatSessions(prev => {
                const currentMessages = [...prev[activeChatId].messages];
                currentMessages[currentMessages.length - 1] = { role: 'model', text: modelResponse };
                return {
                    ...prev,
                    [activeChatId]: {
                        ...prev[activeChatId],
                        messages: currentMessages,
                    }
                };
            });
        }
    } catch (error) {
        console.error("Error sending message:", error);
        const errorString = error instanceof Error ? error.message : JSON.stringify(error);

        if (errorString.includes("PERMISSION_DENIED") || errorString.includes("API key not valid")) {
            alert("There was an issue with your API Key. It might be invalid or lack the necessary permissions. Please select a valid key and try again.");
            setApiKeyReady(false);
            apiKeyReadyRef.current = false;
            // Revert optimistic UI updates
            setChatSessions(prev => ({ ...prev, [activeChatId]: currentChatSession }));
            setInputValue(currentInput);
        } else {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
            setChatSessions(prev => ({
                ...prev,
                [activeChatId]: {
                    ...prev[activeChatId],
                    messages: [...prev[activeChatId].messages, { role: 'model', text: `Sorry, something went wrong. ${errorMessage}` }],
                }
            }));
        }
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .app-wrapper { display: flex; height: 100vh; background-color: var(--background-color); }
        .sidebar { width: 260px; background-color: var(--surface-color); border-right: 1px solid #333; display: flex; flex-direction: column; }
        .sidebar-header { padding: 1rem; border-bottom: 1px solid #333; }
        .new-chat-btn { width: 100%; background-color: transparent; color: var(--text-color); border: 1px solid var(--text-secondary-color); border-radius: 8px; padding: 0.75rem; font-size: 1rem; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .new-chat-btn:hover { background-color: var(--model-message-bg); border-color: var(--primary-color); }
        .chat-history-list { flex-grow: 1; overflow-y: auto; padding: 0.5rem; }
        .chat-history-item { padding: 0.75rem 1rem; margin-bottom: 0.25rem; border-radius: 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .chat-history-item:hover { background-color: var(--model-message-bg); }
        .chat-history-item.active { background-color: var(--primary-color); color: white; }

        .app-container { display: flex; flex-direction: column; height: 100vh; flex-grow: 1; }
        .header { background-color: var(--surface-color); padding: 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; z-index: 10;}
        .header-left { display: flex; align-items: center; gap: 1rem; }
        .header h1 { font-size: 1.25rem; margin: 0; color: var(--text-color); }
        .header-controls { display: flex; align-items: center; gap: 1rem; }
        .chat-container { flex-grow: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
        .message-bubble { max-width: 80%; padding: 0.75rem 1rem; border-radius: 18px; line-height: 1.5; }
        .message-bubble.user { background-color: var(--user-message-bg); color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
        .message-bubble.model { background-color: var(--model-message-bg); color: var(--text-color); align-self: flex-start; border-bottom-left-radius: 4px; }
        .message-bubble.model pre { background-color: #111; padding: 0.75rem; border-radius: 8px; overflow-x: auto; font-family: 'Courier New', Courier, monospace; }
        .message-bubble.model code { font-family: 'Courier New', Courier, monospace; }
        .message-bubble.model p:last-child { margin-bottom: 0; }
        
        .input-form-container { padding: 1rem; background-color: var(--surface-color); border-top: 1px solid #333; z-index: 10;}
        .input-form { display: flex; gap: 0.5rem; }
        .input-form textarea { flex-grow: 1; background-color: var(--model-message-bg); color: var(--text-color); border: 1px solid #444; border-radius: 8px; padding: 0.75rem; font-size: 1rem; resize: none; font-family: inherit; }
        .input-form textarea:focus { outline: none; border-color: var(--primary-color); }
        .input-form button { background-color: var(--primary-color); color: white; border: none; border-radius: 8px; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background-color 0.2s; }
        .input-form button:hover { background-color: #7B1FA2; }
        .input-form button:disabled { background-color: #555; cursor: not-allowed; }
        
        .mode-selector { display: flex; background-color: var(--model-message-bg); padding: 4px; border-radius: 8px; margin-bottom: 0.75rem; }
        .mode-selector button { flex: 1; padding: 0.5rem; border: none; background-color: transparent; color: var(--text-secondary-color); font-size: 0.9rem; font-weight: 500; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
        .mode-selector button.active { background-color: var(--primary-color); color: white; }
        
        .loading-indicator { display: flex; gap: 4px; align-items: center; margin-left: 0.75rem;}
        .loading-indicator span { width: 8px; height: 8px; background-color: var(--text-secondary-color); border-radius: 50%; animation: bounce 1.4s infinite ease-in-out both; }
        .loading-indicator span:nth-of-type(1) { animation-delay: -0.32s; }
        .loading-indicator span:nth-of-type(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }
        
        .mode-toggle { display: flex; align-items: center; gap: 0.5rem; color: var(--text-secondary-color); cursor: pointer; }
        .mode-toggle .switch { position: relative; display: inline-block; width: 40px; height: 20px; }
        .mode-toggle .switch input { opacity: 0; width: 0; height: 0; }
        .mode-toggle .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 20px; }
        .mode-toggle .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        .mode-toggle input:checked + .slider { background-color: var(--primary-color); }
        .mode-toggle input:checked + .slider:before { transform: translateX(20px); }
        .mode-toggle-label { font-size: 0.9rem; font-weight: 500; }
        
        .header-button { background-color: transparent; color: var(--text-secondary-color); border: 1px solid var(--text-secondary-color); border-radius: 8px; padding: 0.5rem 1rem; cursor: pointer; transition: all 0.2s; font-size: 0.9rem; }
        .header-button:hover { background-color: var(--primary-color); color: white; border-color: var(--primary-color); }
        
        .preview-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; z-index: 1000; backdrop-filter: blur(5px); }
        .preview-modal-content { position: relative; display: flex; flex-direction: column; align-items: center; gap: 1rem; }
        .phone-bezel { width: 375px; height: 812px; background: #111; border-radius: 40px; padding: 15px; box-shadow: 0 0 20px rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; }
        .preview-iframe { width: 100%; height: 100%; border: none; border-radius: 30px; background-color: var(--background-color); }
        .preview-close-btn { position: absolute; top: -15px; right: -15px; background: white; color: black; border: none; border-radius: 50%; width: 30px; height: 30px; font-size: 1.2rem; cursor: pointer; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
        .preview-exit-btn { background: #333; color: white; border: 1px solid #555; border-radius: 8px; padding: 0.75rem 1.5rem; cursor: pointer; transition: all 0.2s; font-size: 1rem; font-weight: 500; }
        .preview-exit-btn:hover { background: #444; border-color: #777; }

        .apk-modal-content { position: relative; background-color: var(--surface-color); padding: 2rem; border-radius: 12px; color: var(--text-color); max-width: 600px; width: 90%; box-shadow: 0 5px 15px rgba(0,0,0,0.5); border: 1px solid #444; }
        .apk-modal-content h2 { margin-top: 0; color: var(--primary-color); }
        .apk-modal-content h4 { margin-bottom: 0.5rem; }
        .apk-modal-content p, .apk-modal-content li { line-height: 1.6; color: var(--text-secondary-color); }
        .apk-modal-content code { background-color: var(--model-message-bg); padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', Courier, monospace; color: var(--text-color); }
        .apk-modal-content ol { padding-left: 1.5rem; }
        .apk-modal-content .manifest-button { background-color: var(--primary-color); color: white; border-color: var(--primary-color); margin-top: 0.5rem; }

        .menu-btn { display: none; background: none; border: none; color: var(--text-color); cursor: pointer; padding: 0; }
        .close-sidebar-btn { display: none; position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: var(--text-color); cursor: pointer; z-index: 1000; }
        .sidebar-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 998; }

        @media (max-width: 768px) {
            .sidebar {
                position: fixed;
                left: 0;
                top: 0;
                bottom: 0;
                height: 100%;
                z-index: 999;
                transform: translateX(-100%);
                transition: transform 0.3s ease-in-out;
                box-shadow: 4px 0 15px rgba(0,0,0,0.2);
            }
            .sidebar.open {
                transform: translateX(0);
            }
            .close-sidebar-btn {
                display: block;
            }
            .menu-btn {
                display: block;
            }
            .header h1 {
                font-size: 1.1rem;
            }
            .header-controls {
                gap: 0.5rem;
            }
            .header-button {
                padding: 0.4rem 0.8rem;
                font-size: 0.8rem;
            }
            .mode-toggle-label {
                display: none;
            }
        }
      `}</style>
      <div className="app-wrapper">
          <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
              <button className="close-sidebar-btn" onClick={() => setIsSidebarOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <div className="sidebar-header">
                <button className="new-chat-btn" onClick={handleNewChat}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    New Chat
                </button>
              </div>
              <div className="chat-history-list">
                {/* Fix: Explicitly type 'session' to 'ChatSession' to resolve TypeScript errors. */}
                {Object.values(chatSessions).reverse().map((session: ChatSession) => (
                  <div 
                    key={session.id} 
                    className={`chat-history-item ${session.id === activeChatId ? 'active' : ''}`}
                    onClick={() => handleSelectChat(session.id)}
                  >
                    {session.title}
                  </div>
                ))}
              </div>
          </aside>
          <div className="app-container">
            {!isInIframe && (
                <header className="header">
                    <div className="header-left">
                        <button className="menu-btn" onClick={() => setIsSidebarOpen(true)}>
                           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                        </button>
                        <h1>Gemini Assistant</h1>
                    </div>
                    <div className="header-controls">
                        <div className="mode-toggle" onClick={handleThinkingModeChange} title="Toggle between fast responses and deeper reasoning. Clears current conversation.">
                            <span className="mode-toggle-label">{thinkingMode ? 'Pro' : 'Flash'}</span>
                            <label className="switch">
                                <input type="checkbox" checked={thinkingMode} readOnly />
                                <span className="slider"></span>
                            </label>
                        </div>
                        <button onClick={handlePreviewClick} className="header-button">Preview App</button>
                        <button onClick={handleOpenApkModal} className="header-button">Make APK</button>
                    </div>
                </header>
            )}
            <div className="chat-container" ref={chatContainerRef}>
              {activeMessages.map((msg, index) => (
                <div key={index} className={`message-bubble ${msg.role}`}>
                  <div dangerouslySetInnerHTML={{ __html: msg.role === 'model' ? marked(msg.text) : msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;") }} />
                </div>
              ))}
              {isLoading && mode === 'chat' && activeMessages[activeMessages.length - 1]?.role === 'user' && (
                  <div className="message-bubble model">
                      <div className="loading-indicator"><span></span><span></span><span></span></div>
                  </div>
              )}
            </div>
            <div className="input-form-container">
                <div className="mode-selector">
                    <button className={mode === 'chat' ? 'active' : ''} onClick={() => setMode('chat')}>Chat</button>
                    <button className={mode === 'build' ? 'active' : ''} onClick={() => setMode('build')}>Build & Ask</button>
                </div>
                <form className="input-form" onSubmit={handleSubmit}>
                <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={mode === 'chat' ? "Message Gemini..." : "Describe the app you want to build..."}
                    rows={1}
                    onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e as any);
                    }
                    }}
                />
                <button type="submit" disabled={isLoading || !inputValue.trim()}>
                    {isLoading ? (
                        <div className="loading-indicator"><span></span><span></span><span></span></div>
                    ) : (
                        mode === 'build' ? 'Build' : 'Send'
                    )}
                </button>
                </form>
            </div>
          </div>
      </div>
      {isSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)}></div>}
      {showPreview && (
        <div className="preview-modal-overlay" onClick={handleClosePreview}>
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="phone-bezel">
              <iframe srcDoc={previewSrcDoc} title="App Preview" className="preview-iframe"></iframe>
            </div>
            <button onClick={handleClosePreview} className="preview-close-btn">X</button>
            <button onClick={handleClosePreview} className="preview-exit-btn">Exit Preview</button>
          </div>
        </div>
      )}
      {showApkModal && (
        <div className="preview-modal-overlay" onClick={handleCloseApkModal}>
          <div className="apk-modal-content" onClick={(e) => e.stopPropagation()}>
            <button onClick={handleCloseApkModal} className="preview-close-btn">X</button>
            <h2>Create an APK for Android</h2>
            <p>
                To package this web application as a native Android app (.apk), you can use a tool like an online WebView wrapper or set up a project in Android Studio.
            </p>
            <h4>Using a WebView Wrapper Service:</h4>
            <ol>
                <li>Find an online service that converts web apps to APKs (e.g., GoNative, webtoapp.design).</li>
                <li>Provide the URL of this application.</li>
                <li>Configure app details like name, icon, and permissions. You'll need internet permission, which is included in our provided manifest.</li>
                <li>The service will build the APK for you to download.</li>
            </ol>
            <h4>Using Android Studio (Advanced):</h4>
            <ol>
                <li>Create a new Android Studio project with an "Empty Activity".</li>
                <li>In your activity's layout file (e.g., <code>activity_main.xml</code>), add a <code>WebView</code> component that fills the screen.</li>
                <li>In your <code>MainActivity.java</code> or <code>MainActivity.kt</code>, load the URL of this web app into the WebView. Make sure to enable JavaScript.</li>
                <li>Add the internet permission to your <code>AndroidManifest.xml</code> file. You can use the one provided as a template.</li>
            </ol>
            <p>
                For convenience, you can download a template manifest file below.
            </p>
            <button onClick={handleDownloadManifestClick} className="header-button manifest-button">Download AndroidManifest.xml</button>
          </div>
        </div>
      )}
    </>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);