/** Shared Electron preload bridge types for the Cortex desktop shell. */
export {};

declare global {
  interface Window {
    cortexDesktop?: {
      isDesktop: boolean;
      platform: string;
      hasPty?: boolean;
      openAgentTerminal?: (opts: {
        agent: string;
        title: string;
        url: string;
      }) => Promise<{ ok: boolean; detail?: string }>;
      pty?: {
        start: (opts: {
          agent: string;
          cols: number;
          rows: number;
        }) => Promise<{
          ok: boolean;
          detail?: string;
          session?: {
            id: string;
            display: string;
            label: string;
          };
        }>;
        write: (id: string, data: string) => Promise<{ ok: boolean }>;
        resize: (
          id: string,
          cols: number,
          rows: number,
        ) => Promise<{ ok: boolean }>;
        kill: (id: string) => Promise<{ ok: boolean }>;
        onEvent: (
          cb: (payload: {
            id: string;
            type: "data" | "exit" | "error";
            data?: string;
            exitCode?: number;
          }) => void,
        ) => () => void;
      };
    };
  }
}
