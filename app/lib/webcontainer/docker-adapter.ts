import { WORK_DIR_NAME } from '~/utils/constants';
import { FileSystemAdapter } from '~/lib/fs-adapter';
import type { FileChangeEvent } from '~/lib/fs-adapter/types';
import type { WebContainer } from '@webcontainer/api';
import { executeCommand, spawnProcess, terminateProcess, sendProcessInput, getProcessStatus } from '~/lib/node-runner';
import { env } from '~/utils/env';

/**
 * This is an adapter that implements the WebContainer interface
 * but uses our Docker-based file system service instead
 */
export class DockerWebContainer {
  workdir: string = `/home/${WORK_DIR_NAME}`;
  fs: FileSystemAdapter & {
    watch: (
      path: string,
      options: { recursive?: boolean },
      callback: (event: string, filename: string) => void,
    ) => { close: () => void };
  };

  // Event listeners
  private listeners: Record<string, Array<(args: any) => void>> = {
    'preview-message': [],
    error: [],
    ready: [],
    'server-ready': [],
  };

  constructor() {
    // Create the file system adapter
    const fsAdapter = new FileSystemAdapter();

    // Extend the fs adapter with a watch method for compatibility with WebContainer API
    this.fs = Object.assign(fsAdapter, {
      watch: (
        path: string,
        options: { recursive?: boolean } = {},
        callback: (event: string, filename: string) => void,
      ) => {
        console.log(`Setting up watch for ${path}, recursive: ${options.recursive}`);

        try {
          // Set up the watcher - this starts a polling mechanism
          fsAdapter.watchPaths(
            {
              include: [path],
            },
            (events: FileChangeEvent[]) => {
              // Convert our file events to the format expected by the WebContainer API
              for (const event of events) {
                let eventType = 'change';

                // WebContainer uses 'rename' for creates and deletes
                if (['add', 'addDir'].includes(event.type)) {
                  eventType = 'rename'; // creates
                } else if (['unlink', 'unlinkDir'].includes(event.type)) {
                  eventType = 'rename'; // deletes
                }

                // Extract the filename from the path
                const filename = event.path.split('/').pop() || '';

                // Call the callback with the event type and filename
                callback(eventType, filename);
              }
            },
          );

          // Return an object with a close method that doesn't do anything yet
          // In a real implementation, we would stop the polling here
          return {
            close: () => {
              console.log(`Closing watcher for ${path} (note: polling is not actually stopped)`);
              // We don't have a way to stop polling in the current adapter
              // This is a stub for compatibility with the WebContainer API
            },
          };
        } catch (error) {
          console.error(`Error setting up file watcher for ${path}:`, error);
          // Return a dummy watcher to avoid breaking code that expects a watcher object
          return {
            close: () => {},
          };
        }
      },
    });
  }

  /**
   * Boot the container - in this case, just initialize the adapter
   */
  static async boot(options: {
    workdirName: string;
    coep?: string;
    forwardPreviewErrors?: boolean;
  }): Promise<DockerWebContainer> {
    const container = new DockerWebContainer();

    // Create the workspace directory if it doesn't exist
    try {
      // Ensure the path is properly specified for the Docker environment
      const workdirName = options?.workdirName || 'project';
      const workspacePath = `/home/${workdirName}`;

      console.log(`Creating workspace directory: ${workspacePath}`);

      // Explicitly validate the path before passing to mkdir
      if (!workspacePath || workspacePath.trim() === '') {
        throw new Error('Invalid workspace path: Path cannot be empty');
      }

      await container.fs.mkdir(workspacePath, { recursive: true });

      // Set the workspace directory
      container.workdir = workspacePath;
    } catch (error) {
      console.error('Error creating workspace directory:', error);
      throw error; // Re-throw to show error in the console
    }

    // Trigger any ready listeners
    setTimeout(() => {
      container.listeners['ready'].forEach((listener) => listener({}));
    }, 100);

    return container;
  }

  /**
   * Add an event listener
   */
  on(event: string, callback: (args: any) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  /**
   * Remove an event listener
   */
  off(event: string, callback: (args: any) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }
  }

  /**
   * Spawn a process - now using the NodeRunner service
   */
  async spawn(command: string, args: string[] = [], options?: any): Promise<any> {
    console.log(`Spawning process via NodeRunner: ${command} ${args.join(' ')}`);

    try {
      const processResult = await spawnProcess({
        command,
        args,
        cwd: options?.cwd || this.workdir,
      });

      const processId = processResult.id;

      if (processResult.status === 'error') {
        throw new Error(`Failed to spawn process: ${processResult.error || 'Unknown error'}`);
      }

      console.log(`Process spawned with ID: ${processId}`);

      // Create process interface compatible with WebContainer API
      return {
        exit: new Promise((resolve) => {
          // Poll for process completion
          const checkStatus = async () => {
            try {
              const status = await getProcessStatus(processId);

              if (status.status === 'completed') {
                resolve({ code: status.code || 0, signal: null });
                return;
              }

              setTimeout(checkStatus, 500);
            } catch (error) {
              console.error('Error checking process status:', error);
              resolve({ code: 1, signal: 'error' });
            }
          };

          checkStatus();
        }),

        input: {
          getWriter() {
            return {
              write(data: string) {
                sendProcessInput(processId, data).catch((error) => {
                  console.error('Error sending input to process:', error);
                });
              },
              close() {
                // No explicit close needed for our implementation
              },
            };
          },
        },

        output: {
          pipeTo(writable: WritableStream<any>) {
            // Simulate initial interactive mode
            const writer = writable.getWriter();
            writer.write('\x1b]654;interactive\x07');

            // Poll for process output
            const pollOutput = async () => {
              try {
                const status = await getProcessStatus(processId);

                if (status.status === 'running' || status.status === 'completed') {
                  if (status.stdout && status.stdout.length > 0) {
                    writer.write(status.stdout);
                  }

                  if (status.status === 'completed') {
                    writer.releaseLock();
                    return;
                  }
                }

                setTimeout(pollOutput, 500);
              } catch (error) {
                console.error('Error polling process output:', error);
                writer.releaseLock();
              }
            };

            pollOutput();
            return Promise.resolve();
          },
        },
      };
    } catch (error) {
      console.error('Error spawning process:', error);
      throw error;
    }
  }

  /**
   * Execute a command - simplified helper using NodeRunner
   */
  async exec(command: string, options?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
    const workingDir = options?.cwd || this.workdir;

    try {
      const result = await executeCommand({
        command,
        cwd: workingDir,
      });

      return {
        code: result.code || 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (error: any) {
      console.error('Error executing command:', error);
      return {
        code: 1,
        stdout: '',
        stderr: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Mount a file - not implemented in this adapter
   */
  mount(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Internal methods used by WebContainer API
   */
  get internal() {
    return {
      watchPaths: async (
        options: { include: string[]; exclude?: string[] },
        callback: (events: FileChangeEvent[]) => void,
      ) => {
        return this.fs.watchPaths(options, callback);
      },
    };
  }
}
