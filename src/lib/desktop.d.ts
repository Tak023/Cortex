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
      /** In-app browser for local project apps (build/test visibility) */
      openBrowserPreview?: (opts: {
        url: string;
        title?: string;
      }) => Promise<{
        ok: boolean;
        detail?: string;
        url?: string;
        external?: boolean;
      }>;
      closeBrowserPreview?: () => Promise<{ ok: boolean; detail?: string }>;
      pty?: {
        start: (opts: {
          agent: string;
          cols: number;
          rows: number;
          /** Workspace scope resolved by the Cortex server. */
          cwd?: string;
          /** Approval-policy flags the server verified against the CLI. */
          extraArgs?: string[];
          /** Env keys to drop so the intended credential wins. */
          unsetEnv?: string[];
        }) => Promise<{
          ok: boolean;
          detail?: string;
          session?: {
            id: string;
            display: string;
            label: string;
            cwd?: string;
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
