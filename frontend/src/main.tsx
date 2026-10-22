import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';
import { BootGate } from '@/app/BootGate';
import { CityProvider } from '@/app/city';
import { router } from '@/app/router';
import { ConfirmProvider, Toaster } from '@/components/ui';
import './index.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <Toaster />
        <BootGate>
          <CityProvider>
            <RouterProvider router={router} />
          </CityProvider>
        </BootGate>
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
