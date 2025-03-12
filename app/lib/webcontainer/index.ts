import { WebContainer } from '@webcontainer/api';
import { DockerWebContainer } from './docker-adapter';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';
import { env } from '~/utils/env';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

// Use the environment utility to check if we're running in Docker
const isRunningInDocker = env.runningInDocker;

// Use a type that can represent either container type
export type BoltContainer = WebContainer | DockerWebContainer;

export let webcontainer: Promise<BoltContainer>;

if (import.meta.env.SSR) {
  // noop for ssr
  webcontainer = new Promise(() => {});
} else {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve().then(async () => {
      let container: BoltContainer;

      if (isRunningInDocker) {
        // Use Docker adapter when running in Docker environment
        console.log('Running in Docker mode, using filesystem adapter');
        container = await DockerWebContainer.boot({
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true,
        });
      } else {
        // Use standard WebContainer for browser environments
        console.log('Running in browser mode, using WebContainer');
        container = await WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      }

      webcontainerContext.loaded = true;

      const { workbenchStore } = await import('~/lib/stores/workbench');

      // Listen for preview errors
      container.on('preview-message', (message: any) => {
        console.log('WebContainer preview message:', message);

        // Handle both uncaught exceptions and unhandled promise rejections
        if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
          const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
          workbenchStore.actionAlert.set({
            type: 'preview',
            title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
            description: message.message,
            content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
            source: 'preview',
          });
        }
      });

      return container;
    });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
