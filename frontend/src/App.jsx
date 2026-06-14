import { useState, useEffect, useRef } from "react";
import {
  Package, MessageSquare, FileText, AlertTriangle,
  Plus, Upload, Download, RefreshCw, X, Check,
  Trash2, Edit3, Send, Bot, User, BarChart3, Home,
  ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { useAppStore } from "./store";

const API = "https://web-production-f6942.up.railway.app";
const PAGE_SIZE = 20;

// ─── helpers ────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

const UNITS = [
  "linear ft", "sq ft", "rolls", "squares", "sheets",
  "pieces", "lbs", "oz", "gallons", "boxes", "bundles", "each",
];

// ─── Toast ──────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, []);
  const colors = {
    success: "bg-green-500", error: "bg-red-500",
    warning: "bg-yellow-500", info: "bg-blue-500",
  };
  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg ${colors[type]}`}>
      {type === "success" && <Check size={16} />}
      {type === "error"   && <X size={16} />}
      {type === "warning" && <AlertTriangle size={16} />}
      <span>{message}</span>
      <button onClick={onClose}><X size={14} /></button>
    </div>
  );
}

// ─── Modal ──────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
      <div className="bg-dark-800 border border-gray-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <h3 className="text-white font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────
function Sidebar({ active, setActive, alertCount }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "quotes",    label: "Quotes",    icon: FileText },
    { id: "analyze",   label: "Analysis",  icon: BarChart3 },
  ];
  return (
    <aside className="w-64 bg-dark-800 border-r border-gray-800 flex flex-col flex-shrink-0">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-2xl font-bold text-copper-500 tracking-wider">JR COPPER</h1>
        <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest">Inventory System</p>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-1">
        {items.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActive(id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors text-sm
              ${active === id ? "bg-copper-500/10 text-copper-500" : "text-gray-400 hover:bg-dark-900 hover:text-white"}`}>
            <Icon size={18} />
            <span className="flex-1 text-left">{label}</span>
            {id === "inventory" && alertCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{alertCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-copper-700 flex items-center justify-center text-xs font-bold text-copper-100">JR</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">JR Copper Co.</p>
            <p className="text-xs text-gray-500">Administrator</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Stat Card ──────────────────────────────────────────────
function StatCard({ label, value, sub, subColor = "text-gray-500", accent }) {
  return (
    <div className="bg-dark-800 border border-gray-800 rounded-xl p-5 relative overflow-hidden min-w-0">
      <div className={`absolute top-0 right-0 w-1 h-full ${accent}`} />
      <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-lg md:text-xl xl:text-2xl 2xl:text-3xl font-bold text-white leading-tight break-all w-full min-w-0">{value}</p>
      {sub && <p className={`text-xs mt-2 ${subColor}`}>{sub}</p>}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────
function Dashboard({ materials, alerts, setActive }) {
  const totalValue = materials.reduce((s, m) => s + (m.quantity * (m.price_per_unit || 0)), 0);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-gray-400 text-sm mt-1">Overview of your copper roofing inventory</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Materials" value={materials.length} sub="items tracked" accent="bg-copper-500" />
        <StatCard
          label="Inventory Value"
          value={`$${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="based on unit prices"
          accent="bg-green-500"
        />
        <StatCard
          label="Low Stock" value={alerts.length}
          sub={alerts.length > 0 ? "needs reorder" : "all good"}
          subColor={alerts.length > 0 ? "text-red-400" : "text-green-400"}
          accent={alerts.length > 0 ? "bg-red-500" : "bg-green-500"}
        />
        <StatCard label="Total Units" value={UNITS.length} sub="unit types supported" accent="bg-blue-500" />
      </div>

      {alerts.length > 0 && (
        <div className="bg-dark-800 border border-red-900/40 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800">
            <AlertTriangle size={16} className="text-red-400" />
            <h3 className="font-semibold text-white">Stock Alerts</h3>
            <span className="ml-auto text-xs text-gray-500">{alerts.length} items</span>
          </div>
          {alerts.map(a => (
            <div key={a.id} className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 last:border-0">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.quantity === 0 ? "bg-red-500" : "bg-yellow-500"}`} />
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{a.name}</p>
                <p className="text-xs text-gray-500">{a.quantity} {a.unit} left — threshold: {a.threshold} {a.unit}</p>
              </div>
              <button onClick={() => setActive("inventory")} className="text-xs text-copper-400 hover:text-copper-300">View →</button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-dark-800 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white">Recent Materials</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
              <th className="px-6 py-3 text-left">Material</th>
              <th className="px-6 py-3 text-left">Quantity</th>
              <th className="px-6 py-3 text-left">Price</th>
              <th className="px-6 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {[...materials].sort((a, b) => b.id - a.id).slice(0, 5).map(m => {
              const low = m.low_stock_threshold && m.quantity <= m.low_stock_threshold;
              return (
                <tr key={m.id} className="hover:bg-dark-900/50">
                  <td className="px-6 py-3 text-white font-medium">{m.name}</td>
                  <td className="px-6 py-3 text-gray-300">{m.quantity} <span className="text-gray-500">{m.unit}</span></td>
                  <td className="px-6 py-3 text-copper-400">{m.price_per_unit ? `$${m.price_per_unit}/${m.unit}` : "—"}</td>
                  <td className="px-6 py-3">
                    {low
                      ? <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs px-2 py-1 rounded-full">Low Stock</span>
                      : <span className="bg-green-500/10 text-green-400 border border-green-500/20 text-xs px-2 py-1 rounded-full">In Stock</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Material Form ──────────────────────────────────────────
function MaterialForm({ data, setData, onSubmit, submitLabel }) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Name *</label>
        <input required
          className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
          value={data.name} onChange={e => setData({ ...data, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Quantity *</label>
          <input required type="number" step="any" min="0.01"
            className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
            value={data.quantity} onChange={e => setData({ ...data, quantity: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Unit *</label>
          <select required
            className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
            value={data.unit} onChange={e => setData({ ...data, unit: e.target.value })}>
            {UNITS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Price per unit ($)</label>
          <input type="number" step="any" min="0"
            className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
            value={data.price_per_unit || ""} onChange={e => setData({ ...data, price_per_unit: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Low stock threshold</label>
          <input type="number" step="any" min="0"
            className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
            value={data.low_stock_threshold || ""} onChange={e => setData({ ...data, low_stock_threshold: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Description</label>
        <input
          className="w-full bg-dark-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-copper-500"
          value={data.description || ""} onChange={e => setData({ ...data, description: e.target.value })} />
      </div>
      <button type="submit" className="w-full bg-copper-600 hover:bg-copper-700 text-white font-medium py-2 rounded-lg text-sm transition-colors">
        {submitLabel}
      </button>
    </form>
  );
}

// ─── Inventory ──────────────────────────────────────────────
function Inventory({ materials, onRefresh, showToast }) {
  const [showAdd, setShowAdd]     = useState(false);
  const [editItem, setEditItem]   = useState(null);
  const [importing, setImporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [search, setSearch]       = useState("");
  const fileRef = useRef();

  const emptyForm = { name: "", quantity: "", unit: "linear ft", price_per_unit: "", low_stock_threshold: "", description: "" };
  const [form, setForm] = useState(emptyForm);

  const filtered   = materials
    .filter(m => m.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page       = Math.min(currentPage, totalPages);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 whenever materials change or search changes
  useEffect(() => { setCurrentPage(1); }, [materials.length, search]);

  async function handleAdd(e) {
    e.preventDefault();
    try {
      await apiFetch("/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantity: parseFloat(form.quantity),
          price_per_unit: form.price_per_unit ? parseFloat(form.price_per_unit) : null,
          low_stock_threshold: form.low_stock_threshold ? parseFloat(form.low_stock_threshold) : null,
        }),
      });
      const addedName = form.name;
      showToast("Material added successfully", "success");
      setShowAdd(false);
      setForm(emptyForm);
      await onRefresh();
      setSearch(addedName);
    } catch (err) { showToast(err.message, "error"); }
  }

  async function handleEdit(e) {
    e.preventDefault();
    try {
      await apiFetch(`/materials/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editItem,
          quantity: parseFloat(editItem.quantity),
          price_per_unit: editItem.price_per_unit ? parseFloat(editItem.price_per_unit) : null,
          low_stock_threshold: editItem.low_stock_threshold ? parseFloat(editItem.low_stock_threshold) : null,
        }),
      });
      showToast("Material updated", "success");
      setEditItem(null);
      await onRefresh();
    } catch (err) { showToast(err.message, "error"); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await apiFetch(`/materials/${id}`, { method: "DELETE" });
      showToast("Material deleted", "success");
      await onRefresh();
    } catch (err) { showToast(err.message, "error"); }
  }

  async function handleImport(e) {
    const file = e.target.files[0]; if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const ext  = file.name.split(".").pop().toLowerCase();
      const path = ext === "csv" ? "/materials/import/csv" : "/materials/import/excel";
      const res  = await apiFetch(path, { method: "POST", body: fd });
      showToast(`Imported ${res.imported} materials. Skipped: ${res.skipped}`, res.skipped > 0 ? "warning" : "success");
      onRefresh();
    } catch (err) { showToast(err.message, "error"); }
    finally { setImporting(false); e.target.value = ""; }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Inventory</h2>
          <p className="text-gray-400 text-sm mt-1">{materials.length} materials tracked</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={handleImport} />
          <button onClick={() => fileRef.current.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-dark-800 border border-gray-700 hover:border-copper-500 text-gray-300 hover:text-white rounded-lg text-sm transition-colors">
            <Upload size={15} />{importing ? "Importing..." : "Import"}
          </button>
          <button onClick={() => window.open(API + "/materials/export/csv")}
            className="flex items-center gap-2 px-4 py-2 bg-dark-800 border border-gray-700 hover:border-copper-500 text-gray-300 hover:text-white rounded-lg text-sm transition-colors">
            <Download size={15} /> Export CSV
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-copper-600 hover:bg-copper-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={15} /> Add Material
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search materials..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-dark-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-copper-500"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="bg-dark-800 border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-dark-900 text-gray-500 text-xs uppercase tracking-wider">
              <th className="px-6 py-3 text-left">Material</th>
              <th className="px-6 py-3 text-left">Quantity</th>
              <th className="px-6 py-3 text-left">Price/Unit</th>
              <th className="px-6 py-3 text-left">Threshold</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {paginated.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  {search ? `No materials found for "${search}".` : "No materials yet. Add your first material or import a file."}
                </td>
              </tr>
            )}
            {paginated.map(m => {
              const low = m.low_stock_threshold && m.quantity <= m.low_stock_threshold;
              return (
                <tr key={m.id} className="hover:bg-dark-900/50 transition-colors">
                  <td className="px-6 py-3">
                    <p className="text-white font-medium">{m.name}</p>
                    {m.description && <p className="text-xs text-gray-500 mt-0.5">{m.description}</p>}
                  </td>
                  <td className="px-6 py-3 text-gray-300">{m.quantity} <span className="text-gray-500">{m.unit}</span></td>
                  <td className="px-6 py-3 text-copper-400">{m.price_per_unit ? `$${m.price_per_unit}` : "—"}</td>
                  <td className="px-6 py-3 text-gray-400">{m.low_stock_threshold ?? "—"}</td>
                  <td className="px-6 py-3">
                    {low
                      ? <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs px-2 py-1 rounded-full">Low Stock</span>
                      : <span className="bg-green-500/10 text-green-400 border border-green-500/20 text-xs px-2 py-1 rounded-full">In Stock</span>
                    }
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => setEditItem({ ...m })} className="text-gray-500 hover:text-copper-400 transition-colors"><Edit3 size={15} /></button>
                      <button onClick={() => handleDelete(m.id, m.name)} className="text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800">
            <p className="text-xs text-gray-500">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, materials.length)} of {materials.length} materials
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-copper-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="text-xs text-gray-400 px-2 tabular-nums">{page} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-copper-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <Modal title="Add Material" onClose={() => { setShowAdd(false); setForm(emptyForm); }}>
          <MaterialForm data={form} setData={setForm} onSubmit={handleAdd} submitLabel="Add Material" />
        </Modal>
      )}
      {editItem && (
        <Modal title="Edit Material" onClose={() => setEditItem(null)}>
          <MaterialForm data={editItem} setData={setEditItem} onSubmit={handleEdit} submitLabel="Save Changes" />
        </Modal>
      )}
    </div>
  );
}

// ─── Shared chat primitives ──────────────────────────────────
function ChatBubble({ role, text }) {
  return (
    <div className={`flex gap-3 ${role === "user" ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs
        ${role === "user" ? "bg-copper-700 text-copper-100" : "bg-dark-700 text-gray-300"}`}>
        {role === "user" ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
        ${role === "user"
          ? "bg-copper-600 text-white rounded-tr-sm"
          : "bg-dark-700 text-gray-200 rounded-tl-sm border border-gray-700"}`}>
        {text}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center">
        <Bot size={14} className="text-gray-300" />
      </div>
      <div className="bg-dark-700 border border-gray-700 px-4 py-3 rounded-2xl rounded-tl-sm">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

// ─── AI Chat ────────────────────────────────────────────────
// Messages and sessionId live in Zustand — survive tab switches.
function AIChat({ showToast, compact = false }) {
  const { aiMessages, aiSessionId, addAiMessage } = useAppStore();
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [aiMessages]);

  async function send(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    addAiMessage({ role: "user", text: userMsg });
    setLoading(true);
    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: aiSessionId, message: userMsg }),
      });
      addAiMessage({ role: "model", text: res.reply });
      if (res.low_stock?.length > 0) showToast(`${res.low_stock.length} item(s) running low!`, "warning");
    } catch (err) {
      showToast(err.message, "error");
      addAiMessage({ role: "model", text: "Sorry, I couldn't connect to the AI. Make sure the backend is running." });
    } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full" style={{ height: "calc(100vh - 140px)" }}>
      <div className="flex-1 bg-dark-800 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {aiMessages.map((m, i) => <ChatBubble key={i} role={m.role} text={m.text} />)}
          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="p-4 border-t border-gray-800 flex gap-3">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask about your inventory..."
            className="flex-1 bg-dark-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-copper-500" />
          <button type="submit" disabled={loading || !input.trim()}
            className="bg-copper-600 hover:bg-copper-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl transition-colors">
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Quotes ─────────────────────────────────────────────────
// Messages and sessionId live in Zustand — survive tab switches.
// clearQuotesMessages also resets the sessionId so the backend starts fresh.
function Quotes({ showToast }) {
  const { quotesMessages, quotesSessionId, addQuotesMessage, clearQuotesMessages } = useAppStore();
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [pendingItems, setPendingItems] = useState([]);
  const bottomRef                   = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [quotesMessages]);

  async function startQuote() {
    setLoading(true);
    try {
      const res = await apiFetch("/budget/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: quotesSessionId, message: "start" }),
      });
      addQuotesMessage({ role: "model", text: res.reply });
    } catch (err) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }

  async function send(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    addQuotesMessage({ role: "user", text: userMsg });
    setLoading(true);
    try {
      const res = await apiFetch("/budget/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: quotesSessionId, message: userMsg }),
      });
      addQuotesMessage({ role: "model", text: res.reply });
      if (res.items || res.structured_data) setPendingItems(res.items || res.structured_data);
    } catch (err) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }

  async function handleApprove() {
    setLoading(true);
    try {
      const res = await apiFetch("/budget/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: pendingItems }),
      });
      showToast(res.message || "Quote approved successfully", "success");
      setPendingItems([]);
    } catch (err) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full" style={{ height: "calc(100vh - 140px)" }}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Quote Builder</h2>
          <p className="text-gray-400 text-sm mt-1">AI-powered interactive quote generator</p>
        </div>
        {quotesMessages.length > 0 && (
          <div className="flex gap-2">
            {pendingItems.length > 0 && (
              <button onClick={handleApprove} disabled={loading}
                className="flex items-center gap-2 px-3 py-1.5 text-xs border border-green-700 hover:border-green-500 text-green-400 hover:text-green-300 rounded-lg transition-colors disabled:opacity-40">
                <Check size={13} /> Approve Quote
              </button>
            )}
            <button onClick={() => { clearQuotesMessages(); setPendingItems([]); }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs border border-gray-700 hover:border-red-500 text-gray-400 hover:text-red-400 rounded-lg transition-colors">
              <X size={13} /> New Quote
            </button>
          </div>
        )}
      </div>

      {quotesMessages.length === 0 ? (
        <div className="flex-1 bg-dark-800 border border-gray-800 rounded-xl flex flex-col items-center justify-center gap-4">
          <FileText size={48} className="text-gray-600" />
          <p className="text-white font-semibold text-lg">Start a New Quote</p>
          <p className="text-gray-400 text-sm text-center max-w-sm">The AI will guide you step by step to build an accurate quote for your client</p>
          <button onClick={startQuote} disabled={loading}
            className="flex items-center gap-2 bg-copper-600 hover:bg-copper-700 text-white px-6 py-3 rounded-xl font-medium transition-colors">
            <Plus size={16} /> {loading ? "Starting..." : "New Quote"}
          </button>
        </div>
      ) : (
        <div className="flex-1 bg-dark-800 border border-gray-800 rounded-xl flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {quotesMessages.map((m, i) => <ChatBubble key={i} role={m.role} text={m.text} />)}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={send} className="p-4 border-t border-gray-800 flex gap-3">
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Reply to the AI..."
              className="flex-1 bg-dark-900 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-copper-500" />
            <button type="submit" disabled={loading || !input.trim()}
              className="bg-copper-600 hover:bg-copper-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl transition-colors">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Analysis ───────────────────────────────────────────────
function Analysis({ showToast }) {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading]   = useState(false);

  async function run() {
    setLoading(true); setAnalysis("");
    try {
      const res = await apiFetch("/analyze");
      setAnalysis(res.analysis);
    } catch (err) { showToast(err.message, "error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">AI Analysis</h2>
          <p className="text-gray-400 text-sm mt-1">Proactive inventory review powered by Gemini</p>
        </div>
        <button onClick={run} disabled={loading}
          className="flex items-center gap-2 bg-copper-600 hover:bg-copper-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          {loading ? "Analyzing..." : "Run Analysis"}
        </button>
      </div>
      {!analysis && !loading && (
        <div className="bg-dark-800 border border-gray-800 rounded-xl p-12 flex flex-col items-center gap-4">
          <BarChart3 size={48} className="text-gray-600" />
          <p className="text-white font-semibold">No analysis yet</p>
          <p className="text-gray-400 text-sm text-center max-w-sm">
            Click "Run Analysis" to get proactive recommendations from Gemini about your current inventory
          </p>
        </div>
      )}
      {analysis && (
        <div className="bg-dark-800 border border-gray-800 rounded-xl p-6">
          <pre className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap font-sans">{analysis}</pre>
        </div>
      )}
    </div>
  );
}
// ─── App Root Modificado ──────────────────────────────────────
export default function App() {
  const [active, setActive] = useState("dashboard");
  const [toast, setToast]   = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false); // Nuevo estado para controlar la burbuja
  const { materials, alerts, setMaterials, setAlerts } = useAppStore();

  function showToast(message, type = "info") { setToast({ message, type }); }

  async function loadData() {
    try {
      const [mats, alrt] = await Promise.all([apiFetch("/materials"), apiFetch("/alerts")]);
      setMaterials(mats);
      setAlerts(alrt.alerts || []);
    } catch {
      showToast("Cannot connect to backend. Make sure uvicorn is running.", "error");
    }
  }

  useEffect(() => { loadData(); }, []);

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden font-sans relative">
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      
      <Sidebar active={active} setActive={setActive} alertCount={alerts.length} />
      
      <main className="flex-1 overflow-y-auto p-8">
        {active === "dashboard" && <Dashboard materials={materials} alerts={alerts} setActive={setActive} />}
        {active === "inventory" && <Inventory materials={materials} onRefresh={loadData} showToast={showToast} />}
        {active === "quotes"    && <Quotes showToast={showToast} />}
        {active === "analyze"   && <Analysis showToast={showToast} />}
      </main>

      {/* ─── BURBUJA FLOTANTE DE IA ─── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
        {/* Ventana del Chat */}
        {isChatOpen && (
          <div className="bg-dark-800 border border-gray-700 w-96 h-[500px] rounded-2xl shadow-2xl mb-4 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="bg-copper-600 p-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Bot size={18} />
                <div>
                  <h3 className="font-semibold text-sm">Asistente JR Copper</h3>
                  <p className="text-[10px] text-copper-100">En línea • Gemini 3.5 Flash</p>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 p-4 overflow-hidden bg-dark-900/40">
              {/* Forzamos una altura interna para el componente AIChat original */}
              <div className="h-full flex flex-col" style={{ height: '100%' }}>
                <AIChat showToast={showToast} compact={true} />
              </div>
            </div>
          </div>
        )}

        {/* Botón de la Burbuja */}
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-200 hover:scale-105 ${
            isChatOpen ? "bg-gray-700 hover:bg-gray-600" : "bg-copper-600 hover:bg-copper-700"
          }`}
        >
          {isChatOpen ? <X size={24} /> : <MessageSquare size={24} />}
        </button>
      </div>
    </div>
  );
}