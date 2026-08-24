import { useEffect, useState } from 'react';
import { CloseIcon, InstallIcon, ShareIcon } from './icons';

const DISMISS_KEY = 'crm_install_dismissed_at';
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function wasRecentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
  return elapsedDays < DISMISS_DAYS;
}

const eligible = () => isMobile() && !isStandalone() && !wasRecentlyDismissed();

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint] = useState(() => eligible() && isIos());
  const [visible, setVisible] = useState(() => eligible() && isIos());

  useEffect(() => {
    if (!eligible() || isIos()) return;

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    }

    function handleAppInstalled() {
      setVisible(false);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-800 dark:bg-gray-900 md:hidden">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          {showIosHint ? <ShareIcon className="h-5 w-5" /> : <InstallIcon className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Instalar o Dispara</p>
          {showIosHint ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Toque em <ShareIcon className="inline h-3.5 w-3.5 align-text-bottom" /> Compartilhar e depois em
              "Adicionar à Tela de Início".
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">Acesse mais rápido, direto da tela inicial do seu celular.</p>
          )}
        </div>

        {!showIosHint && (
          <button
            onClick={handleInstall}
            className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Instalar
          </button>
        )}

        <button
          onClick={dismiss}
          aria-label="Fechar"
          className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
