const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

// --- CONFIGURATION ---

// 1. PASTE YOUR DISCORD WEBHOOK URL HERE:
const WEBHOOK_URL = "https://discord.com/api/webhooks/1440620971676401775/LXW_nLzJV1ogXqe-_1pSha4cEQdJABWeVb39PhB2GhtpJh-qjde4dGZKJ3DoJLqA5Kdu"; 

// 2. EMAIL SIMULATION (For logs only)
const ADMIN_EMAIL = "hr_manager@company.com";

// 3. DISCORD FILE LIMIT (25MB for free servers)
const DISCORD_LIMIT_MB = 25;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- Helper Functions ---
function sanitizeName(name) {
  return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}
function getFormattedDate() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${d.getFullYear()}_${pad(d.getHours())}_${pad(d.getMinutes())}`;
}

// --- Routes ---

app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;
  if (token === 'VALID_TOKEN_123') res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

app.post('/api/session/start', (req, res) => {
  const { token, userName } = req.body;
  if (token !== 'VALID_TOKEN_123') return res.status(401).json({ ok: false });
  
  const folderName = `${getFormattedDate()}_${sanitizeName(userName)}`;
  const folderPath = path.join(__dirname, 'uploads', folderName);

  try {
    fs.mkdirSync(folderPath, { recursive: true });
    const meta = { token, userName, startTime: new Date().toISOString(), questions: [] };
    fs.writeFileSync(path.join(folderPath, 'meta.json'), JSON.stringify(meta, null, 2));
    res.json({ ok: true, folder: folderName });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// --- UPLOAD LOGIC ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads', req.body.folder));
  },
  filename: (req, file, cb) => {
    cb(null, `Q${req.body.questionIndex}.webm`);
  },
});
const upload = multer({ storage: storage });

app.post('/api/upload-one', upload.single('video'), (req, res) => {
  const { folder, questionIndex, transcript } = req.body;
  const savedFile = req.file;
  
  try {
    const metaPath = path.join(__dirname, 'uploads', folder, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.questions.push({
      index: questionIndex,
      file: savedFile.filename,
      transcript: transcript,
      uploadTime: new Date().toISOString()
    });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // Save Transcript
    const transPath = path.join(__dirname, 'uploads', folder, 'transcript.txt');
    fs.appendFileSync(transPath, `Q${questionIndex}: ${transcript}\n\n`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// --- FINISH SESSION (Fixed for Reliability) ---
app.post('/api/session/finish', async (req, res) => {
  const { folder, questionsCount } = req.body;
  console.log(`Finishing session: ${folder}`);

  // 1. EMAIL LOG
  console.log(`\n--- EMAIL SIMULATION ---`);
  console.log(`To: ${ADMIN_EMAIL}`);
  console.log(`Subject: Interview Complete: ${folder}`);
  console.log(`Body: Candidate finished ${questionsCount} questions.`);
  console.log(`------------------------\n`);

  // 2. WEBHOOK UPLOAD
  if (WEBHOOK_URL && WEBHOOK_URL !== "YOUR_WEBHOOK_URL_HERE") {
    const folderPath = path.join(__dirname, 'uploads', folder);
    
    // FIX 1: Wait 2 seconds (Increased) for files to settle
    console.log("[Server] Waiting 2s for file system sync...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      // Sort files: Q1, Q2, Q3, Q4, Q5
      const files = fs.readdirSync(folderPath).sort();
      console.log(`[Server] Found files: ${files.join(', ')}`); // Log what we found

      for (const file of files) {
        if (file.endsWith('.webm')) {
          const filePath = path.join(folderPath, file);
          const stats = fs.statSync(filePath);
          const fileSizeMB = stats.size / (1024 * 1024);

          // FIX 2: Check for Discord Size Limit
          if (fileSizeMB > DISCORD_LIMIT_MB) {
             console.warn(`[Server] SKIPPING ${file} because it is too large (${fileSizeMB.toFixed(2)}MB). Limit is ${DISCORD_LIMIT_MB}MB.`);
             continue;
          }

          console.log(`[Server] Uploading ${file} (${fileSizeMB.toFixed(2)}MB)...`);
          
          const fileBuffer = fs.readFileSync(filePath);
          const blob = new Blob([fileBuffer], { type: 'video/webm' });
          const formData = new FormData();
          formData.append('candidate', folder);
          formData.append('filename', file);
          formData.append('video_file', blob, file);

          try {
            const hookRes = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
            if (hookRes.ok) {
                console.log(`[Server] ${file} sent successfully.`);
            } else {
                // Log the exact reason for failure
                console.log(`[Server] Failed to send ${file}. Status: ${hookRes.status} ${hookRes.statusText}`);
            }
          } catch (e) {
            console.error(`[Server] Network Error on ${file}:`, e.message);
          }

          // FIX 3: Keep delay to prevent rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } catch (e) { console.error(e); }
  }

  // 3. Finalize Metadata
  try {
    const metaPath = path.join(__dirname, 'uploads', folder, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.finishTime = new Date().toISOString();
    meta.totalQuestionsReported = questionsCount;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});