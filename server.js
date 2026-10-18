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

// ============================================================
// MULTI-ACCOUNT CLOUDINARY CONFIGURATION (Add as many as you want)
// ============================================================
const CLOUD_ACCOUNTS = [
  {
    name: "Account 1",
    cloudName: "ixdyv04r",
    preset: "ml_default",
    apiKey: process.env.CLOUDINARY_API_KEY || "423328895529369",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
  },
  /*
  // Key storage full hoye gele nicher moto extra accounts enable/add korte parben:
  {
    name: "Account 2",
    cloudName: "your_second_cloud_name",
    preset: "ml_default",
    apiKey: "your_second_api_key",
    apiSecret: "your_second_api_secret"
  }
  */
];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Helper: Try uploading across accounts until one succeeds
async function uploadToCloudinary(fileBuffer, mimetype, name) {
  const base64File = `data:${mimetype};base64,${fileBuffer.toString("base64")}`;
  let lastError = null;

  for (const acc of CLOUD_ACCOUNTS) {
    try {
      const form = new URLSearchParams();
      form.append("file", base64File);
      form.append("upload_preset", acc.preset);
      form.append("public_id", `${FOLDER}/${name}`);

      const cloudRes = await axios.post(
        `https://api.cloudinary.com/v1_1/${acc.cloudName}/auto/upload`,
        form,
        { timeout: 120000, maxBodyLength: Infinity }
      );

      const type = cloudRes.data.is_audio ? "audio" : (cloudRes.data.resource_type === "video" ? "video" : "image");
      return { success: true, name, type, url: cloudRes.data.secure_url, cloudName: acc.cloudName };
    } catch (e) {
      lastError = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
      console.error(`[Upload Failed on ${acc.name}]:`, lastError);
      // Limit full or error হলে auto next account-e shift করবে loop
    }
  }
  return { success: false, error: lastError || "All Cloudinary accounts failed or full." };
}

// API: Upload Media (Mr.king Only)
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

    const result = await uploadToCloudinary(file.buffer, file.mimetype, name);
    return res.json(result);
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// API: Get Combined List from ALL Cloudinary Accounts
app.get("/api/list", async (req, res) => {
  const out = [];

  for (const acc of CLOUD_ACCOUNTS) {
    if (!acc.apiSecret) continue;

    for (const type of ["video", "image"]) {
      try {
        const r = await axios.get(
          `https://api.cloudinary.com/v1_1/${acc.cloudName}/resources/${type}`,
          {
            params: { type: "upload", prefix: FOLDER + "/", max_results: 500 },
            auth: { username: acc.apiKey, password: acc.apiSecret },
            timeout: 15000
          }
        );
        for (const resItem of r.data.resources || []) {
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
      } catch (e) {}
    }
  }

  out.sort((a, b) => (a.t > b.t ? 1 : -1));
  return res.json(out);
});

// API: Delete Media Across Accounts
app.post("/api/delete", async (req, res) => {
  try {
    const { name, resource_type, author } = req.body;
    if (author !== AUTHOR) {
      return res.status(403).json({ success: false, error: "Access Denied! Only Mr.king can delete." });
    }

    const publicId = `${FOLDER}/${name}`;
    const targetType = resource_type === "audio" ? "video" : resource_type;
    let deleted = false;

    for (const acc of CLOUD_ACCOUNTS) {
      if (!acc.apiSecret) continue;
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto
          .createHash("sha1")
          .update(`public_id=${publicId}&timestamp=${timestamp}${acc.apiSecret}`)
          .digest("hex");

        const form = new URLSearchParams();
        form.append("public_id", publicId);
        form.append("api_key", acc.apiKey);
        form.append("timestamp", timestamp);
        form.append("signature", signature);

        const r = await axios.post(`https://api.cloudinary.com/v1_1/${acc.cloudName}/${targetType}/destroy`, form);
        if (r.data.result === "ok") {
          deleted = true;
          break;
        }
      } catch (e) {}
    }

    if (deleted) return res.json({ success: true, message: "Deleted successfully." });
    return res.json({ success: false, error: "Failed to delete item from all accounts." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

// API: Rename Media Across Accounts
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
    let renamed = false;

    for (const acc of CLOUD_ACCOUNTS) {
      if (!acc.apiSecret) continue;
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = crypto
          .createHash("sha1")
          .update(`from_public_id=${fromPublicId}&timestamp=${timestamp}&to_public_id=${toPublicId}${acc.apiSecret}`)
          .digest("hex");

        const form = new URLSearchParams();
        form.append("from_public_id", fromPublicId);
        form.append("to_public_id", toPublicId);
        form.append("api_key", acc.apiKey);
        form.append("timestamp", timestamp);
        form.append("signature", signature);

        await axios.post(`https://api.cloudinary.com/v1_1/${acc.cloudName}/${targetType}/rename`, form);
        renamed = true;
        break;
      } catch (e) {}
    }

    if (renamed) return res.json({ success: true, newName: cleanNewName });
    return res.json({ success: false, error: "Failed to rename item." });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`[Aliya Official V4 Multi-Account Server Running on Port ${PORT}]`));

