type Turnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      'response-field': false;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      'timeout-callback': () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileLoad: Promise<Turnstile> | undefined;

export function loadTurnstile(): Promise<Turnstile> {
  turnstileLoad ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.addEventListener('load', () => {
      const client = window.turnstile;
      if (client) resolve(client);
      else reject(new Error('Turnstile unavailable'));
    });
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error('Turnstile unavailable'));
    });
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    turnstileLoad = undefined;
    throw error;
  });
  return turnstileLoad;
}
