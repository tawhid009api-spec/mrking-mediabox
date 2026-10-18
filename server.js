const express = require("express");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const PORT = process.env.PORT || 3000;
const CLOUD_NAME = "j7sw9npl";
const PRESET = "Aliya_1290";
const FOLDER = "aliya";

const UPLOAD_TOKEN = "dcf04737bc98552031fd2e5a546a48d401c6aca4d270f22d9659905ba554ce34";

const CLOUD_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUD_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const cloudEnabled = !!(CLOUD_API_KEY && CLOUD_API_SECRET);

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

const cleanName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
const cloudType = (t) => (t === "image" ? "image" : "video");

function cloudSign(params) {
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&") + CLOUD_API_SECRET;
  return crypto.createHash("sha1").update(str).digest("hex");
}

async function cloudDestroy(publicId, resourceType) {
  if (!cloudEnabled) return { skipped: true };
  const timestamp = Math.floor(Date.now() / 1000);
  const p = { public_id: publicId, timestamp };
  const form = new URLSearchParams({ ...p, api_key: CLOUD_API_KEY, signature: cloudSign(p) });
  const { data } = await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/destroy`, form, { timeout: 30000 }
  );
  return data;
}

async function cloudRename(fromId, toId, resourceType) {
  if (!cloudEnabled) return { skipped: true };
  const timestamp = Math.floor(Date.now() / 1000);
  const p = { from_public_id: fromId, timestamp, to_public_id: toId };
  const form = new URLSearchParams({ ...p, api_key: CLOUD_API_KEY, signature: cloudSign(p) });
  const { data } = await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/rename`, form, { timeout: 30000 }
  );
  return data;
}

async function rebuildFromCloud() {
  if (!cloudEnabled) {
    console.log("[db] CLOUDINARY_API_KEY/SECRET not set — skipping cloud rebuild.");
    return;
  }
  try {
    const auth = { username: CLOUD_API_KEY, password: CLOUD_API_SECRET };
    const db = readDB();
    const have = new Set(db.map((x) => x.name));
    let added = 0;
    for (const rt of ["image", "video"]) {
      let next = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${rt}?prefix=${FOLDER}/&max_results=500`;
      while (next) {
        const { data } = await axios.get(next, { auth, timeout: 30000 });
        for (const r of data.resources || []) {
          const name = String(r.public_id || "").replace(`${FOLDER}/`, "");
          if (!name || have.has(name)) continue;
          db.push({
            name,
            type: rt === "image" ? "image" : "video",
            url: r.secure_url,
            public_id: r.public_id,
            t: r.created_at || new Date().toISOString(),
          });
          have.add(name);
          added += 1;
        }
        next = data.next_cursor
          ? `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${rt}?prefix=${FOLDER}/&max_results=500&next_cursor=${data.next_cursor}`
          : null;
      }
    }
    if (added) {
      writeDB(db);
      console.log(`[db] rebuilt ${added} entr${added === 1 ? "y" : "ies"} from Cloudinary`);
    } else {
      console.log("[db] cloud rebuild: nothing new");
    }
  } catch (e) {
    console.error("[db] cloud rebuild failed:", e.message);
  }
}

function providedToken(req) {
  const h = req.get("authorization") || "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return String(req.body.author || req.query.author || "");
}

function authorized(req) {
  const a = Buffer.from(providedToken(req));
  const b = Buffer.from(UPLOAD_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function guard(req, res, next) {
  if (!authorized(req)) return res.status(403).json({ success: false, error: "Access Denied!" });
  next();
}

app.get("/api/list", (req, res) => {
  const list = readDB();
  list.sort((a, b) => (a.t > b.t ? -1 : 1));
  return res.json(list);
});

function parseUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}

app.post("/api/upload", parseUpload, guard, async (req, res) => {
  try {
    const file = req.file;
    const name = cleanName(req.body.name);
    let type = req.body.type || "video";
    let secureUrl = req.body.url || "";
    let publicId = null;

    if (file) {
      const base64File = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const form = new URLSearchParams();
      form.append("file", base64File);
      form.append("upload_preset", PRESET);
      form.append("public_id", `${FOLDER}/${name}`);

      const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, form, { timeout: 120000 });
      type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");
      secureUrl = cloudRes.data.secure_url;
      publicId = cloudRes.data.public_id || null;
    }

    if (!name) return res.json({ success: false, error: "Provide a valid name." });

    const db = readDB();
    const existingIndex = db.findIndex((x) => x.name === name);
    const newItem = {
      name,
      type,
      url: secureUrl || generateUrl(name, type),
      public_id: publicId || (db[existingIndex] && db[existingIndex].public_id) || `${FOLDER}/${name}`,
      t: new Date().toISOString(),
    };

    if (existingIndex >= 0) db[existingIndex] = newItem;
    else db.push(newItem);

    writeDB(db);

    return res.json({ success: true, name, type, url: newItem.url });
  } catch (e) {
    const errMsg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return res.json({ success: false, error: errMsg });
  }
});

app.post("/api/register", guard, async (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.json({ success: false, error: "Provide a valid name." });
  const type = ["image", "video", "audio"].includes(req.body.type) ? req.body.type : "video";
  const url = String(req.body.url || "");
  if (!url.startsWith(`https://res.cloudinary.com/${CLOUD_NAME}/`)) return res.json({ success: false, error: "Invalid url." });
  const publicId = String(req.body.public_id || `${FOLDER}/${name}`);

  const db = readDB();
  const i = db.findIndex((x) => x.name === name);
  const item = { name, type, url, public_id: publicId, t: new Date().toISOString() };
  if (i >= 0) db[i] = item;
  else db.push(item);
  writeDB(db);

  return res.json({ success: true, name, type, url });
});

app.post("/api/delete", guard, async (req, res) => {
  try {
    const clean = cleanName(req.body.name);
    let db = readDB();
    const item = db.find((x) => x.name === clean);
    db = db.filter((x) => x.name !== clean);
    writeDB(db);

    if (item) {
      const pid = item.public_id || `${FOLDER}/${clean}`;
      try {
        await cloudDestroy(pid, cloudType(item.type));
      } catch (e) {
        console.error("cloud delete failed:", e.message);
      }
    }

    return res.json({ success: true, message: "Deleted successfully." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.post("/api/rename", guard, async (req, res) => {
  try {
    const oldName = cleanName(req.body.oldName);
    const newName = cleanName(req.body.newName);
    if (!oldName || !newName) return res.json({ success: false, error: "Provide valid names." });
    if (oldName === newName) return res.json({ success: true, newName });

    const db = readDB();
    const item = db.find((x) => x.name === oldName);
    if (!item) return res.json({ success: false, error: "Item not found." });
    if (db.some((x) => x.name === newName)) return res.json({ success: false, error: "Name already exists." });

    const fromId = item.public_id || `${FOLDER}/${oldName}`;
    const toId = `${FOLDER}/${newName}`;
    try {
      const r = await cloudRename(fromId, toId, cloudType(item.type));
      if (!r.skipped) {
        item.public_id = toId;
        if (item.url && String(item.url).includes("res.cloudinary.com")) {
          item.url = generateUrl(newName, item.type);
        }
      }
    } catch (e) {
      return res.json({ success: false, error: "Cloud rename failed: " + e.message });
    }

    item.name = newName;
    writeDB(db);
    return res.json({ success: true, newName });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

rebuildFromCloud();
app.listen(PORT, () => console.log(`[MediaBox running on port ${PORT}]`));
