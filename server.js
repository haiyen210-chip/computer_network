const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

// --- CONFIGURATION ---

// 1. GOOGLE GEMINI API KEY
const GEMINI_API_KEY = "AIzaSyDVwvFOlT6krx6A6BIGl_sD6mdfNogoaNs"; 

// 2. DISCORD WEBHOOK URL
const WEBHOOK_URL = "https://discord.com/api/webhooks/1440620971676401775/LXW_nLzJV1ogXqe-_1pSha4cEQdJABWeVb39PhB2GhtpJh-qjde4dGZKJ3DoJLqA5Kdu"; 

// 3. EMAIL SIMULATION
const ADMIN_EMAIL = "hr_manager@company.com";
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

// AI Assistant Route
app.post('/api/ai-assist', async (req, res) => {
  console.log("--- AI Request Started ---");
  // NEW: We now accept 'transcript' (the answer so far)
  const { question, transcript } = req.body;
  
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("YOUR_GEMINI_API_KEY")) {
    console.error("ERROR: API Key is missing or still set to placeholder.");
    return res.json({ success: false, error: "API Key not configured." });
  }
  
  try {
    let promptText;

    // LOGIC: If the candidate has said enough (more than 20 chars), critique them.
    // Otherwise, just give general advice.
    if (transcript && transcript.length > 20) {
        promptText = `
          You are a tough but helpful interview coach. 
          The candidate was asked: "${question}".
          
          CURRENT ANSWER SO FAR: "${transcript}"
          
          Task:
          1. Analyze what they have said so far.
          2. Provide 3 "Real-time Tips" on how to improve/continue THIS specific answer.
          3. Suggest a "Next Sentence" to help them keep flowing.

          Return ONLY raw JSON: { "tips": ["Critique 1", "Critique 2", "Critique 3"], "opener": "Next sentence suggestion..." }
        `;
        console.log("Mode: Live Analysis");
    } else {
        promptText = `
          You are an expert job interview coach. The candidate is asked: "${question}".
          Provide a JSON response with:
          1. "tips": An array of 3 short, punchy tips on how to answer.
          2. "opener": A strong example opening sentence (1st person).
          
          Return ONLY raw JSON. No markdown formatting.
          Example format: { "tips": ["Tip 1", "Tip 2", "Tip 3"], "opener": "I believe..." }
        `;
        console.log("Mode: General Advice");
    }

    const MODEL_NAME = "gemini-2.5-flash";
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }]
      })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Google API Failed: ${response.status} ${response.statusText}`);
        return res.json({ success: false, error: `Google Error: ${response.statusText}` });
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0].content) {
      let textResponse = data.candidates[0].content.parts[0].text;
      textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonResponse = JSON.parse(textResponse);
      console.log("Success! Sending data to client.");
      res.json({ success: true, data: jsonResponse });
    } else {
      throw new Error("No content in AI response");
    }

  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.json({ success: false, error: "Failed to generate AI tips." });
  }
});

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
    const dir = path.join(__dirname, 'uploads', req.body.folder);
    if (!fs.existsSync(dir)){
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
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
    if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.questions.push({
          index: questionIndex,
          file: savedFile.filename,
          transcript: transcript,
          uploadTime: new Date().toISOString()
        });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    
        const transPath = path.join(__dirname, 'uploads', folder, 'transcript.txt');
        fs.appendFileSync(transPath, `Q${questionIndex}: ${transcript}\n\n`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// --- FINISH SESSION ---
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
    console.log("[Server] Waiting 2s for file system sync...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath).sort();
          for (const file of files) {
            if (file.endsWith('.webm')) {
              const filePath = path.join(folderPath, file);
              const stats = fs.statSync(filePath);
              const fileSizeMB = stats.size / (1024 * 1024);

              if (fileSizeMB > DISCORD_LIMIT_MB) {
                 console.warn(`[Server] SKIPPING ${file} (Too Large).`);
                 continue;
              }

              console.log(`[Server] Uploading ${file}...`);
              const fileBuffer = fs.readFileSync(filePath);
              const blob = new Blob([fileBuffer], { type: 'video/webm' });
              const formData = new FormData();
              formData.append('candidate', folder);
              formData.append('filename', file);
              formData.append('video_file', blob, file);

              try {
                await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
              } catch (e) { console.error(`[Server] Network Error on ${file}:`, e.message); }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
      }
    } catch (e) { console.error(e); }
  }

  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});