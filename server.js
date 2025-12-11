require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3000;

// --- CẤU HÌNH ---
// 1. Gemini Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyBo6i-H6Ns-1yb4BWAnRIfXDHHj0wUGVdI";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // Dùng Flash cho nhanh

// 2. Discord Webhook
const WEBHOOK_URL = "https://discord.com/api/webhooks/1440620971676401775/LXW_nLzJV1ogXqe-_1pSha4cEQdJABWeVb39PhB2GhtpJh-qjde4dGZKJ3DoJLqA5Kdu";
const DISCORD_LIMIT_MB = 25;
const ADMIN_EMAIL = "hr_manager@company.com";

app.use(cors());
app.use(express.json());
// Dòng này quan trọng để hiện giao diện:
app.use(express.static(path.join(__dirname, 'public')));

// --- HELPER FUNCTIONS ---
function sanitizeName(name) {
  return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}
function getFormattedDate() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${d.getFullYear()}_${pad(d.getHours())}_${pad(d.getMinutes())}`;
}

// --- API ROUTES ---

// 1. Verify Token
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;
  if (token === 'VALID_TOKEN_123') res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// 2. Start Session
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

// 3. Upload One (Lưu video + transcript)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', req.body.folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

      // Lưu Transcript để AI đọc sau này
      const transPath = path.join(__dirname, 'uploads', folder, 'transcript.txt');
      fs.appendFileSync(transPath, `Q${questionIndex}: ${transcript || "(No speech)"}\n\n`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// 4. AI Assist (Gợi ý trực tiếp) 
app.post('/api/ai-assist', async (req, res) => {
  const { question, transcript } = req.body;

  if (!GEMINI_API_KEY) return res.json({ success: false, error: "Server missing API Key" });

  try {
    let promptText;
    if (transcript && transcript.length > 20) {
      promptText = `
             You are an expert interview coach. The candidate is answering: "${question}".
             Their current speech: "${transcript}".
             
             Task:
             1. Give 3 short tips to improve or continue their answer.
             2. Suggest 1 strong next sentence (Opener) to keep the flow.
             
             Return ONLY raw JSON: { "tips": ["Tip 1", "Tip 2", "Tip 3"], "opener": "Example sentence..." }`;
    } else {
      promptText = `
             You are an expert interview coach. The candidate is stuck on: "${question}".
             
             Task:
             1. Give 3 short tips on how to structure the answer.
             2. Suggest 1 strong opening sentence (Opener).
             
             Return ONLY raw JSON: { "tips": ["Tip 1", "Tip 2", "Tip 3"], "opener": "I believe that..." }`;
    }

    const result = await model.generateContent(promptText);
    let textResponse = result.response.text();

    // Làm sạch JSON
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const jsonResponse = JSON.parse(textResponse);

    res.json({ success: true, data: jsonResponse });

  } catch (err) {
    console.error("AI Assist Error:", err);
    res.json({ success: false, error: "AI Connection Error." });
  }
});

// API 5: AI Review 
app.post('/api/ai-review', async (req, res) => {
  const { folder } = req.body;
  const transcriptPath = path.join(__dirname, 'uploads', folder, 'transcript.txt');

  if (!fs.existsSync(transcriptPath)) {
    return res.status(404).json({ ok: false, message: 'No transcript found.' });
  }

  try {
    const transcriptText = fs.readFileSync(transcriptPath, 'utf8');


    const prompt = `
        You are a professional recruiter. Evaluate the following interview transcript:
        "${transcriptText}"
        
        Please provide a concise review in English:
        1. Strengths (What they did well).
        2. Weaknesses (Areas for improvement).
        3. Overall Score (0/10).
        `;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    res.json({ ok: true, feedback: text });
  } catch (err) {
    console.error("AI Review Error:", err);
    res.status(500).json({ ok: false, message: "AI Error: " + err.message });
  }
});

// 6. Finish Session (Gửi Discord)
app.post('/api/session/finish', async (req, res) => {
  const { folder, questionsCount } = req.body;
  console.log(`Finishing: ${folder}`);

  // Gửi Discord
  if (WEBHOOK_URL && WEBHOOK_URL.startsWith("http")) {
    const folderPath = path.join(__dirname, 'uploads', folder);
    console.log("[Server] Waiting 2s for files...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      if (fs.existsSync(folderPath)) {
        const files = fs.readdirSync(folderPath).sort();
        for (const file of files) {
          if (file.endsWith('.webm')) {
            const filePath = path.join(folderPath, file);
            const stats = fs.statSync(filePath);

            if (stats.size / (1024 * 1024) > DISCORD_LIMIT_MB) continue;

            const fileBuffer = fs.readFileSync(filePath);
            const blob = new Blob([fileBuffer], { type: 'video/webm' });
            const formData = new FormData();
            formData.append('candidate', folder);
            formData.append('filename', file);
            formData.append('video_file', blob, file);

            try {
              await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
              console.log(`Sent ${file} to Discord`);
            } catch (e) { console.error(e); }

            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (e) { console.error(e); }
  }

  // Update Meta
  try {
    const metaPath = path.join(__dirname, 'uploads', folder, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta.finishTime = new Date().toISOString();
      meta.totalQuestionsReported = questionsCount;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false }); }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});