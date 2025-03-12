import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { useReactContext } from '../providers/react-provider';

export function useShortcuts() {
  // Get React from context to ensure we're using the correct instance
  const React = useReactContext();

  // Replace the direct hook calls with React from context
  const useCallback = React.useCallback;

  // Use a safe pattern for store
  const storeCallback = useCallback(() => {
    // Your store logic here
    return {};
  }, []);

  useEffect(() => {
    // Set up your keyboard shortcuts here
    const handleKeyDown = (e: KeyboardEvent) => {
      // Your shortcut handling logic
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.addEventListener('keydown', handleKeyDown);
    };
  }, []);

  return storeCallback;
}

// Provide a safer fallback if called outside of component context
export default function safeUseShortcuts() {
  try {
    return useShortcuts();
  } catch (e) {
    console.warn('useShortcuts called outside React component context');
    return {};
  }
}
