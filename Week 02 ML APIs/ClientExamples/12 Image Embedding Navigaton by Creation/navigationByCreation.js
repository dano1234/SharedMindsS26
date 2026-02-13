
import { UMAP } from "https://cdn.skypack.dev/umap-js";


let canvas;
let inputBox;
let people = {};
let authToken = "";
let hoveredPersonName = null;
// Render stack: names in this array are drawn in order; last entry is on top.
let drawOrder = [];
let mePromptInput = null;
let isUpdatingMe = false;
let statusSpan = null; // compact progress text in the top toolbar

init();

function init() {
    // Perform initialization logic here
    people = loadJSONFromLocalStorage();
    if (Object.keys(people).length > 0) {
        runUMAP(people);
    }
    initInterface();
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
        ctx.drawImage(personObj.img, personObj.x, personObj.y, personObj.width, personObj.height);
        // Special frame for the "me" element to make it stand out
        if (personName === 'me') {
            ctx.save();
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(30, 144, 255, 0.95)'; // dodgerblue
            ctx.shadowColor = 'rgba(30, 144, 255, 0.6)';
            ctx.shadowBlur = 12;
            ctx.strokeRect(
                personObj.x - 4,
                personObj.y - 4,
                personObj.width + 8,
                personObj.height + 8
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
        const subject = (inputBox.value || '').trim();
        if (!subject) {
            alert('Enter a subject in the input box first.');
            return;
        }
        document.body.style.cursor = 'progress';
        const replicateProxy = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';
        const llmPrompt =
            'You are creating 10 characters for a visual canvas. ' +
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

            // 4) Add person
            const img = document.createElement('img');
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
    console.log('canvas', canvas.width, canvas.height);

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
        document.body.style.cursor = hitName ? 'pointer' : 'default';
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
    runUMAPBtn.textContent = 'runUMAP';
    runUMAPBtn.style.zIndex = '100';
    runUMAPBtn.style.fontSize = '16px';
    runUMAPBtn.className = 'ui-btn';
    runUMAPBtn.addEventListener('click', () => {
        try {
            runUMAP();
            saveJSONToLocalStorage();
        } catch (e) {
            console.error('runUMAP button error', e);
            alert('Failed to run UMAP. See console for details.');
        }
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
        try {
            snapClearHalfAndSave();
        } catch (e) {
            console.error('Snap error', e);
            alert('Failed to snap. See console for details.');
        }
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
    // Match the polaroid strip look
    mePromptInput.style.background = 'rgba(255,255,255,0.92)';
    mePromptInput.style.border = '1px solid rgba(0,0,0,0.08)';
    mePromptInput.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
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

    //comes back with a list of embeddings and Sentences, single out the embeddings for UMAP

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
    console.log("embeddings", embeddings);

    //let fittings = runUMAP(embeddings);
    var myrng = new Math.seedrandom('hello.');
    // Cosine distance for high-dimensional embeddings
    const cosineDistance = (a, b) => {
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < a.length; i++) {
            const ai = a[i];
            const bi = b[i];
            dot += ai * bi;
            na += ai * ai;
            nb += bi * bi;
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb) || 1; // avoid divide-by-zero
        const cosineSim = dot / denom;
        return 1 - Math.max(-1, Math.min(1, cosineSim));
    };
    let umap = new UMAP({
        nNeighbors: 3,
        minDist: 0.9,
        nComponents: 2,
        random: myrng,  // special library seeded random so it is deterministic
        spread: 0.99,
        distanceFn: cosineDistance,
    });


    const umap2DPoints = umap.fit(embeddings); // array of [x, y] in UMAP space (arbitrary range)
    console.log("umap2DPoints", umap2DPoints);
    // Normalize and project to pixels (stores normalizedX/Y for responsive resizing)
    setNormalizedAndProjectToCanvas(umap2DPoints, personNames);
    console.log("people", people);
    //console.log("fitting", fitting);
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
async function newPromptFromMe(leadingText) {
    if (isUpdatingMe) return; // guard against rapid double-press
    isUpdatingMe = true;
    const meObj = people['me'];
    if (!meObj) {
        alert('No "me" person found yet. Add people first.');
        isUpdatingMe = false;
        return;
    }
    const leading = (leadingText || '').trim();
    if (!leading) { isUpdatingMe = false; return; }

    // Build new prompt: prepend leading words, drop the same count from the tail
    const numLeadingWords = leading.split(/\s+/).filter(Boolean).length;
    const meWords = (meObj.prompt || '').trim().split(/\s+/).filter(Boolean);
    const keepUpTo = Math.max(0, meWords.length - numLeadingWords);
    const trimmedBase = meWords.slice(0, keepUpTo).join(' ');
    const newPrompt =
        trimmedBase.length > 0 ? `${leading} ${trimmedBase}` : leading;
    meObj.prompt = newPrompt;
    if (mePromptInput) mePromptInput.value = '';

    // Fetch new image and embedding using same proxy flow as batch
    try {
        document.body.style.cursor = 'progress';
        const replicateProxy = 'https://itp-ima-replicate-proxy.web.app/api/create_n_get';

        // 1) Image from prompt
        let data = {
            model: 'google/imagen-4-fast',
            input: { prompt: newPrompt }
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
        let resp = await fetch(replicateProxy, options);
        const imgRes = await resp.json();
        const imageURL = imgRes.output;

        // 2) Embedding for the image URL (same model as batch)
        data = {
            model: 'andreasjansson/clip-features:75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a',
            input: { inputs: imageURL } // use image embedding, not text-of-URL
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

        // 3) Update "me" record in-place
        meObj.imageURL = imageURL;
        meObj.img = meObj.img || document.createElement('img');
        meObj.img.src = imageURL;
        meObj.embedding = embedding; // shape: [{ embedding: number[] }]
        console.log('Updated "me" embedding length:', Array.isArray(embedding) && embedding[0] ? embedding[0].embedding.length : 'unknown');

        // Keep "me" on top visually
        const idx = drawOrder.indexOf('me');
        if (idx !== -1) drawOrder.splice(idx, 1);
        drawOrder.push('me');

        saveJSONToLocalStorage();
        saveDrawOrderToLocalStorage();

        // 4) Recompute UMAP layout with the updated embedding
        if (statusSpan) statusSpan.textContent = 'Fitting layout…';
        runUMAP();
        if (statusSpan) statusSpan.textContent = `Done: ${Object.keys(people).length} people`;
    } catch (e) {
        console.error('newPromptFromMe error', e);
        alert('Failed to update "me" from prompt. See console for details.');
    } finally {
        document.body.style.cursor = 'auto';
        isUpdatingMe = false;
    }
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
    try {
        localStorage.setItem('people_draw_order', JSON.stringify(drawOrder));
    } catch (e) {
        console.warn('Failed to save draw order', e);
    }
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
        let img = document.createElement("img");
        // img.style.position = 'absolute';
        // img.style.left = loadedJSON[person].x + 'px';
        // img.style.top = loadedJSON[person].y + 'px';
        // img.style.width = '256px';
        // img.style.height = '256px';
        loadedJSON[person].img = img;
        img.src = loadedJSON[person].imageURL;

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

