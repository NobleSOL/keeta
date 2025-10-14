import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import SlippagePortal from "@/components/shared/SlippageDialog";
import { createRoot, type Root } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Pool from "./pages/Pool";
import Portfolio from "./pages/Portfolio";
import Header from "./components/layout/Header";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./wallet/config";

const queryClient = new QueryClient();

const App = () => (
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Header />
          {/* Global slippage dialog portal */}
          <SlippagePortal />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/pool" element={<Pool />} />
            <Route path="/portfolio" element={<Portfolio />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

declare global {
  interface Window {
    __SIVERBACK_ROOT__?: Root;
  }
}

const container = document.getElementById("root")!;
window.__SIVERBACK_ROOT__ = window.__SIVERBACK_ROOT__ ?? createRoot(container);
window.__SIVERBACK_ROOT__.render(<App />);
