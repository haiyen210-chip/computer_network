// --- Mock Questions ---
const QUESTIONS = [
  '1. Tell me about yourself.',
  '2. What is your biggest strength?',
  '3. What is your biggest weakness?',
  '4. Where do you see yourself in 5 years?',
  '5. Why should we hire you?',
];

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen');
const interviewScreen = document.getElementById('interview-screen');
const finishScreen = document.getElementById('finish-screen');

const tokenInput = document.getElementById('token');
const nameInput = document.getElementById('name');
const startSessionBtn = document.getElementById('start-session-btn');

const videoPreview = document.getElementById('video-preview');
const questionText = document.getElementById('question');
const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const statusText = document.getElementById('status');

// --- State Variables ---
let mediaRecorder;
let recordedChunks = [];
let localStream;
let sessionToken = '';
let sessionFolder = '';
let currentQuestionIndex = 0;

const API_BASE = 'http://localhost:3000'; // Our server URL

// --- Event Listeners ---
startSessionBtn.addEventListener('click', startSession);
nextBtn.addEventListener('click', handleNext);
finishBtn.addEventListener('click', handleFinish);

// --- 1. Start Session ---
async function startSession() {
  const token = tokenInput.value;
  const userName = nameInput.value;

  if (!token || !userName) {
    setStatus('Please enter both token and name.', true);
    return;
  }

  setStatus('Verifying token...');
  startSessionBtn.disabled = true;

  try {
    // 1. Verify Token
    const verifyRes = await fetch(`${API_BASE}/api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!verifyRes.ok) throw new Error('Invalid Token');

    // 2. Start Session (creates folder)
    const sessionRes = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userName }),
    });

    if (!sessionRes.ok) throw new Error('Could not start session');
    const data = await sessionRes.json();
    sessionToken = token;
    sessionFolder = data.folder;

    // 3. Request permissions
    setStatus('Requesting camera/microphone...');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    videoPreview.srcObject = localStream;

    // 4. Move to interview screen
    startScreen.classList.add('hidden');
    interviewScreen.classList.remove('hidden');
    setStatus('');
    startRecording();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    startSessionBtn.disabled = false;
  }
}

// --- 2. Recording Logic ---
function startRecording() {
  // Show the current question
  questionText.innerText = QUESTIONS[currentQuestionIndex];
  nextBtn.disabled = false;
  // Only hide the 'Finish' button if it's NOT the last question
if (currentQuestionIndex < QUESTIONS.length - 1) {
  finishBtn.classList.add('hidden');
}

  // Start the MediaRecorder
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm' });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = uploadCurrentQuestion;

  mediaRecorder.start();
  setStatus(`Recording Question ${currentQuestionIndex + 1}...`);
}

function stopRecording() {
  nextBtn.disabled = true;
  mediaRecorder.stop(); // This will trigger the 'onstop' event
}

// --- 3. Upload Logic ---
async function uploadCurrentQuestion() {
  setStatus(
    `Uploading Question ${currentQuestionIndex + 1}... (this may take a moment)`
  );

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const formData = new FormData();
  formData.append('token', sessionToken);
  formData.append('folder', sessionFolder);
  formData.append('questionIndex', currentQuestionIndex + 1);
  formData.append('video', blob, `Q${currentQuestionIndex + 1}.webm`);

  try {
    // Call /api/upload-one
    const res = await fetch(`${API_BASE}/api/upload-one`, {
      method: 'POST',
      body: formData, // No 'Content-Type' header needed, browser sets it for FormData
    });

    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    console.log('Upload success:', data);
    setStatus(`Question ${currentQuestionIndex + 1} uploaded.`);

    // --- Move to next question or finish ---
    currentQuestionIndex++;
    if (currentQuestionIndex < QUESTIONS.length) {
      // Show "Finish" button on the last question
      if (currentQuestionIndex === QUESTIONS.length - 1) {
        nextBtn.classList.add('hidden');
        finishBtn.classList.remove('hidden');
      }
      startRecording();
    } else {
      // This case is handled by the "Finish" button click
      // but you could auto-finish here if desired.
    }
  } catch (err) {
    console.error(err);
    setStatus(`Error uploading: ${err.message}. Please try again.`, true);
    // TODO: Implement retry logic as per requirements
    nextBtn.disabled = false; // Allow retry
  }
}

// --- 4. Handle "Next" / "Finish" Clicks ---
function handleNext() {
  stopRecording(); // This triggers the upload
}

async function handleFinish() {
  // If we are on the last question, we need to stop and upload it first
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    finishBtn.disabled = true;
    mediaRecorder.onstop = async () => {
      await uploadCurrentQuestion(); // Wait for the last upload
      await finalizeSession(); // Then finalize
    };
    mediaRecorder.stop();
  } else {
    await finalizeSession();
  }
}

// --- 5. Finalize Session ---
async function finalizeSession() {
  setStatus('Finishing session...');
  try {
    await fetch(`${API_BASE}/api/session/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sessionToken,
        folder: sessionFolder,
        questionsCount: currentQuestionIndex + 1, // Report how many were *actually* answered
      }),
    });

    // Stop camera/mic
    localStream.getTracks().forEach((track) => track.stop());
    videoPreview.srcObject = null;

    // Show finish screen
    interviewScreen.classList.add('hidden');
    finishScreen.classList.remove('hidden');
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(`Error finishing session: ${err.message}`, true);
    finishBtn.disabled = false;
  }
}

// --- Utility ---
function setStatus(message, isError = false) {
  statusText.innerText = message;
  statusText.style.color = isError ? 'red' : 'black';
}