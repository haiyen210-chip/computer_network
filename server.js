const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Helper Functions (No change) ---
function sanitizeName(name) {
  return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}
function getFormattedDate() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  return (
    pad(d.getDate()) +
    '_' +
    pad(d.getMonth() + 1) +
    '_' +
    d.getFullYear() +
    '_' +
    pad(d.getHours()) +
    '_' +
    pad(d.getMinutes())
  );
}

// --- API Endpoints ---

// POST /api/verify-token (No change)
app.post('/api/verify-token', (req, res) => {
  const { token } = req.body;
  console.log(`Verifying token: ${token}`);
  if (token === 'VALID_TOKEN_123') {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, message: 'Invalid token' });
  }
});

// POST /api/session/start (No change)
app.post('/api/session/start', (req, res) => {
  const { token, userName } = req.body;
  if (token !== 'VALID_TOKEN_123') {
    return res.status(401).json({ ok: false, message: 'Invalid token' });
  }
  const safeName = sanitizeName(userName);
  const folderName = `${getFormattedDate()}_${safeName}`;
  const folderPath = path.join(__dirname, 'uploads', folderName);

  try {
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`Created folder: ${folderPath}`);
    const meta = {
      token,
      userName,
      startTime: new Date().toISOString(),
      questions: [],
    };
    fs.writeFileSync(
      path.join(folderPath, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );
    res.json({ ok: true, folder: folderName });
  } catch (err) {
    console.error(`Error creating folder: ${err}`);
    res.status(500).json({ ok: false, message: 'Failed to create session' });
  }
});

// --- Multer Setup (No change) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderPath = path.join(__dirname, 'uploads', req.body.folder);
    cb(null, folderPath);
  },
  filename: (req, file, cb) => {
    const fileName = `Q${req.body.questionIndex}.webm`;
    cb(null, fileName);
  },
});
const upload = multer({ storage: storage });

// --- MODIFIED: /api/upload-one ---
// This is no longer 'async'. We removed all OpenAI code.
app.post('/api/upload-one', upload.single('video'), (req, res) => {
  // 'transcript' is now in req.body because it's a text field in the FormData
  const { token, folder, questionIndex, transcript } = req.body;
  const savedFile = req.file;
  const savedAs = savedFile.filename;

  console.log(
    `Received upload for folder: ${folder}, Q: ${questionIndex}, saved as: ${savedAs}`
  );
  const metaPath = path.join(__dirname, 'uploads', folder, 'meta.json');

  try {
    // 1. Update metadata (same as before)
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.questions.push({
      index: questionIndex,
      file: savedAs,
      uploadTime: new Date().toISOString(),
      transcript: transcript, // NEW: We can even save the transcript in the meta file
    });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // --- NEW: Save to transcript.txt ---
    console.log(`Saving transcript for Q${questionIndex}: ${transcript}`);
    const transcriptPath = path.join(
      __dirname,
      'uploads',
      folder,
      'transcript.txt'
    );
    const transcriptContent = `Q${questionIndex}: ${transcript}\n\n`;

    // Use 'appendFileSync' to add this question's text to the file
    fs.appendFileSync(transcriptPath, transcriptContent);
    // --- End of NEW Step ---

    // Send success response (same as before)
    res.json({ ok: true, savedAs: savedAs });
  } catch (err) {
    console.error(`Error processing upload: ${err}`);
    res.status(500).json({ ok: false, message: 'Failed to process upload' });
  }
});

// POST /api/session/finish (No change)
app.post('/api/session/finish', (req, res) => {
  const { token, folder, questionsCount } = req.body;
  console.log(`Finishing session for folder: ${folder}`);
  const metaPath = path.join(__dirname, 'uploads', folder, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.finishTime = new Date().toISOString();
    meta.totalQuestionsReported = questionsCount;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({ ok: true });
  } catch (err) {
    console.error(`Error finalizing metadata: ${err}`);
    res.status(500).json({ ok: false, message: 'Failed to finalize session' });
  }
});

// --- Serve The Frontend (No change) ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start The Server (No change) ---
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});