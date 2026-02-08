
let canvas;
let ctx;
let x = 100;
let y = 100;
let xDirection = 1;
let yDirection = 1;
let inputBox;
let texts = [];

function init() {
    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    inputBox = document.createElement('input');
    inputBox.setAttribute('type', 'text');
    inputBox.setAttribute('id', 'inputBox');
    inputBox.setAttribute('placeholder', 'Enter text here');
    inputBox.style.position = 'absolute';
    inputBox.style.left = '50%';
    inputBox.style.top = '90%';
    inputBox.style.transform = 'translate(-50%, -50%)';
    inputBox.style.zIndex = '100';
    document.body.appendChild(inputBox);
    inputBox.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            const inputValue = inputBox.value;
            console.log("inputValue: ", inputValue);
            let xDirection = Math.random() * 2 - 1;
            let yDirection = Math.random() * 2 - 1;
            let x = Math.random() * canvas.width;
            let y = Math.random() * canvas.height;
            texts.push({ text: inputValue, x: x, y: y, xDirection: xDirection, yDirection: yDirection });
            console.log("text: ", texts[texts.length - 1]);
        }
    });
    animate();
}


document.addEventListener('mousemove', function (event) {
    //move the text if it is being dragged
    for (let i = 0; i < texts.length; i++) {
        if (texts[i].isDragging) {
            texts[i].x = event.clientX;
            texts[i].y = event.clientY;
        }
    }
    console.log("mousemove");
});
document.addEventListener('mouseup', function (event) {
    console.log("mouseup");
});
document.addEventListener('mousedown', function (event) {
    //check if the mouse is over any of the texts
    for (let i = 0; i < texts.length; i++) {
        if (hitTest(event.clientX, event.clientY, texts[i])) {
            console.log("Mouse clicked on text: ", texts[i].text);
            texts[i].isDragging = true;
            texts[i].startX = event.clientX;
            texts[i].startY = event.clientY;
            texts[i].xDirection = 0;
            texts[i].yDirection = 0;
            break;
        }
    }
});
//need hitTest function
function hitTest(mouseX, mouseY, textObj) {
    ctx.font = '30px Arial';
    const width = ctx.measureText(textObj.text).width;
    const height = 30; // font size
    // Text is drawn from baseline, so top of text is at y - height
    return mouseX >= textObj.x && mouseX <= textObj.x + width && mouseY >= textObj.y - height && mouseY <= textObj.y;
}
function checkEdges(text) {
    if (text.x > canvas.width) {
        text.xDirection = -text.xDirection;
    }
    if (text.x < 0) {
        text.xDirection = -text.xDirection;
    }
    if (text.y > canvas.height) {
        text.yDirection = -text.yDirection;
    }
    if (text.y < 0) {
        text.yDirection = -text.yDirection;
    }
}


init();

function animate() {
    requestAnimationFrame(animate);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'red';
    ctx.font = '30px Arial';
    for (let i = 0; i < texts.length; i++) {
        ctx.fillText(texts[i].text, texts[i].x, texts[i].y);
        texts[i].x = texts[i].x + texts[i].xDirection;
        texts[i].y = texts[i].y + texts[i].yDirection;
        checkEdges(texts[i]);
    }
    //console.log("animate");
}



