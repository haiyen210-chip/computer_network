window.addEventListener('DOMContentLoaded', () => {
    const tokenInput = document.getElementById('token-input');
    const nameInput = document.getElementById('name-input');
    const loginButton = document.getElementById('login-button');
    const errorMessage = document.getElementById('error-message');

    // Điền sẵn token đúng để test cho nhanh
    tokenInput.value = 'VALID_TOKEN_123';

    loginButton.addEventListener('click', async (e) => {
        e.preventDefault();

        const token = tokenInput.value.trim();
        const userName = nameInput.value.trim();

        if (!token || !userName) {
            errorMessage.textContent = "Please fill your information!";
            errorMessage.classList.remove('hidden');
            return;
        }

        loginButton.textContent = "Checking...";
        loginButton.disabled = true;
        errorMessage.classList.add('hidden');

        try {
            // 1. API Verify Token
            const verifyRes = await fetch('/api/verify-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });

            if (!verifyRes.ok) throw new Error('Token is not available');

            // 2. API Start Session
            const startRes = await fetch('/api/session/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, userName })
            });

            const data = await startRes.json();

            if (data.ok) {
                // LƯU LẠI ĐỂ DÙNG Ở TRANG SAU
                sessionStorage.setItem('userToken', token);
                sessionStorage.setItem('sessionFolder', data.folder);

                // Chuyển trang
                window.location.href = 'interview.html';
            } else {
                throw new Error('Lỗi tạo phiên làm việc');
            }

        } catch (err) {
            console.error(err);
            errorMessage.textContent = err.message || "Lỗi kết nối Server";
            errorMessage.classList.remove('hidden');
            loginButton.textContent = "LOG IN";
            loginButton.disabled = false;
        }
    });
});