/**
 * Types for the File System Adapter interface
 */

export interface FileSystemInterface {
  workdir: string;

  /**
   * Read a file from the filesystem
   */
  readFile(path: string, encoding?: string): Promise<string | Uint8Array>;

  /**
   * Write data to a file
   */
  writeFile(path: string, data: string | Uint8Array, options?: { encoding?: string }): Promise<void>;

  /**
   * Create a directory
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Read directory contents
   */
  readdir(
    path: string,
    options?: { withFileTypes?: boolean },
  ): Promise<string[] | { name: string; isDirectory: () => boolean }[]>;

  /**
   * Remove a file or directory
   */
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Watch for changes in the filesystem
   */
  watchPaths(options: { include: string[] }, callback: (events: FileChangeEvent[]) => void): Promise<void>;
}

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  timestamp: number;
}
