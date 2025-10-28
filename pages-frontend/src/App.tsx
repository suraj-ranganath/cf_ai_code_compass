// App.tsx - Main React application component

import React, { useState, useEffect, useRef } from 'react';
import { analyzeRepo, sendChat, transcribeAudio } from './api';
import { VoiceRecorder } from './voice';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [useVoice, setUseVoice] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceRecorder = useRef<VoiceRecorder | null>(null);
  const websocket = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize voice recorder
  useEffect(() => {
    if (useVoice && !voiceRecorder.current) {
      voiceRecorder.current = new VoiceRecorder();
    }
  }, [useVoice]);

  // Establish WebSocket connection when session is created
  useEffect(() => {
    if (!sessionId || !useVoice) return;

    const apiUrl = import.meta.env.VITE_API_URL || '';
    // Remove /api suffix if present, then add the full path
    const baseUrl = apiUrl.replace(/\/api$/, '');
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/api/realtime/${sessionId}`;

    console.log('Connecting to WebSocket:', wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      setSuccessMessage('Voice streaming connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data);

        switch (data.type) {
          case 'connected':
            console.log('Connection acknowledged:', data.message);
            break;

          case 'status':
            // Show status message temporarily
            setSuccessMessage(data.message);
            break;

          case 'transcription':
            // Show transcription
            setMessages((prev) => [...prev, {
              role: 'user',
              content: data.text,
              timestamp: Date.now(),
            }]);
            break;

          case 'text_response':
            // Add assistant response
            setMessages((prev) => [...prev, {
              role: 'assistant',
              content: data.message,
              timestamp: data.timestamp,
            }]);
            setIsLoading(false);
            break;

          case 'error':
            setError(data.message);
            setIsLoading(false);
            break;

          case 'pong':
            // Keep-alive response
            break;

          default:
            console.warn('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    websocket.current = ws;

    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [sessionId, useVoice]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-dismiss messages
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Handle repository analysis
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!repoUrl || !goal) {
      setError('Please enter both repository URL and your goal');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await analyzeRepo(repoUrl, goal);
      setSessionId(response.sessionId);
      setSuccessMessage('Repository analyzed successfully!');
      
      // Add welcome message
      setMessages([{
        role: 'assistant',
        content: `I've analyzed the repository **${response.analysis.repoName}**.\n\n` +
          `I found ${response.analysis.structure.length} key files and identified ` +
          `${response.analysis.prerequisites.length} prerequisite concepts.\n\n` +
          `Let's start with a Socratic walk-through. ${useVoice ? 'You can speak or type your answers.' : 'Type your answers below.'}`,
        timestamp: Date.now(),
      }]);
    } catch (error) {
      setError('Failed to analyze repository: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle sending a text message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputMessage.trim() || !sessionId) return;

    const userMessage: Message = {
      role: 'user',
      content: inputMessage,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChat(sessionId, inputMessage);
      
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: response.response.content,
        timestamp: response.response.timestamp,
      }]);
    } catch (error) {
      setError('Failed to send message: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Handle voice recording
  const handleVoiceToggle = async () => {
    if (!voiceRecorder.current || !sessionId) return;

    if (isRecording) {
      // Stop recording
      const audioBlob = await voiceRecorder.current.stop();
      setIsRecording(false);
      setIsLoading(true);

      try {
        // Convert audio to base64
        const audioBase64 = await voiceRecorder.current.blobToBase64(audioBlob);

        // Send via WebSocket if connected, otherwise fallback to HTTP
        if (websocket.current && websocket.current.readyState === WebSocket.OPEN) {
          // Stream via WebSocket for real-time processing
          websocket.current.send(JSON.stringify({
            type: 'voice',
            audio: audioBase64,
          }));
          
          setSuccessMessage('Voice message sent via WebSocket');
        } else {
          // Fallback to HTTP POST
          console.log('WebSocket not connected, using HTTP fallback');
          
          const tempMessage: Message = {
            role: 'user',
            content: '[Voice message - transcribing...]',
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, tempMessage]);

          // Transcribe audio via HTTP
          const { transcription } = await transcribeAudio(audioBase64, sessionId);

          // Replace temporary message with transcription
          setMessages((prev) => {
            const filtered = prev.filter((m) => m !== tempMessage);
            return [...filtered, {
              role: 'user',
              content: transcription,
              timestamp: Date.now(),
            }];
          });

          // Send transcribed message to chat
          const response = await sendChat(sessionId, transcription, true);

          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: response.response.content,
            timestamp: response.response.timestamp,
          }]);

          setSuccessMessage('Voice message sent via HTTP');
        }
      } catch (error) {
        setError('Failed to process voice message: ' + (error instanceof Error ? error.message : 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    } else {
      // Start recording
      try {
        await voiceRecorder.current.start();
        setIsRecording(true);
      } catch (error) {
        setError('Failed to access microphone: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>🎓 Socratic Mentor</h1>
        <p>Voice-first GitHub repository onboarding</p>
      </header>

      <main className="main">
        {/* Error Message */}
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="success-message">
            {successMessage}
          </div>
        )}

        {/* Loading Overlay */}
        {isAnalyzing && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
            <div className="loading-text">Analyzing repository...</div>
          </div>
        )}

        {!sessionId ? (
          <div className="start-screen">
            <div className="card">
              <h2>Let's Begin Your Learning Journey</h2>
              <p>Paste a GitHub repository URL and tell me what you want to learn or accomplish.</p>
              
              <form onSubmit={handleAnalyze} className="start-form">
                <div className="form-group">
                  <label htmlFor="repoUrl">GitHub Repository URL</label>
                  <input
                    id="repoUrl"
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/username/repo"
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="goal">Your Goal</label>
                  <textarea
                    id="goal"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="e.g., I need to understand how authentication works in this codebase"
                    rows={3}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={useVoice}
                      onChange={(e) => setUseVoice(e.target.checked)}
                    />
                    Enable voice interaction
                  </label>
                </div>

                <button type="submit" className={`btn btn-primary ${isAnalyzing ? 'btn-loading' : ''}`} disabled={isAnalyzing}>
                  {isAnalyzing ? 'Analyzing...' : 'Start Learning'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="chat-screen">
            {useVoice && (
              <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                {isConnected ? '🟢 Voice streaming connected' : '🔴 Voice streaming disconnected'}
              </div>
            )}
            <div className="messages">
              {messages.map((msg, index) => (
                <div key={index} className={`message message-${msg.role}`}>
                  <div className="message-content">{msg.content}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message message-assistant">
                  <div className="message-content typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
              <form onSubmit={handleSendMessage} className="message-form">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type your answer or question..."
                  disabled={isLoading}
                  className="message-input"
                />
                
                <div className="input-buttons">
                  {useVoice && (
                    <button
                      type="button"
                      onClick={handleVoiceToggle}
                      className={`btn btn-voice ${isRecording ? 'recording' : ''}`}
                      disabled={isLoading}
                      title={isRecording ? 'Stop recording' : 'Start voice recording'}
                    >
                      {isRecording ? '⏹️ Stop' : '🎤 Voice'}
                    </button>
                  )}
                  
                  <button
                    type="submit"
                    className={`btn btn-send ${isLoading ? 'btn-loading' : ''}`}
                    disabled={isLoading || !inputMessage.trim()}
                  >
                    {isLoading ? '' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Built with ❤️ on Cloudflare Edge | <a href="https://github.com/suraj-ranganath/cf_ai_repo_socratic_mentor" target="_blank" rel="noopener noreferrer">View on GitHub</a></p>
      </footer>
    </div>
  );
}

export default App;
