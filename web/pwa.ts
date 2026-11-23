// Application installable : manifeste, icônes et service worker (seulement en http/https ;
// en double-clic local, file:// ne les accepte pas et la page fonctionne sans).

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function addLink(rel: string, href: string) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

export function setupPwa(installButton: HTMLButtonElement) {
  if (!location.protocol.startsWith('http')) return;
  addLink('manifest', 'manifest.webmanifest');
  addLink('apple-touch-icon', 'icons/icon-192.png');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => undefined);
  }

  let deferred: InstallPromptEvent | null = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    installButton.hidden = false;
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    installButton.hidden = true;
  });
  installButton.onclick = async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    installButton.hidden = true;
    await prompt.prompt();
  };
}
