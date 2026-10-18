const express = require("express");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const CLOUD_NAME = "ixdyv04r";
const PRESET = "ml_default";
const FOLDER = "aliya";
const API_KEY = process.env.CLOUDINARY_API_KEY || "423328895529369";
const API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const AUTHOR = "Mr.king";
const AUDIO_EXT = ["mp3", "m4a", "wav", "aac", "ogg", "flac", "opus", "amr", "wma"];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// API: Get Media List (Publicly accessible, 100% stable)
app.get("/api/list", async (req, res) => {
  if (!API_SECRET) {
    return res.json([]);
  }

  const out = [];
  for (const type of ["video", "image"]) {
    try {
      const r = await axios.get(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/${type}`,
        {
          params: { type: "upload", prefix: FOLDER + "/", max_results: 500 },
          auth: { username: API_KEY, password: API_SECRET },
          timeout: 15000
        }
      );

      for (const resItem of r.data.resources || []) {
        const publicId = resItem.public_id;
        if (!publicId.startsWith(FOLDER + "/")) continue;
        const name = publicId.slice(FOLDER.length + 1);
        
        const isAudio = AUDIO_EXT.includes(resItem.format);
        const finalType = isAudio ? "audio" : type;
        const baseUrl = `https://res.cloudinary.com/${CLOUD_NAME}`;

        let url = `${baseUrl}/image/upload/${FOLDER}/${name}.jpg`;
        if (finalType === "audio") url = `${baseUrl}/video/upload/${FOLDER}/${name}.mp3`;
        if (finalType === "video") url = `${baseUrl}/video/upload/${FOLDER}/${name}.mp4`;

        out.push({
          public_id: publicId,
          name: name.toLowerCase(),
          type: finalType,
          resource_type: resItem.resource_type,
          url,
          t: resItem.created_at || ""
        });
      }
    } catch (e) {
      console.error(`Error listing ${type}:`, e.message);
    }
  }

  out.sort((a, b) => (a.t > b.t ? -1 : 1));
  return res.json(out);
});

// API: Upload Media (Strictly Mr.king Only)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = (req.body.name || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    const authorToken = req.body.author || "";

    if (authorToken !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can upload." });
    }
    if (!file || !name) return res.json({ success: false, error: "Provide both file and name." });
    if (/^\d+$/.test(name)) return res.json({ success: false, error: "Name cannot be purely numbers." });

    const base64File = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    const form = new URLSearchParams();
    form.append("file", base64File);
    form.append("upload_preset", PRESET);
    form.append("public_id", `${FOLDER}/${name}`);

    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, form, { timeout: 120000 });
    const type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");

    return res.json({ success: true, name, type, url: cloudRes.data.secure_url });
  } catch (e) {
    const errMsg = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    return res.json({ success: false, error: errMsg });
  }
});

// API: Delete Media (Strictly Mr.king Only)
app.post("/api/delete", async (req, res) => {
  try {
    const { name, resource_type, author } = req.body;
    if (author !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can delete." });
    }

    const publicId = `${FOLDER}/${name}`;
    const targetType = resource_type === "audio" ? "video" : resource_type;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`).digest("hex");

    const form = new URLSearchParams();
    form.append("public_id", publicId);
    form.append("api_key", API_KEY);
    form.append("timestamp", timestamp);
    form.append("signature", signature);

    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${targetType}/destroy`, form);
    return res.json({ success: true, message: "Deleted successfully." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// API: Rename Media (Strictly Mr.king Only)
app.post("/api/rename", async (req, res) => {
  try {
    const { oldName, newName, resource_type, author } = req.body;
    if (author !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can rename." });
    }

    const cleanNewName = (newName || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (!cleanNewName) return res.json({ success: false, error: "Invalid new name." });

    const fromPublicId = `${FOLDER}/${oldName}`;
    const toPublicId = `${FOLDER}/${cleanNewName}`;
    const targetType = resource_type === "audio" ? "video" : resource_type;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash("sha1").update(`from_public_id=${fromPublicId}&timestamp=${timestamp}&to_public_id=${toPublicId}${API_SECRET}`).digest("hex");

    const form = new URLSearchParams();
    form.append("from_public_id", fromPublicId);
    form.append("to_public_id", toPublicId);
    form.append("api_key", API_KEY);
    form.append("timestamp", timestamp);
    form.append("signature", signature);

    await axios.post(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${targetType}/rename`, form);
    return res.json({ success: true, newName: cleanNewName });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`[Aliya Official V4 Server Running on Port ${PORT}]`));
                      
