import { Toaster as SonnerToaster } from 'sonner';

export { toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-center"
      closeButton
      duration={5000}
      toastOptions={{
        style: {
          background: 'var(--color-elevated)',
          border: '1px solid var(--color-line-strong)',
          color: 'var(--color-fg)',
          borderRadius: '8px',
          fontFamily: 'var(--font-sans)',
        },
      }}
    />
  );
}
