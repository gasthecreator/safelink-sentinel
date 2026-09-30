// app/hooks/useOfflineSync.js
import { useState, useEffect } from 'react';

export const useOfflineSync = () => {
  const [syncProgress, setSyncProgress] = useState(0);
  const [pendingMessages, setPendingMessages] = useState(0);
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    // Mock sync status
    setSyncProgress(0);
    setPendingMessages(0);
    setIsOnline(false);
  }, []);

  return {
    syncProgress,
    pendingMessages,
    isOnline,
  };
};

