export {};
declare global {
  interface Window {
    __MANUS_CONFIG__?: {
      projectId: string; oauthPortalUrl: string; apiUrl: string; apiBrowserKey: string; turnstileSiteKey: string;
    };
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void; theme?: "light" | "dark" | "auto" }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}
