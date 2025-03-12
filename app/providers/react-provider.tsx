import React, { createContext, useContext } from 'react';

// Create a context that will hold React instance
const ReactContext = createContext(React);

// Export the provider component
export function ReactProvider({ children }: { children: React.ReactNode }) {
  return <ReactContext.Provider value={React}>{children}</ReactContext.Provider>;
}

// Custom hook to access the React instance
export function useReactContext() {
  return useContext(ReactContext);
}
