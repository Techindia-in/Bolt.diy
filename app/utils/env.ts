/**
 * Environment variable utilities
 *
 * This file provides a consistent way to access environment variables
 * across browser and Node.js environments, with support for Vite's
 * import.meta.env in the browser.
 */

// Type for environment configuration
export interface EnvironmentConfig {
  // Docker environment detection
  runningInDocker: boolean;

  // File Server configuration
  fileServerUrl: string;
  fileServerApiKey: string;

  // Node Runner configuration
  nodeRunnerUrl: string;
  nodeRunnerApiKey: string;
}

/**
 * Convert Docker service URLs to browser-accessible URLs
 * This is needed because browsers can't resolve Docker service names directly
 */
function convertToClientUrl(url: string, defaultPort: number): string {
  if (typeof window === 'undefined') {
    // In Node.js (server-side) environment, keep as-is
    return url;
  }

  // Handle empty URLs by providing localhost defaults
  if (!url || url.trim() === '') {
    return `http://localhost:${defaultPort}`;
  }

  // In browser environment, convert Docker service hostnames to localhost
  return url.replace('http://fileserver:', 'http://localhost:').replace('http://noderunner:', 'http://localhost:');
}

/**
 * Get environment variables with proper fallbacks for browser and Node.js environments
 */
export function getEnvironment(): EnvironmentConfig {
  // In browser environment
  if (typeof window !== 'undefined') {
    const fileServerUrl =
      (window as any).ENV?.VITE_FILESERVER_URL || import.meta.env.VITE_FILESERVER_URL || 'http://localhost:3001';

    const nodeRunnerUrl =
      (window as any).ENV?.VITE_NODERUNNER_URL || import.meta.env.VITE_NODERUNNER_URL || 'http://localhost:3002';

    // Debug log the URLs being used
    console.debug('Using file server URL:', fileServerUrl);
    console.debug('Using node runner URL:', nodeRunnerUrl);

    return {
      // Docker environment detection
      runningInDocker:
        (window as any).ENV?.VITE_RUNNING_IN_DOCKER === 'true' || import.meta.env.VITE_RUNNING_IN_DOCKER === 'true',

      // File Server configuration - convert to client-accessible URL
      fileServerUrl: convertToClientUrl(fileServerUrl, 3001),
      fileServerApiKey:
        (window as any).ENV?.VITE_FILESERVER_API_KEY ||
        import.meta.env.VITE_FILESERVER_API_KEY ||
        'bolt-fileserver-key',

      // Node Runner configuration - convert to client-accessible URL
      nodeRunnerUrl: convertToClientUrl(nodeRunnerUrl, 3002),
      nodeRunnerApiKey:
        (window as any).ENV?.VITE_NODERUNNER_API_KEY ||
        import.meta.env.VITE_NODERUNNER_API_KEY ||
        'bolt-noderunner-key',
    };
  }

  // In Node.js environment
  return {
    // Docker environment detection
    runningInDocker: process.env.RUNNING_IN_DOCKER === 'true',

    // File Server configuration
    fileServerUrl: process.env.FILESERVER_URL || 'http://localhost:3001',
    fileServerApiKey: process.env.FILESERVER_API_KEY || 'bolt-fileserver-key',

    // Node Runner configuration
    nodeRunnerUrl: process.env.NODERUNNER_URL || 'http://localhost:3002',
    nodeRunnerApiKey: process.env.NODERUNNER_API_KEY || 'bolt-noderunner-key',
  };
}

// Export a singleton instance for easy access
export const env = getEnvironment();
