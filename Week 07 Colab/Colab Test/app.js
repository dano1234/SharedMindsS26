document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const urlInput = document.getElementById('url-input');
    const promptInput = document.getElementById('prompt-input');
    const resultImage = document.getElementById('result-image');
    const placeholderText = document.getElementById('placeholder-text');
    const errorContainer = document.getElementById('error-message');
    const btnText = document.querySelector('.btn-text');
    const btnLoader = document.getElementById('btn-loader');
    const resultContainer = document.getElementById('result-container');

    generateBtn.addEventListener('click', async () => {
        let url = urlInput.value.trim();
        const prompt = promptInput.value.trim();

        // 1. Basic Local Validation
        if (!url || !prompt) {
            showError("Please enter both a valid Localtunnel URL and an image prompt.");
            return;
        }

        // 2. Prepare URL
        // Ensure not fetching to the root URL if they forgot the /generate route
        if (url.endsWith('/')) {
            url = url.slice(0, -1);
        }
        if (!url.endsWith('/generate')) {
            url += '/generate';
        }

        // 3. UI Loading State
        setLoadingState(true);
        hideError();
        
        // Hide previous image during loading to simulate fresh start
        resultImage.style.display = 'none';
        placeholderText.textContent = "Generating your image (this may take a bit)...";
        placeholderText.style.display = 'block';
        resultContainer.style.borderStyle = 'solid';

        try {
            // 4. Send Request
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Crucial: Bypass Localtunnel's warning page which otherwise intercepts the JSON response
                    'Bypass-Tunnel-Reminder': 'true',
                    'ngrok-skip-browser-warning': 'true' // Also added just in case
                },
                body: JSON.stringify({
                    prompt: prompt,
                    num_inference_steps: 1, // Using colab notebook default
                    guidance_scale: 0.0     // Using colab notebook default
                })
            });

            if (!response.ok) {
                // Determine if it was an HTML page sent back (meaning localtunnel intercepted it anyway)
                const contentType = response.headers.get("content-type");
                let errorDetails = `HTTP Error ${response.status}`;
                if (contentType && contentType.indexOf("text/html") !== -1) {
                    errorDetails += " - Localtunnel warning page intercepted the request. Make sure Headers are allowed.";
                }
                throw new Error(errorDetails);
            }

            // 5. Read Binary Response (Image Bytes)
            const imageBlob = await response.blob();
            
            // 6. Release old Object URL if there was one (memory management)
            if (resultImage.src) {
                URL.revokeObjectURL(resultImage.src);
            }

            // 7. Render Image
            const objectURL = URL.createObjectURL(imageBlob);
            resultImage.src = objectURL;
            
            resultImage.onload = () => {
                resultImage.style.display = 'block';
                placeholderText.style.display = 'none';
                resultContainer.style.borderStyle = 'none'; // remove border for clean image look
            };

        } catch (error) {
            console.error("Image Gen Error:", error);
            showError(`Failed to connect or generate image. Ensure your Colab is running, the URL is correct, and CORS bypass headers are allowed. Details: ${error.message}`);
            placeholderText.textContent = "Failed. Try again.";
            resultContainer.style.borderStyle = 'dashed';
        } finally {
            // 8. Revert Loading State
            setLoadingState(false);
        }
    });

    function setLoadingState(isLoading) {
        if (isLoading) {
            generateBtn.disabled = true;
            btnText.textContent = 'Generating...';
            btnLoader.style.display = 'inline-block';
        } else {
            generateBtn.disabled = false;
            btnText.textContent = 'Generate Image';
            btnLoader.style.display = 'none';
        }
    }

    function showError(message) {
        errorContainer.textContent = message;
        errorContainer.style.display = 'block';
        // Add a small shake animation if we wanted, but popping in is fine
    }

    function hideError() {
        errorContainer.style.display = 'none';
    }
});
