/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
  isMemo?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isStreaming = false,
  className = '',
  isMemo = false,
}) => {
  const parsedHTML = useMemo(() => {
    if (!content) return '';

    // Standard safety encoding
    let text = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Normalize markdown styling before rendering
    // Strip bold markers surrounding paragraph headers if any to make it uniform
    text = text.replace(/^\[(.*?)]/g, '<strong>$1</strong>');

    // Headers (# -> h1, ## -> h2, ### -> h3)
    text = text.replace(/^### (.*?)$/gm, '<h4 class="text-sm font-semibold text-slate-800 dark:text-slate-100 mt-3 mb-1 font-serif">$1</h4>');
    text = text.replace(/^## (.*?)$/gm, '<h3 class="text-base font-semibold text-slate-900 dark:text-slate-50 mt-4 mb-1.5 font-serif border-b border-slate-100 dark:border-slate-800 pb-1">$1</h3>');
    text = text.replace(/^# (.*?)$/gm, '<h2 class="text-lg font-bold text-slate-950 dark:text-white mt-5 mb-2 font-serif border-b-2 border-slate-200 dark:border-slate-700 pb-1">$1</h2>');

    // Bold (**text**)
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-slate-50">$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong class="font-bold text-slate-900 dark:text-slate-50">$1</strong>');

    // Italics (*text*)
    text = text.replace(/\*(.*?)\*/g, '<em class="italic text-slate-700 dark:text-slate-300">$1</em>');

    // Code blocks (```code```)
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre class="my-4 p-3 rounded-lg bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed border border-slate-800 select-all">${code.trim()}</pre>`;
    });

    // Inline code (`code`)
    text = text.replace(/`(.*?)`/g, '<code class="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-rose-600 dark:text-rose-400 border border-slate-200/50 dark:border-slate-700/50">$1</code>');

    // Blockquotes (> text)
    text = text.replace(/^&gt;[ ]?(.*?)$/gm, '<blockquote class="pl-4 border-l-3 border-brand-500 my-2.5 text-slate-600 dark:text-slate-400 italic bg-brand-50/20 dark:bg-slate-800/10 py-1 pr-2 rounded-r">$1</blockquote>');

    // Bullet Lists (- or * or +)
    // Wrap groups in <ul> tags
    text = text.replace(/^\s*[\-\*\+]\s+(.*?)$/gm, '<li class="relative pl-5 mb-1 list-none before:content-[\'\'] before:absolute before:left-1 before:top-2.5 before:w-1.5 before:border-b-2 before:border-brand-500 before:h-0 text-slate-700 dark:text-slate-300">$1</li>');

    // Numbered Lists (1. text)
    text = text.replace(/^\s*\d+\.\s+(.*?)$/gm, '<li class="list-decimal pl-1 mb-1 ml-4 text-slate-700 dark:text-slate-300">$1</li>');

    // Linebreaks and paras
    const lines = text.split('\n');
    let formatted = '';
    let inList = false;

    lines.forEach((line) => {
      const trimmed = line.trim();
      const isListItem = trimmed.startsWith('<li');
      
      if (isListItem && !inList) {
        formatted += '<ul class="my-3 space-y-1">';
        inList = true;
      } else if (!isListItem && inList) {
        formatted += '</ul>';
        inList = false;
      }

      if (!trimmed) {
        formatted += '<div class="h-2"></div>';
      } else if (trimmed.startsWith('<h') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<pre') || trimmed.startsWith('<ul') || trimmed.startsWith('<li')) {
        formatted += line;
      } else {
        formatted += `<p class="leading-relaxed mb-2.5 text-slate-800 dark:text-slate-200 ${isMemo ? 'text-xs md:text-xs' : 'text-sm md:text-[15px]'}}">${line}</p>`;
      }
    });

    if (inList) formatted += '</ul>';

    return formatted;
  }, [content, isMemo]);

  return (
    <div
      className={`font-sans tracking-wide ${isMemo ? 'text-xs text-slate-600 dark:text-slate-400' : 'text-sm text-slate-800 dark:text-slate-200'} ${className}`}
    >
      <div 
        className={`${isStreaming ? 'streaming-caret' : ''} prose prose-slate dark:prose-invert max-w-none`}
        dangerouslySetInnerHTML={{ __html: parsedHTML }} 
      />
    </div>
  );
};
