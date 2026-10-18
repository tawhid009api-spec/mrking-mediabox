const express = require("express");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const CLOUD_NAME = "j7sw9npl";
const PRESET = "Aliya_1290";
const FOLDER = "aliya";
const API_KEY = "756585634365758";
const API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const AUTHOR = "Mr.king";
const DB_FILE = path.join(__dirname, "media_db.json");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("DB write error:", e.message);
  }
}

function generateUrl(name, type) {
  const base = `https://res.cloudinary.com/${CLOUD_NAME}`;
  if (type === "audio") return `${base}/video/upload/${FOLDER}/${name}.mp3`;
  if (type === "video") return `${base}/video/upload/${FOLDER}/${name}.mp4`;
  return `${base}/image/upload/${FOLDER}/${name}.jpg`;
}

// Get All Media List (Used by Web & Bot)
app.get("/api/list", (req, res) => {
  const list = readDB();
  list.sort((a, b) => (a.t > b.t ? -1 : 1));
  return res.json(list);
});

// Upload API
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const authorToken = req.body.author || "";

    if (authorToken !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can upload." });
    }

    let type = req.body.type || "video";
    let secureUrl = req.body.url || "";

    // File Upload via Web
    if (file) {
      const base64File = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const form = new URLSearchParams();
      form.append("file", base64File);
      form.append("upload_preset", PRESET);
      form.append("public_id", `${FOLDER}/${name}`);

      const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, form, { timeout: 120000 });
      type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");
      secureUrl = cloudRes.data.secure_url;
    }

    if (!name) return res.json({ success: false, error: "Provide a valid name." });

    const db = readDB();
    const existingIndex = db.findIndex(x => x.name === name);
    const newItem = { name, type, url: secureUrl || generateUrl(name, type), t: new Date().toISOString() };
    
    if (existingIndex >= 0) db[existingIndex] = newItem;
    else db.push(newItem);
    
    writeDB(db);

    return res.json({ success: true, name, type, url: newItem.url });
  } catch (e) {
    const errMsg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return res.json({ success: false, error: errMsg });
  }
});

// Delete API
app.post("/api/delete", async (req, res) => {
  try {
    const { name, resource_type, author } = req.body;
    if (author !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });

    const cleanName = (name || "").toLowerCase();
    let db = readDB();
    db = db.filter(x => x.name !== cleanName);
    writeDB(db);

    return res.json({ success: true, message: "Deleted successfully." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`[Aliya Server Running on Port ${PORT}]`));
      
