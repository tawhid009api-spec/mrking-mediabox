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

// Local DB Helpers
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

// API: Get List
app.get("/api/list", async (req, res) => {
  let list = readDB();
  if (!API_SECRET) {
    list.sort((a, b) => (a.t > b.t ? -1 : 1));
    return res.json(list);
  }

  try {
    const AUDIO_EXT = ["mp3", "m4a", "wav", "aac", "ogg", "flac", "opus", "amr", "wma"];
    const out = [...list];

    for (const type of ["video", "image"]) {
      const r = await axios.get(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${type}`,
        {
          params: { type: "upload", prefix: FOLDER + "/", max_results: 500 },
          auth: { username: API_KEY, password: API_SECRET },
          timeout: 6000
        }
      );

      for (const resItem of r.data.resources || []) {
        const publicId = resItem.public_id;
        if (!publicId.startsWith(FOLDER + "/")) continue;
        const name = publicId.slice(FOLDER.length + 1).toLowerCase();
        
        const isAudio = AUDIO_EXT.includes(resItem.format);
        const finalType = isAudio ? "audio" : type;
        const url = generateUrl(name, finalType);

        if (!out.find(x => x.name === name)) {
          out.push({ name, type: finalType, url, t: resItem.created_at || new Date().toISOString() });
        }
      }
    }
    out.sort((a, b) => (a.t > b.t ? -1 : 1));
    writeDB(out);
    return res.json(out);
  } catch (e) {
    list.sort((a, b) => (a.t > b.t ? -1 : 1));
    return res.json(list);
  }
});

// API: Upload Media
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const authorToken = req.body.author || "";

    if (authorToken !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can upload." });
    }
    if (!file || !name) return res.json({ success: false, error: "Provide both file and name." });

    const base64File = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const form = new URLSearchParams();
    form.append("file", base64File);
    form.append("upload_preset", PRESET);
    form.append("public_id", `${FOLDER}/${name}`);

    const cloudRes = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
      form,
      { timeout: 120000 }
    );

    const type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");
    const url = generateUrl(name, type);

    const db = readDB();
    const existingIndex = db.findIndex(x => x.name === name);
    const newItem = { name, type, url: cloudRes.data.secure_url || url, t: new Date().toISOString() };
    
    if (existingIndex >= 0) db[existingIndex] = newItem;
    else db.push(newItem);
    
    writeDB(db);

    return res.json({ success: true, name, type, url: newItem.url });
  } catch (e) {
    const errMsg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return res.json({ success: false, error: errMsg });
  }
});

// API: Delete
app.post("/api/delete", async (req, res) => {
  try {
    const { name, resource_type, author } = req.body;
    if (author !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });

    const cleanName = (name || "").toLowerCase();
    let db = readDB();
    db = db.filter(x => x.name !== cleanName);
    writeDB(db);

    if (API_SECRET) {
      const publicId = `${FOLDER}/${cleanName}`;
      const targetType = resource_type === "audio" ? "video" : resource_type;
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`).digest("hex");

      const form = new URLSearchParams();
      form.append("public_id", publicId);
      form.append("api_key", API_KEY);
      form.append("timestamp", timestamp);
      form.append("signature", signature);

      await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${targetType}/destroy`, form).catch(() => {});
    }

    return res.json({ success: true, message: "Deleted successfully." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// API: Rename
app.post("/api/rename", async (req, res) => {
  try {
    const { oldName, newName, resource_type, author } = req.body;
    if (author !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });

    const cleanOld = (oldName || "").toLowerCase();
    const cleanNew = (newName || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);

    let db = readDB();
    const item = db.find(x => x.name === cleanOld);
    if (item) {
      item.name = cleanNew;
      item.url = generateUrl(cleanNew, item.type);
      writeDB(db);
    }

    if (API_SECRET) {
      const fromPublicId = `${FOLDER}/${cleanOld}`;
      const toPublicId = `${FOLDER}/${cleanNew}`;
      const targetType = resource_type === "audio" ? "video" : resource_type;
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash("sha1").update(`from_public_id=${fromPublicId}&timestamp=${timestamp}&to_public_id=${toPublicId}${API_SECRET}`).digest("hex");

      const form = new URLSearchParams();
      form.append("from_public_id", fromPublicId);
      form.append("to_public_id", toPublicId);
      form.append("api_key", API_KEY);
      form.append("timestamp", timestamp);
      form.append("signature", signature);

      await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${targetType}/rename`, form).catch(() => {});
    }

    return res.json({ success: true, newName: cleanNew });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`[Aliya Server Running on Port ${PORT}]`));
        
