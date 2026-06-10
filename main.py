import csv
import io
import os
import json
from datetime import datetime
from typing import Optional

import openpyxl
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()  # carga GEMINI_API_KEY desde el archivo .env

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# ══════════════════════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════════════════════
# Elastica: usa DATABASE_URL del entorno (PostgreSQL en Railway); SQLite como fallback local.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./inventory.db")
# Railway entrega URLs "postgres://"; SQLAlchemy requiere "postgresql://".
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
# check_same_thread solo aplica a SQLite.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine      = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base         = declarative_base()


class MaterialDB(Base):
    __tablename__ = "materials"

    id                  = Column(Integer,     primary_key=True, index=True)
    name                = Column(String(100), nullable=False)
    quantity            = Column(Float,       nullable=False)
    unit                = Column(String(50),  nullable=False)
    price_per_unit      = Column(Float,       nullable=True)    # USD — for quotes
    low_stock_threshold = Column(Float,       nullable=True)    # alert when qty <= this
    description         = Column(String(255), nullable=True)
    created_at          = Column(DateTime,    default=datetime.utcnow)
    updated_at          = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)


Base.metadata.create_all(bind=engine)


# ══════════════════════════════════════════════════════════════
# GEMINI SETUP
# ══════════════════════════════════════════════════════════════
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel("gemini-3.5-flash")
else:
    gemini_model = None

# In-memory chat history per session (keyed by session_id string)
chat_sessions: dict[str, list[dict]] = {}


def _inventory_snapshot(db: Session) -> str:
    """Returns a plain-text summary of the full inventory for the AI context."""
    materials = db.query(MaterialDB).all()
    if not materials:
        return "The inventory is currently empty."

    lines = ["CURRENT INVENTORY SNAPSHOT (Copper Roofing Company — US units)\n"]
    low_stock = []

    for m in materials:
        price_str = f"${m.price_per_unit:.2f}/{m.unit}" if m.price_per_unit else "no price set"
        threshold_str = f"threshold: {m.low_stock_threshold} {m.unit}" if m.low_stock_threshold else "no threshold"
        lines.append(
            f"- [{m.id}] {m.name}: {m.quantity} {m.unit} | {price_str} | {threshold_str}"
            + (f" | {m.description}" if m.description else "")
        )
        if m.low_stock_threshold and m.quantity <= m.low_stock_threshold:
            low_stock.append(m)

    if low_stock:
        lines.append("\n⚠️  LOW STOCK ITEMS:")
        for m in low_stock:
            lines.append(f"  - {m.name}: only {m.quantity} {m.unit} left (threshold: {m.low_stock_threshold})")

    return "\n".join(lines)


SYSTEM_PROMPT = """You are an expert inventory assistant for a copper roofing company in the United States.
You have access to the company's full material inventory. Your job is to:
1. Answer questions about stock levels, prices, and materials in clear, simple language.
2. Proactively warn when materials are running low.
3. Help the contractor build accurate quotes for their clients based on project size and materials needed.
4. Suggest efficient material usage when possible.
5. Be concise and practical — this is a field business, not a tech company.
6. TOOL USAGE — RESERVAR MATERIAL: When the user explicitly approves or confirms a budget or
   quote (words like "approve", "confirm", "yes go ahead", "deduct it", "aprobado", "sí, adelante"),
   call the `reservar_material` tool ONCE per material in that quote. Do NOT ask for re-confirmation
   — the user's approval is sufficient. After all tool calls complete, summarize what was deducted
   and flag any items that are now below their low-stock threshold.

CRITICAL - LANGUAGE RULE: Always respond in the EXACT same language the user writes in.
If the user writes in Spanish, respond entirely in Spanish.
If the user writes in English, respond entirely in English.
Never mix both languages in the same response. No exceptions.
When calculating quotes, show a clear itemized breakdown.
If stock is critically low for a requested job, say so immediately.
"""


# ══════════════════════════════════════════════════════════════
# FUNCTION CALLING — TOOLS
# ══════════════════════════════════════════════════════════════
def reservar_material(nombre_material: str, cantidad_a_reservar: float) -> dict:
    """
    Deduct a material quantity from inventory when a quote is approved.

    Call this tool once per material when the user confirms or approves a budget or quote.
    Use the exact material name as it appears in the inventory snapshot.

    Args:
        nombre_material: Exact name of the material to reserve (as shown in the inventory).
        cantidad_a_reservar: Quantity to deduct from stock (must be positive).
    """
    return {}  # Schema stub — real execution handled in _ejecutar_reservar_material


def _ejecutar_reservar_material(
    db: Session, nombre_material: str, cantidad_a_reservar: float
) -> dict:
    m = (
        db.query(MaterialDB)
        .filter(MaterialDB.name.ilike(f"%{nombre_material}%"))
        .first()
    )
    if not m:
        return {"status": "error", "message": f"Material '{nombre_material}' not found in inventory."}
    if m.quantity < cantidad_a_reservar:
        return {
            "status": "error",
            "message": (
                f"Insufficient stock for '{m.name}': "
                f"available {m.quantity} {m.unit}, "
                f"requested {cantidad_a_reservar} {m.unit}."
            ),
        }
    before = m.quantity
    m.quantity -= cantidad_a_reservar
    m.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(m)
    return {
        "status": "success",
        "material": m.name,
        "unit": m.unit,
        "deducted": cantidad_a_reservar,
        "stock_before": before,
        "stock_after": m.quantity,
    }


if GEMINI_API_KEY:
    gemini_model_with_tools = genai.GenerativeModel(
        model_name="gemini-3.5-flash",
        system_instruction=SYSTEM_PROMPT,
        tools=[reservar_material],
    )
else:
    gemini_model_with_tools = None


# ══════════════════════════════════════════════════════════════
# US IMPERIAL UNITS
# ══════════════════════════════════════════════════════════════
VALID_UNITS = [
    "linear ft", "sq ft", "rolls", "squares", "sheets",
    "pieces", "lbs", "oz", "gallons", "boxes", "bundles", "each",
]

UNIT_DESCRIPTIONS = {
    "linear ft":  "Linear feet — flashing, drip edge, gutters",
    "sq ft":      "Square feet — flat copper sheet stock",
    "rolls":      "Rolls — coil stock, underlayment",
    "squares":    "Squares (100 sq ft) — roofing coverage area",
    "sheets":     "Sheets — pre-cut flat copper panels",
    "pieces":     "Pieces — fittings, cleats, fasteners",
    "lbs":        "Pounds — solder bars, scrap copper",
    "oz":         "Ounces — solder wire, small hardware",
    "gallons":    "Gallons — flux, solvents, coatings",
    "boxes":      "Boxes — nails, screws, staples",
    "bundles":    "Bundles — shingles / miscellaneous",
    "each":       "Each — unique or single items",
}


# ══════════════════════════════════════════════════════════════
# PYDANTIC SCHEMAS
# ══════════════════════════════════════════════════════════════
class MaterialBase(BaseModel):
    name:                str   = Field(..., min_length=1, max_length=100, example="16 oz Copper Coil Stock")
    quantity:            float = Field(..., gt=0,         example=250.0)
    unit:                str   = Field(...,               example="linear ft")
    price_per_unit:      Optional[float] = Field(None, ge=0, example=4.75)
    low_stock_threshold: Optional[float] = Field(None, ge=0, example=50.0)
    description:         Optional[str]   = Field(None, max_length=255)

class MaterialCreate(MaterialBase):
    pass

class MaterialUpdate(BaseModel):
    name:                Optional[str]   = Field(None, min_length=1, max_length=100)
    quantity:            Optional[float] = Field(None, gt=0)
    unit:                Optional[str]   = None
    price_per_unit:      Optional[float] = Field(None, ge=0)
    low_stock_threshold: Optional[float] = Field(None, ge=0)
    description:         Optional[str]   = Field(None, max_length=255)

class MaterialOut(MaterialBase):
    id:         int
    created_at: datetime
    updated_at: datetime
       
    model_config = { "from_attributes" : True }  

class ImportResult(BaseModel):
    imported: int
    skipped:  int
    errors:   list[str]

# ── AI schemas ─────────────────────────────────────────────────
class ChatMessage(BaseModel):
    session_id: str  = Field(default="default", example="user-123")
    message:    str  = Field(..., example="How much copper coil do we have left?")

class ChatResponse(BaseModel):
    reply:      str
    low_stock:  list[dict]   # items below threshold — drives frontend alerts
    session_id: str

class BudgetItem(BaseModel):
    material_id: int
    quantity_needed: float

class BudgetRequest(BaseModel):
    project_name: str
    items: list[BudgetItem]

class BudgetResponse(BaseModel):
    project_name:    str
    line_items:      list[dict]
    total_usd:       float
    stock_warnings:  list[str]

class ApproveQuoteRequest(BaseModel):
    project_name: str = Field(..., example="Smith Residence - Standing Seam")
    items: list[BudgetItem]   # same items used to generate the quote

class ApproveQuoteResponse(BaseModel):
    project_name:   str
    deducted:       list[dict]   # what was actually subtracted
    skipped:        list[str]    # items skipped due to insufficient stock
    new_low_stock:  list[dict]   # items that fell below threshold after deduction


# ══════════════════════════════════════════════════════════════
# APP
# ══════════════════════════════════════════════════════════════
app = FastAPI(
    title="Copper Roofing Inventory API",
    description="Inventory management + Gemini AI assistant for a US copper roofing company.",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════
REQUIRED_COLUMNS = {"name", "quantity", "unit"}

def _row_to_material(row: dict) -> tuple[Optional[MaterialDB], Optional[str]]:
    name        = str(row.get("name", "")).strip()
    unit        = str(row.get("unit", "")).strip().lower()
    description = str(row.get("description", "")).strip() or None

    if not name:
        return None, "Missing 'name'"
    try:
        quantity = float(row.get("quantity", 0))
        if quantity <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, f"Row '{name}': quantity must be a positive number"
    if unit not in VALID_UNITS:
        return None, f"Row '{name}': unit '{unit}' not valid. Accepted: {VALID_UNITS}"

    price = None
    raw_price = row.get("price_per_unit") or row.get("price") or row.get("unit_price")
    if raw_price not in (None, ""):
        try:
            price = float(raw_price)
        except (ValueError, TypeError):
            pass  # price is optional — skip bad value

    threshold = None
    raw_threshold = row.get("low_stock_threshold") or row.get("threshold") or row.get("min_qty")
    if raw_threshold not in (None, ""):
        try:
            threshold = float(raw_threshold)
        except (ValueError, TypeError):
            pass

    return MaterialDB(
        name=name, quantity=quantity, unit=unit,
        price_per_unit=price, low_stock_threshold=threshold,
        description=description
    ), None


def _get_low_stock(db: Session) -> list[dict]:
    materials = db.query(MaterialDB).all()
    return [
        {"id": m.id, "name": m.name, "quantity": m.quantity,
         "unit": m.unit, "threshold": m.low_stock_threshold}
        for m in materials
        if m.low_stock_threshold and m.quantity <= m.low_stock_threshold
    ]


# ══════════════════════════════════════════════════════════════
# ROOT / CATALOG
# ══════════════════════════════════════════════════════════════
@app.get("/", tags=["Root"])
def root():
    return {"message": "Copper Roofing Inventory API v3 ✅"}


@app.get("/units", tags=["Catalog"])
def list_units():
    return {"units": UNIT_DESCRIPTIONS}


# ══════════════════════════════════════════════════════════════
# CRUD
# ══════════════════════════════════════════════════════════════
@app.post("/materials", response_model=MaterialOut, status_code=201, tags=["Materials"])
def create_material(material: MaterialCreate, db: Session = Depends(get_db)):
    if material.unit not in VALID_UNITS:
        raise HTTPException(422, detail=f"Unit '{material.unit}' not valid. Accepted: {VALID_UNITS}")
    new = MaterialDB(**material.model_dump())
    db.add(new); db.commit(); db.refresh(new)
    return new


@app.get("/materials", response_model=list[MaterialOut], tags=["Materials"])
def list_materials(skip: int = 0, limit: int = 2000, db: Session = Depends(get_db)):
    return db.query(MaterialDB).offset(skip).limit(limit).all()


@app.get("/materials/{material_id}", response_model=MaterialOut, tags=["Materials"])
def get_material(material_id: int, db: Session = Depends(get_db)):
    m = db.query(MaterialDB).filter(MaterialDB.id == material_id).first()
    if not m:
        raise HTTPException(404, "Material not found")
    return m


@app.patch("/materials/{material_id}", response_model=MaterialOut, tags=["Materials"])
def update_material(material_id: int, data: MaterialUpdate, db: Session = Depends(get_db)):
    m = db.query(MaterialDB).filter(MaterialDB.id == material_id).first()
    if not m:
        raise HTTPException(404, "Material not found")
    changes = data.model_dump(exclude_unset=True)
    if "unit" in changes and changes["unit"] not in VALID_UNITS:
        raise HTTPException(422, f"Unit '{changes['unit']}' not valid.")
    for field, value in changes.items():
        setattr(m, field, value)
    m.updated_at = datetime.utcnow()
    db.commit(); db.refresh(m)
    return m


@app.delete("/materials/{material_id}", status_code=204, tags=["Materials"])
def delete_material(material_id: int, db: Session = Depends(get_db)):
    m = db.query(MaterialDB).filter(MaterialDB.id == material_id).first()
    if not m:
        raise HTTPException(404, "Material not found")
    db.delete(m); db.commit()


# ══════════════════════════════════════════════════════════════
# IMPORT / EXPORT
# ══════════════════════════════════════════════════════════════
@app.post("/materials/import/csv", response_model=ImportResult, tags=["Import / Export"])
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    CSV columns: name, quantity, unit, description (opt), price_per_unit (opt), low_stock_threshold (opt)
    """
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "File must be .csv")
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(400, "CSV is empty or missing headers")
    reader.fieldnames = [f.strip().lower() for f in reader.fieldnames]

    missing = REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise HTTPException(422, f"CSV missing required columns: {missing}")

    imported, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        mat, err = _row_to_material({k.strip().lower(): v for k, v in row.items()})
        if err:
            errors.append(f"Row {i}: {err}"); skipped += 1
        else:
            db.add(mat); imported += 1
    db.commit()
    return ImportResult(imported=imported, skipped=skipped, errors=errors)


@app.post("/materials/import/excel", response_model=ImportResult, tags=["Import / Export"])
async def import_excel(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Excel columns: name, quantity, unit, description (opt), price_per_unit (opt), low_stock_threshold (opt)
    """
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "File must be .xlsx or .xlsm")
    raw = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(400, f"Cannot open Excel file: {e}")

    ws   = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Excel sheet is empty")

    headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    missing  = REQUIRED_COLUMNS - set(headers)
    if missing:
        raise HTTPException(422, f"Excel missing required columns: {missing}")

    imported, skipped, errors = 0, 0, []
    for i, row in enumerate(rows[1:], start=2):
        if all(c is None or str(c).strip() == "" for c in row):
            continue
        row_dict = {headers[j]: (row[j] if j < len(row) else None) for j in range(len(headers))}
        mat, err = _row_to_material(row_dict)
        if err:
            errors.append(f"Row {i}: {err}"); skipped += 1
        else:
            db.add(mat); imported += 1
    db.commit()
    return ImportResult(imported=imported, skipped=skipped, errors=errors)


@app.get("/materials/export/csv", tags=["Import / Export"])
def export_csv(db: Session = Depends(get_db)):
    materials = db.query(MaterialDB).all()
    buf    = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id","name","quantity","unit","price_per_unit",
                     "low_stock_threshold","description","created_at","updated_at"])
    for m in materials:
        writer.writerow([m.id, m.name, m.quantity, m.unit,
                         m.price_per_unit or "", m.low_stock_threshold or "",
                         m.description or "", m.created_at.isoformat(), m.updated_at.isoformat()])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=inventory.csv"},
    )


# ══════════════════════════════════════════════════════════════
# AI — STOCK ALERTS  (no Gemini needed)
# ══════════════════════════════════════════════════════════════
@app.get("/alerts", tags=["AI Assistant"], summary="Get all low-stock alerts")
def get_alerts(db: Session = Depends(get_db)):
    """
    Returns every material currently at or below its low_stock_threshold.
    Call this on page load so the frontend can show notification badges.
    """
    low = _get_low_stock(db)
    return {
        "alert_count": len(low),
        "alerts": low,
    }


# ══════════════════════════════════════════════════════════════
# AI — GEMINI CHAT
# ══════════════════════════════════════════════════════════════
@app.post("/chat", response_model=ChatResponse, tags=["AI Assistant"])
def chat(msg: ChatMessage, db: Session = Depends(get_db)):
    """
    Natural-language chat with the AI about your inventory.
    Supports Function Calling: Gemini can invoke `reservar_material` to deduct
    stock when the user approves a quote.
    Each session_id keeps its own conversation history (in-memory).
    """
    if not gemini_model_with_tools:
        raise HTTPException(503, detail="GEMINI_API_KEY not configured. Set it as an environment variable.")

    snapshot = _inventory_snapshot(db)

    # Retrieve stored conversation (excludes the dynamic context turns)
    stored_history = chat_sessions.get(msg.session_id, [])

    # Prepend fresh inventory snapshot as context; system_instruction handles persona
    full_history = [
        {"role": "user",  "parts": [f"INVENTORY SNAPSHOT:\n{snapshot}"]},
        {"role": "model", "parts": ["Inventory loaded and ready."]},
    ] + list(stored_history)

    try:
        chat_obj = gemini_model_with_tools.start_chat(history=full_history)
        response = chat_obj.send_message(msg.message)
    except Exception as e:
        raise HTTPException(500, detail=f"Gemini API error: {str(e)}")

    # Detect function calls (Gemini may request one or more tool invocations)
    function_calls = [
        p for p in response.parts
        if hasattr(p, "function_call") and p.function_call.name
    ]

    if function_calls:
        fn_response_parts = []
        for part in function_calls:
            fn_name = part.function_call.name
            fn_args = dict(part.function_call.args)

            result = (
                _ejecutar_reservar_material(db, **fn_args)
                if fn_name == "reservar_material"
                else {"error": f"Unknown tool: {fn_name}"}
            )

            fn_response_parts.append(
                genai.protos.Part(
                    function_response=genai.protos.FunctionResponse(
                        name=fn_name,
                        response=result,
                    )
                )
            )

        try:
            final = chat_obj.send_message(
                genai.protos.Content(role="user", parts=fn_response_parts)
            )
            reply_text = final.text
        except Exception as e:
            raise HTTPException(500, detail=f"Gemini function response error: {str(e)}")
    else:
        reply_text = response.text

    # Persist conversation without the context turns (they are rebuilt fresh each call)
    history_list = list(chat_obj.history)
    chat_sessions[msg.session_id] = history_list[2:] if len(history_list) > 2 else []

    # Refresh low-stock list (stock may have changed via tool call above)
    low = _get_low_stock(db)

    return ChatResponse(reply=reply_text, low_stock=low, session_id=msg.session_id)


@app.delete("/chat/{session_id}", tags=["AI Assistant"], status_code=204)
def clear_chat(session_id: str):
    """Clears the conversation history for a session (start fresh)."""
    chat_sessions.pop(session_id, None)


# ══════════════════════════════════════════════════════════════
# AI — PROACTIVE ANALYSIS
# ══════════════════════════════════════════════════════════════
@app.get("/analyze", tags=["AI Assistant"], summary="AI proactive stock analysis")
def analyze_inventory(db: Session = Depends(get_db)):
    """
    Asks Gemini to review the full inventory and proactively identify:
    - Items running low
    - Purchasing recommendations
    - Efficiency tips
    No user message needed — the AI speaks first.
    """
    if not gemini_model:
        raise HTTPException(503, "GEMINI_API_KEY not configured.")

    snapshot = _inventory_snapshot(db)
    prompt   = (
        SYSTEM_PROMPT + "\n\n" + snapshot +
        "\n\nPlease analyze this inventory proactively. "
        "Identify what's running low, what should be reordered soon, "
        "and any tips for efficient material use on upcoming copper roofing jobs. "
        "Be specific and practical. Format with clear sections."
    )
    try:
        response = gemini_model.generate_content(prompt)
        return {"analysis": response.text, "low_stock": _get_low_stock(db)}
    except Exception as e:
        raise HTTPException(500, f"Gemini API error: {str(e)}")


# ══════════════════════════════════════════════════════════════
# BUDGET / QUOTE BUILDER
# ══════════════════════════════════════════════════════════════
@app.post("/budget", response_model=BudgetResponse, tags=["Budget / Quotes"])
def calculate_budget(req: BudgetRequest, db: Session = Depends(get_db)):
    """
    Given a project name and a list of {material_id, quantity_needed},
    returns an itemized quote with totals and stock warnings.
    """
    line_items    = []
    total         = 0.0
    stock_warnings = []

    for item in req.items:
        m = db.query(MaterialDB).filter(MaterialDB.id == item.material_id).first()
        if not m:
            raise HTTPException(404, f"Material ID {item.material_id} not found")

        subtotal = (m.price_per_unit or 0) * item.quantity_needed
        total   += subtotal

        line_items.append({
            "material_id":    m.id,
            "name":           m.name,
            "unit":           m.unit,
            "quantity_needed": item.quantity_needed,
            "price_per_unit": m.price_per_unit,
            "subtotal_usd":   round(subtotal, 2),
            "in_stock":       m.quantity,
            "enough_stock":   m.quantity >= item.quantity_needed,
        })

        if m.quantity < item.quantity_needed:
            shortage = item.quantity_needed - m.quantity
            stock_warnings.append(
                f"⚠️  {m.name}: need {item.quantity_needed} {m.unit}, "
                f"only {m.quantity} in stock (short by {shortage:.1f} {m.unit})"
            )

    return BudgetResponse(
        project_name=req.project_name,
        line_items=line_items,
        total_usd=round(total, 2),
        stock_warnings=stock_warnings,
    )


@app.post("/budget/approve", tags=["Budget / Quotes"])
def approve_quote(req: ApproveQuoteRequest, db: Session = Depends(get_db)):
    """
    Approve a quote and automatically deduct materials from inventory.

    Call this endpoint when the contractor confirms a job after generating a quote.
    The system will subtract the used quantities from stock and return:
    - What was deducted
    - Any items skipped (not enough stock)
    - Items that fell below their low_stock_threshold after deduction (triggers alerts)

    If a material does not have enough stock, it is SKIPPED and listed in 'skipped'.
    The remaining items are still deducted so work can proceed with what is available.
    """
    deducted      = []
    skipped       = []

    for item in req.items:
        m = db.query(MaterialDB).filter(MaterialDB.id == item.material_id).first()
        if not m:
            skipped.append(f"Material ID {item.material_id} not found — skipped")
            continue

        if m.quantity < item.quantity_needed:
            skipped.append(
                f"{m.name}: needed {item.quantity_needed} {m.unit} "
                f"but only {m.quantity} in stock — skipped"
            )
            continue

        before        = m.quantity
        m.quantity   -= item.quantity_needed
        m.updated_at  = datetime.utcnow()

        deducted.append({
            "material_id":    m.id,
            "name":           m.name,
            "unit":           m.unit,
            "deducted":       item.quantity_needed,
            "stock_before":   before,
            "stock_after":    m.quantity,
        })

    db.commit()

    # Check which items fell below threshold after deduction
    new_low = _get_low_stock(db)

    return ApproveQuoteResponse(
        project_name=req.project_name,
        deducted=deducted,
        skipped=skipped,
        new_low_stock=new_low,
    )


@app.post("/budget/ai", tags=["Budget / Quotes"])
def ai_budget_interactive(msg: ChatMessage, db: Session = Depends(get_db)):
    """
    Interactive, step-by-step quote builder powered by Gemini.

    The AI guides the contractor (and their client) through a friendly conversation:
    it asks one question at a time — roof size, job type, special requirements —
    and builds the final itemized quote only once it has enough information.

    Uses the same session system as /chat, so the conversation is remembered
    between messages. Use session_id='quote-{project}' to keep it separate
    from the general inventory chat.

    The AI automatically detects and responds in Spanish or English depending
    on how the user writes.
    """
    if not gemini_model:
        raise HTTPException(503, "GEMINI_API_KEY not configured.")

    snapshot = _inventory_snapshot(db)
    low      = _get_low_stock(db)

    QUOTE_SYSTEM_PROMPT = """You are a friendly and professional estimator assistant for a copper roofing company in the United States.
Your job is to help the contractor build an accurate, itemized quote for their client through a natural conversation.

CRITICAL: Always respond in the EXACT same language the user writes in.
Spanish input → respond entirely in Spanish. English input → respond entirely in English. No mixing languages.

YOUR CONVERSATION FLOW — follow this order, one question at a time:
1. Greet warmly and ask for the client's name and the project address.
2. Ask what type of copper roofing job it is (standing seam, gutters, flashing, full roof replacement, repairs, etc.).
3. Ask for the size of the area (in square feet or linear feet depending on the job type).
4. Ask about any special details: slopes, valleys, custom shapes, downspouts, solder work, etc.
5. Once you have enough information, say: "Great, let me put together your estimate..." and generate a clear itemized quote.

QUOTE FORMAT (use this when generating the final quote):
- Project name and client info at the top
- Each material as a line item: name | quantity | unit | unit price | subtotal
- Subtotal, any applicable notes, and TOTAL in USD
- A note on stock availability if any material is running low
- A professional closing line

IMPORTANT RULES:
- Ask only ONE question at a time — don't overwhelm the client.
- Be warm and professional, not robotic.
- Only use materials that exist in the inventory snapshot provided.
- If a material is insufficient in stock, mention it clearly but offer alternatives if possible.
- Never make up prices — only use prices from the inventory.
"""

    history = chat_sessions.get(msg.session_id, [])

    # First message: inject context and start the conversation
    if not history:
        history.append({
            "role": "user",
            "parts": [QUOTE_SYSTEM_PROMPT + "\n\n" + snapshot]
        })
        history.append({
            "role": "model",
            "parts": [
                "Understood. I have the full inventory and pricing loaded. "
                "I'll guide the conversation one step at a time to build an accurate quote."
            ]
        })

    # Always refresh inventory snapshot so prices/stock are current
    history[0]["parts"] = [QUOTE_SYSTEM_PROMPT + "\n\n" + snapshot]

    # If this is the very first user message in the session, trigger the greeting
    user_message = msg.message
    if len(history) == 2:
        # Inject a silent trigger so Gemini starts the conversation
        user_message = "__START_QUOTE__"

    history.append({"role": "user", "parts": [user_message]})

    try:
        chat_obj  = gemini_model.start_chat(history=history[:-1])
        response  = chat_obj.send_message(user_message)
        reply_text = response.text
    except Exception as e:
        raise HTTPException(500, f"Gemini API error: {str(e)}")

    history.append({"role": "model", "parts": [reply_text]})
    chat_sessions[msg.session_id] = history

    return ChatResponse(reply=reply_text, low_stock=low, session_id=msg.session_id)
