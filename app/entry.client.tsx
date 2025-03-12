import { RemixBrowser } from '@remix-run/react';
import { startTransition, StrictMode, useState, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';

// Add a custom provider that ensures we have consistent React context
function ClientApp() {
  // Force a re-render after initial mount to ensure clean hydration
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Set mounted to true after initial render to ensure client-side only code runs after hydration
    setMounted(true);
  }, []);

  return (
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  );
}

// Wrap in startTransition to prioritize user input during hydration
startTransition(() => {
  const root = document.getElementById('root');
  if (root) {
    try {
      hydrateRoot(root, <ClientApp />);
    } catch (error) {
      console.error('Hydration error:', error);
      // If hydration fails, perform a full client-side render
      root.innerHTML = '';
      hydrateRoot(root, <ClientApp />);
    }
  }
});
