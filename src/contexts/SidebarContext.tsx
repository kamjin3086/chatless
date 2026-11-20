import { createContext, useContext } from 'react';

interface SidebarContextValue {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  newConversation: () => Promise<void>;
}

export const SidebarContext = createContext<SidebarContextValue | undefined>(undefined);

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}; 