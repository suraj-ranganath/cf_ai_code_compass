// ReasoningPanel.tsx - Shows AI reasoning steps and tool calls

import React from 'react';
import '../styles/reasoning.css';

export interface ReasoningStep {
  type: 'tool_call' | 'thinking' | 'result';
  toolName?: string;
  description: string;
  timestamp: number;
  args?: any;
  result?: any;
}

interface ReasoningPanelProps {
  steps: ReasoningStep[];
  isOpen: boolean;
  onClose: () => void;
}

export const ReasoningPanel: React.FC<ReasoningPanelProps> = ({ steps, isOpen, onClose }) => {
  if (!isOpen) return null;

  const getStepIcon = (step: ReasoningStep) => {
    switch (step.type) {
      case 'tool_call':
        return '🔧';
      case 'result':
        return '✓';
      case 'thinking':
        return '💭';
      default:
        return '•';
    }
  };

  const getToolDisplayName = (toolName?: string) => {
    if (!toolName) return 'Processing';
    
    const names: { [key: string]: string } = {
      'semantic_search': 'Searching Code',
      'generate_concept_primer': 'Building Concept Primer',
      'generate_socratic_question': 'Creating Question',
      'repo_map': 'Analyzing Repository',
      'embed_text': 'Embedding Content',
    };
    
    return names[toolName] || toolName.replace(/_/g, ' ');
  };

  return (
    <div className="reasoning-overlay" onClick={onClose}>
      <div className="reasoning-panel" onClick={(e) => e.stopPropagation()}>
        <div className="reasoning-header">
          <h3>🧠 AI Reasoning</h3>
          <button className="close-btn" onClick={onClose} aria-label="Close reasoning panel">
            ✕
          </button>
        </div>

        <div className="reasoning-disclosure">
          <small>These steps show how the AI approached the problem. They may be imperfect or simplified.</small>
        </div>

        <div className="reasoning-steps">
          {steps.length === 0 ? (
            <div className="no-reasoning">
              <p>No reasoning steps available</p>
            </div>
          ) : (
            steps.map((step, index) => (
              <div key={index} className={`reasoning-step step-${step.type}`}>
                <div className="step-icon">{getStepIcon(step)}</div>
                <div className="step-content">
                  <div className="step-title">
                    {step.type === 'tool_call' && getToolDisplayName(step.toolName)}
                    {step.type === 'result' && `✓ ${getToolDisplayName(step.toolName)}`}
                    {step.type === 'thinking' && 'Thinking...'}
                  </div>
                  <div className="step-description">{step.description}</div>
                  {step.result && (
                    <details className="step-details">
                      <summary>View result</summary>
                      <pre>{step.result}</pre>
                    </details>
                  )}
                </div>
                <div className="step-time">
                  {new Date(step.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="reasoning-footer">
          <kbd>R</kbd> to toggle • <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
};
