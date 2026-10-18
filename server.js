const express = require("express");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const FOLDER = "aliya";
const AUTHOR = "Mr.king";
const AUDIO_EXT = ["mp3", "m4a", "wav", "aac", "ogg", "flac", "opus", "amr", "wma"];

const CLOUD_ACCOUNTS = [
  {
    name: "Account 1",
    cloudName: "ixdyv04r",
    preset: "ml_default",
    apiKey: process.env.CLOUDINARY_API_KEY || "423328895529369",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
  }
];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Cache Object for Fast Responses
let listCache = { time: 0, data: [] };

async function fetchAllResourcesFast() {
  // Return cached data if under 30 seconds
  if (Date.now() - listCache.time < 30000 && listCache.data.length > 0) {
    return listCache.data;
  }

  const tasks = [];
  for (const acc of CLOUD_ACCOUNTS) {
    if (!acc.apiSecret) continue;
    for (const type of ["video", "image"]) {
      tasks.push(
        axios.get(`https://api.cloudinary.com/v1_1/${acc.cloudName}/resources/${type}`, {
          params: { type: "upload", prefix: FOLDER + "/", max_results: 500 },
          auth: { username: acc.apiKey, password: acc.apiSecret },
          timeout: 10000
        }).then(r => ({ acc, type, resources: r.data.resources || [] })).catch(() => null)
      );
    }
  }

  const results = await Promise.all(tasks);
  const out = [];

  for (const resObj of results) {
    if (!resObj) continue;
    const { acc, type, resources } = resObj;
    for (const resItem of resources) {
      const name = resItem.public_id.slice(FOLDER.length + 1);
      const isAudio = AUDIO_EXT.includes(resItem.format);
      const finalType = isAudio ? "audio" : type;
      const baseUrl = `https://res.cloudinary.com/${acc.cloudName}`;
      let url = `${baseUrl}/image/upload/${FOLDER}/${name}.jpg`;
      if (finalType === "audio") url = `${baseUrl}/video/upload/${FOLDER}/${name}.mp3`;
      if (finalType === "video") url = `${baseUrl}/video/upload/${FOLDER}/${name}.mp4`;

      out.push({
        public_id: resItem.public_id,
        name,
        type: finalType,
        resource_type: resItem.resource_type,
        url,
        cloudName: acc.cloudName,
        t: resItem.created_at || ""
      });
    }
  }

  out.sort((a, b) => (a.t > b.t ? 1 : -1));
  listCache = { time: Date.now(), data: out };
  return out;
}

app.get("/api/list", async (req, res) => {
  const list = await fetchAllResourcesFast();
  return res.json(list);
});

// Clear cache on upload/delete/rename
function invalidateCache() {
  listCache = { time: 0, data: [] };
}

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const authorToken = req.body.author || "";

    if (authorToken !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });
    if (!file || !name) return res.json({ success: false, error: "Missing required fields." });

    const base64File = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const acc = CLOUD_ACCOUNTS[0];

    const form = new URLSearchParams();
    form.append("file", base64File);
    form.append("upload_preset", acc.preset);
    form.append("public_id", `${FOLDER}/${name}`);

    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/${acc.cloudName}/auto/upload`, form, { timeout: 120000 });
    const type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");
    
    invalidateCache();
    return res.json({ success: true, name, type, url: cloudRes.data.secure_url });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.post("/api/delete", async (req, res) => {
  try {
    const { name, resource_type, author } = req.body;
    if (author !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });

    const publicId = `${FOLDER}/${name}`;
    const targetType = resource_type === "audio" ? "video" : resource_type;
    const acc = CLOUD_ACCOUNTS[0];

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${acc.apiSecret}`).digest("hex");

    const form = new URLSearchParams();
    form.append("public_id", publicId);
    form.append("api_key", acc.apiKey);
    form.append("timestamp", timestamp);
    form.append("signature", signature);

    await axios.post(`https://api.cloudinary.com/v1_1/${acc.cloudName}/${targetType}/destroy`, form);
    invalidateCache();
    return res.json({ success: true, message: "Deleted successfully." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.post("/api/rename", async (req, res) => {
  try {
    const { oldName, newName, resource_type, author } = req.body;
    if (author !== AUTHOR) return res.status(403).json({ success: false, error: "Access Denied!" });

    const cleanNewName = (newName || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const fromPublicId = `${FOLDER}/${oldName}`;
    const toPublicId = `${FOLDER}/${cleanNewName}`;
    const targetType = resource_type === "audio" ? "video" : resource_type;
    const acc = CLOUD_ACCOUNTS[0];

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash("sha1").update(`from_public_id=${fromPublicId}&timestamp=${timestamp}&to_public_id=${toPublicId}${acc.apiSecret}`).digest("hex");

    const form = new URLSearchParams();
    form.append("from_public_id", fromPublicId);
    form.append("to_public_id", toPublicId);
    form.append("api_key", acc.apiKey);
    form.append("timestamp", timestamp);
    form.append("signature", signature);

    await axios.post(`https://api.cloudinary.com/v1_1/${acc.cloudName}/${targetType}/rename`, form);
    invalidateCache();
    return res.json({ success: true, newName: cleanNewName });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`[Aliya Fast Server Running on Port ${PORT}]`));
