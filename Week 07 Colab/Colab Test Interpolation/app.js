document.addEventListener('DOMContentLoaded', () => {
    // Globals
    const urlInput = document.getElementById('url-input');
    const globalError = document.getElementById('global-error');

    // Left
    const btnLeft = document.getElementById('btn-generate-Left');
    const promptLeft = document.getElementById('prompt-a');
    const imgLeft = document.getElementById('image-Left');
    const phLeft = document.getElementById('placeholder-Left');
    const loaderLeft = document.getElementById('loader-Left');

    // Right
    const btnRight = document.getElementById('btn-generate-Right');
    const promptRight = document.getElementById('prompt-b');
    const imgRight = document.getElementById('image-Right');
    const phRight = document.getElementById('placeholder-Right');
    const loaderRight = document.getElementById('loader-Right');

    // Middle
    const btnInterp = document.getElementById('btn-interpolate');
    const imgInterp = document.getElementById('image-Middle');
    const phInterp = document.getElementById('placeholder-Middle');
    const loaderInterp = document.getElementById('loader-Interpolate');
    const sliderContainer = document.getElementById('slider-container');
    const slider = document.getElementById('interpolation-slider');
    const stepLabel = document.getElementById('step-label');

    // State
    let hasLeft = false;
    let hasRight = false;
    let cachedImages = [];

    function getBaseUrl() {
        let url = urlInput.value.trim();
        if (url.endsWith('/')) url = url.slice(0, -1);
        if (url.endsWith('/generate')) url = url.replace('/generate', '');
        if (url.endsWith('/interpolate')) url = url.replace('/interpolate', '');
        return url;
    }

    async function generateImage(side, prompt, imgElement, phElement, loader, btn) {
        const baseUrl = getBaseUrl();
        if (!baseUrl || !prompt) {
            showError("Please enter both a valid Localtunnel URL and a prompt.");
            return false;
        }

        const url = baseUrl + '/generate';
        
        btn.disabled = true;
        loader.style.display = 'inline-block';
        hideError();
        imgElement.style.display = 'none';
        phElement.textContent = "Generating...";
        phElement.style.display = 'block';

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Bypass-Tunnel-Reminder': 'true',
                    'ngrok-skip-browser-warning': 'true'
                },
                body: JSON.stringify({
                    prompt: prompt,
                    num_inference_steps: 1,
                    guidance_scale: 0.0
                })
            });

            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

            const imageBlob = await response.blob();
            if (imgElement.src) URL.revokeObjectURL(imgElement.src);
            
            const objectURL = URL.createObjectURL(imageBlob);
            imgElement.src = objectURL;
            
            return new Promise((resolve) => {
                imgElement.onload = () => {
                    imgElement.style.display = 'block';
                    phElement.style.display = 'none';
                    resolve(objectURL);
                };
            });

        } catch (error) {
            console.error(`Error generating ${side}:`, error);
            showError(`Failed to generate ${side} image. ${error.message}`);
            phElement.textContent = "Failed. Try again.";
            return false;
        } finally {
            btn.disabled = false;
            loader.style.display = 'none';
        }
    }

    btnLeft.addEventListener('click', async () => {
        const prompt = promptLeft.value.trim();
        const url = await generateImage('Left', prompt, imgLeft, phLeft, loaderLeft, btnLeft);
        if (url) {
            hasLeft = true;
            checkInterpolateState();
        }
    });

    btnRight.addEventListener('click', async () => {
        const prompt = promptRight.value.trim();
        const url = await generateImage('Right', prompt, imgRight, phRight, loaderRight, btnRight);
        if (url) {
            hasRight = true;
            checkInterpolateState();
        }
    });

    function checkInterpolateState() {
        if (hasLeft && hasRight) {
            btnInterp.disabled = false;
            btnInterp.querySelector('.btn-text').textContent = 'Interpolate Between Images';
            phInterp.textContent = "Ready to interpolate!";
        } else {
            btnInterp.disabled = true;
            btnInterp.querySelector('.btn-text').textContent = 'Wait for Images A & B';
            phInterp.textContent = "Generate both sides to unlock.";
        }
    }

    btnInterp.addEventListener('click', async () => {
        const baseUrl = getBaseUrl();
        const promptA = promptLeft.value.trim();
        const promptB = promptRight.value.trim();

        if (!baseUrl || !promptA || !promptB) return;

        const url = baseUrl + '/interpolate';

        btnInterp.disabled = true;
        loaderInterp.style.display = 'inline-block';
        imgInterp.style.display = 'none';
        sliderContainer.style.display = 'none';
        phInterp.textContent = "Interpolating... this may take some time!";
        phInterp.style.display = 'block';

        try {
            const requestBody = {
                prompt_a: promptA,
                prompt_b: promptB,
                steps: 5,
                num_inference_steps: 4 
            };

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "bypass-tunnel-reminder": "true" 
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            const base64Images = data.images;

            cachedImages = [];
            cachedImages.push(imgLeft.src); // Start sequence with Left image

            base64Images.forEach((b64) => {
                cachedImages.push(`data:image/jpeg;base64,${b64}`);
            });

            cachedImages.push(imgRight.src); // End sequence with Right image

            slider.min = "0";
            slider.max = (cachedImages.length - 1).toString();
            
            // Default to middle of the transition
            const middleIndex = Math.floor(cachedImages.length / 2);
            slider.value = middleIndex.toString();
            
            updateMiddleImage();

            sliderContainer.style.display = 'block';
            phInterp.style.display = 'none';
            btnInterp.querySelector('.btn-text').textContent = 'Re-Interpolate';

        } catch (error) {
            console.error("Interpolation Error:", error);
            showError(`Failed to interpolate. ${error.message}`);
            phInterp.textContent = "Interpolation failed.";
        } finally {
            btnInterp.disabled = false;
            loaderInterp.style.display = 'none';
        }
    });

    slider.addEventListener('input', () => {
        updateMiddleImage();
    });

    function updateMiddleImage() {
        const val = parseInt(slider.value);
        imgInterp.src = cachedImages[val];
        imgInterp.style.display = 'block';

        if (val === 0) {
            stepLabel.textContent = "Side A";
        } else if (val === cachedImages.length - 1) {
            stepLabel.textContent = "Side B";
        } else {
            stepLabel.textContent = `Step ${val}`;
        }
    }

    function showError(message) {
        globalError.textContent = message;
        globalError.style.display = 'block';
    }

    function hideError() {
        globalError.style.display = 'none';
    }
});
