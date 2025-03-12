import { FileSystemAdapter } from './filesystem-adapter';

export class DockerWebContainer {
  fs: any;
  private fileSystemAdapter: FileSystemAdapter;

  constructor() {
    this.fileSystemAdapter = new FileSystemAdapter();
    // Create a proxy for fs methods
    this.fs = {
      mkdir: (path: string) => this.fileSystemAdapter.mkdir(path),
      // Add a no-op watch function since it's not supported
      watch: () => {
        console.warn('fs.watch is not supported in this container');
        return { close: () => {} };
      },
    };
  }

  async boot() {
    try {
      // Ensure we have a valid workspace path
      const workspacePath = '/workspace';
      await this.fileSystemAdapter.mkdir(workspacePath);
      console.log('Docker container booted successfully');
      return true;
    } catch (error) {
      console.error('Error booting Docker container:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const dockerContainer = new DockerWebContainer();
