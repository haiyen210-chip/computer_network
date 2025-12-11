window.addEventListener('DOMContentLoaded', () => {
    console.log("CandiGo Interview Script Loaded - XHR Version");

    const userToken = sessionStorage.getItem('userToken');
    const sessionFolder = sessionStorage.getItem('sessionFolder');
    
    if (!userToken || !sessionFolder) { 
        console.warn("No session found, redirecting...");
        window.location.href = 'login.html'; 
        return; 
    }

    const questionsList = [
        "Could you please introduce yourself?",
        "Why do you want to apply for this position?",
        "What do you consider your greatest strength?",
        "Describe a problem you solved.",
        "Where do you see yourself in 5 years?"
    ];

    // Elements
    const videoElement = document.getElementById('camera-preview');
    const startButton = document.getElementById('start-button');
    const nextButton = document.getElementById('next-button');
    const finishButton = document.getElementById('finish-button');
    const questionTitle = document.getElementById('question-title');
    const questionText = document.getElementById('question-text');
    const transcriptBox = document.getElementById('transcript-box');
    const questionArea = document.getElementById('question-area');

    // --- Progress Elements ---
    const uploadContainer = document.getElementById('upload-progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressText = document.getElementById('progress-text');

    // --- AI Hint Elements ---
    const hintBtn = document.getElementById('hint-btn');
    const hintBox = document.getElementById('hint-box');
    const hintContent = document.getElementById('hint-content');
    const hintOpener = document.getElementById('hint-opener');
    const closeHintBtn = document.getElementById('close-hint');

    let mediaRecorder;
    let recordedChunks = [];
    let currentQuestion = 1;
    let recognition;
    let finalTranscript = "";

    // 1. Speech Setup
    function setupSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;
        
        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = true;
        
        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; ++i) {
                if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + ". ";
                else interim += e.results[i][0].transcript;
            }
            transcriptBox.innerHTML = `<span style="opacity:1">${finalTranscript}</span> <span style="opacity:0.7">${interim}</span>`;
            transcriptBox.scrollTop = transcriptBox.scrollHeight;
        };
        return rec;
    }
    recognition = setupSpeech();

    // 2. Camera Setup
    async function initCamera() {
        hintBox.classList.add('hidden');
        startButton.disabled = true;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            videoElement.srcObject = stream;
            
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            
            mediaRecorder.ondataavailable = e => { 
                if (e.data.size > 0) recordedChunks.push(e.data); 
            };
            
            mediaRecorder.onstop = async () => {
                console.log("Recorder stopped. Processing upload...");
                
                if (recognition) {
                    try { recognition.stop(); } catch(e) { /* ignore */ }
                }

                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                await uploadVideoWithProgress(blob);
            };

            startButton.disabled = false;
        } catch (err) { 
            console.error("Camera Error:", err);
            alert("Camera access denied."); 
        }
    }

    function startRecording() {
        console.log(`Starting Q${currentQuestion}...`);
        recordedChunks = [];
        finalTranscript = "";
        hintBox.classList.add('hidden');
        
        try {
            if (mediaRecorder.state === 'inactive') {
                mediaRecorder.start();
            }
            if (recognition) {
                try { recognition.start(); } catch(e) { /* ignore */ }
            }
        } catch(e) {
            console.error("Start Error:", e);
            alert("Could not start recording. Refresh page.");
        }
    }

    // 3. Upload with XHR (Required for Progress Bar)
    function uploadVideoWithProgress(blob) {
        return new Promise((resolve, reject) => {
            if (!uploadContainer) {
                console.error("#upload-progress-container NOT FOUND. Check interview.html");
                alert("Error: Progress bar UI missing.");
                reject("DOM Error");
                return;
            }

            // Show UI
            uploadContainer.classList.remove('hidden');
            progressFill.style.width = '0%';
            progressPercent.innerText = '0%';
            if(progressText) progressText.innerText = `Uploading Question ${currentQuestion}...`;
            
            nextButton.disabled = true;
            nextButton.innerText = "Uploading...";

            const formData = new FormData();
            formData.append('folder', sessionFolder);
            formData.append('token', userToken);
            formData.append('questionIndex', currentQuestion);
            formData.append('transcript', finalTranscript || "");
            formData.append('video', blob, `Q${currentQuestion}.webm`);

            // Use XMLHttpRequest instead of fetch
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload-one', true);

            // TRACK PROGRESS
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    progressFill.style.width = `${percent}%`;
                    progressPercent.innerText = `${percent}%`;
                    console.log(`Upload: ${percent}%`);
                }
            };

            // SUCCESS
            xhr.onload = () => {
                if (xhr.status === 200) {
                    uploadContainer.classList.add('hidden');
                    nextButton.disabled = false;
                    nextButton.innerText = "Next Question";
                    handleUploadSuccess();
                    resolve();
                } else {
                    handleUploadError();
                    reject(xhr.statusText);
                }
            };

            xhr.onerror = () => {
                handleUploadError();
                reject("Network Error");
            };

            xhr.send(formData);
        });
    }

    function handleUploadSuccess() {
        currentQuestion++;
        if (currentQuestion <= questionsList.length) {
            questionTitle.textContent = `Question ${currentQuestion}/${questionsList.length}`;
            questionText.textContent = questionsList[currentQuestion - 1];
            setTimeout(startRecording, 500);
        } else {
            alert("Interview Complete! Click Finish.");
            nextButton.classList.add('hidden');
            finishButton.classList.remove('hidden');
            questionArea.classList.add('hidden');
        }
    }

    function handleUploadError() {
        uploadContainer.classList.add('hidden');
        alert("Upload failed. Please check connection.");
        nextButton.disabled = false;
        nextButton.innerText = "Retry Question";
    }

    // Buttons
    startButton.addEventListener('click', () => {
        startButton.classList.add('hidden');
        nextButton.classList.remove('hidden');
        finishButton.classList.remove('hidden');
        questionArea.classList.remove('hidden');
        
        questionTitle.textContent = "Question 1/5";
        questionText.textContent = questionsList[0];
        
        startRecording();
    });

    nextButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            nextButton.disabled = true; 
            mediaRecorder.stop();
        }
    });

    finishButton.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to finish?")) return;
        
        finishButton.textContent = "Sending to Discord...";
        finishButton.disabled = true;

        try {
            await fetch('/api/session/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder: sessionFolder, questionsCount: currentQuestion - 1 })
            });
            window.location.href = 'end.html';
        } catch (e) {
            alert("Error: " + e.message);
            finishButton.disabled = false;
        }
    });

    hintBtn.addEventListener('click', async () => {
        hintBox.classList.remove('hidden');
        hintContent.innerHTML = "<em>Gemini thinking...</em>";
        try {
            const res = await fetch('/api/ai-assist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: questionsList[currentQuestion - 1],
                    transcript: finalTranscript
                })
            });
            const result = await res.json();
            if (result.success) {
                hintContent.innerHTML = `<ul>${result.data.tips.map(t => `<li>${t}</li>`).join('')}</ul>`;
                hintOpener.innerText = result.data.opener;
            } else {
                hintContent.innerText = "AI could not generate a hint.";
            }
        } catch(e) {
            hintContent.innerText = "Connection Error";
        }
    });

    closeHintBtn.addEventListener('click', () => hintBox.classList.add('hidden'));

    initCamera();
});