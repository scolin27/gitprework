import { create } from "zustand";

const MAX_MESSAGES = 30;

export const useAppStore = create((set) => ({
  // ── Inventory ──────────────────────────────────────────────
  materials: [],
  alerts: [],
  setMaterials: (materials) => set({ materials }),
  setAlerts: (alerts) => set({ alerts }),

  // ── AI Assistant chat ──────────────────────────────────────
  aiMessages: [
    {
      role: "model",
      text: "Hi! I'm your inventory assistant. Ask me anything about your stock, prices, or materials.",
    },
  ],
  aiSessionId: "session-" + Date.now(),
  addAiMessage: (msg) =>
    set((state) => ({
      aiMessages: [...state.aiMessages, msg].slice(-MAX_MESSAGES),
    })),

  // ── Quotes chat ────────────────────────────────────────────
  quotesMessages: [],
  quotesSessionId: "quote-" + Date.now(),
  addQuotesMessage: (msg) =>
    set((state) => ({
      quotesMessages: [...state.quotesMessages, msg].slice(-MAX_MESSAGES),
    })),
  // Generates a fresh backend session ID so the next quote starts clean
  clearQuotesMessages: () =>
    set({ quotesMessages: [], quotesSessionId: "quote-" + Date.now() }),
}));
