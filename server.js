// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";
import "dotenv/config";

const app = express();
app.set("trust proxy", 1);

// === CONFIG ===
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const CHAT_ID = process.env.TG_CHAT_ID;

// fail fast
if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌ Не заданы TG_BOT_TOKEN или TG_CHAT_ID в .env");
  process.exit(1);
}

// CORS — разреши домен сайта (или оставь * на тест)
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
}));

// лимитер от спама
app.use("/api/apply", rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
}));

// multipart upload (файл в памяти)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ok = [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
      "application/vnd.rar",
      "application/x-7z-compressed",
      "application/pdf",
      "application/octet-stream", // иногда 7z/rar прилетает так
    ].includes(file.mimetype);

    if (!ok) return cb(new Error("Недопустимый тип файла"));
    cb(null, true);
  }
});

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function fmtDate() {
  const d = new Date();
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Berlin" });
}

// Telegram helpers
async function tgSendMessage(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`TG sendMessage failed: ${JSON.stringify(json)}`);
}

async function tgSendDocument(fileBuffer, filename, caption) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`;
  const fd = new FormData();
  fd.append("chat_id", CHAT_ID);
  fd.append("caption", caption || "");
  fd.append("parse_mode", "HTML");
  fd.append("document", new Blob([fileBuffer]), filename);

  const res = await fetch(url, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.ok) throw new Error(`TG sendDocument failed: ${JSON.stringify(json)}`);
}

// API endpoint
app.post("/api/apply", upload.single("files"), async (req, res) => {
  try {
    const { email, fio, phone, workname, nomination } = req.body;
    const file = req.file;

    // basic validation
    if (!email || !fio || !phone || !workname || !nomination || !file) {
      return res.status(400).json({ ok:false, error:"missing_fields" });
    }

    const msg =
      `🧾 <b>Новая заявка</b>\n` +
      `<b>Дата:</b> ${escapeHtml(fmtDate())}\n\n` +
      `<b>ФИО:</b> ${escapeHtml(fio)}\n` +
      `<b>Email:</b> ${escapeHtml(email)}\n` +
      `<b>Телефон:</b> ${escapeHtml(phone)}\n` +
      `<b>Номинация:</b> ${escapeHtml(nomination)}\n\n` +
      `<b>Название работы:</b>\n${escapeHtml(workname)}\n\n` +
      `<b>Файл:</b> ${escapeHtml(file.originalname)} (${Math.round(file.size/1024)} KB)`;

    // 1) сообщение
    await tgSendMessage(msg);

    // 2) документ
    await tgSendDocument(
      file.buffer,
      file.originalname,
      `📎 Материалы: <b>${escapeHtml(fio)}</b>`
    );

    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

app.get("/health", (req,res)=>res.send("ok"));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
