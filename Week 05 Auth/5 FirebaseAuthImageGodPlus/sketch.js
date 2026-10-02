import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getDatabase, ref, off, update, set, push, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import { getAuth, signOut, setPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword, updateProfile, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

// Global state
let myObjectsByFirebaseKey = {}; // Cache of all items in Firebase
let activeCards = {};            // Map of key -> DOM Persona Card elements
let db, auth, app;
let googleAuthProvider;
let existingSubscribedFolder = null;

let selectedAIUserKey = null; // Currently highlighted AI fake user from pulldown

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
// USER IDENTITY & PERMISSION SYSTEM
// Supports both Firebase Auth and selected AI Fake User impersonation
// -------------------------------------------------------------
function getActiveUser() {
    // 1. If an AI fake person is currently selected from the pulldown
    if (selectedAIUserKey && myObjectsByFirebaseKey[selectedAIUserKey]) {
        const fake = myObjectsByFirebaseKey[selectedAIUserKey];
        const fakeName = fake.name || fake.userName || "AI Fake User";
        return {
            uid: selectedAIUserKey,
            id: selectedAIUserKey,
            name: fakeName,
            email: `${fakeName.toLowerCase().replace(/[^a-z0-9]/g, '')}@sharedminds.ai`,
            photoURL: fake.profilePictureURL || fake.imageURL || getFallbackAvatarUrl(fakeName),
            isImpersonated: true,
            isAI: true
        };
    }
    // 2. Real user logged in via Firebase Auth
    if (auth && auth.currentUser) {
        const u = auth.currentUser;
        const realName = u.displayName || (u.email ? u.email.split('@')[0] : "Logged In User");
        return {
            uid: u.uid,
            id: u.uid,
            name: realName,
            email: u.email,
            photoURL: u.photoURL || getFallbackAvatarUrl(realName),
            isImpersonated: false,
            isAI: false
        };
    }
    return null;
}

// Determines if a given card belongs to the active user (either the impersonated fake user or the logged-in user)
function isCardOwnedByActiveUser(cardData, cardKey) {
    if (!cardData && !cardKey) return false;

    // 1. If an AI fake person is selected in the pulldown, grant permission for their card!
    if (selectedAIUserKey) {
        if (cardKey && cardKey === selectedAIUserKey) {
            return true;
        }
        if (cardData && myObjectsByFirebaseKey[selectedAIUserKey] === cardData) {
            return true;
        }
    }

    // 2. Real user logged in via Firebase Auth
    if (auth && auth.currentUser) {
        const u = auth.currentUser;
        const targetUid = u.uid;
        const realName = u.displayName || (u.email ? u.email.split('@')[0] : "");

        if (cardData) {
            // UID / ID match
            if (cardData.creatorUid && (cardData.creatorUid === targetUid || cardData.creatorUid === u.uid)) {
                return true;
            }
            // Name match (case-insensitive)
            const cardName = (cardData.name || cardData.userName || "").trim().toLowerCase();
            const activeName = realName.trim().toLowerCase();
            if (cardName && activeName && cardName === activeName) {
                return true;
            }
            // Email match
            if (cardData.email && u.email && cardData.email.trim().toLowerCase() === u.email.trim().toLowerCase()) {
                return true;
            }
        }
    }

    return false;
}

// -------------------------------------------------------------
// DOM PERSONA CARD CREATION & HOVER HANDLING
// 1. Profile Picture and Name displayed on screen
// 2. Additional Info Modal:
//    - Image from prompt at the TOP
//    - Image prompt editable only for owner + Regenerate button
//    - Background (editable only for owner)
//    - Mission in life (editable only for owner)
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
            <div class="persona-name-badge">
                <span class="persona-name-text">${displayName}</span>
                <span class="you-indicator" style="display:none;">YOU</span>
            </div>

            <!-- Additional Info Modal: Revealed on mouseover / click -->
            <div class="persona-details-popover">
                <!-- Header -->
                <div class="popover-header">
                    <img class="popover-mini-avatar" src="${profilePic}" alt="${displayName}" />
                    <div class="popover-title-group">
                        <div class="popover-name-row" style="display:flex;align-items:center;">
                            <span class="popover-name">${displayName}</span>
                            <span class="popover-you-tag" style="display:none;">Your Profile</span>
                        </div>
                        <div class="popover-role-tag ${isAI ? 'ai' : 'human'}">${isAI ? 'AI Persona' : 'Real User'}</div>
                    </div>
                    <button class="popover-delete-btn" title="Delete Card" data-delete-key="${key}" style="display:none;">✕</button>
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

                <!-- 2. EDITABLE IMAGE PROMPT (ONLY FOR LOGGED IN / IMPERSONATED OWNER) -->
                <div class="popover-section popover-prompt-section">
                    <div class="popover-label">
                        <span>✨ Image Prompt</span>
                        <span class="owner-edit-badge" style="display:none;">(Editable by You)</span>
                    </div>
                    <textarea class="popover-prompt-input is-readonly" rows="3" placeholder="Enter image prompt..." readonly>${prompt}</textarea>
                    
                    <div class="popover-prompt-actions" style="display:none;">
                        <button class="popover-regen-btn" type="button">🎨 Regenerate Image</button>
                    </div>
                    <div class="popover-auth-hint" style="display:block;">
                        🔒 View only
                    </div>
                </div>

                <!-- 3. BACKGROUND -->
                <div class="popover-section popover-bg-section">
                    <div class="popover-label">
                        <span>📜 Background</span>
                        <span class="owner-edit-badge" style="display:none;">(Editable by You)</span>
                    </div>
                    <textarea class="popover-field-input popover-background-input" rows="2" placeholder="Add your background story..." style="display:none;">${background}</textarea>
                    <div class="popover-text popover-background-display ${!background ? 'is-empty' : ''}">${background || '(No background provided yet)'}</div>
                </div>

                <!-- 4. MISSION IN LIFE -->
                <div class="popover-section popover-mission-section">
                    <div class="popover-label">
                        <span>🎯 Mission in Life</span>
                        <span class="owner-edit-badge" style="display:none;">(Editable by You)</span>
                    </div>
                    <textarea class="popover-field-input popover-mission-input" rows="2" placeholder="Add your mission in life..." style="display:none;">${mission}</textarea>
                    <div class="popover-mission popover-mission-display ${!mission ? 'is-empty' : ''}">${mission ? `"${mission}"` : '(No mission entered yet)'}</div>
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

    // Apply permissions immediately for this card
    updateCardPermissions(card, key, data);
}

function updateCardContent(card, data) {
    const isAI = data.isAI !== false;
    const rawName = data.name || data.userName || (isAI ? "Persona" : "User");
    const displayName = formatUserName(rawName, isAI);
    const profilePic = data.profilePictureURL || data.imageURL || getFallbackAvatarUrl(rawName);
    const imageURL = data.imageURL || "";

    const nameText = card.querySelector('.persona-name-text');
    if (nameText && nameText.textContent !== displayName) nameText.textContent = displayName;

    const popoverName = card.querySelector('.popover-name');
    if (popoverName && popoverName.textContent !== displayName) popoverName.textContent = displayName;

    const roleTag = card.querySelector('.popover-role-tag');
    if (roleTag) {
        roleTag.className = 'popover-role-tag ' + (isAI ? 'ai' : 'human');
        roleTag.textContent = isAI ? 'AI Persona' : 'Real User';
    }

    const avatarImg = card.querySelector('.persona-avatar-img');
    if (avatarImg && avatarImg.src !== profilePic) avatarImg.src = profilePic;

    const miniAvatar = card.querySelector('.popover-mini-avatar');
    if (miniAvatar && miniAvatar.src !== profilePic) miniAvatar.src = profilePic;

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
    if (promptInput && document.activeElement !== promptInput && data.prompt !== undefined && promptInput.value !== data.prompt) {
        promptInput.value = data.prompt;
    }

    const bgInput = card.querySelector('.popover-background-input');
    const bgDisplay = card.querySelector('.popover-background-display');
    if (bgInput && document.activeElement !== bgInput && data.background !== undefined && bgInput.value !== data.background) {
        bgInput.value = data.background;
    }
    if (bgDisplay) {
        bgDisplay.textContent = data.background || "(No background provided yet)";
        if (!data.background) bgDisplay.classList.add('is-empty');
        else bgDisplay.classList.remove('is-empty');
    }

    const missionInput = card.querySelector('.popover-mission-input');
    const missionDisplay = card.querySelector('.popover-mission-display');
    if (missionInput && document.activeElement !== missionInput && data.mission !== undefined && missionInput.value !== data.mission) {
        missionInput.value = data.mission;
    }
    if (missionDisplay) {
        missionDisplay.textContent = data.mission ? `"${data.mission}"` : "(No mission entered yet)";
        if (!data.mission) missionDisplay.classList.add('is-empty');
        else missionDisplay.classList.remove('is-empty');
    }
}

// Updates UI controls & readonly states on a card depending on whether the active user owns it
function updateCardPermissions(card, key, data) {
    if (!card || !data) return;
    const isOwned = isCardOwnedByActiveUser(data, key);
    const active = getActiveUser();
    const ownerName = data.name || data.userName || "this persona";
    const isImpersonatingThis = (selectedAIUserKey && selectedAIUserKey === key);

    // Card movement & visual styling
    if (isOwned) {
        card.classList.add('is-own-card');
        card.classList.add('can-move');
        card.title = isImpersonatingThis
            ? `🎭 ${ownerName} (Active) — Drag to move, click to edit details`
            : "Your Card — Drag to move, hover or click to edit";
    } else {
        card.classList.remove('is-own-card');
        card.classList.remove('can-move');
        card.title = `${ownerName} — Hover or click to view details`;
    }

    // YOU / ACTIVE indicator on canvas name badge
    const youIndicator = card.querySelector('.you-indicator');
    if (youIndicator) {
        youIndicator.style.display = isOwned ? 'inline-block' : 'none';
        youIndicator.textContent = isImpersonatingThis ? "ACTIVE" : "YOU";
    }

    // Your Profile / Impersonating tag in modal header
    const youTag = card.querySelector('.popover-you-tag');
    if (youTag) {
        youTag.style.display = isOwned ? 'inline-block' : 'none';
        youTag.textContent = isImpersonatingThis ? "🎭 Impersonating" : "Your Profile";
    }

    // Delete button: only permanent owner can delete their card (not temporary impersonator)
    const deleteBtn = card.querySelector('.popover-delete-btn');
    if (deleteBtn) {
        deleteBtn.style.display = (isOwned && !isImpersonatingThis) ? 'flex' : 'none';
    }

    // Prompt input & regenerate button
    const promptInput = card.querySelector('.popover-prompt-input');
    const regenActions = card.querySelector('.popover-prompt-actions');
    const authHint = card.querySelector('.popover-auth-hint');
    const promptBadge = card.querySelector('.popover-prompt-section .owner-edit-badge');

    if (promptInput) {
        if (isOwned) {
            promptInput.removeAttribute('readonly');
            promptInput.classList.remove('is-readonly');
        } else {
            promptInput.setAttribute('readonly', 'true');
            promptInput.classList.add('is-readonly');
        }
    }
    if (regenActions) {
        regenActions.style.display = isOwned ? 'flex' : 'none';
    }
    if (promptBadge) {
        promptBadge.style.display = isOwned ? 'inline' : 'none';
    }
    if (authHint) {
        if (isOwned) {
            authHint.style.display = 'none';
        } else {
            authHint.style.display = 'block';
            if (!active) {
                authHint.innerHTML = `🔒 Log in or impersonate <strong>${ownerName}</strong> to edit.`;
            } else {
                authHint.innerHTML = `🔒 View only — belongs to <strong>${ownerName}</strong>.`;
            }
        }
    }

    // Background section
    const bgInput = card.querySelector('.popover-background-input');
    const bgDisplay = card.querySelector('.popover-background-display');
    const bgBadge = card.querySelector('.popover-bg-section .owner-edit-badge');
    if (bgBadge) bgBadge.style.display = isOwned ? 'inline' : 'none';

    if (isOwned) {
        if (bgInput) {
            bgInput.style.display = 'block';
            if (document.activeElement !== bgInput) {
                bgInput.value = data.background || "";
            }
        }
        if (bgDisplay) bgDisplay.style.display = 'none';
    } else {
        if (bgInput) bgInput.style.display = 'none';
        if (bgDisplay) {
            bgDisplay.style.display = 'block';
            bgDisplay.textContent = data.background || "(No background provided yet)";
            if (!data.background) bgDisplay.classList.add('is-empty');
            else bgDisplay.classList.remove('is-empty');
        }
    }

    // Mission section
    const missionInput = card.querySelector('.popover-mission-input');
    const missionDisplay = card.querySelector('.popover-mission-display');
    const missionBadge = card.querySelector('.popover-mission-section .owner-edit-badge');
    if (missionBadge) missionBadge.style.display = isOwned ? 'inline' : 'none';

    if (isOwned) {
        if (missionInput) {
            missionInput.style.display = 'block';
            if (document.activeElement !== missionInput) {
                missionInput.value = data.mission || "";
            }
        }
        if (missionDisplay) missionDisplay.style.display = 'none';
    } else {
        if (missionInput) missionInput.style.display = 'none';
        if (missionDisplay) {
            missionDisplay.style.display = 'block';
            missionDisplay.textContent = data.mission ? `"${data.mission}"` : "(No mission entered yet)";
            if (!data.mission) missionDisplay.classList.add('is-empty');
            else missionDisplay.classList.remove('is-empty');
        }
    }
}

// Refreshes permissions and controls across every card on the canvas
function refreshAllCardsPermissions() {
    for (const key in activeCards) {
        const card = activeCards[key];
        const data = myObjectsByFirebaseKey[key];
        if (card && data) {
            updateCardPermissions(card, key, data);
        }
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
        if (rect.left + 120 + 340 > window.innerWidth) {
            popover.classList.add('popover-flip-left');
        } else {
            popover.classList.remove('popover-flip-left');
        }
        if (rect.top + 520 > window.innerHeight) {
            popover.classList.add('popover-flip-up');
        } else {
            popover.classList.remove('popover-flip-up');
        }
    });

    // 2. Click avatar to pin/unpin modal open (ignore click right after drag)
    avatarWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        if (card._justDragged) {
            card._justDragged = false;
            return;
        }
        card.classList.toggle('popover-pinned');
    });

    // 3. Stop clicks inside popover from closing it or triggering drag
    popover.addEventListener('mousedown', (e) => e.stopPropagation());
    popover.addEventListener('click', (e) => e.stopPropagation());

    // 4. Delete button handler (only for owned card)
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isCardOwnedByActiveUser(data, key)) {
                showStatus("🔒 You can only delete your own card.", false);
                hideStatus(2500);
                return;
            }
            const name = data.name || data.userName || "Card";
            if (confirm(`Remove your card "${name}" from canvas?`)) {
                deleteFromFirebase(exampleName, key);
            }
        });
    }

    // 5. Background & Mission live saving (only for owned card)
    if (bgInput) {
        let bgSaveTimer = null;
        bgInput.addEventListener('mousedown', (e) => e.stopPropagation());
        bgInput.addEventListener('click', (e) => e.stopPropagation());
        bgInput.addEventListener('input', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            data.background = bgInput.value;
            clearTimeout(bgSaveTimer);
            bgSaveTimer = setTimeout(() => {
                updateJSONFieldInFirebase(exampleName + "/" + key + "/", { background: bgInput.value });
            }, 800);
        });
        bgInput.addEventListener('change', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            clearTimeout(bgSaveTimer);
            const val = bgInput.value.trim();
            data.background = val;
            updateJSONFieldInFirebase(exampleName + "/" + key + "/", { background: val });
        });
    }

    if (missionInput) {
        let missionSaveTimer = null;
        missionInput.addEventListener('mousedown', (e) => e.stopPropagation());
        missionInput.addEventListener('click', (e) => e.stopPropagation());
        missionInput.addEventListener('input', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            data.mission = missionInput.value;
            clearTimeout(missionSaveTimer);
            missionSaveTimer = setTimeout(() => {
                updateJSONFieldInFirebase(exampleName + "/" + key + "/", { mission: missionInput.value });
            }, 800);
        });
        missionInput.addEventListener('change', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            clearTimeout(missionSaveTimer);
            const val = missionInput.value.trim();
            data.mission = val;
            updateJSONFieldInFirebase(exampleName + "/" + key + "/", { mission: val });
        });
    }

    // 6. Prompt Textarea & Regenerate Button Handlers (only for owned card)
    if (promptInput) {
        let promptSaveTimer = null;
        promptInput.addEventListener('mousedown', (e) => e.stopPropagation());
        promptInput.addEventListener('click', (e) => e.stopPropagation());
        promptInput.addEventListener('input', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            data.prompt = promptInput.value;
            clearTimeout(promptSaveTimer);
            promptSaveTimer = setTimeout(() => {
                updateJSONFieldInFirebase(exampleName + "/" + key + "/", { prompt: promptInput.value });
            }, 800);
        });
        promptInput.addEventListener('change', () => {
            if (!isCardOwnedByActiveUser(data, key)) return;
            clearTimeout(promptSaveTimer);
            const val = promptInput.value.trim();
            data.prompt = val;
            updateJSONFieldInFirebase(exampleName + "/" + key + "/", { prompt: val });
        });
        promptInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (isCardOwnedByActiveUser(data, key)) {
                    triggerRegenerate();
                }
            }
        });
    }

    if (regenBtn) {
        regenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCardOwnedByActiveUser(data, key)) {
                triggerRegenerate();
            }
        });
    }

    async function triggerRegenerate() {
        if (!isCardOwnedByActiveUser(data, key)) {
            const active = getActiveUser();
            const ownerName = data.name || data.userName || "this persona";
            showStatus(`🔒 Please select ${ownerName} in the AI Fake Users menu to edit this card.`, false);
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

    // 7. Card Dragging (ONLY FOR LOGGED IN / IMPERSONATED USER'S OWN CARD)
    attachCardDragHandlers(card, key, data);
}

// Drag & drop cards on canvas - STRICTLY restricted to the card owner!
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

        // STRICT PERMISSION CHECK: Only the logged in or impersonated user can move their own location!
        if (!isCardOwnedByActiveUser(data, key)) {
            const active = getActiveUser();
            const ownerName = data.name || data.userName || "this persona";
            showStatus(`🔒 Select ${ownerName} in the AI Fake Users menu to move this card.`, false);
            hideStatus(2800);
            return;
        }

        e.stopPropagation();
        isDraggingThis = true;
        let hasMoved = false;
        card.classList.add('is-dragging');
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startPosX = parseFloat(card.style.left) || (data.position ? data.position.x : 0);
        startPosY = parseFloat(card.style.top) || (data.position ? data.position.y : 0);

        function onMouseMove(moveEvent) {
            if (!isDraggingThis) return;
            const dx = moveEvent.clientX - startMouseX;
            const dy = moveEvent.clientY - startMouseY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }
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
            if (hasMoved || Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                card._justDragged = true;
                setTimeout(() => { card._justDragged = false; }, 150);
                const finalX = Math.round(startPosX + dx);
                const finalY = Math.round(startPosY + dy);
                updateJSONFieldInFirebase(exampleName + "/" + key + "/position/", { x: finalX, y: finalY });
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
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

    // 5. Right Sidebar (Flex column: Auth UI on top, AI Fake Users pulldown directly under it)
    const rightSidebar = document.createElement("div");
    rightSidebar.setAttribute("id", "rightSidebar");
    document.body.appendChild(rightSidebar);

    // 5a. Auth Box
    authDiv = document.createElement("div");
    authDiv.setAttribute("id", "authDiv");
    rightSidebar.appendChild(authDiv);

    authDiv.addEventListener('mousedown', (e) => e.stopPropagation());
    authDiv.addEventListener('dblclick', (e) => e.stopPropagation());

    renderAuthInterface();

    // 5b. AI Fake Users Pulldown Panel (Directly under Auth UI)
    const aiUsersPanel = document.createElement("div");
    aiUsersPanel.setAttribute("id", "aiUsersPanel");
    aiUsersPanel.innerHTML = `
        <div class="aiUsersHeader">
            <span>🤖 AI Fake Users</span>
            <span id="aiUsersCountBadge" class="aiUsersBadge">0</span>
        </div>
        <select id="aiFakeUsersSelect">
            <option value="">-- Select AI Fake User --</option>
        </select>
        <div class="aiUsersHint">Select an AI user to locate their card & view details.</div>
    `;
    rightSidebar.appendChild(aiUsersPanel);

    aiUsersPanel.addEventListener('mousedown', (e) => e.stopPropagation());
    aiUsersPanel.addEventListener('dblclick', (e) => e.stopPropagation());

    const aiSelect = aiUsersPanel.querySelector("#aiFakeUsersSelect");
    aiSelect.addEventListener("change", (e) => {
        e.stopPropagation();
        handleAIUserSelection(aiSelect.value);
    });

    // 6. Bottom Navigation Hint
    const bottomHint = document.createElement('div');
    bottomHint.setAttribute('id', 'bottomHint');
    bottomHint.textContent = '💡 Click GOD for AI personas • Select an AI Fake User from the pulldown below auth • Hover or click avatar for details';
    document.body.appendChild(bottomHint);

    // 7. Clicking outside unpins any pinned modal (except for the active impersonated card)
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.persona-card') && !e.target.closest('#rightSidebar')) {
            document.querySelectorAll('.persona-card.popover-pinned').forEach(c => {
                if (selectedAIUserKey && c === activeCards[selectedAIUserKey]) {
                    return; // Keep impersonated person modal pinned open for typing/editing
                }
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
        console.log("Firebase user is signed in:", user);
    } else {
        console.log("Firebase user is signed out");
    }
    renderAuthInterface();
    refreshAllCardsPermissions();
});

// When a new person logs on or is impersonated, ensure a card exists for them
function ensureUserCardExists(user) {
    if (!user) return;
    const realName = user.name || user.displayName || (user.email ? user.email.split('@')[0] : "User");
    const targetUid = user.uid || user.id;

    // Check if card for this user already exists in Firebase
    const existingKey = Object.keys(myObjectsByFirebaseKey).find(key => {
        const item = myObjectsByFirebaseKey[key];
        if (!item) return false;
        if (targetUid && item.creatorUid === targetUid) return true;
        const itemName = (item.name || item.userName || "").trim().toLowerCase();
        return itemName === realName.trim().toLowerCase();
    });

    if (existingKey) {
        console.log("User card already exists on canvas:", existingKey);
        const cardEl = activeCards[existingKey];
        if (cardEl) {
            updateCardPermissions(cardEl, existingKey, myObjectsByFirebaseKey[existingKey]);
        }
        return;
    }

    const safePos = getRandomSafeLocation();
    const defaultAvatar = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(realName)}&backgroundColor=6366f1`;

    const userCardData = {
        type: "user",
        isAI: false, // REAL USER - no (AI) attached!
        creatorUid: targetUid,
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

    console.log("Auto-creating blank card on canvas for user:", realName);
    addNewThingToFirebase(exampleName + "/", userCardData);
    showStatus(`Welcome, ${realName}! Your profile card was placed on the canvas.`, false);
    hideStatus(3500);
}

// -------------------------------------------------------------
// AUTHENTICATION INTERFACE
// -------------------------------------------------------------
function renderAuthInterface() {
    if (!authDiv) return;
    authDiv.innerHTML = "";

    // 1. If logged in via Firebase Auth (Google or Email)
    if (auth && auth.currentUser) {
        const u = auth.currentUser;
        const realName = u.displayName || u.email || "Logged In User";
        const banner = document.createElement("div");
        banner.className = "authActiveUserBanner loggedIn";
        const photo = u.photoURL || getFallbackAvatarUrl(realName);
        banner.innerHTML = `
            <img src="${photo}" class="authAvatar" alt="${realName}" />
            <div class="authUserInfo">
                <div class="authUserName">${realName}</div>
                <div class="authUserRole">✓ Logged In (Real User)</div>
            </div>
        `;
        authDiv.appendChild(banner);

        const logOutButton = document.createElement("button");
        logOutButton.innerHTML = "Log Out";
        logOutButton.setAttribute("id", "logOut");
        logOutButton.setAttribute("class", "authButton");
        logOutButton.addEventListener("click", (e) => {
            e.stopPropagation();
            signOut(auth).then(() => {
                console.log("signed out");
            });
        });
        authDiv.appendChild(logOutButton);
    }
    // 2. Else: Guest / unauthenticated - Show Firebase login options
    else {
        // Google Login Button
        let signUpWithGoogleButton = document.createElement("button");
        signUpWithGoogleButton.innerHTML = "Google Login";
        signUpWithGoogleButton.setAttribute("id", "signInWithGoogle");
        signUpWithGoogleButton.setAttribute("class", "authButton");
        authDiv.appendChild(signUpWithGoogleButton);

        // Email Sign In / Sign Up
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

        signUpWithGoogleButton.addEventListener("click", (e) => {
            e.stopPropagation();
            signInWithPopup(auth, googleAuthProvider)
                .catch((err) => console.error("Google sign in error", err));
        });

        signInWithEmailButton.addEventListener("click", (e) => {
            e.stopPropagation();
            const em = document.getElementById("email").value;
            const pw = document.getElementById("password").value;
            signInWithEmailAndPassword(auth, em, pw)
                .catch((err) => alert(err.message));
        });

        signUpWithEmailButton.addEventListener("click", (e) => {
            e.stopPropagation();
            const em = document.getElementById("email").value;
            const pw = document.getElementById("password").value;
            createUserWithEmailAndPassword(auth, em, pw)
                .catch((err) => alert(err.message));
        });
    }
}

// -------------------------------------------------------------
// AI FAKE USERS PULLDOWN MENU
// Populates and updates the dedicated dropdown under the auth UI
// -------------------------------------------------------------
function updateAIFakeUsersDropdown() {
    const aiSelect = document.getElementById("aiFakeUsersSelect");
    const countBadge = document.getElementById("aiUsersCountBadge");
    if (!aiSelect) return;

    const currentSelected = selectedAIUserKey || aiSelect.value;
    aiSelect.innerHTML = `<option value="">${selectedAIUserKey ? "🚫 Stop Impersonating (View Only)" : "-- Select AI Fake User --"}</option>`;

    let aiEntries = [];

    for (let key in myObjectsByFirebaseKey) {
        const item = myObjectsByFirebaseKey[key];
        if (!item) continue;

        // An AI Fake User is any persona: isAI !== false, or type === 'persona', or has (AI) in name
        const isAI = item.isAI !== false && item.type !== "user";
        if (isAI) {
            const rawName = item.name || item.userName || "Unnamed AI Persona";
            const displayName = rawName.includes("(AI)") ? rawName : `${rawName} (AI)`;
            aiEntries.push({ key, name: displayName });
        }
    }

    // Sort alphabetically by name
    aiEntries.sort((a, b) => a.name.localeCompare(b.name));

    aiEntries.forEach(entry => {
        const opt = document.createElement("option");
        opt.value = entry.key;
        const isActive = (entry.key === currentSelected);
        opt.textContent = isActive ? `✓ ${entry.name} (Active)` : entry.name;
        if (isActive) {
            opt.selected = true;
        }
        aiSelect.appendChild(opt);
    });

    if (countBadge) {
        countBadge.textContent = aiEntries.length;
    }
}

// Handles selecting an AI user from the pulldown menu:
// Grants move and edit permissions, highlights card with pulsing glow, and opens/pins its details popover
function handleAIUserSelection(selectedKey) {
    selectedAIUserKey = selectedKey || null;

    // Un-highlight and un-pin any existing cards
    document.querySelectorAll('.persona-card.selected-highlight').forEach(c => {
        c.classList.remove('selected-highlight');
    });
    document.querySelectorAll('.persona-card.popover-pinned').forEach(c => {
        c.classList.remove('popover-pinned');
    });

    // Refresh all cards permissions so the newly selected person becomes editable & movable!
    refreshAllCardsPermissions();

    if (!selectedKey) {
        showStatus("Stopped impersonating. Cards are now in view-only mode.", false);
        hideStatus(2500);
        updateAIFakeUsersDropdown();
        return;
    }

    const card = activeCards[selectedKey];
    if (card) {
        card.classList.add('selected-highlight');
        card.classList.add('popover-pinned');

        const personaData = myObjectsByFirebaseKey[selectedKey];
        const personaName = personaData ? (personaData.name || personaData.userName) : "AI Fake User";
        showStatus(`🎭 Now impersonating ${personaName}! You can move their card & type in their modal.`, false);
        hideStatus(3500);

        // Smoothly scroll into view if card is offscreen
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }

    updateAIFakeUsersDropdown();
}

// -------------------------------------------------------------
// DEDUPLICATION: Purges accidental duplicate cards from Firebase
// -------------------------------------------------------------
let cleanupDebounceTimer = null;

function scheduleDuplicateCleanup() {
    clearTimeout(cleanupDebounceTimer);
    cleanupDebounceTimer = setTimeout(() => {
        cleanupDuplicateCards();
    }, 1500);
}

function cleanupDuplicateCards() {
    const keys = Object.keys(myObjectsByFirebaseKey);
    if (keys.length === 0) return;

    const seenRealUsers = {};
    const keysToDelete = [];

    for (const key of keys) {
        const item = myObjectsByFirebaseKey[key];
        if (!item) continue;

        // Target real users (not AI personas)
        const isAI = item.isAI === true || (item.name && item.name.includes("(AI)"));
        if (!isAI) {
            const rawName = (item.name || item.userName || "").trim().toLowerCase();
            const uid = item.creatorUid;
            const ident = uid ? `uid:${uid}` : `name:${rawName}`;

            if (ident && ident !== "name:") {
                if (seenRealUsers[ident]) {
                    // Duplicate found! Keep the first one seen, schedule this duplicate for deletion
                    keysToDelete.push({ key, name: item.name || item.userName });
                } else {
                    seenRealUsers[ident] = key;
                }
            }
        }
    }

    if (keysToDelete.length > 0) {
        console.warn(`[Deduplication] Removing ${keysToDelete.length} duplicate user card(s) from Firebase:`, keysToDelete);
        keysToDelete.forEach(dup => {
            deleteFromFirebase(exampleName, dup.key);
        });
        showStatus(`🧹 Removed ${keysToDelete.length} duplicate copy of ${keysToDelete[0].name}`, false);
        hideStatus(3000);
    }
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
        updateAIFakeUsersDropdown();
        scheduleDuplicateCleanup();
    });

    onChildChanged(thisRef, (snapshot) => {
        const key = snapshot.key;
        const data = snapshot.val();
        if (!key || !data) return;
        myObjectsByFirebaseKey[key] = data;
        createOrUpdatePersonaCard(key, data);
        updateAIFakeUsersDropdown();
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
        if (selectedAIUserKey === key) {
            selectedAIUserKey = null;
        }
        updateAIFakeUsersDropdown();
    });
}

