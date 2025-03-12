import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Theme } from '~/lib/stores/theme';
import { createScopedLogger } from '~/utils/logger';
import { getTerminalTheme } from './theme';

const logger = createScopedLogger('Terminal');

export interface TerminalRef {
  reloadStyles: () => void;
}

export interface TerminalProps {
  className?: string;
  theme: Theme;
  readonly?: boolean;
  id: string;
  onTerminalReady?: (terminal: XTerm) => void;
  onTerminalResize?: (cols: number, rows: number) => void;
}

export const Terminal = memo(
  forwardRef<TerminalRef, TerminalProps>(
    ({ className, theme, readonly, id, onTerminalReady, onTerminalResize }, ref) => {
      const terminalElementRef = useRef<HTMLDivElement>(null);
      const terminalRef = useRef<XTerm>();
      const [isInitialized, setIsInitialized] = useState(false);

      // Initialize the terminal only after component is mounted
      useEffect(() => {
        // Wait for next render cycle to ensure the DOM is fully rendered
        const timeoutId = setTimeout(() => {
          const element = terminalElementRef.current;

          if (!element) {
            logger.error(`Terminal element not found for [${id}]`);
            return;
          }

          // If element doesn't have dimensions yet, set up polling
          if (element.offsetHeight === 0 || element.offsetWidth === 0) {
            logger.debug(`Terminal element has no dimensions yet for [${id}], waiting...`);

            const checkInterval = setInterval(() => {
              if (element.offsetHeight > 0 && element.offsetWidth > 0) {
                clearInterval(checkInterval);
                initializeTerminal(element);
              }
            }, 100);

            // Clean up interval on unmount
            return () => clearInterval(checkInterval);
          } else {
            // Element has dimensions, initialize terminal
            initializeTerminal(element);
          }
        }, 100); // Delay initialization to ensure DOM is ready

        return () => clearTimeout(timeoutId);
      }, []);

      function initializeTerminal(element: HTMLDivElement) {
        if (isInitialized) return;

        try {
          logger.debug(`Initializing terminal [${id}] with dimensions ${element.offsetWidth}x${element.offsetHeight}`);

          const fitAddon = new FitAddon();
          const webLinksAddon = new WebLinksAddon();

          const terminal = new XTerm({
            cursorBlink: true,
            convertEol: true,
            disableStdin: readonly,
            theme: getTerminalTheme(readonly ? { cursor: '#00000000' } : {}),
            fontSize: 12,
            fontFamily: 'Menlo, courier-new, courier, monospace',
            // Pre-define dimensions to avoid XTerm trying to calculate them
            rows: 20,
            cols: 80,
          });

          terminalRef.current = terminal;

          // Load addons before opening
          terminal.loadAddon(fitAddon);
          terminal.loadAddon(webLinksAddon);

          // Wrap terminal.open in try-catch
          try {
            terminal.open(element);
            setIsInitialized(true);

            // Safely fit the terminal after a brief delay
            setTimeout(() => {
              try {
                if (element.offsetHeight > 0 && element.offsetWidth > 0) {
                  fitAddon.fit();
                  onTerminalResize?.(terminal.cols, terminal.rows);
                  logger.debug(`Fit terminal [${id}] to ${terminal.cols}x${terminal.rows}`);
                }
              } catch (e) {
                logger.error(`Error fitting terminal [${id}]:`, e);
              }
            }, 100);

            // Setup resize observer to handle container resizing
            const resizeObserver = new ResizeObserver(() => {
              try {
                if (element.offsetHeight > 0 && element.offsetWidth > 0 && terminalRef.current) {
                  fitAddon.fit();
                  onTerminalResize?.(terminal.cols, terminal.rows);
                }
              } catch (e) {
                logger.error(`Error in resize observer [${id}]:`, e);
              }
            });

            resizeObserver.observe(element);

            logger.debug(`Terminal [${id}] initialized and ready`);
            onTerminalReady?.(terminal);

            return () => {
              resizeObserver.disconnect();
              terminal.dispose();
              setIsInitialized(false);
            };
          } catch (e) {
            logger.error(`Error opening terminal [${id}]:`, e);
            return () => {};
          }
        } catch (e) {
          logger.error(`Error creating terminal [${id}]:`, e);
          return () => {};
        }
      }

      useEffect(() => {
        const terminal = terminalRef.current;
        if (!terminal) return;

        try {
          // we render a transparent cursor in case the terminal is readonly
          terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});
          terminal.options.disableStdin = readonly;
        } catch (e) {
          logger.error(`Error updating terminal options [${id}]:`, e);
        }
      }, [theme, readonly]);

      useImperativeHandle(ref, () => {
        return {
          reloadStyles: () => {
            try {
              const terminal = terminalRef.current;
              if (!terminal) return;

              terminal.options.theme = getTerminalTheme(readonly ? { cursor: '#00000000' } : {});
            } catch (e) {
              logger.error(`Error reloading terminal styles [${id}]:`, e);
            }
          },
        };
      }, []);

      return <div className={className} ref={terminalElementRef} style={{ minHeight: '20px', minWidth: '80px' }} />;
    },
  ),
);
