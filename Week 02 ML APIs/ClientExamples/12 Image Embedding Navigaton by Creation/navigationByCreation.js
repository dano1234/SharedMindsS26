
import { UMAP } from "https://cdn.skypack.dev/umap-js";

const numberOfPeopleToAdd = 10;
let canvas;
let inputBox;
let people = {};
let authToken = "";
let hoveredPersonName = null;
// Render stack: names in this array are drawn in order; last entry is on top.
let drawOrder = [];
let mePromptInput = null;
let isUpdatingMe = false;
let isBusyWithProxy = false; // true while either proxy function is in-flight
let statusSpan = null; // compact progress text in the top toolbar

init();



function init() {
    // Perform initialization logic here
    people = loadJSONFromLocalStorage();
    console.log("people", people);
    initInterface();
    if (Object.keys(people).length > 0) {
        runUMAP();
    }
    animate();
}

// Animate loop
function animate() {
    // Perform animation logic here
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const order = drawOrder.length ? drawOrder : Object.keys(people);
    for (let idx = 0; idx < order.length; idx++) {
        const personName = order[idx];
        const personObj = people[personName];
        if (!personObj) continue; // skip entries that no longer exist
        // Draw image
        if (personObj.img && personObj.img.complete && personObj.img.naturalWidth > 0) {
            ctx.drawImage(personObj.img, personObj.x, personObj.y, personObj.width, personObj.height);
        } else {
            // Fallback placeholder while image loads or if broken
            ctx.save();
            ctx.fillStyle = '#eee';
            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 1;
            ctx.fillRect(personObj.x, personObj.y, personObj.width, personObj.height);
            ctx.strokeRect(personObj.x, personObj.y, personObj.width, personObj.height);
            ctx.restore();
        }
        // Special frame for the "me" element — extends down past the caption panel
        // so it visually wraps the image + name + prompt input as one unit
        if (personName === 'me') {
            const captionOverlap = 6;
            const captionHeight = 34;
            const inputHeight = 36; // approximate height of the mePromptInput
            const totalHeight = personObj.height - captionOverlap + captionHeight + inputHeight + 4;
            ctx.save();
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(30, 144, 255, 0.95)'; // dodgerblue
            ctx.shadowColor = 'rgba(30, 144, 255, 0.6)';
            ctx.shadowBlur = 12;
            ctx.strokeRect(
                personObj.x - 4,
                personObj.y - 4,
                personObj.width + 8,
                totalHeight + 8
            );
            ctx.restore();
        }
        // Polaroid-style bottom caption panel to keep name readable over images behind
        const panelHeight = 34; // small whitish strip under the image
        const panelY = personObj.y + personObj.height - 6; // overlap a touch with the image
        const panelX = personObj.x - 2;
        const panelW = personObj.width + 4;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; // whitish
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';      // faint border
        ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 6;
        ctx.fillRect(panelX, panelY, panelW, panelHeight);
        ctx.strokeRect(panelX, panelY, panelW, panelHeight);
        ctx.restore();

        // Draw name centered within the panel
        ctx.font = '20px Arial';
        ctx.fillStyle = 'black';
        const textWidth = ctx.measureText(personObj.name).width;
        const textY = panelY + Math.min(panelHeight - 8, 22);
        ctx.fillText(
            personObj.name,
            personObj.x + personObj.width / 2 - textWidth / 2,
            textY
        );
        // If hovered, draw a highlight stroke around the image
        if (hoveredPersonName === personName) {
            ctx.save();
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 8;
            ctx.strokeRect(
                personObj.x - 2,
                personObj.y - 2,
                personObj.width + 4,
                personObj.height + 4
            );
            ctx.restore();
        }
    }

    // Keep the "me" prompt input positioned below the "me" image (if present)
    positionMePromptInput();

    requestAnimationFrame(animate);
}


/**
 * Uses the text typed under "me" to produce a new prompt by
 * prepending those words to the existing "me" prompt and removing
 * the same number of words from the END of the existing prompt.
 *
 * Example:
 * - Existing: "ancient marble statue with vines"
 * - Typed:    "rusty"
 * - New:      "rusty ancient marble statue with"
 *
 * Then generates a new image and embedding (same flow as batch),
 * updates the "me" entry, saves, and re-runs UMAP for a fresh layout.
 */
async function newPromptFromMe(p_prompt) {
    if (isUpdatingMe) return; // guard against rapid double-press
    isUpdatingMe = true;
    const meObj = people['me'];


    if (statusSpan) statusSpan.textContent = `Getting New Image for me...`;
    isBusyWithProxy = true;
    document.body.style.cursor = 'wait';
    const replicateProxy = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';

    meObj.prompt = p_prompt;
    // 1) Image from prompt (use known-good model)
    // const hasValidImage = meObj.img && meObj.img.complete && meObj.img.naturalWidth > 0;
    // const base64Image = hasValidImage
    //     ? imageToBase64(meObj.img)
    //     : generateNoiseBase64(512, 512);
    // const base64SizeKB = Math.round((base64Image.length * 3 / 4) / 1024);
    let base64Image = generateNoiseBase64(512, 512);
    if (meObj.imageURL) {
        base64Image = imageToBase64(meObj.img);
    }
    //console.log(`Base64 image size: ${base64SizeKB} KB (${base64Image.length} chars, ${base64Image.substring(0, 30)}...)`);


    let data = {
        //model: 'google/imagen-4-fast',
        model: "google/nano-banana",
        input: {
            prompt: meObj.prompt,
            image_input: [base64Image],
        }
    };
    let options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
    };
    console.log("data", data);
    let resp = await fetch(replicateProxy, options);

    const imgRes = await resp.json();
    let imageURL = imgRes.output;
    console.log("imageURL", imgRes)
    //if (Array.isArray(imageURL)) imageURL = imageURL[0];

    meObj.imageURL = imageURL;
    console.log("imageURL", imageURL);
    // 2) Embedding for the image URL (same model as batch)
    if (statusSpan) statusSpan.textContent = `Getting a new embedding me...`;
    data = {
        model: 'andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a',
        //input: { inputs: imageURL } // use image embedding, not text-of-URL
    };
    options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
    };
    resp = await fetch(replicateProxy, options);

    const embRes = await resp.json();
    const embedding = embRes.output;

    console.log("embedding", embedding);
    // 3) Update "me" record in-place
    // Preload image; only swap in after it loads successfully
    const newImg = new Image();
    newImg.crossOrigin = 'anonymous';
    newImg.onload = () => {
        meObj.img = newImg;
        positionMePromptInput();
    };
    newImg.onerror = () => {
        console.warn('"me" image failed to load', imageURL);
    };
    newImg.src = imageURL;
    meObj.embedding = embedding; // shape: [{ embedding: number[] }]
    console.log('Updated "me" embedding length:', Array.isArray(embedding) && embedding[0] ? embedding[0].embedding.length : 'unknown');

    // Keep "me" on top visually
    const idx = drawOrder.indexOf('me');
    if (idx !== -1) drawOrder.splice(idx, 1);
    drawOrder.push('me');

    // 4) Recompute UMAP layout with the updated embedding
    if (statusSpan) statusSpan.textContent = 'Fitting layout for new me...';

    runUMAP();

    saveJSONToLocalStorage();
    saveDrawOrderToLocalStorage();
    if (statusSpan) statusSpan.textContent = "Done:";
    if (mePromptInput) mePromptInput.value = '';

    isBusyWithProxy = false;
    document.body.style.cursor = 'auto';
    isUpdatingMe = false;
}

function generateNoiseBase64(w = 512, h = 512) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(w, h);
    for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = Math.random() * 255 | 0; // R
        imageData.data[i + 1] = Math.random() * 255 | 0; // G
        imageData.data[i + 2] = Math.random() * 255 | 0; // B
        imageData.data[i + 3] = 255;                      // A
    }
    ctx.putImageData(imageData, 0, 0);
    return c.toDataURL('image/jpeg', 0.7);
}

function imageToBase64(imgElement, maxSize = 512, quality = 0.7) {
    const c = document.createElement('canvas');
    // Scale down to maxSize x maxSize, preserving aspect ratio
    const w = imgElement.naturalWidth;
    const h = imgElement.naturalHeight;
    const scale = Math.min(maxSize / w, maxSize / h, 1); // never scale up
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(imgElement, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality); // JPEG with compression
}

// Choose a random position for a 256x256 image within the canvas
function randomPosition() {
    const margin = 10;
    const maxX = Math.max(margin, canvas.width - 256 - margin);
    const maxY = Math.max(margin, canvas.height - 256 - margin);
    const x = Math.floor(Math.random() * maxX);
    const y = Math.floor(Math.random() * maxY);
    return { x, y };
}

// Ask LLM for a person (name, walkOfLife, imagePrompt), then create image + embedding, add to people
async function addPeopleFromSubject() {
    try {
        if (statusSpan) statusSpan.textContent = "Making up people...";

        const subject = (inputBox.value || '').trim();
        if (!subject) {
            alert('Enter a subject in the input box first.');
            return;
        }
        isBusyWithProxy = true;
        document.body.style.cursor = 'wait';
        const replicateProxy = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
        const llmPrompt =
            'You are creating ' + numberOfPeopleToAdd + ' characters for a visual canvas. ' +
            'Given the subject: \"' + subject + '\" produce STRICT JSON with keys ' +
            '{ \"name\": string, \"walkOfLife\": string, \"imagePrompt\": string }. ' +
            'Keep it short. Turn up the temperature to 1.0. and make it weirder. Do NOT include any extra text.';

        // 1) LLM
        let data = { model: 'google/gemini-3-pro', input: { prompt: llmPrompt } };
        console.log("data", data);
        let options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(data),
        };
        let resp = await fetch(replicateProxy, options);
        let llm = await resp.json();
        let out = llm.output;
        console.log("llm", out);
        let births = JSON.parse(out.join(""));
        console.log("births", births);
        if (statusSpan) statusSpan.textContent = `LLM: ${births.length} characters`;
        births[0].name = "me";
        for (let i = 0; i < births.length; i++) {
            let thisBirth = births[i];
            let personName = thisBirth.name;
            let walkOfLife = thisBirth.walkOfLife;
            let imagePrompt = thisBirth.imagePrompt;

            // 2) Image
            if (statusSpan) statusSpan.textContent = `Image ${i + 1}/${births.length} — ${personName}`;
            data = {
                model: 'google/imagen-4-fast',
                input: {
                    prompt: imagePrompt
                }
            };
            options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(data),
            };
            console.log("options", options);
            resp = await fetch(replicateProxy, options);
            const imgRes = await resp.json();
            let imageURL = imgRes.output;

            // 3) Embedding
            if (statusSpan) statusSpan.textContent = `Embed ${i + 1}/${births.length} — ${personName}`;
            data = {
                model: 'andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a',
                input: {
                    inputs: imageURL
                }
            };
            options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(data),
            };
            resp = await fetch(replicateProxy, options);
            const embRes = await resp.json();
            const embedding = embRes.output;
            console.log("embedding of 10", embedding);
            // 4) Add person
            const img = document.createElement('img');
            img.crossOrigin = 'anonymous';
            img.src = imageURL;
            let pos = randomPosition();
            people[personName] = {
                name: personName,
                walkOfLife: walkOfLife || '',
                prompt: imagePrompt,
                imageURL: imageURL,
                imageModel: 'google/imagen-4-fast',
                embeddingModel: 'andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a',
                embedding: embedding,
                x: pos.x,
                y: pos.y,
                width: 256,
                height: 256,
                img: img
            };
            // Ensure new person is on top by default
            if (!drawOrder.includes(personName)) {
                drawOrder.push(personName);
            }
        }
        saveJSONToLocalStorage();
        saveDrawOrderToLocalStorage();
        if (statusSpan) statusSpan.textContent = 'Fitting layout…';
        runUMAP();
        if (statusSpan) statusSpan.textContent = `Done: ${Object.keys(people).length} people`;

    } catch (e) {
        console.error('addPeopleFromSubject error', e);
        alert('Failed to add person. See console for details.');
    } finally {
        isBusyWithProxy = false;
        document.body.style.cursor = 'auto';
    }
}




function initInterface() {
    // Get the input box and the canvas element
    canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'myCanvas');
    canvas.style.position = 'absolute';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    let ctx = canvas.getContext('2d');
    document.body.appendChild(canvas);
    //console.log('canvas', canvas.width, canvas.height);

    // Keep canvas sized to window and keep items on-screen on resize
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        projectNormalizedToCanvasWithMargins(); // safely re-map stored normalized coords to current canvas
    });

    // Hover detection over images drawn on the canvas
    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const hitName = hitTestPersonAt(mouseX, mouseY);
        hoveredPersonName = hitName;
        // Don't override the wait cursor while a proxy call is in-flight
        if (!isBusyWithProxy) {
            document.body.style.cursor = hitName ? 'pointer' : 'default';
        }
    });

    // Click to bring an item to the top of the render stack
    canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const hitName = hitTestPersonAt(mouseX, mouseY, /*preferTopmost*/ true);
        if (!hitName) return;
        // Move hitName to the end (top) of drawOrder
        const existingIdx = drawOrder.indexOf(hitName);
        if (existingIdx !== -1) {
            drawOrder.splice(existingIdx, 1);
        }
        drawOrder.push(hitName);
        hoveredPersonName = hitName;
        saveDrawOrderToLocalStorage();
    });

    // Top toolbar container (left-justified)
    const toolbar = document.createElement('div');
    toolbar.setAttribute('id', 'topToolbar');
    toolbar.style.position = 'fixed';
    toolbar.style.top = '12px';
    toolbar.style.left = '12px';
    toolbar.style.zIndex = '300';
    toolbar.style.display = 'flex';
    toolbar.style.alignItems = 'center';
    toolbar.style.gap = '8px';
    document.body.appendChild(toolbar);

    // Inject compact UI styles for inputs/buttons/status (always on top, readable)
    (() => {
        const id = 'nav-create-ui-styles';
        if (document.getElementById(id)) return;
        const style = document.createElement('style');
        style.id = id;
        style.textContent = `
		#topToolbar{
			z-index:1000;
			background:rgba(255,255,255,0.85);
			border:1px solid rgba(0,0,0,0.08);
			border-radius:10px;
			padding:10px 12px;
			box-shadow:0 4px 16px rgba(0,0,0,0.12);
			backdrop-filter:saturate(120%) blur(6px);
		}
		#topToolbar .ui-input{
			font:600 18px/1.2 "Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
			padding:8px 12px;
			border:1px solid #d0d7de;
			border-radius:8px;
			background:#fff;
			color:#111;
			min-width:320px;
			outline:none;
			box-shadow:inset 0 1px 2px rgba(0,0,0,0.06);
		}
		#topToolbar .ui-input::placeholder{ color:#777; }
		#topToolbar .ui-input:focus{
			border-color:#0969da;
			box-shadow:0 0 0 3px rgba(9,105,218,0.2), inset 0 1px 2px rgba(0,0,0,0.06);
		}
		#topToolbar .ui-btn{
			font:600 14px/1 "Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
			color:#111;
			background:#f6f8fa;
			border:1px solid #d0d7de;
			border-radius:8px;
			padding:10px 12px;
			cursor:pointer;
			transition:all .15s ease;
		}
		#topToolbar .ui-btn:hover{ background:#eef1f4; transform:translateY(-1px); }
		#topToolbar .ui-btn:active{ transform:translateY(0); }
		#topToolbar .ui-btn.primary{
			background:#0969da; color:#fff; border-color:#0969da;
		}
		#topToolbar .ui-btn.primary:hover{ background:#075bbd; }
		#topToolbar .status{
			font:500 14px/1.2 "Inter", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
			color:#111;
			white-space:nowrap;
			max-width:40vw;
			overflow:hidden;
			text-overflow:ellipsis;
		}
		`;
        document.head.appendChild(style);
    })();

    inputBox = document.createElement('input');
    inputBox.value = "The Last Supper";
    inputBox.setAttribute('type', 'text');
    inputBox.setAttribute('id', 'inputBox');
    inputBox.setAttribute('placeholder', 'Enter text here');
    inputBox.style.zIndex = '100';
    inputBox.style.fontSize = '30px';
    inputBox.style.fontFamily = 'Arial';
    inputBox.className = 'ui-input';
    toolbar.appendChild(inputBox);
    inputBox.setAttribute('autocomplete', 'off');


    // Add Person button
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add People';
    addBtn.style.zIndex = '100';
    addBtn.style.fontSize = '16px';
    addBtn.className = 'ui-btn primary';
    addBtn.addEventListener('click', addPeopleFromSubject);
    toolbar.appendChild(addBtn);

    // runUMAP button
    const runUMAPBtn = document.createElement('button');
    runUMAPBtn.textContent = 'Fit';
    runUMAPBtn.style.zIndex = '100';
    runUMAPBtn.style.fontSize = '16px';
    runUMAPBtn.className = 'ui-btn';
    runUMAPBtn.addEventListener('click', () => {
        runUMAP();
        saveJSONToLocalStorage();

    });
    toolbar.appendChild(runUMAPBtn);

    // Snap button: remove half the people (keep "me"), save, rerun UMAP
    const snapBtn = document.createElement('button');
    snapBtn.textContent = 'Snap';
    snapBtn.style.zIndex = '100';
    snapBtn.style.fontSize = '16px';
    snapBtn.className = 'ui-btn';
    snapBtn.title = 'Remove half the people (keeps "me") and re-layout';
    snapBtn.addEventListener('click', () => {
        snapClearHalfAndSave();

    });
    toolbar.appendChild(snapBtn);

    // Status text (compact) – placed to the right of Snap button
    statusSpan = document.createElement('span');
    statusSpan.className = 'status';
    statusSpan.textContent = 'Ready';
    toolbar.appendChild(statusSpan);

    // Create a dedicated prompt input for the "me" element (hidden until "me" exists)
    mePromptInput = document.createElement('input');
    mePromptInput.type = 'text';
    mePromptInput.placeholder = 'Add Prompt To Move';
    mePromptInput.style.position = 'absolute';
    mePromptInput.style.fontSize = '18px';
    mePromptInput.style.zIndex = '200';
    // Match the blue "me" frame
    mePromptInput.style.background = 'rgba(255,255,255,0.92)';
    mePromptInput.style.border = 'none';
    mePromptInput.style.boxShadow = 'none';
    mePromptInput.style.padding = '6px 8px';
    mePromptInput.style.margin = '0';
    mePromptInput.style.outline = 'none';
    mePromptInput.style.display = 'none'; // shown when "me" is present
    document.body.appendChild(mePromptInput);
    // Independent input; pressing Enter triggers only the 'me' update flow
    mePromptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {

            const val = (mePromptInput.value || '').trim();
            if (!val) return;

            newPromptFromMe(val);
        }
    });
}



function runUMAP() {
    console.log("running UMAP");

    // Build deterministic list of names so indexes align across steps
    const personNames = Object.keys(people);
    // Extract raw embedding vectors robustly
    const embeddings = personNames.map((name) => {
        const emb = people[name].embedding;
        if (Array.isArray(emb)) {
            if (emb.length > 0 && Array.isArray(emb[0]?.embedding)) return emb[0].embedding;
            if (emb.length > 0 && typeof emb[0] === 'number') return emb;
        } else if (emb && Array.isArray(emb.embedding)) {
            return emb.embedding;
        }
        console.warn('Unexpected embedding shape for', name, emb);
        return new Array(768).fill(0);
    });

    // DIAGNOSTIC: log first 5 values of "me" embedding so we can verify it changes between runs
    const meIdx = personNames.indexOf('me');
    if (meIdx !== -1) {
        console.log(`DIAG: "me" embedding first 5 values:`, embeddings[meIdx].slice(0, 5));
    }

    // Cosine distance for high-dimensional CLIP embeddings
    const cosineDistance = (a, b) => {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
        return 1 - dot / denom;
    };

    // Use a NEW random seed each call so UMAP can produce different layouts
    // when embeddings change.
    var myrng = new Math.seedrandom(Date.now().toString());
    let umap = new UMAP({
        nNeighbors: 3,
        minDist: 0.9,
        nComponents: 2,
        random: myrng,
        spread: 0.99,
        distanceFn: cosineDistance
    });

    const umap2DPoints = umap.fit(embeddings);

    // DIAGNOSTIC: log "me" 2D position so we can see if it actually changes
    if (meIdx !== -1) {
        console.log(`DIAG: "me" umap2D point:`, umap2DPoints[meIdx]);
    }

    // Normalize and project to pixels (stores normalizedX/Y for responsive resizing)
    setNormalizedAndProjectToCanvas(umap2DPoints, personNames);
    console.log("people", people);
}



/**
 * Takes raw UMAP output points (array of [x, y] in arbitrary units),
 * normalizes each axis independently to [0..1], stores them as
 * person.normalizedX and person.normalizedY, then projects to pixels.
 *
 * Why keep normalized values?
 * - They are resolution-independent. On window resize, we can re-project
 *   to make full use of the new canvas size without re-running UMAP.
 */
function setNormalizedAndProjectToCanvas(umapPoints, orderedNames) {
    if (!umapPoints || umapPoints.length === 0) return;
    // 1) Find true min/max for each axis (handles negatives)
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < umapPoints.length; i++) {
        const x = umapPoints[i][0];
        const y = umapPoints[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const rangeX = (maxX - minX) || 1; // avoid divide-by-zero
    const rangeY = (maxY - minY) || 1;

    // 2) Map to [0..1], persist on each person for responsive reprojection
    if (Array.isArray(orderedNames) && orderedNames.length === umapPoints.length) {
        for (let i = 0; i < orderedNames.length; i++) {
            const personName = orderedNames[i];
            const normalizedX = Math.max(0, Math.min(1, (umapPoints[i][0] - minX) / rangeX));
            const normalizedY = Math.max(0, Math.min(1, (umapPoints[i][1] - minY) / rangeY));
            people[personName].normalizedX = normalizedX;
            people[personName].normalizedY = normalizedY;
        }
    } else {
        let i = 0;
        for (let personName in people) {
            const normalizedX = Math.max(0, Math.min(1, (umapPoints[i][0] - minX) / rangeX));
            const normalizedY = Math.max(0, Math.min(1, (umapPoints[i][1] - minY) / rangeY));
            people[personName].normalizedX = normalizedX;
            people[personName].normalizedY = normalizedY;
            i++;
        }
    }

    // 3) Convert normalized coords to pixel positions with margins and clamping
    projectNormalizedToCanvasWithMargins();
}



/**
 * Projects stored normalized coordinates (person.normalizedX / normalizedY in [0..1])
 * into canvas pixel positions (person.x / person.y), while:
 * - Respecting a safety margin on all sides
 * - Accounting for each image's width/height so images stay fully visible
 * - Clamping to ensure no part of the image is off-screen
 *
 * This is called after UMAP finishes (via setNormalizedAndProjectToCanvas)
 * and also on window resize so the layout remains responsive without
 * recomputing UMAP.
 */
function projectNormalizedToCanvasWithMargins() {
    if (!canvas) return;
    const margin = 24;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    for (let person in people) {
        const p = people[person];
        if (typeof p.normalizedX !== 'number' || typeof p.normalizedY !== 'number') {
            continue; // nothing to project for this item
        }
        const imgW = p.width || 256;
        const imgH = p.height || 256;
        const usableW = Math.max(0, canvasWidth - imgW - margin * 2);
        // Reserve extra space below for the polaroid caption panel
        const captionExtra = 34;
        const usableH = Math.max(0, canvasHeight - (imgH + captionExtra) - margin * 2);
        const px = margin + p.normalizedX * usableW;
        const py = margin + p.normalizedY * usableH;
        // Clamp to ensure fully visible
        p.x = Math.round(Math.min(canvasWidth - imgW - margin, Math.max(margin, px)));
        p.y = Math.round(Math.min(canvasHeight - imgH - margin - captionExtra, Math.max(margin, py)));
    }
    // Reposition "me" prompt when layout changes
    positionMePromptInput();
}

/**
 * Remove half of the non-"me" people at random, update draw order, save, and rerun UMAP.
 */
function snapClearHalfAndSave() {
    const names = Object.keys(people).filter((n) => n !== 'me');
    if (names.length === 0) return;
    // Shuffle names (Fisher-Yates)
    for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
    }
    const toRemoveCount = Math.ceil(names.length / 2);
    const removeSet = new Set(names.slice(0, toRemoveCount));
    // Delete from people and drawOrder
    for (const name of removeSet) {
        delete people[name];
    }
    drawOrder = drawOrder.filter((n) => n === 'me' || !removeSet.has(n));
    // Save and re-layout
    saveJSONToLocalStorage();
    saveDrawOrderToLocalStorage();
    runUMAP();
}
/**
 * Returns the name of the person under the given canvas coordinates, or null if none.
 * Performs a simple axis-aligned rectangle hit test using each person's x/y/width/height.
 */
function hitTestPersonAt(x, y, preferTopmost = true) {
    // If we prefer the topmost visual element, iterate drawOrder from top to bottom (reverse)
    if (preferTopmost && drawOrder.length) {
        for (let i = drawOrder.length - 1; i >= 0; i--) {
            const name = drawOrder[i];
            const p = people[name];
            if (!p) continue;
            const width = p.width || 256;
            const height = p.height || 256;
            const withinX = x >= p.x && x <= p.x + width;
            const withinY = y >= p.y && y <= p.y + height;
            if (withinX && withinY) return name;
        }
        return null;
    }
    // Otherwise, any order is fine
    for (let personName in people) {
        const p = people[personName];
        const width = p.width || 256;
        const height = p.height || 256;
        const withinX = x >= p.x && x <= p.x + width;
        const withinY = y >= p.y && y <= p.y + height;
        if (withinX && withinY) return personName;
    }
    return null;
}



function saveJSONToLocalStorage() {
    localStorage.setItem('people', JSON.stringify(people));
    console.log("JSON saved to localStorage");
}

function saveDrawOrderToLocalStorage() {
    localStorage.setItem('people_draw_order', JSON.stringify(drawOrder));

}

function loadJSONFromLocalStorage() {

    let loadedJSON = JSON.parse(localStorage.getItem('people'));
    if (!loadedJSON) {
        console.log("No JSON found in localStorage");
        // Initialize draw order empty and hide "me" prompt
        drawOrder = [];
        if (mePromptInput) mePromptInput.style.display = 'none';
        return {};
    }
    for (let person in loadedJSON) {
        const url = loadedJSON[person].imageURL;
        let img = document.createElement("img");
        img.crossOrigin = 'anonymous';
        loadedJSON[person].img = img;
        img.onload = () => { };
        img.onerror = () => {
            console.warn('Image failed to load from storage for', person, url);
        };
        if (url && typeof url === 'string') {
            img.src = url;
        } else {
            // Keep record but don't set src; UI will render a placeholder instead of throwing
            console.warn('Missing imageURL in storage for', person);
        }
    }

    // Load draw order (if present), filter to existing people, and append any missing
    try {
        const storedOrder = JSON.parse(localStorage.getItem('people_draw_order')) || [];
        const filtered = storedOrder.filter((name) => loadedJSON[name]);
        const missing = Object.keys(loadedJSON).filter((name) => !filtered.includes(name));
        drawOrder = filtered.concat(missing);
    } catch (e) {
        // Fallback to natural key order on any error
        drawOrder = Object.keys(loadedJSON);
    }

    return loadedJSON;
}

/**
 * Positions the dedicated "me" prompt input under the "me" image, or hides it if "me" is absent.
 */
function positionMePromptInput() {
    if (!mePromptInput || !canvas) return;
    const meObj = people['me'];
    if (!meObj || typeof meObj.x !== 'number' || typeof meObj.y !== 'number') {
        mePromptInput.style.display = 'none';
        return;
    }
    // Position centered under the "me" image
    const rect = canvas.getBoundingClientRect();
    const inputWidth = meObj.width || 256;
    mePromptInput.style.width = `${inputWidth}px`;
    const leftPx = rect.left + meObj.x + meObj.width / 2 - inputWidth / 2;
    // Align flush beneath the white caption strip (no visual gap)
    const captionOverlap = 6;   // panel starts 6px above image bottom
    const captionHeight = 34;   // panel height used in drawing/projection
    const gap = -1;             // slight overlap to visually merge with the strip
    const bottomOfCaptionCanvasY = meObj.y + meObj.height - captionOverlap + captionHeight;
    const topPx = rect.top + bottomOfCaptionCanvasY + gap;
    mePromptInput.style.left = `${Math.round(leftPx)}px`;
    mePromptInput.style.top = `${Math.round(topPx)}px`;
    mePromptInput.style.display = 'block';
}

