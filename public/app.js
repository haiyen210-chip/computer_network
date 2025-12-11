// --- Configuration ---
const API_BASE = 'http://localhost:3000';
const QUESTION_TIME_LIMIT_SEC = 180; 
const AI_REFRESH_RATE_MS = 12000; // 12 Seconds

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
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');

const tokenInput = document.getElementById('token');
const nameInput = document.getElementById('name');
const startSessionBtn = document.getElementById('start-session-btn');

const questionHeader = document.getElementById('question-header');
const questionText = document.getElementById('question-text');
const videoPreview = document.getElementById('video-preview');
const timerEl = document.getElementById('timer');
const liveTranscriptEl = document.getElementById('live-transcript');

const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const rerecordBtn = document.getElementById('rerecord-btn');

// AI Elements
const aiAssistBtn = document.getElementById('ai-assist-btn');
const aiPanel = document.getElementById('ai-panel');
const aiContent = document.getElementById('ai-content');

const uploadStatusContainer = document.getElementById('upload-status-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const statusText = document.getElementById('status');

// --- State Variables ---
let mediaRecorder;
let recordedChunks = [];
let localStream;
let sessionToken = '';
let sessionFolder = '';
let currentQuestionIndex = 0;
let reRecordAvailable = true; 

// --- Timer & Speech State ---
let timerInterval;
let timeLeft = QUESTION_TIME_LIMIT_SEC;
let recognition;
let currentTranscript = '';
let isRecognitionActive = false;

// --- AI Auto-Coach State ---
let aiInterval = null;
let isAiActive = false;

// --- Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isRecognitionActive = true;
  };

  recognition.onend = () => {
    isRecognitionActive = false;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try { recognition.start(); } catch(e) {}
    }
  };

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    if (liveTranscriptEl) liveTranscriptEl.innerText = interim || final || '...';
    if (final) currentTranscript += final + ' ';
  };
}

// --- Event Listeners ---
startSessionBtn.addEventListener('click', startSession);
nextBtn.addEventListener('click', () => stopRecordingAndUpload(false)); 
finishBtn.addEventListener('click', () => stopRecordingAndUpload(false));
rerecordBtn.addEventListener('click', handleReRecord);

// NEW: Toggle instead of single click
aiAssistBtn.addEventListener('click', toggleAICoach);

// --- 1. Start Session ---
async function startSession() {
  const token = tokenInput.value;
  const userName = nameInput.value;

  if (!token || !userName) {
    setStatus('Please enter both token and name.', true);
    return;
  }

  setStatus('Connecting...');
  startSessionBtn.disabled = true;

  try {
    const verifyRes = await fetch(`${API_BASE}/api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!verifyRes.ok) throw new Error('Invalid Token');

    const sessionRes = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userName }),
    });
    if (!sessionRes.ok) throw new Error('Could not start session');
    
    const data = await sessionRes.json();
    sessionToken = token;
    sessionFolder = data.folder;

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoPreview.srcObject = localStream;

    startScreen.classList.add('hidden');
    interviewScreen.classList.remove('hidden');
    if(progressContainer) progressContainer.classList.remove('hidden');
    setStatus('');

    startRecording();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    startSessionBtn.disabled = false;
  }
}

// --- 2. AI Auto-Coach Logic ---
function toggleAICoach() {
    if (isAiActive) {
        stopAICoach();
    } else {
        startAICoach();
    }
}

function startAICoach() {
    isAiActive = true;
    aiPanel.classList.remove('hidden');
    aiAssistBtn.innerText = "🛑 Stop Live Coach";
    aiAssistBtn.classList.add('ai-active');
    
    // Run once immediately, then loop
    getAICoachTips();
    aiInterval = setInterval(getAICoachTips, AI_REFRESH_RATE_MS);
}

function stopAICoach() {
    isAiActive = false;
    clearInterval(aiInterval);
    aiAssistBtn.innerText = "✨ Start Live AI Coach";
    aiAssistBtn.classList.remove('ai-active');
}

async function getAICoachTips() {
  if (!isAiActive) return; // Double check

  const currentQ = QUESTIONS[currentQuestionIndex];
  
  try {
    // Don't send if transcript is too short yet (saves API calls)
    if (!currentTranscript || currentTranscript.trim().length < 5) {
        // Optional: update status but don't fetch
        return;
    }

    const res = await fetch(`${API_BASE}/api/ai-assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
          question: currentQ,
          transcript: currentTranscript 
      })
    });
    
    const result = await res.json();
    
    if (result.success && result.data) {
        // Create a new card for this advice batch
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const newCard = document.createElement('div');
        newCard.className = 'ai-advice-card';
        
        let html = `<div style="font-size:0.75rem; color:#888; margin-bottom:5px; display:flex; justify-content:space-between;">
                      <span>Feedback at ${timestamp}</span>
                    </div>`;
        
        html += '<ul>';
        result.data.tips.forEach(tip => {
            html += `<li>${tip}</li>`;
        });
        html += '</ul>';
        
        if (result.data.opener) {
             html += `<div class="ai-opener"><strong>Suggestion:</strong> "${result.data.opener}"</div>`;
        }

        newCard.innerHTML = html;
        
        // PREPEND: Add new advice to the TOP of the list
        aiContent.prepend(newCard);
        
    } else {
        console.error("AI Error:", result);
    }
  } catch (err) {
    console.error("AI Fetch Error:", err);
  }
}

// --- 3. Recording Logic ---
function startRecording() {
  // Reset State
  recordedChunks = [];
  currentTranscript = '';
  if (liveTranscriptEl) liveTranscriptEl.innerText = '(Listening...)';
  
  // Reset UI for new question
  if(questionHeader) questionHeader.innerText = `Question ${currentQuestionIndex + 1}`;
  if(questionText) questionText.innerText = QUESTIONS[currentQuestionIndex];
  
  // Reset AI UI - Important: Stop the previous interval!
  stopAICoach();
  aiContent.innerHTML = ''; // Clear previous question's tips
  aiPanel.classList.add('hidden');
  
  if(progressFill) {
      const percent = ((currentQuestionIndex) / QUESTIONS.length) * 100;
      progressFill.style.width = `${percent}%`;
  }

  updateButtonsState();

  if (recognition && isRecognitionActive) {
      recognition.stop();
      setTimeout(actuallyStartRecording, 200);
  } else {
      actuallyStartRecording();
  }
}

function actuallyStartRecording() {
  mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm' });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();

  if (recognition) {
      try { recognition.start(); } catch(e) { console.log("Speech start error:", e); }
  }

  startTimer();
  setStatus(`Recording Question ${currentQuestionIndex + 1}...`);
}

// --- Timer Logic ---
function startTimer() {
  clearInterval(timerInterval);
  timeLeft = QUESTION_TIME_LIMIT_SEC;
  updateTimerDisplay();
  
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      stopRecordingAndUpload(false); 
    }
  }, 1000);
}

function updateTimerDisplay() {
  if (!timerEl) return;
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerEl.innerText = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  
  if (timeLeft <= 10) timerEl.classList.add('timer-warning');
  else timerEl.classList.remove('timer-warning');
}

// --- 4. Stop & Handle Action ---
function stopRecordingAndUpload(isReRecording) {
  clearInterval(timerInterval);
  stopAICoach(); // Ensure AI stops when question ends

  if (recognition) {
      recognition.stop();
      isRecognitionActive = false;
  }
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.onstop = () => {
        if (isReRecording) {
          startRecording();
        } else {
          uploadVideo();
        }
      };
      mediaRecorder.stop();
  }
}

function handleReRecord() {
  if (!reRecordAvailable) return;
  reRecordAvailable = false; 
  stopRecordingAndUpload(true); 
}

function updateButtonsState() {
  if (reRecordAvailable && rerecordBtn) {
    rerecordBtn.disabled = false;
    rerecordBtn.innerText = "Re-record (1 left)";
  } else if (rerecordBtn) {
    rerecordBtn.disabled = true;
    rerecordBtn.innerText = "Re-record (Used)";
  }

  if (currentQuestionIndex < QUESTIONS.length - 1) {
    nextBtn.classList.remove('hidden');
    finishBtn.classList.add('hidden');
  } else {
    nextBtn.classList.add('hidden');
    finishBtn.classList.remove('hidden');
  }
}

// --- 5. Upload Logic ---
function uploadVideo() {
  if(uploadStatusContainer) uploadStatusContainer.classList.remove('hidden');
  
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const formData = new FormData();
  formData.append('token', sessionToken);
  formData.append('folder', sessionFolder);
  formData.append('questionIndex', currentQuestionIndex + 1);
  formData.append('transcript', currentTranscript.trim());
  formData.append('video', blob, `Q${currentQuestionIndex + 1}.webm`);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/api/upload-one`, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && uploadProgressFill) {
      const percentComplete = (e.loaded / e.total) * 100;
      uploadProgressFill.style.width = `${percentComplete}%`;
    }
  };

  xhr.onload = async () => {
    if (xhr.status === 200) {
      if(uploadStatusContainer) uploadStatusContainer.classList.add('hidden');
      if(uploadProgressFill) uploadProgressFill.style.width = '0%';

      currentQuestionIndex++;
      
      if (currentQuestionIndex < QUESTIONS.length) {
        reRecordAvailable = true; 
        if(progressFill) progressFill.style.width = `${(currentQuestionIndex / QUESTIONS.length) * 100}%`;
        startRecording();
      } else {
        finalizeSession();
      }
    } else {
      setStatus(`Upload Failed: ${xhr.statusText}`, true);
    }
  };

  xhr.onerror = () => {
    setStatus("Network Error during upload.", true);
  };

  xhr.send(formData);
}

async function finalizeSession() {
  setStatus('Finalizing...');
  if(progressFill) progressFill.style.width = '100%'; 
  
  try {
    await fetch(`${API_BASE}/api/session/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sessionToken,
        folder: sessionFolder,
        questionsCount: currentQuestionIndex,
      }),
    });

    localStream.getTracks().forEach((t) => t.stop());
    videoPreview.srcObject = null;
    interviewScreen.classList.add('hidden');
    finishScreen.classList.remove('hidden');
    setStatus('');
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  }
}

function setStatus(msg, err = false) {
  statusText.innerText = msg;
  statusText.style.color = err ? 'red' : '#333';
}