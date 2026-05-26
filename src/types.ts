/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Language {
  code: string;
  name: string;
  label: string;
  flag: string;
}

export type LLMProvider = 'deepseek' | 'gemini' | 'openai' | 'claude';

export interface LLMModel {
  value: string;
  label: string;
  provider: LLMProvider;
  description: string;
}

export interface SystemSettings {
  apiKey: string;
  provider: LLMProvider;
  model: string;
  rounds: number;
  thinkingMode: 'disabled' | 'high' | 'max';
  customPrompt: string;
  glossary: string;
  theme: 'minimal-warm' | 'cosmic-dark';
}

export interface AgentPath {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  name: string;
  role: string;
  tag: string;
  color: string;
  description: string;
}

export interface DynamicAgent {
  name: string;
  label: string;
  systemPrompt: string;
}

export interface RoundDrafts {
  A: string; // Linguist
  B: string; // Editor
  C: string; // Domain Expert
  D: string; // Dynamic Customized
  E: string; // Implicit hidden meaning
  F: string; // Style writer
}

export interface RoundCritiques {
  A: string; // Critique on B/C
  B: string; // Critique on C/D
  C: string; // Critique on D/F
  D: string; // Critique on A/B
  F: string; // Critique on A/C
}

export interface RoundData {
  round: number;
  paths: RoundDrafts;
  critiques: RoundCritiques;
  synthesis: string;
  memo: string;
  usageTokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface TranslationSession {
  id: string;
  timestamp: string;
  srcLang: string;
  tgtLang: string;
  srcCode: string;
  tgtCode: string;
  model: string;
  source: string;
  result: string;
  scores: [number, number, number] | null; // fidelity, fluency, naturalness
  remark: string;
  elapsed: number;
  mode: 'refined' | 'standard' | 'efficient' | 'light' | 'chunk';
  modeLabel: string;
  rounds: number;
  dynamicAgent?: {
    name: string;
    label: string;
  };
  customPrompt?: string;
  roundData?: RoundData[];
  usageTokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}
