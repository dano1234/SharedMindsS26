import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";

// TODO: Replace with your Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyAso5J837G5oDSj0hJHWG2Yi8tunau2n9g",
    authDomain: "classtest-dbd04.firebaseapp.com",
    projectId: "classtest-dbd04",
    storageBucket: "classtest-dbd04.firebasestorage.app",
    messagingSenderId: "872634326150",
    appId: "1:872634326150:web:fbebd86059d4d9a8fec507"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let canvas;
let ctx;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentStroke = [];
let allStrokes = [];

function init() {
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    prompt("Enter your name");
    const name = prompt("Enter your name");
    // if (name) {
    //     const dbRef = collection(db, "users");
    //     const docRef = await addDoc(dbRef, { name: name });
    //     console.log("Document written with ID: ", docRef.id);
    // }

    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        lastX = e.clientX;
        lastY = e.clientY;
        currentStroke = [[lastX, lastY]];
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        currentStroke.push([e.clientX, e.clientY]);
        lastX = e.clientX;
        lastY = e.clientY;
    });

    canvas.addEventListener('mouseup', async () => {
        if (isDrawing && currentStroke.length > 1) {
            const points = currentStroke.map(p => ({ x: p[0], y: p[1] }));
            await addDoc(collection(db, "drawings"), {
                points: points,
                timestamp: serverTimestamp()
            });
        }
        isDrawing = false;
        currentStroke = [];
    });

    canvas.addEventListener('mouseout', () => {
        isDrawing = false;
        currentStroke = [];
    });

    listenForStrokes();
    animate();
}

function listenForStrokes() {
    onSnapshot(collection(db, "drawings"), (snapshot) => {
        allStrokes = [];
        snapshot.forEach((doc) => {
            allStrokes.push(doc.data());
        });
    });
}

function drawStroke(points, isFromFirestore = true) {
    if (points.length < 2) return;
    ctx.beginPath();
    if (isFromFirestore) {
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
    } else {
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i][0], points[i][1]);
        }
    }
    ctx.stroke();
}

function animate() {
    requestAnimationFrame(animate);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let stroke of allStrokes) {
        if (stroke.points) {
            drawStroke(stroke.points);
        }
    }

    if (currentStroke.length > 1) {
        ctx.strokeStyle = 'red';
        drawStroke(currentStroke, false);
    }
}

init();
