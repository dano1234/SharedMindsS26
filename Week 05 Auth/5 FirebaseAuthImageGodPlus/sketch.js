import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getDatabase, ref, off, update, set, push, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import { getAuth, signOut, setPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

// Global state
let myObjectsByFirebaseKey = {}; // Cache of all items in Firebase
let activeCards = {};            // Map of key -> DOM Persona Card elements
let db, auth, app;
let googleAuthProvider;
let existingSubscribedFolder = null;

const exampleName = "SharedMindsFirebaseAuthImageGodPlus";

// UI references
let canvas;
let ctx;
let snapButton;
let godButton;
let authDiv;
let statusToast;
let isGenerating = false;

init();

function init() {
    initFirebase();
    initInterface();
    animate();
}

// -------------------------------------------------------------
// Animation Loop: Canvas renders subtle connection network
// -------------------------------------------------------------
function animate() {
    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawNetworkConnections(ctx);
    }
    requestAnimationFrame(animate);
}

// Subtle cosmic constellation lines connecting nearby personas
function drawNetworkConnections(ctx) {
    const keys = Object.keys(myObjectsByFirebaseKey);
    for (let i = 0; i < keys.length; i++) {
        const objA = myObjectsByFirebaseKey[keys[i]];
        if (!objA || !objA.position) continue;
        const centerAX = objA.position.x + 48;
        const centerAY = objA.position.y + 48;

        for (let j = i + 1; j < keys.length; j++) {
            const objB = myObjectsByFirebaseKey[keys[j]];
            if (!objB || !objB.position) continue;
            const centerBX = objB.position.x + 48;
            const centerBY = objB.position.y + 48;

            const dist = Math.hypot(centerBX - centerAX, centerBY - centerAY);
            if (dist < 260) {
                const alpha = (1 - dist / 260) * 0.35;
                ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(centerAX, centerAY);
                ctx.lineTo(centerBX, centerBY);
                ctx.stroke();
            }
        }
    }
}

// -------------------------------------------------------------
// REPLICATE GENERATION PIPELINE
// -------------------------------------------------------------

// Helper to fetch an image from Replicate's flux-schnell
async function fetchImageForPrompt(prompt) {
    const replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
    const authToken = "";

    const data = {
        model: "black-forest-labs/flux-schnell",
        input: {
            prompt: prompt
        },
    };
    console.log("Fetching image for prompt:", prompt);
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(data),
    };

    try {
        const raw_response = await fetch(replicateProxy, options);
        const json_response = await raw_response.json();
        console.log("Flux response:", json_response);
        if (json_response && json_response.output) {
            let output = json_response.output;
            if (Array.isArray(output) && output.length > 0) {
                return output[0];
            }
            if (typeof output === "string") {
                return output;
            }
        }
    } catch (err) {
        console.error("Error generating image:", err);
    }
    return null;
}

// Distinguish between real and fake users: append (AI) to fake users
function formatUserName(name, isAI = true) {
    if (!name) return isAI ? "Cyber Adventurer (AI)" : "User";
    const cleanName = name.replace(/\s*\(AI\)$/i, "").trim();
    return isAI ? `${cleanName} (AI)` : cleanName;
}

// Parse LLM text output into structured persona fields
function parsePersonaOutput(text) {
    let name = "";
    let background = "";
    let mission = "";
    let profilePrompt = "";
    let imagePrompt = "";

    const lines = text.split("\n");
    let currentField = null;

    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;

        let lower = trimmed.toLowerCase();
        if (lower.startsWith("name:")) {
            currentField = "name";
            name = trimmed.substring(5).replace(/^\*+|\*+$/g, "").trim();
        } else if (lower.startsWith("background:")) {
            currentField = "background";
            background = trimmed.substring(11).replace(/^\*+|\*+$/g, "").trim();
        } else if (lower.startsWith("mission:") || lower.startsWith("mission in life:")) {
            currentField = "mission";
            let colonIdx = trimmed.indexOf(":");
            mission = trimmed.substring(colonIdx + 1).replace(/^\*+|\*+$/g, "").trim();
        } else if (lower.startsWith("profile prompt:") || lower.startsWith("profile picture prompt:")) {
            currentField = "profilePrompt";
            let colonIdx = trimmed.indexOf(":");
            profilePrompt = trimmed.substring(colonIdx + 1).replace(/^\*+|\*+$/g, "").trim();
        } else if (lower.startsWith("image prompt:") || lower.startsWith("prompt:")) {
            currentField = "imagePrompt";
            let colonIdx = trimmed.indexOf(":");
            imagePrompt = trimmed.substring(colonIdx + 1).replace(/^\*+|\*+$/g, "").trim();
        } else if (currentField) {
            let extra = trimmed.replace(/^\*+|\*+$/g, "").trim();
            if (currentField === "background") background += " " + extra;
            else if (currentField === "mission") mission += " " + extra;
            else if (currentField === "profilePrompt") profilePrompt += " " + extra;
            else if (currentField === "imagePrompt") imagePrompt += " " + extra;
        }
    }

    if (!name) name = "Cyber Adventurer";
    if (!background) background = "An enigmatic digital wanderer discovering new frontiers in shared cyberspace.";
    if (!mission) mission = "To connect isolated minds across the cosmic network.";

    return { name, background, mission, profilePrompt, imagePrompt };
}

// Step 1: Ask LLM for fake name, fake background, fake mission in life
async function generatePersonaBase(concept) {
    const replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
    const promptText = `You are a world-building character creator. Inspired by the concept "${concept}", generate a creative fictional persona.
Strictly format your response like this:
Name: <Full fake character name>
Background: <2-3 sentences about their origin, history, and personality>
Mission: <1-2 sentences about their ultimate life quest or driving mission>
Profile Prompt: <A prompt for a photorealistic headshot portrait of a real human being representing this character. Describe their authentic human face, age, facial features, hair, eyes, natural skin texture, and soft lighting. It must look like an authentic photographic portrait of a real person taken with a 35mm lens, looking at the camera. Do NOT make it an abstract image, landscape, illustration, or cartoon.>
Do not include any conversational filler, quotes, or markdown headers.`;

    const data = {
        model: "meta/meta-llama-3-70b-instruct",
        input: {
            prompt: promptText,
            max_tokens: 350
        }
    };

    try {
        const response = await fetch(replicateProxy, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(data)
        });
        const json = await response.json();
        if (json && json.output) {
            let outputText = Array.isArray(json.output) ? json.output.join("") : json.output;
            let persona = parsePersonaOutput(outputText);
            if (persona && persona.name) {
                return persona;
            }
        }
    } catch (err) {
        console.warn("LLM Persona base generation error:", err);
    }

    return getFallbackPersona(concept);
}

// Step 2: Ask Flux for a fake profile picture (photorealistic human portrait)
async function generateProfilePicture(persona) {
    let rawPrompt = (persona.profilePrompt || "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
    let prompt = "";

    if (!rawPrompt || rawPrompt.length < 10) {
        prompt = `A photorealistic headshot portrait of a real person, ${persona.name}, authentic human face, natural skin texture, realistic eyes, soft studio lighting, looking directly into the camera, 35mm portrait photography, highly detailed`;
    } else {
        prompt = `A photorealistic headshot portrait photograph of a real person: ${rawPrompt}. Authentic human face, realistic skin texture, natural eyes, looking at camera, shallow depth of field, 35mm portrait photograph, natural lighting, highly detailed photo`;
    }

    console.log("Generating profile picture with prompt:", prompt);
    let url = await fetchImageForPrompt(prompt);
    if (!url) {
        url = getFallbackAvatarUrl(persona.name);
    }
    return url;
}

// Step 3a: Ask LLM for an image prompt (like we do now)
async function generateImagePrompt(persona, concept) {
    const replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
    const promptText = `Character: ${persona.name}
Theme: ${concept}
Background: ${persona.background}
Mission: ${persona.mission}
Create a single vivid, detailed visual image prompt for Flux describing an artwork or scene showing their creation, journey, or life mission in action. Output only the prompt text itself without quotation marks.`;

    const data = {
        model: "meta/meta-llama-3-70b-instruct",
        input: {
            prompt: promptText,
            max_tokens: 150
        }
    };

    try {
        const response = await fetch(replicateProxy, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(data)
        });
        const json = await response.json();
        if (json && json.output) {
            let outputText = Array.isArray(json.output) ? json.output.join("") : json.output;
            outputText = outputText.replace(/^["'\s]+|["'\s]+$/g, "").trim();
            if (outputText) return outputText;
        }
    } catch (err) {
        console.warn("LLM Image prompt generation error:", err);
    }

    return persona.imagePrompt || `Vivid visual scene of ${persona.name} pursuing their mission: ${persona.mission.slice(0, 100)}, epic cinematic lighting, 8k resolution`;
}

// Step 3b: Ask Flux for the image from that prompt
async function generateImageFromPrompt(imagePrompt) {
    console.log("Generating image for prompt:", imagePrompt);
    let url = await fetchImageForPrompt(imagePrompt);
    if (!url) {
        url = getFallbackSceneUrl(imagePrompt);
    }
    return url;
}

// The Complete Generation Chain:
// 1. Fake name, background, mission in life (LLM)
// 2. Fake profile picture (Flux)
// 3. Image prompt (LLM) and image from prompt (Flux)
async function runPersonaChain(concept, location) {
    if (isGenerating) {
        console.log("Generation already in progress...");
        return;
    }
    isGenerating = true;
    document.body.style.cursor = "progress";
    if (godButton) godButton.classList.add('is-working');

    try {
        // Step 1: Ask for fake name, fake background, fake mission in life
        showStatus(`1/4: Asking LLM for fake name, background & mission in life...`);
        const persona = await generatePersonaBase(concept);
        console.log("Step 1 Persona:", persona);

        // Step 2: Ask for a fake profile picture
        showStatus(`2/4: Asking Flux for fake profile picture for ${persona.name}...`);
        const profilePictureURL = await generateProfilePicture(persona);
        console.log("Step 2 Profile Picture URL:", profilePictureURL);

        // Step 3a: Ask LLM for an image prompt (like we do now)
        showStatus(`3/4: Asking LLM for vision prompt for ${persona.name}...`);
        const imagePrompt = await generateImagePrompt(persona, concept);
        console.log("Step 3a Image Prompt:", imagePrompt);

        // Step 3b: Ask Flux for an image from that prompt
        showStatus(`4/4: Painting image from prompt for ${persona.name}...`);
        const imageURL = await generateImageFromPrompt(imagePrompt);
        console.log("Step 3b Image URL:", imageURL);

        // Save to Firebase!
        if (!location) {
            location = getRandomSafeLocation();
        }

        const aiName = formatUserName(persona.name, true);

        const personaData = {
            type: "persona",
            isAI: true,
            name: aiName,
            userName: aiName, // backward compatibility
            background: persona.background,
            mission: persona.mission,
            profilePrompt: persona.profilePrompt || "",
            profilePictureURL: profilePictureURL,
            prompt: imagePrompt,
            imageURL: imageURL,
            position: location,
            createdAt: Date.now()
        };

        showStatus(`Saving ${aiName} to Firebase...`);
        const key = addNewThingToFirebase(exampleName + "/", personaData);
        console.log("Saved persona to Firebase with key:", key);

        showStatus(`✨ ${aiName} created! Hover or click their avatar to view & edit details.`, false);
        hideStatus(5000);
    } catch (err) {
        console.error("Chain error:", err);
        showStatus(`⚠️ Error during generation: ${err.message}`, false);
        hideStatus(4000);
    } finally {
        isGenerating = false;
        document.body.style.cursor = "auto";
        if (godButton) godButton.classList.remove('is-working');
    }
}

// "GOD" function: dreams up creative themes and runs the chain
async function askGod() {
    if (isGenerating) {
        console.log("GOD is already working, please wait...");
        return;
    }

    const themes = [
        "bioluminescent underwater metropolis",
        "steampunk clockwork airships",
        "cyberpunk street food market in neon rain",
        "ancient alien greenhouse in the desert",
        "cosmic dream observatory floating in space",
        "desert crystal alchemist in glowing caverns",
        "intergalactic antique collector on Mars",
        "quantum dream weaver repairing fractured timelines",
        "solarpunk sky garden botanist",
        "cybernetic ronin wandering holographic ruins"
    ];
    const concept = themes[Math.floor(Math.random() * themes.length)];

    const safePos = getRandomSafeLocation();
    await runPersonaChain(concept, safePos);
}

// -------------------------------------------------------------
// FALLBACK HELPERS (Resilient offline/error fallbacks)
// -------------------------------------------------------------
function getFallbackPersona(theme) {
    const list = [
        {
            name: "Kaida 'Glitch' Yamato",
            background: "A rogue cybernetic hacker operating from the rain-slick rooftops of Neo-Edo. Merged with an experimental quantum neural link.",
            mission: "To dismantle oppressive data monopolies and broadcast digital freedom to the masses.",
            profilePrompt: "A realistic photographic headshot portrait of a Japanese woman in her late 20s, dark hair with subtle neon highlights, authentic human skin texture, expressive brown eyes, soft studio lighting, looking at camera, 35mm portrait photography",
            imagePrompt: "Kaida Yamato standing on a skyscraper rooftop in a neon-drenched futuristic cyberpunk city, slicing holographic code streams, 8k"
        },
        {
            name: "Captain Zephyr Vance",
            background: "A solar sailor who charted the golden cloud canyons of upper Venus using antique brass astrolabes and solar sails.",
            mission: "To discover the legendary singing auroras at the edge of the solar system.",
            profilePrompt: "A realistic photographic headshot portrait of a weather-worn man in his early 40s with a rugged trimmed beard, kind hazel eyes, authentic facial features and skin details, looking at camera, 35mm portrait photography",
            imagePrompt: "A majestic brass solar sail ship sailing through golden glowing clouds above Venus, lens flare, epic cinematic scale"
        },
        {
            name: "Dr. Seraphina Solis",
            background: "A bio-alchemist who cultivates luminescent flora that convert cosmic radiation into pure harmonic energy.",
            mission: "To restore dead moons into thriving, breathing crystalline biospheres.",
            profilePrompt: "A realistic photographic headshot portrait of a woman in her 30s with curly dark hair, gentle confident smile, authentic human face, natural lighting, looking into the camera, 35mm portrait photo",
            imagePrompt: "A massive crystalline dome greenhouse on a dark moon glowing with vibrant alien bioluminescent flowers, ultra-detailed"
        }
    ];
    return list[Math.floor(Math.random() * list.length)];
}

function getFallbackAvatarUrl(name) {
    return `https://i.pravatar.cc/300?u=${encodeURIComponent(name)}`;
}

function getFallbackSceneUrl(prompt) {
    return `https://picsum.photos/seed/${encodeURIComponent((prompt || "scene").slice(0, 10))}/512/512`;
}

function getRandomSafeLocation() {
    const padding = 100;
    const maxX = Math.max(120, window.innerWidth - 360);
    const maxY = Math.max(120, window.innerHeight - 280);
    return {
        x: Math.floor(Math.random() * (maxX - padding) + padding),
        y: Math.floor(Math.random() * (maxY - padding) + padding)
    };
}

// -------------------------------------------------------------
// STATUS TOAST
// -------------------------------------------------------------
function showStatus(message, isWorking = true) {
    if (!statusToast) return;
    statusToast.innerHTML = (isWorking ? '<span class="spinner"></span> ' : '') + message;
    statusToast.classList.add('visible');
}

function hideStatus(delay = 3500) {
    setTimeout(() => {
        if (statusToast) statusToast.classList.remove('visible');
    }, delay);
}

// -------------------------------------------------------------
// DOM PERSONA CARD CREATION & HOVER HANDLING
// 1. Profile Picture and Name displayed on screen
// 2. Additional Info Modal:
//    - Image from prompt at the TOP
//    - Image prompt editable for logged-in user + Regenerate button
//    - Background
//    - Mission in life
// -------------------------------------------------------------
function createOrUpdatePersonaCard(key, data) {
    let card = activeCards[key];
    const position = data.position || { x: 120, y: 120 };
    const isAI = data.isAI !== false; // Default true (fake persona) unless explicitly false (real user)
    const rawName = data.name || data.userName || (isAI ? "Persona" : "User");
    const displayName = formatUserName(rawName, isAI);
    const profilePic = data.profilePictureURL || data.imageURL || getFallbackAvatarUrl(rawName);
    const background = data.background || "";
    const mission = data.mission || "";
    const prompt = data.prompt || "";
    const imageURL = data.imageURL || "";
    const isLoggedIn = !!(auth && auth.currentUser);

    if (!card) {
        card = document.createElement('div');
        card.className = 'persona-card' + (isAI ? ' is-ai-persona' : ' is-real-user');
        card.id = 'persona_' + key;
        card.setAttribute('data-key', key);

        card.innerHTML = `
            <!-- Screen Display: Profile Picture and Name -->
            <div class="persona-avatar-wrapper" title="Click to pin details, hover to view">
                <img class="persona-avatar-img" src="${profilePic}" alt="${displayName}" loading="lazy" />
            </div>
            <div class="persona-name-badge">${displayName}</div>

            <!-- Additional Info Modal: Revealed on mouseover / click -->
            <div class="persona-details-popover">
                <!-- Header -->
                <div class="popover-header">
                    <img class="popover-mini-avatar" src="${profilePic}" alt="${displayName}" />
                    <div class="popover-title-group">
                        <div class="popover-name">${displayName}</div>
                        <div class="popover-role-tag ${isAI ? 'ai' : 'human'}">${isAI ? 'AI Persona' : 'Real User'}</div>
                    </div>
                    <button class="popover-delete-btn" title="Delete Persona" data-delete-key="${key}">✕</button>
                </div>

                <!-- 1. IMAGE FROM PROMPT (AT THE TOP) -->
                <div class="popover-section">
                    <div class="popover-label">🖼️ Image from Prompt</div>
                    <div class="popover-prompt-image-container">
                        <div class="popover-prompt-image-placeholder" style="${imageURL ? 'display:none;' : 'display:flex;'}">
                            <span style="font-size:24px;">🎨</span>
                            <span>No image generated yet.</span>
                            <span style="font-size:11px;color:#94a3b8;">Enter a prompt below and click "Regenerate Image"!</span>
                        </div>
                        <img class="popover-prompt-image" src="${imageURL}" alt="${prompt}" loading="lazy" style="${imageURL ? 'display:block;' : 'display:none;'}" />
                        <div class="image-loading-overlay">
                            <span class="spinner"></span>
                            <span>Painting with Flux...</span>
                        </div>
                    </div>
                </div>

                <!-- 2. EDITABLE IMAGE PROMPT (FOR LOGGED IN PERSON) -->
                <div class="popover-section popover-prompt-section">
                    <div class="popover-label">
                        ✨ Image Prompt ${isLoggedIn ? '<span style="color:#38bdf8;font-size:10px;font-weight:normal;text-transform:none;">(Editable)</span>' : ''}
                    </div>
                    <textarea class="popover-prompt-input" rows="3" placeholder="Enter image prompt..." ${isLoggedIn ? '' : 'readonly'}>${prompt}</textarea>
                    
                    <div class="popover-prompt-actions" style="${isLoggedIn ? 'display:flex;' : 'display:none;'}">
                        <button class="popover-regen-btn" type="button">🎨 Regenerate Image</button>
                    </div>
                    <div class="popover-auth-hint" style="${isLoggedIn ? 'display:none;' : 'display:block;'}">
                        🔒 Log in above to edit prompt & regenerate image
                    </div>
                </div>

                <!-- 3. BACKGROUND -->
                <div class="popover-section">
                    <div class="popover-label">📜 Background</div>
                    ${(!isAI && isLoggedIn) ? 
                        `<textarea class="popover-field-input popover-background-input" rows="2" placeholder="Add your background story...">${background}</textarea>` :
                        `<div class="popover-text ${!background ? 'is-empty' : ''}">${background || '(No background provided yet)'}</div>`
                    }
                </div>

                <!-- 4. MISSION IN LIFE -->
                <div class="popover-section">
                    <div class="popover-label">🎯 Mission in Life</div>
                    ${(!isAI && isLoggedIn) ? 
                        `<textarea class="popover-field-input popover-mission-input" rows="2" placeholder="Add your mission in life...">${mission}</textarea>` :
                        `<div class="popover-mission ${!mission ? 'is-empty' : ''}">${mission ? `"${mission}"` : '(No mission entered yet)'}</div>`
                    }
                </div>
            </div>
        `;

        document.body.appendChild(card);
        activeCards[key] = card;

        // Setup Card Event Handlers
        setupCardEvents(card, key, data);
    } else {
        // Update existing card elements if data changed remotely
        updateCardContent(card, data);
    }

    card.style.left = position.x + 'px';
    card.style.top = position.y + 'px';
}

function updateCardContent(card, data) {
    const isAI = data.isAI !== false;
    const rawName = data.name || data.userName || (isAI ? "Persona" : "User");
    const displayName = formatUserName(rawName, isAI);
    const profilePic = data.profilePictureURL || data.imageURL || getFallbackAvatarUrl(rawName);
    const imageURL = data.imageURL || "";

    const nameBadge = card.querySelector('.persona-name-badge');
    if (nameBadge && nameBadge.textContent !== displayName) nameBadge.textContent = displayName;

    const popoverName = card.querySelector('.popover-name');
    if (popoverName && popoverName.textContent !== displayName) popoverName.textContent = displayName;

    const roleTag = card.querySelector('.popover-role-tag');
    if (roleTag) {
        roleTag.className = 'popover-role-tag ' + (isAI ? 'ai' : 'human');
        roleTag.textContent = isAI ? 'AI Persona' : 'Real User';
    }

    const avatarImg = card.querySelector('.persona-avatar-img');
    if (avatarImg && avatarImg.src !== profilePic) avatarImg.src = profilePic;

    const popoverPromptImg = card.querySelector('.popover-prompt-image');
    const placeholder = card.querySelector('.popover-prompt-image-placeholder');
    if (popoverPromptImg) {
        if (imageURL) {
            if (popoverPromptImg.src !== imageURL) popoverPromptImg.src = imageURL;
            popoverPromptImg.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            popoverPromptImg.style.display = 'none';
            if (placeholder) placeholder.style.display = 'flex';
        }
    }

    const promptInput = card.querySelector('.popover-prompt-input');
    if (promptInput && document.activeElement !== promptInput && data.prompt && promptInput.value !== data.prompt) {
        promptInput.value = data.prompt;
    }
}

// Setup interactions: drag, hover flip, pin-on-click, delete, prompt regeneration, and bio/mission editing
function setupCardEvents(card, key, data) {
    const popover = card.querySelector('.persona-details-popover');
    const avatarWrapper = card.querySelector('.persona-avatar-wrapper');
    const promptInput = card.querySelector('.popover-prompt-input');
    const regenBtn = card.querySelector('.popover-regen-btn');
    const imgEl = card.querySelector('.popover-prompt-image');
    const placeholder = card.querySelector('.popover-prompt-image-placeholder');
    const loadingOverlay = card.querySelector('.image-loading-overlay');
    const deleteBtn = card.querySelector('.popover-delete-btn');
    const bgInput = card.querySelector('.popover-background-input');
    const missionInput = card.querySelector('.popover-mission-input');

    // 1. Smart Popover Positioning on Mouseenter
    card.addEventListener('mouseenter', () => {
        if (!popover) return;
        const rect = card.getBoundingClientRect();

        // Flip to left if too close to right edge
        if (rect.left + 120 + 340 > window.innerWidth) {
            popover.classList.add('popover-flip-left');
        } else {
            popover.classList.remove('popover-flip-left');
        }

        // Flip upward if too close to bottom edge
        if (rect.top + 520 > window.innerHeight) {
            popover.classList.add('popover-flip-up');
        } else {
            popover.classList.remove('popover-flip-up');
        }
    });

    // 2. Click avatar to pin/unpin modal open
    avatarWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.toggle('popover-pinned');
    });

    // 3. Stop clicks inside popover from closing it or triggering drag
    popover.addEventListener('mousedown', (e) => e.stopPropagation());
    popover.addEventListener('click', (e) => e.stopPropagation());

    // 4. Delete button handler
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = data.name || data.userName || "Persona";
            if (confirm(`Remove "${name}" from canvas?`)) {
                deleteFromFirebase(exampleName, key);
            }
        });
    }

    // 5. Background & Mission live saving for real users
    if (bgInput) {
        bgInput.addEventListener('mousedown', (e) => e.stopPropagation());
        bgInput.addEventListener('click', (e) => e.stopPropagation());
        bgInput.addEventListener('change', () => {
            const val = bgInput.value.trim();
            data.background = val;
            updateJSONFieldInFirebase(exampleName + "/" + key + "/", { background: val });
        });
    }

    if (missionInput) {
        missionInput.addEventListener('mousedown', (e) => e.stopPropagation());
        missionInput.addEventListener('click', (e) => e.stopPropagation());
        missionInput.addEventListener('change', () => {
            const val = missionInput.value.trim();
            data.mission = val;
            updateJSONFieldInFirebase(exampleName + "/" + key + "/", { mission: val });
        });
    }

    // 6. Prompt Textarea & Regenerate Button Handlers
    if (promptInput) {
        promptInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                triggerRegenerate();
            }
        });
    }

    if (regenBtn) {
        regenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerRegenerate();
        });
    }

    async function triggerRegenerate() {
        if (!auth.currentUser) {
            showStatus("Please log in above to edit and regenerate image", false);
            hideStatus(3000);
            return;
        }

        const newPrompt = promptInput.value.trim();
        if (!newPrompt) {
            showStatus("Please enter an image prompt first.", false);
            hideStatus(2500);
            return;
        }

        if (regenBtn) {
            regenBtn.disabled = true;
            regenBtn.innerHTML = '<span class="spinner"></span> Painting...';
        }
        if (loadingOverlay) loadingOverlay.style.display = 'flex';

        showStatus(`🎨 Generating new image for "${data.name || 'Persona'}"...`);

        try {
            const newImageURL = await fetchImageForPrompt(newPrompt);
            if (newImageURL) {
                imgEl.src = newImageURL;
                imgEl.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                data.prompt = newPrompt;
                data.imageURL = newImageURL;

                // Sync new prompt and image to Firebase!
                await updateJSONFieldInFirebase(exampleName + "/" + key + "/", {
                    prompt: newPrompt,
                    imageURL: newImageURL
                });

                showStatus(`✨ Image regenerated for "${data.name || 'Persona'}"!`, false);
                hideStatus(3500);
            } else {
                showStatus("⚠️ Could not generate image, please try again.", false);
                hideStatus(3500);
            }
        } catch (err) {
            console.error("Error regenerating image:", err);
            showStatus(`⚠️ Error: ${err.message}`, false);
            hideStatus(3500);
        } finally {
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            if (regenBtn) {
                regenBtn.disabled = false;
                regenBtn.innerHTML = '🎨 Regenerate Image';
            }
        }
    }

    // 7. Card Dragging (syncs position to Firebase)
    attachCardDragHandlers(card, key, data);
}

// Drag & drop cards on canvas, sync position to Firebase
function attachCardDragHandlers(card, key, data) {
    let startMouseX = 0;
    let startMouseY = 0;
    let startPosX = 0;
    let startPosY = 0;
    let isDraggingThis = false;

    card.addEventListener('mousedown', (e) => {
        if (e.target.closest('.persona-details-popover')) {
            return;
        }
        e.stopPropagation();
        isDraggingThis = true;
        card.classList.add('is-dragging');
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startPosX = parseFloat(card.style.left) || (data.position ? data.position.x : 0);
        startPosY = parseFloat(card.style.top) || (data.position ? data.position.y : 0);

        function onMouseMove(moveEvent) {
            if (!isDraggingThis) return;
            const dx = moveEvent.clientX - startMouseX;
            const dy = moveEvent.clientY - startMouseY;
            const currentX = Math.round(startPosX + dx);
            const currentY = Math.round(startPosY + dy);
            card.style.left = currentX + 'px';
            card.style.top = currentY + 'px';
            if (!data.position) data.position = {};
            data.position.x = currentX;
            data.position.y = currentY;
        }

        function onMouseUp(upEvent) {
            if (!isDraggingThis) return;
            isDraggingThis = false;
            card.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            const dx = upEvent.clientX - startMouseX;
            const dy = upEvent.clientY - startMouseY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                const finalX = Math.round(startPosX + dx);
                const finalY = Math.round(startPosY + dy);
                updateJSONFieldInFirebase(exampleName + "/" + key + "/position/", { x: finalX, y: finalY });
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}

// Update all modal prompt inputs when user logs in or out
function updateAllCardsAuthMode(isLoggedIn) {
    for (let key in activeCards) {
        const card = activeCards[key];
        if (!card) continue;
        const promptInput = card.querySelector('.popover-prompt-input');
        const actionsDiv = card.querySelector('.popover-prompt-actions');
        const authHint = card.querySelector('.popover-auth-hint');
        const promptLabel = card.querySelector('.popover-prompt-section .popover-label');

        if (promptInput) {
            if (isLoggedIn) {
                promptInput.removeAttribute('readonly');
            } else {
                promptInput.setAttribute('readonly', 'true');
            }
        }
        if (actionsDiv) actionsDiv.style.display = isLoggedIn ? 'flex' : 'none';
        if (authHint) authHint.style.display = isLoggedIn ? 'none' : 'block';
        if (promptLabel) {
            promptLabel.innerHTML = `✨ Image Prompt ${isLoggedIn ? '<span style="color:#38bdf8;font-size:10px;font-weight:normal;text-transform:none;">(Editable)</span>' : ''}`;
        }
    }
}

// -------------------------------------------------------------
// INTERFACE INITIALIZATION
// -------------------------------------------------------------
function initInterface() {
    // 1. Canvas setup
    canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'myCanvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx = canvas.getContext('2d');
    document.body.appendChild(canvas);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    // 2. Status Toast for Chain Steps & Notifications
    statusToast = document.createElement('div');
    statusToast.setAttribute('id', 'statusToast');
    document.body.appendChild(statusToast);

    // 3. GOD Button
    godButton = document.createElement('button');
    godButton.textContent = '✨ GOD';
    godButton.setAttribute('id', 'godButton');
    godButton.className = 'top-bar-button';
    godButton.title = 'Dream up a new persona with profile picture and image artwork';
    document.body.appendChild(godButton);

    godButton.addEventListener('mousedown', (e) => e.stopPropagation());
    godButton.addEventListener('dblclick', (e) => e.stopPropagation());
    godButton.addEventListener('click', () => {
        askGod();
    });

    // 4. Snap Button (Thanos Snap)
    snapButton = document.createElement('button');
    snapButton.textContent = '🫰 Snap';
    snapButton.setAttribute('id', 'snapButton');
    snapButton.className = 'top-bar-button';
    snapButton.title = 'Snap half of the personas out of existence';
    document.body.appendChild(snapButton);

    snapButton.addEventListener('mousedown', (e) => e.stopPropagation());
    snapButton.addEventListener('dblclick', (e) => e.stopPropagation());
    snapButton.addEventListener('click', () => {
        const keys = Object.keys(myObjectsByFirebaseKey);
        if (keys.length === 0) {
            showStatus("No personas to snap! Click GOD to create some.", false);
            hideStatus(2500);
            return;
        }
        const halfCount = Math.ceil(keys.length / 2);
        const shuffled = keys.sort(() => Math.random() - 0.5);
        const toDelete = shuffled.slice(0, halfCount);

        for (let key of toDelete) {
            deleteFromFirebase(exampleName, key);
        }
        showStatus(`Snapped ${toDelete.length} personas out of existence! 🫰`, false);
        hideStatus(3000);
    });

    // 5. Auth Box
    authDiv = document.createElement("div");
    authDiv.setAttribute("id", "authDiv");
    document.body.appendChild(authDiv);

    authDiv.addEventListener('mousedown', (e) => e.stopPropagation());
    authDiv.addEventListener('dblclick', (e) => e.stopPropagation());

    // 6. Bottom Navigation Hint
    const bottomHint = document.createElement('div');
    bottomHint.setAttribute('id', 'bottomHint');
    bottomHint.textContent = '💡 Click GOD to dream up a persona • Hover or click avatar for details • Log in to edit prompts & regenerate • Drag to arrange';
    document.body.appendChild(bottomHint);

    // 7. Clicking outside unpins any pinned modal
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.persona-card')) {
            document.querySelectorAll('.persona-card.popover-pinned').forEach(c => {
                c.classList.remove('popover-pinned');
            });
        }
    });
}

// -------------------------------------------------------------
// FIREBASE & AUTHENTICATION
// -------------------------------------------------------------
function initFirebase() {
    const firebaseConfig = {
        apiKey: "AIzaSyDHOrU4Lrtlmk-Af2svvlP8RiGsGvBLb_Q",
        authDomain: "sharedmindss24.firebaseapp.com",
        databaseURL: "https://sharedmindss24-default-rtdb.firebaseio.com",
        projectId: "sharedmindss24",
        storageBucket: "sharedmindss24.appspot.com",
        messagingSenderId: "1039430447930",
        appId: "1:1039430447930:web:edf98d7d993c21017ad603"
    };

    app = initializeApp(firebaseConfig);
    db = getDatabase();
    auth = getAuth();
    setPersistence(auth, browserSessionPersistence);
    googleAuthProvider = new GoogleAuthProvider();

    subscribeToData();
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("user is signed in", user);
        showLogOutButton(user);
        ensureUserCardExists(user);
    } else {
        console.log("user is signed out");
        showLoginButtons();
    }
    // Update all persona modals so prompt input becomes editable/readonly
    updateAllCardsAuthMode(!!user);
});

// When a new person logs on, give them all blanks except their name from login information
function ensureUserCardExists(user) {
    const realName = user.displayName || (user.email ? user.email.split('@')[0] : "User");

    // Check if card for this user already exists in Firebase
    const existingKey = Object.keys(myObjectsByFirebaseKey).find(key => {
        const item = myObjectsByFirebaseKey[key];
        return item && (item.creatorUid === user.uid || (!item.isAI && item.name === realName));
    });

    if (existingKey) {
        console.log("User card already exists on canvas:", existingKey);
        return;
    }

    const safePos = getRandomSafeLocation();
    const defaultAvatar = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(realName)}&backgroundColor=6366f1`;

    const userCardData = {
        type: "user",
        isAI: false, // REAL USER - no (AI) attached!
        creatorUid: user.uid,
        name: realName,
        userName: realName,
        profilePictureURL: defaultAvatar,
        background: "", // blank!
        mission: "",    // blank!
        prompt: "",     // blank!
        imageURL: "",   // blank!
        position: safePos,
        createdAt: Date.now()
    };

    console.log("Auto-creating blank card on canvas for new logged-in user:", realName);
    addNewThingToFirebase(exampleName + "/", userCardData);
    showStatus(`Welcome, ${realName}! Your profile card is on the canvas.`, false);
    hideStatus(3500);
}

function showLogOutButton(user) {
    authDiv.innerHTML = "";
    let userNameDiv = document.createElement("div");
    userNameDiv.style.marginBottom = "8px";
    userNameDiv.style.fontWeight = "600";

    if (user.photoURL) {
        let userPic = document.createElement("img");
        userPic.src = user.photoURL;
        userPic.style.width = "40px";
        userPic.style.height = "40px";
        userPic.style.borderRadius = "50%";
        userPic.style.display = "block";
        userPic.style.marginBottom = "6px";
        authDiv.appendChild(userPic);
    }
    const realName = user.displayName || user.email || "Logged In";
    userNameDiv.innerHTML = `${realName} <span style="color:#34d399;font-size:11px;font-weight:normal;">(Real User)</span>`;
    authDiv.appendChild(userNameDiv);

    let logOutButton = document.createElement("button");
    logOutButton.innerHTML = "Log Out";
    logOutButton.setAttribute("id", "logOut");
    logOutButton.setAttribute("class", "authButton");
    authDiv.appendChild(logOutButton);

    logOutButton.addEventListener("click", function () {
        signOut(auth).then(() => {
            console.log("signed out");
        }).catch((error) => {
            console.log("error signing out", error);
        });
    });
}

// Predefined real user profiles for Quick "Login As"
const predefinedUsers = [
    { name: "Alice Walker", email: "alice@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=alice" },
    { name: "Bob Chen", email: "bob@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=bob" },
    { name: "Charlie Davis", email: "charlie@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=charlie" },
    { name: "Dana Scully", email: "dana@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=dana" },
    { name: "Elena Rostova", email: "elena@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=elena" },
    { name: "Marcus Vance", email: "marcus@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=marcus" },
    { name: "Guest Explorer", email: "guest@sharedminds.com", password: "password123", photoURL: "https://i.pravatar.cc/150?u=guest" }
];

async function performLoginAs(userData) {
    showStatus(`Logging in as ${userData.name}...`);
    try {
        let userCred;
        try {
            userCred = await signInWithEmailAndPassword(auth, userData.email, userData.password);
        } catch (signInErr) {
            // If user doesn't exist yet in Firebase, auto-create account
            if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/invalid-login-credentials') {
                userCred = await createUserWithEmailAndPassword(auth, userData.email, userData.password);
            } else {
                throw signInErr;
            }
        }

        if (userCred && userCred.user) {
            await updateProfile(userCred.user, {
                displayName: userData.name,
                photoURL: userData.photoURL
            });
        }
        showStatus(`Signed in as ${userData.name}!`, false);
        hideStatus(2500);
    } catch (err) {
        console.error("Login As error:", err);
        // Fallback attempt: create and set profile
        try {
            let cred = await createUserWithEmailAndPassword(auth, userData.email, userData.password);
            await updateProfile(cred.user, { displayName: userData.name, photoURL: userData.photoURL });
            showStatus(`Signed in as ${userData.name}!`, false);
            hideStatus(2500);
        } catch (createErr) {
            showStatus(`Login failed: ${err.message}`, false);
            hideStatus(3500);
        }
    }
}

function showLoginButtons() {
    authDiv.innerHTML = "";

    // 1. Google Login
    let signUpWithGoogleButton = document.createElement("button");
    signUpWithGoogleButton.innerHTML = "Google Login";
    signUpWithGoogleButton.setAttribute("id", "signInWithGoogle");
    signUpWithGoogleButton.setAttribute("class", "authButton");
    authDiv.appendChild(signUpWithGoogleButton);

    // 2. Email Sign In / Sign Up
    let emailDiv = document.createElement("div");
    emailDiv.style.marginTop = "8px";
    emailDiv.style.fontWeight = "600";
    emailDiv.innerHTML = "Email Sign In";
    authDiv.appendChild(emailDiv);

    let emailInput = document.createElement("input");
    emailInput.setAttribute("id", "email");
    emailInput.setAttribute("class", "authInput");
    emailInput.setAttribute("type", "text");
    emailInput.setAttribute("placeholder", "email@domain.com");
    authDiv.appendChild(emailInput);

    let passwordInput = document.createElement("input");
    passwordInput.setAttribute("id", "password");
    passwordInput.setAttribute("type", "password");
    passwordInput.setAttribute("class", "authInput");
    passwordInput.setAttribute("placeholder", "password");
    passwordInput.setAttribute("autocomplete", "on");
    authDiv.appendChild(passwordInput);

    let signUpWithEmailButton = document.createElement("button");
    signUpWithEmailButton.innerHTML = "Sign Up";
    signUpWithEmailButton.setAttribute("id", "signUpWithEmail");
    signUpWithEmailButton.setAttribute("class", "authButton");
    authDiv.appendChild(signUpWithEmailButton);

    let signInWithEmailButton = document.createElement("button");
    signInWithEmailButton.innerHTML = "Sign In";
    signInWithEmailButton.setAttribute("id", "signInWithEmail");
    signInWithEmailButton.setAttribute("class", "authButton");
    authDiv.appendChild(signInWithEmailButton);

    // 3. "Login As" Section with pull-down menu
    let divider = document.createElement("hr");
    divider.className = "authDivider";
    authDiv.appendChild(divider);

    let loginAsLabel = document.createElement("div");
    loginAsLabel.className = "authSubHeader";
    loginAsLabel.textContent = "Or Quick Login As:";
    authDiv.appendChild(loginAsLabel);

    let loginAsSelect = document.createElement("select");
    loginAsSelect.setAttribute("id", "loginAsSelect");
    loginAsSelect.className = "authSelect";

    predefinedUsers.forEach((u, idx) => {
        let opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${u.name} (${u.email.split('@')[0]})`;
        loginAsSelect.appendChild(opt);
    });
    authDiv.appendChild(loginAsSelect);

    let loginAsButton = document.createElement("button");
    loginAsButton.innerHTML = "Login As";
    loginAsButton.setAttribute("id", "loginAsButton");
    loginAsButton.setAttribute("class", "authButton loginAsBtn");
    loginAsButton.title = "Log in as the selected user";
    authDiv.appendChild(loginAsButton);

    // Event Listeners
    signUpWithGoogleButton.addEventListener("click", function (event) {
        signInWithPopup(auth, googleAuthProvider)
            .then((result) => {
                console.log("Google signed in", result.user);
            }).catch((error) => {
                console.error("Google sign in error", error);
            });
        event.stopPropagation();
    });

    signInWithEmailButton.addEventListener("click", function (event) {
        let email = document.getElementById("email").value;
        let password = document.getElementById("password").value;
        signInWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                console.log("Signed in with email", userCredential.user);
            })
            .catch((error) => {
                alert(error.message);
            });
        event.stopPropagation();
    });

    signUpWithEmailButton.addEventListener("click", function (event) {
        let email = document.getElementById("email").value;
        let password = document.getElementById("password").value;
        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {
                console.log("Signed up with email", userCredential.user);
            })
            .catch((error) => {
                alert(error.message);
            });
        event.stopPropagation();
    });

    loginAsButton.addEventListener("click", function (event) {
        event.stopPropagation();
        const selectedIdx = parseInt(loginAsSelect.value, 10) || 0;
        const targetUser = predefinedUsers[selectedIdx];
        performLoginAs(targetUser);
    });
}

function addNewThingToFirebase(folder, data) {
    const dbRef = ref(db, folder);
    const newKey = push(dbRef, data).key;
    return newKey;
}

async function updateJSONFieldInFirebase(folder, data) {
    const dbRef = ref(db, folder);
    try {
        await update(dbRef, data);
    } catch (e) {
        console.error("update error", e);
    }
}

function deleteFromFirebase(folder, key) {
    console.log("deleting", folder + '/' + key);
    const dbRef = ref(db, folder + '/' + key);
    set(dbRef, null);
}

function subscribeToData() {
    let folder = exampleName + "/";
    if (existingSubscribedFolder) {
        const oldRef = ref(db, existingSubscribedFolder);
        off(oldRef);
    }
    existingSubscribedFolder = folder;

    const thisRef = ref(db, folder);
    console.log("subscribing to", folder);

    onChildAdded(thisRef, (snapshot) => {
        let key = snapshot.key;
        let data = snapshot.val();
        if (!data) return;
        myObjectsByFirebaseKey[key] = data;
        createOrUpdatePersonaCard(key, data);
    });

    onChildChanged(thisRef, (snapshot) => {
        const key = snapshot.key;
        const data = snapshot.val();
        if (!key || !data) return;
        myObjectsByFirebaseKey[key] = data;
        createOrUpdatePersonaCard(key, data);
    });

    onChildRemoved(thisRef, (snapshot) => {
        const key = snapshot.key;
        console.log("removed", key);
        if (key && activeCards[key]) {
            activeCards[key].remove();
            delete activeCards[key];
        }
        if (key && myObjectsByFirebaseKey[key]) {
            delete myObjectsByFirebaseKey[key];
        }
    });
}
