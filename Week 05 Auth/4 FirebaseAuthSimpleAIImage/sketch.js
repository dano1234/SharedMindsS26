import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getDatabase, ref, off, onValue, update, set, push, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";
import { getAuth, signOut, setPersistence, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

let myObjectsByFirebaseKey = {}; // for converting from firebase key to my JSON object

let ctx;
let db, auth, app;
let googleAuthProvider;
let existingSubscribedFolder = null;

let exampleName = "SharedMindsFirebaseAuthSimpleAIImage";

let canvas;
let inputBox;
let snapButton;
let authDiv;
let currentObject = -1;
let mouseDown = false;
let promptWords = [];

init();

function init() {
    initFirebase();
    initInterface();
    animate();
}

// Animate loop
function animate() {
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let key in myObjectsByFirebaseKey) {
        let thisObject = myObjectsByFirebaseKey[key];
        if (thisObject.type === "image") {
            let position = thisObject.position;
            let img = thisObject.loadedImage;
            if (img && position) {
                ctx.drawImage(img, position.x, position.y, 256, 256);
                if (thisObject.textarea) {
                    thisObject.textarea.style.left = position.x + 'px';
                    thisObject.textarea.style.top = (position.y + 256) + 'px';
                }
            }
        } else if (thisObject.type === "text") {
            let position = thisObject.position;
            if (position) {
                ctx.fillStyle = "black";
                ctx.font = "30px Arial";
                let label = thisObject.userName ? (thisObject.userName + ": " + thisObject.text) : thisObject.text;
                ctx.fillText(label, position.x, position.y);
            }
        }
    }

    requestAnimationFrame(animate);
}

async function askPictures(promptWord, location) {
    const user = auth.currentUser;
    if (!user) {
        inputBox.value = "Please Log in";
        return;
    }
    let userName = user.displayName;
    if (!userName && user.email) userName = user.email.split("@")[0];
    if (!userName) userName = "Anonymous";

    inputBox.value = 'Asking for ' + promptWord;
    document.body.style.cursor = "progress";
    let replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";
    let authToken = "";

    promptWords.push(promptWord);

    const data = {
        model: "black-forest-labs/flux-schnell",
        input: {
            prompt: promptWord
        },
    };
    console.log("Making a Fetch Request", data);
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
        console.log("json_response", json_response);

        if (!json_response || json_response.length == 0 || !json_response.output) {
            console.log("Something went wrong, try it again");
        } else {
            addImageRemote(json_response.output, promptWord, { x: location.x, y: location.y }, userName);
        }
    } catch (err) {
        console.error("Fetch error:", err);
    }

    document.body.style.cursor = "auto";
    inputBox.style.display = 'block';
    inputBox.value = '';
}

function initInterface() {
    // Canvas setup
    canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'myCanvas');
    canvas.style.position = 'absolute';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx = canvas.getContext('2d');
    document.body.appendChild(canvas);
    console.log('canvas', canvas.width, canvas.height);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    // Input box
    inputBox = document.createElement('input');
    inputBox.setAttribute('type', 'text');
    inputBox.setAttribute('id', 'inputBox');
    inputBox.setAttribute('placeholder', 'Enter text here');
    inputBox.style.position = 'absolute';
    inputBox.style.left = '50%';
    inputBox.style.top = '50%';
    inputBox.style.transform = 'translate(-50%, -50%)';
    inputBox.style.zIndex = '100';
    inputBox.style.fontSize = '30px';
    inputBox.style.fontFamily = 'Arial';
    inputBox.setAttribute('autocomplete', 'off');
    document.body.appendChild(inputBox);

    // Add event listener to the input box
    inputBox.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            const user = auth.currentUser;
            if (!user) {
                inputBox.value = "Please Log in";
                return;
            }
            const inputValue = inputBox.value;
            if (!inputValue.trim()) return;
            var rect = inputBox.getBoundingClientRect();
            let location = { x: rect.left, y: rect.top };
            console.log("Location: ", location);
            askPictures(inputValue, location);
        }
    });

    // Add Snap button
    snapButton = document.createElement('button');
    snapButton.textContent = 'Snap';
    snapButton.style.position = 'absolute';
    snapButton.style.top = '10px';
    snapButton.style.right = '10px';
    snapButton.style.zIndex = '100';
    snapButton.style.padding = '10px 20px';
    snapButton.style.fontSize = '16px';
    snapButton.style.cursor = 'pointer';
    document.body.appendChild(snapButton);

    snapButton.addEventListener('mousedown', (e) => e.stopPropagation());
    snapButton.addEventListener('dblclick', (e) => e.stopPropagation());
    snapButton.addEventListener('click', () => {
        const keys = Object.keys(myObjectsByFirebaseKey);
        const halfCount = Math.floor(keys.length / 2);
        const shuffled = keys.sort(() => Math.random() - 0.5);
        const toDelete = shuffled.slice(0, halfCount);

        for (let key of toDelete) {
            deleteFromFirebase(exampleName, key);
        }
        console.log(`Snapped ${toDelete.length} items out of existence`);
    });

    // Auth box
    authDiv = document.createElement("div");
    authDiv.setAttribute("id", "authDiv");
    authDiv.style.position = "absolute";
    authDiv.style.top = "60px";
    authDiv.style.right = "10px";
    authDiv.style.width = "150px";
    authDiv.style.backgroundColor = "lightpink";
    authDiv.style.border = "1px solid black";
    authDiv.style.padding = "10px";
    authDiv.style.zIndex = "3000";
    document.body.appendChild(authDiv);

    authDiv.addEventListener('mousedown', (e) => e.stopPropagation());
    authDiv.addEventListener('dblclick', (e) => e.stopPropagation());

    // Mouse drag listeners
    document.addEventListener('mousedown', (event) => {
        if (event.target === inputBox || event.target === snapButton || event.target.closest('#authDiv')) {
            return;
        }
        mouseDown = true;
        currentObject = -1;
        for (let key in myObjectsByFirebaseKey) {
            let thisObject = myObjectsByFirebaseKey[key];
            if (thisObject.position &&
                event.clientX > thisObject.position.x &&
                event.clientX < thisObject.position.x + 256 &&
                event.clientY > thisObject.position.y &&
                event.clientY < thisObject.position.y + 256 + 60) {
                currentObject = key;
                break;
            }
        }
        console.log("Clicked on ", currentObject);
    });

    document.addEventListener('mousemove', (event) => {
        if (mouseDown && currentObject != -1) {
            let thisLocation = { x: event.clientX, y: event.clientY };
            myObjectsByFirebaseKey[currentObject].position = thisLocation;
            if (myObjectsByFirebaseKey[currentObject].textarea) {
                myObjectsByFirebaseKey[currentObject].textarea.style.left = thisLocation.x + 'px';
                myObjectsByFirebaseKey[currentObject].textarea.style.top = (thisLocation.y + 256) + 'px';
            }
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (currentObject != -1) {
            let thisLocation = myObjectsByFirebaseKey[currentObject].position;
            updateJSONFieldInFirebase(exampleName + "/" + currentObject + "/position/", { x: thisLocation.x, y: thisLocation.y });
        }
        mouseDown = false;
        currentObject = -1;
    });

    // Add event listener to the document for double click event
    document.addEventListener('dblclick', (event) => {
        if (event.target === snapButton || event.target.closest('#authDiv') || event.target.classList.contains('promptTextArea')) {
            return;
        }
        inputBox.style.display = 'block';
        inputBox.focus();
        inputBox.style.left = event.clientX + 'px';
        inputBox.style.top = event.clientY + 'px';
        console.log("Document double clicked");
    });
}

///////////////////////FIREBASE & AUTH///////////////////////////

export function addImageRemote(imgURL, prompt, pos, userName) {
    console.log("addImageRemote", imgURL, prompt, pos, userName);
    const data = {
        type: "image",
        prompt: prompt,
        position: pos,
        imageURL: imgURL,
        userName: userName || ""
    };
    let folder = exampleName + "/";
    console.log("Entered Image, Send to Firebase", folder, data);
    const key = addNewThingToFirebase(folder, data);
    return key;
}

function initFirebase() {
    // Initialize Firebase
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

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("user is signed in", user);
        showLogOutButton(user);
    } else {
        console.log("user is signed out");
        showLoginButtons();
    }
});

function showLogOutButton(user) {
    authDiv.innerHTML = "";
    let userNameDiv = document.createElement("div");
    if (user.photoURL) {
        let userPic = document.createElement("img");
        userPic.src = user.photoURL;
        userPic.style.width = "50px";
        userPic.style.height = "50px";
        userPic.style.borderRadius = "50%";
        authDiv.appendChild(userPic);
    }
    if (user.displayName) {
        userNameDiv.innerHTML = user.displayName;
    } else {
        userNameDiv.innerHTML = user.email;
    }
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

function showLoginButtons() {
    authDiv.innerHTML = "";
    let signUpWithGoogleButton = document.createElement("button");
    signUpWithGoogleButton.innerHTML = "Google Login";
    signUpWithGoogleButton.setAttribute("id", "signInWithGoogle");
    signUpWithGoogleButton.setAttribute("class", "authButton");
    authDiv.appendChild(signUpWithGoogleButton);

    authDiv.appendChild(document.createElement("br"));
    authDiv.appendChild(document.createElement("br"));

    let emailDiv = document.createElement("div");
    emailDiv.innerHTML = "Email";
    authDiv.appendChild(emailDiv);

    let emailInput = document.createElement("input");
    emailInput.setAttribute("id", "email");
    emailInput.setAttribute("class", "authInput");
    emailInput.setAttribute("type", "text");
    emailInput.setAttribute("placeholder", "email@email.com");
    authDiv.appendChild(emailInput);

    let passwordInput = document.createElement("input");
    passwordInput.setAttribute("id", "password");
    passwordInput.setAttribute("type", "password");
    passwordInput.setAttribute("class", "authInput");
    passwordInput.setAttribute("placeholder", "password");
    passwordInput.setAttribute("suggest", "current-password");
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

    signUpWithGoogleButton.addEventListener("click", function (event) {
        signInWithPopup(auth, googleAuthProvider)
            .then((result) => {
                const user = result.user;
                console.log("Google signed in", user);
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
                console.error("Sign in error", error);
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
                console.error("Sign up error", error);
                alert(error.message);
            });
        event.stopPropagation();
    });
}

function addNewThingToFirebase(folder, data) {
    const dbRef = ref(db, folder);
    const newKey = push(dbRef, data).key;
    return newKey;
}

async function updateJSONFieldInFirebase(folder, data) {
    console.log("updateDataInFirebase", folder, data);
    const dbRef = ref(db, folder);
    try {
        await update(dbRef, data);
    } catch (e) {
        console.error("update error", e);
    }
}

function setDataInFirebase(folder, data) {
    console.log("setDataInFirebase", folder, data);
    const dbRef = ref(db, folder);
    set(dbRef, data);
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
        console.log("unsubscribing from", existingSubscribedFolder, oldRef);
        off(oldRef);
    }
    existingSubscribedFolder = folder;

    const thisRef = ref(db, folder);
    console.log("subscribing to", folder, thisRef);
    onChildAdded(thisRef, (snapshot) => {
        let key = snapshot.key;
        let data = snapshot.val();
        myObjectsByFirebaseKey[key] = data;

        if (data.type == "image") {
            let img = new Image();
            img.onload = function () {
                img.setAttribute("id", key + "_image");
                myObjectsByFirebaseKey[key].loadedImage = img;
            };
            img.src = data.imageURL;

            // Create neat prompt textarea under the image
            let textarea = document.createElement('textarea');
            textarea.className = 'promptTextArea';
            textarea.setAttribute('readonly', 'true');
            textarea.value = (data.userName ? data.userName + ": " : "") + (data.prompt || "");
            if (data.position) {
                textarea.style.left = data.position.x + 'px';
                textarea.style.top = (data.position.y + 256) + 'px';
            }
            document.body.appendChild(textarea);
            myObjectsByFirebaseKey[key].textarea = textarea;

            // Allow dragging from textarea as well
            textarea.addEventListener('mousedown', (event) => {
                mouseDown = true;
                currentObject = key;
            });
        }
        console.log(myObjectsByFirebaseKey);
    });

    onChildChanged(thisRef, (snapshot) => {
        const key = snapshot.key;
        const value = snapshot.val();
        if (!key) { return; }
        const existing = myObjectsByFirebaseKey[key];
        myObjectsByFirebaseKey[key] = value;

        if (existing && existing.loadedImage && existing.imageURL === value.imageURL) {
            myObjectsByFirebaseKey[key].loadedImage = existing.loadedImage;
        } else if (value.type === "image") {
            const img = new Image();
            img.onload = function () {
                myObjectsByFirebaseKey[key].loadedImage = img;
            };
            img.src = value.imageURL;
        }

        // Update textarea position and text
        if (existing && existing.textarea) {
            myObjectsByFirebaseKey[key].textarea = existing.textarea;
            existing.textarea.value = (value.userName ? value.userName + ": " : "") + (value.prompt || "");
            if (value.position) {
                existing.textarea.style.left = value.position.x + 'px';
                existing.textarea.style.top = (value.position.y + 256) + 'px';
            }
        }
    });

    onChildRemoved(thisRef, (snapshot) => {
        const key = snapshot.key;
        console.log("removed", key);
        if (key && myObjectsByFirebaseKey[key]) {
            if (myObjectsByFirebaseKey[key].textarea) {
                myObjectsByFirebaseKey[key].textarea.remove();
            }
            delete myObjectsByFirebaseKey[key];
        }
    });
}
