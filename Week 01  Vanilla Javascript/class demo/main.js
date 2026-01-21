
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



