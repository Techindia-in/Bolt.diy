import { WORK_DIR_NAME } from '~/utils/constants';
import type { FileChangeEvent, FileSystemInterface } from './types';
import { env } from '~/utils/env';

interface ErrorResponse {
  error: string;
}

interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedTime: string;
}

/**
 * FileSystemAdapter provides a WebContainer-like interface
 * that communicates with our Node.js fileserver
 */
export class FileSystemAdapter implements FileSystemInterface {
  workdir: string = `/home/${WORK_DIR_NAME}`;

  // Headers used for all API requests
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': env.fileServerApiKey,
    };
  }

  // Normalize path to be relative to workdir
  private normalizePath(path: string): string {
    // If the path is exactly the workdir, return a dot to represent current directory
    if (path === this.workdir) {
      return '.';
    }

    // Otherwise handle as before
    if (path.startsWith(this.workdir)) {
      return path.slice(this.workdir.length + 1); // +1 for the slash
    }
    return path.startsWith('/') ? path.slice(1) : path;
  }

  // File System API methods
  async readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
    const normalizedPath = this.normalizePath(path);
    const response = await fetch(`${env.fileServerUrl}/files?path=${encodeURIComponent(normalizedPath)}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(`Failed to read file: ${errorData.error}`);
    }

    if (encoding) {
      return await response.text();
    } else {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
  }

  async writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string }): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    let content: string;

    if (typeof data === 'string') {
      content = data;
    } else {
      // Convert Uint8Array to base64 string for JSON transport
      content = btoa(String.fromCharCode.apply(null, [...data]));
      options = { ...options, encoding: 'base64' };
    }

    const response = await fetch(`${env.fileServerUrl}/files`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        path: normalizedPath,
        content,
        encoding: options?.encoding,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(`Failed to write file: ${errorData.error}`);
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // Validate the path parameter
    if (!path || typeof path !== 'string' || path.trim() === '') {
      throw new Error('Path parameter is required and must be a non-empty string');
    }

    // Normalize the path to ensure consistent formatting
    const normalizedPath = this.normalizePath(path);
    console.log(`Creating directory: ${normalizedPath} (normalized from ${path})`);

    try {
      // Ensure we have a valid path string to send to the API
      const pathToSend = normalizedPath || '.';

      const response = await fetch(`${env.fileServerUrl}/directories`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          path: pathToSend,
          recursive: options?.recursive ?? true,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as ErrorResponse;
        throw new Error(`Failed to create directory: ${errorData.error || response.statusText}`);
      }
    } catch (error) {
      console.error(`Error in mkdir(${normalizedPath}):`, error);
      throw error; // Re-throw to allow proper error handling upstream
    }
  }

  async readdir(
    path: string,
    options?: { withFileTypes?: boolean },
  ): Promise<string[] | { name: string; isDirectory: () => boolean }[]> {
    const normalizedPath = this.normalizePath(path);
    const response = await fetch(`${env.fileServerUrl}/files?path=${encodeURIComponent(normalizedPath)}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(`Failed to read directory: ${errorData.error}`);
    }

    const filesList = (await response.json()) as FileInfo[];

    if (options?.withFileTypes) {
      return filesList.map((file) => ({
        name: file.name,
        isDirectory: () => file.isDirectory,
      }));
    } else {
      return filesList.map((file) => file.name);
    }
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const response = await fetch(`${env.fileServerUrl}/files?path=${encodeURIComponent(normalizedPath)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(`Failed to remove file: ${errorData.error}`);
    }
  }

  // File watcher API - simplified for this implementation
  async watchPaths(options: { include: string[] }, callback: (events: FileChangeEvent[]) => void): Promise<void> {
    // Poll for changes
    let lastTimestamp = Date.now();

    const checkForChanges = async () => {
      try {
        const response = await fetch(`${env.fileServerUrl}/changes?since=${lastTimestamp}`, {
          headers: this.getHeaders(),
        });

        if (response.ok) {
          const changesData = (await response.json()) as FileChangeEvent[];
          if (changesData.length > 0) {
            lastTimestamp = changesData[changesData.length - 1].timestamp;
            callback(changesData);
          }
        }
      } catch (error) {
        console.error('Error fetching file changes:', error);
      }

      setTimeout(checkForChanges, 1000); // Poll every second
    };

    checkForChanges();
  }
}
