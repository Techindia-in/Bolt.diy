/**
 * NodeRunner - Client adapter for the Node.js executor service
 *
 * This module provides methods to execute Node.js commands and manage processes
 * in a Docker container environment.
 */
import { env } from '~/utils/env';

interface ExecuteCommandOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

interface SpawnCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface CommandResult {
  id: string;
  status: 'success' | 'error' | 'running' | 'completed' | 'terminated';
  stdout?: string;
  stderr?: string;
  error?: string;
  code?: number;
}

interface ErrorResponse {
  error: string;
}

/**
 * Get headers for API requests
 */
function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Always include the API key header with the default or configured value
  headers['X-API-Key'] = env.nodeRunnerApiKey || 'bolt-noderunner-key';

  // Debug log to see what API key is being used
  console.debug('Using noderunner API key:', headers['X-API-Key']);

  return headers;
}

/**
 * Fetch with retry logic
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    if (retries <= 0) {
      throw error;
    }

    console.warn(`Fetch to ${url} failed, retrying in ${delay}ms... (${retries} retries left)`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchWithRetry(url, options, retries - 1, delay * 1.5);
  }
}

/**
 * Execute a command and return the result
 */
export async function executeCommand(options: ExecuteCommandOptions): Promise<CommandResult> {
  try {
    const response = await fetchWithRetry(
      `${env.nodeRunnerUrl}/execute`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(options),
      },
      3, // 3 retries
    );

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(errorData.error || 'Failed to execute command');
    }

    return (await response.json()) as CommandResult;
  } catch (error) {
    console.error('Error executing command:', error);
    return {
      id: 'error',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Spawn a long-running process
 */
export async function spawnProcess(options: SpawnCommandOptions): Promise<CommandResult> {
  try {
    console.log(`Attempting to spawn process at ${env.nodeRunnerUrl}/spawn:`, options.command);

    const response = await fetchWithRetry(
      `${env.nodeRunnerUrl}/spawn`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(options),
      },
      3, // 3 retries
    );

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(errorData.error || 'Failed to spawn process');
    }

    return (await response.json()) as CommandResult;
  } catch (error) {
    console.error('Error spawning process:', error);
    return {
      id: 'error',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get the status of a running process
 */
export async function getProcessStatus(processId: string): Promise<CommandResult> {
  try {
    const response = await fetchWithRetry(
      `${env.nodeRunnerUrl}/process/${processId}`,
      {
        method: 'GET',
        headers: getHeaders(),
      },
      2, // 2 retries
    );

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(errorData.error || 'Failed to get process status');
    }

    return (await response.json()) as CommandResult;
  } catch (error) {
    console.error(`Error getting status for process ${processId}:`, error);
    return {
      id: processId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send input to a running process
 */
export async function sendProcessInput(processId: string, input: string): Promise<CommandResult> {
  try {
    const response = await fetchWithRetry(
      `${env.nodeRunnerUrl}/process/${processId}/input`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ input }),
      },
      2, // 2 retries
    );

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(errorData.error || 'Failed to send process input');
    }

    return (await response.json()) as CommandResult;
  } catch (error) {
    console.error(`Error sending process input to ${processId}:`, error);
    return {
      id: processId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Terminate a running process
 */
export async function terminateProcess(processId: string): Promise<CommandResult> {
  try {
    const response = await fetchWithRetry(
      `${env.nodeRunnerUrl}/process/${processId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      },
      2, // 2 retries
    );

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(errorData.error || 'Failed to terminate process');
    }

    return (await response.json()) as CommandResult;
  } catch (error) {
    console.error(`Error terminating process ${processId}:`, error);
    return {
      id: processId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
