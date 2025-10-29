// App.tsx - Main React application component

import { useState, useEffect, useRef } from 'react';
import './styles.css';
import { analyzeRepo, sendChat, transcribeAudio } from './api';
import { VoiceRecorder } from './voice';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface RepoInfo {
  name: string;
  url: string;
  fileCount: number;
  technologies: string[];
}

function App() {
  const [repoUrl, setRepoUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
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
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize voice recorder
  useEffect(() => {
    if (useVoice && !voiceRecorder.current) {
      voiceRecorder.current = new VoiceRecorder();
    }
  }, [useVoice]);

  // Establish WebSocket connection when session is created
  useEffect(() => {
    if (!sessionId) return;

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
      
      // Setup client-side heartbeat (send ping every 25 seconds)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(pingInterval);
        }
      }, 25000);
      
      // Store interval for cleanup
      (ws as any).pingInterval = pingInterval;
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

          case 'reasoning_step':
            // Skip reasoning steps - don't show tool calls to user
            console.log('Tool invoked:', data.step.toolName);
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
              role: 'assistant' as const,
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

          case 'ping':
            // Server heartbeat - respond with pong
            if (websocket.current?.readyState === WebSocket.OPEN) {
              websocket.current.send(JSON.stringify({ type: 'pong' }));
            }
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
      
      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        console.log(`Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/5)`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnectAttempts((prev) => prev + 1);
        }, delay);
      } else {
        setError('WebSocket disconnected. Please refresh the page.');
      }
    };

    websocket.current = ws;

    // Cleanup on unmount
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if ((ws as any).pingInterval) {
        clearInterval((ws as any).pingInterval);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [sessionId, reconnectAttempts]);

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
      
      // Store repo info for display
      setRepoInfo({
        name: response.analysis.repoName,
        url: repoUrl,
        fileCount: response.analysis.structure.length,
        technologies: response.analysis.prerequisites.slice(0, 5),
      });
      
      // Add LLM-generated welcome message
      if (response.welcomeMessage) {
        setMessages([{
          role: 'assistant',
          content: response.welcomeMessage,
          timestamp: Date.now(),
        }]);
      }
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
      // Send via WebSocket if connected for real-time reasoning steps
      if (websocket.current && websocket.current.readyState === WebSocket.OPEN) {
        websocket.current.send(JSON.stringify({
          type: 'text',
          message: userMessage.content,
        }));
      } else {
        // Fallback to HTTP POST (no reasoning steps will be shown)
        const response = await sendChat(sessionId, userMessage.content);
        
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: response.response.content,
          timestamp: response.response.timestamp,
        }]);
        setIsLoading(false);
      }
    } catch (error) {
      setError('Failed to send message: ' + (error instanceof Error ? error.message : 'Unknown error'));
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
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <h1>
            <span style={{ marginRight: '0.5rem' }}>🧭</span>
            Code Compass
          </h1>
          {sessionId && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button 
                className="status-indicator"
                title={isConnected ? 'Voice streaming active' : 'Voice streaming inactive'}
              >
                <span className={`status-dot ${isConnected ? 'active' : ''}`}></span>
              </button>
              <button
                onClick={() => {
                  if (confirm('Start a new learning session? Current progress will be lost.')) {
                    setSessionId(null);
                    setMessages([]);
                    setRepoUrl('');
                    setGoal('');
                    if (websocket.current) {
                      websocket.current.close();
                    }
                  }
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
                title="Start a new session"
              >
                ↻ New Session
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      {!sessionId ? (
        <main className="main-content">
          {/* Error/Success Messages */}
          {error && <div className="error-message">⚠️ {error}</div>}
          {successMessage && <div className="success-message">✓ {successMessage}</div>}

          {/* Welcome Section */}
          <div className="voice-control">
            <div className="voice-button" style={{ cursor: 'default', background: 'rgba(255, 255, 255, 0.15)' }}>
              🧠
            </div>
            <div className="voice-status">Learn Any Codebase Through Conversation</div>
            <div className="voice-hint">Master unfamiliar repos with Socratic dialogue - voice or text</div>
          </div>

          {/* Start Form */}
          <form onSubmit={handleAnalyze} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '2rem', boxShadow: 'var(--shadow-md)' }}>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: '500' }}>
                  GitHub Repository
                </label>
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  required
                  style={{
                    width: '100%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '1rem 1.5rem',
                    color: 'var(--text-primary)',
                    fontSize: '1rem',
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: '500' }}>
                  Your Learning Goal
                </label>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What would you like to learn? (e.g., 'Understand the authentication system')"
                  rows={3}
                  required
                  style={{
                    width: '100%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '1rem 1.5rem',
                    color: 'var(--text-primary)',
                    fontSize: '1rem',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              {/* Advanced Settings - Collapsible */}
              <details style={{ marginBottom: '1.5rem' }}>
                <summary style={{ 
                  cursor: 'pointer', 
                  padding: '0.75rem 1rem',
                  background: 'var(--bg-elevated)',
                  borderRadius: '8px',
                  color: 'var(--text-secondary)',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <span>⚙️</span>
                  Additional Settings
                </summary>
                <div style={{ 
                  marginTop: '1rem',
                  padding: '1rem', 
                  background: 'var(--bg-elevated)', 
                  borderRadius: '12px',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={useVoice}
                      onChange={(e) => setUseVoice(e.target.checked)}
                      style={{ marginRight: '0.75rem' }}
                    />
                    <span style={{ fontSize: '1.25rem', marginRight: '0.5rem' }}>🎤</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      Enable Voice Mode
                    </span>
                  </label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', marginLeft: '2.5rem' }}>
                    Use voice input and output for a conversational learning experience
                  </p>
                </div>
              </details>

              <button 
                type="submit" 
                className="send-button" 
                disabled={isAnalyzing}
                style={{ width: '100%', justifyContent: 'center', fontSize: '1rem', padding: '1rem 2rem' }}
              >
                {isAnalyzing ? (
                  <>
                    <div className="loading">
                      <div className="loading-dot"></div>
                      <div className="loading-dot"></div>
                      <div className="loading-dot"></div>
                    </div>
                    Analyzing...
                  </>
                ) : (
                  <>
                    ✨ Start Learning
                  </>
                )}
              </button>
            </div>
          </form>
          
          {/* Footer */}
          <footer style={{
            padding: '1rem',
            textAlign: 'center',
            borderTop: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            fontSize: '0.75rem',
            flexShrink: 0,
            marginTop: 'auto',
          }}>
            <p style={{ marginBottom: '0.5rem' }}>
              Made with ❤️ using{' '}
              <a 
                href="https://developers.cloudflare.com/workers-ai/" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  color: 'var(--primary-color)', 
                  textDecoration: 'none',
                  fontWeight: '500',
                }}
              >
                Cloudflare AI
              </a>
            </p>
            <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', alignItems: 'center' }}>
              <a
                href="https://github.com/suraj-ranganath/cf_ai_repo_socratic_mentor"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <span>GitHub</span>
                <span>↗</span>
              </a>
              <a
                href="https://www.linkedin.com/in/suraj-ranganath/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <span>LinkedIn</span>
                <span>↗</span>
              </a>
            </div>
          </footer>
        </main>
      ) : (
        <main className="main-content">
          {/* Error/Success Messages */}
          {error && <div className="error-message">⚠️ {error}</div>}
          {successMessage && <div className="success-message">✓ {successMessage}</div>}

          {/* Repository Preview Card */}
          {repoInfo && (
            <a 
              href={repoInfo.url} 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                background: 'var(--bg-card)',
                borderRadius: '12px',
                padding: '1rem 1.5rem',
                border: '1px solid var(--border)',
                marginBottom: '1rem',
                display: 'block',
                textDecoration: 'none',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.5rem' }}>📦</span>
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                    {repoInfo.name}
                  </h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', margin: 0 }}>
                    {repoInfo.fileCount} files analyzed • {repoInfo.technologies.slice(0, 3).map((t: any) => typeof t === 'string' ? t : t.concept || t.name).filter(Boolean).join(', ')}
                  </p>
                </div>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>↗</span>
              </div>
            </a>
          )}

          {/* Voice Control */}
          {useVoice && (
            <div className="voice-control">
              <button
                type="button"
                onClick={handleVoiceToggle}
                className={`voice-button ${isRecording ? 'listening' : ''}`}
                disabled={isLoading}
              >
                {isRecording ? '⏹' : '🎤'}
              </button>
              <div className="voice-status">
                {isRecording ? 'Listening...' : 'Tap to speak'}
              </div>
              <div className="voice-hint">
                {isRecording ? 'Tap again to stop' : 'Or type your message below'}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="chat-container">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <h2>Ready to Learn</h2>
                <p>{useVoice ? 'Start speaking or type a message below' : 'Type a message to begin'}</p>
              </div>
            ) : (
              <>
                {messages.map((msg, index) => (
                  <div key={index} className={`message ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className="message-content">
                      <div className="message-text">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="message assistant">
                    <div className="message-avatar">🤖</div>
                    <div className="message-content">
                      <div className="loading">
                        <div className="loading-dot"></div>
                        <div className="loading-dot"></div>
                        <div className="loading-dot"></div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="input-container">
            <form onSubmit={handleSendMessage} className="input-wrapper">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                placeholder={useVoice ? "Speak or type your message..." : "Type your message..."}
                disabled={isLoading}
                className="input-box"
              />
              <button
                type="submit"
                className="send-button"
                disabled={isLoading || !inputMessage.trim()}
              >
                ➤
              </button>
            </form>
          </div>
          
          {/* Footer */}
          <footer style={{
            padding: '1rem',
            textAlign: 'center',
            borderTop: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
            fontSize: '0.75rem',
            flexShrink: 0,
          }}>
            <p style={{ marginBottom: '0.5rem' }}>
              Made with ❤️ using{' '}
              <a 
                href="https://developers.cloudflare.com/workers-ai/" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  color: 'var(--primary-color)', 
                  textDecoration: 'none',
                  fontWeight: '500',
                }}
              >
                Cloudflare AI
              </a>
            </p>
            <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', alignItems: 'center' }}>
              <a
                href="https://github.com/suraj-ranganath/cf_ai_repo_socratic_mentor"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <span>GitHub</span>
                <span>↗</span>
              </a>
              <a
                href="https://www.linkedin.com/in/suraj-ranganath/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                <span>LinkedIn</span>
                <span>↗</span>
              </a>
            </div>
          </footer>
        </main>
      )}
    </div>
  );
}

export default App;
