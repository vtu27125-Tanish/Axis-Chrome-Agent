// permission.js

const btn = document.getElementById("request-btn");
const success = document.getElementById("success-msg");
const requestContent = document.getElementById("request-content");

let requesting = false;

// -------------------------------------
// Request microphone permission
// -------------------------------------
async function requestMicrophonePermission() {

    if (requesting) return;

    requesting = true;

    btn.disabled = true;

    btn.textContent = "Requesting Permission...";

    try {

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        // Stop immediately
        stream.getTracks().forEach(track => track.stop());

        showSuccess();

    } catch (err) {

        console.error("[Axis]", err);

        btn.disabled = false;

        btn.textContent = "Grant Microphone Access";

        requesting = false;

        showError(err);

    }

}

// -------------------------------------
// Success
// -------------------------------------
function showSuccess() {

    requestContent.style.display = "none";

    success.style.display = "block";

    console.log("[Axis] Permission granted.");

    setTimeout(() => {

        window.close();

    }, 1800);

}

// -------------------------------------
// Error Handler
// -------------------------------------
function showError(error) {

    let message = "Unable to access microphone.";

    switch (error.name) {

        case "NotAllowedError":

            message =
                "Microphone permission was denied.\n\nPlease enable it from Chrome Extension Settings.";

            break;

        case "NotFoundError":

            message =
                "No microphone was detected on this device.";

            break;

        case "NotReadableError":

            message =
                "The microphone is currently being used by another application.";

            break;

        case "SecurityError":

            message =
                "Browser security prevented microphone access.";

            break;

    }

    alert(message);

}

// -------------------------------------
// Check existing permission
// -------------------------------------
async function checkPermission() {

    if (!navigator.permissions) return;

    try {

        const permission =
            await navigator.permissions.query({
                name: "microphone"
            });

        console.log("[Axis] Permission:", permission.state);

        if (permission.state === "granted") {

            showSuccess();

            return;

        }

        permission.onchange = () => {

            console.log(
                "[Axis] Permission changed:",
                permission.state
            );

            if (permission.state === "granted") {

                showSuccess();

            }

        };

    } catch (err) {

        console.warn(err);

    }

}

// -------------------------------------
// Events
// -------------------------------------
btn.addEventListener(
    "click",
    requestMicrophonePermission
);

// -------------------------------------
// Init
// -------------------------------------
checkPermission();