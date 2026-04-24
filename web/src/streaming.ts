import { useEffect, useRef, useState } from 'react';

export type StableMarkdownSplit = {
  stable: string;
  tail: string;
};

const FRAME_MS = 33;

export function splitStableMarkdown(text: string): StableMarkdownSplit {
  const fence = findUnclosedFenceStart(text);
  if (fence >= 0) return { stable: text.slice(0, fence), tail: text.slice(fence) };

  const lastBlockStart = Math.max(text.lastIndexOf('\n\n'), text.lastIndexOf('\r\n\r\n'));
  const blockStart = lastBlockStart >= 0 ? lastBlockStart + (text[lastBlockStart] === '\r' ? 4 : 2) : 0;
  const tail = text.slice(blockStart);
  if (tail && !/\n\s*$/.test(text) && isUnstableTailBlock(tail)) {
    return { stable: text.slice(0, blockStart), tail };
  }
  return { stable: text, tail: '' };
}

export function useSmoothStreamText(text: string): string {
  const [visible, setVisible] = useState(text);
  const visibleRef = useRef(text);
  const targetRef = useRef(text);
  const lastFrameRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = text;

    const previous = visibleRef.current;
    if (!text || !previous || text.length < previous.length) {
      visibleRef.current = text;
      lastFrameRef.current = performance.now();
      setVisible(text);
      return;
    }
    if (text === previous) return;

    const now = performance.now();
    const apply = () => {
      timerRef.current = null;
      const next = targetRef.current;
      visibleRef.current = next;
      lastFrameRef.current = performance.now();
      setVisible(next);
    };

    if (now - lastFrameRef.current >= FRAME_MS) {
      apply();
    } else if (timerRef.current === null) {
      timerRef.current = window.setTimeout(apply, FRAME_MS - (now - lastFrameRef.current));
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text]);

  return visible;
}

function findUnclosedFenceStart(text: string): number {
  const matches = [...text.matchAll(/^```/gm)];
  if (matches.length % 2 === 0) return -1;
  return matches[matches.length - 1].index ?? -1;
}

function isUnstableTailBlock(block: string): boolean {
  const lines = block.trimEnd().split(/\r?\n/);
  if (lines.length === 0) return false;
  const first = lines[0].trimStart();
  if (/^([-*+]|\d+[.)])\s+/.test(first)) return true;
  if (/^[-*+]\s+\[[ xX]\]\s+/.test(first)) return true;
  if (lines.some((line) => /^\s*\|.*\|\s*$/.test(line))) return true;
  return false;
}
