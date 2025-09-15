// js/ort-page-initializer.js
// This script is injected by content.js and runs in the main page's world (window context).
// Its primary responsibilities are:
// 1. Initialize the ONNX Runtime (ORT) environment.
// 2. Load the ONNX phishing detection model.
// 3. Listen for inference requests from content.js (via custom DOM events).
// 4. Perform inference using the loaded model and feature data from content.js.
// 5. Send the prediction results back to content.js (via custom DOM events).

(async function() {
  // Log that the script has started execution in the main page world.
  console.log("[MainWorldInitializerScript] External initializer script started.");

  // Retrieve data passed from the content script via data-* attributes on this script tag.
  // content.js sets 'data-wasm-directory' and 'data-model-path' when injecting this script.
  const currentScriptTag = document.getElementById('phishing-detector-ort-page-initializer-script');
  if (!currentScriptTag) {
    // Critical error if the script cannot find itself to read passed-in data.
    console.error("[MainWorldInitializerScript] Could not find its own script tag by ID ('phishing-detector-ort-page-initializer-script'). Cannot proceed.");
    // Dispatch an event to content.js indicating failure.
    document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
      detail: { success: false, error: "Initializer script tag not found by ID." }
    }));
    return; // Stop execution if script tag not found.
  }

  // Extract the WASM directory path and model path from the script tag's dataset.
  const wasmDirectory = currentScriptTag.dataset.wasmDirectory;
  const modelPath = currentScriptTag.dataset.modelPath;

  // Validate that both paths were successfully passed.
  if (!wasmDirectory || !modelPath) {
      const errorMsg = "[MainWorldInitializerScript] Critical: WASM directory or model path not received via data attributes.";
      console.error(errorMsg, "Dataset received:", currentScriptTag.dataset);
      // Dispatch an event to content.js indicating failure.
      document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
        detail: { success: false, error: errorMsg }
      }));
      return; // Stop execution if paths are missing.
  }
  console.log("[MainWorldInitializerScript] Received wasmDirectory:", wasmDirectory);
  console.log("[MainWorldInitializerScript] Received modelPath:", modelPath);

  // Wait for the ONNX Runtime library (ort.min.js, injected earlier by content.js)
  // to load and make the `window.ort` object available.
  console.log("[MainWorldInitializerScript] Waiting for window.ort to become available...");
  let ortInWindow;
  let attempts = 0;
  const maxAttempts = 60; // Wait for up to 6 seconds (60 attempts * 100ms interval).

  while (typeof window.ort === 'undefined' && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 100)); // Pause for 100ms before checking again.
    attempts++;
  }
  ortInWindow = window.ort; // Assign window.ort to a local variable.

  // Check if ONNX Runtime loaded successfully.
  if (!ortInWindow) {
    console.error(`[MainWorldInitializerScript] window.ort is undefined after ${attempts * 100}ms.`);
    document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
      detail: { success: false, error: "window.ort not found in main world after timeout" }
    }));
    return;
  }
  console.log("[MainWorldInitializerScript] window.ort found:", ortInWindow);

  // Further validation for the ORT environment structure.
  if (!ortInWindow.env || typeof ortInWindow.env.wasm !== 'object') {
    console.error("[MainWorldInitializerScript] window.ort.env.wasm is not a valid object.");
    document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
      detail: { success: false, error: "window.ort.env.wasm is invalid or not found" }
    }));
    return;
  }

  try {
    // Configure the WASM paths for ONNX Runtime.
    // This tells ORT where to find its WebAssembly backend files (e.g., ort-wasm.wasm).
    // The `wasmDirectory` should be the URL to the 'js/' folder within the extension.
    ortInWindow.env.wasm.wasmPaths = wasmDirectory;
    console.log(`[MainWorldInitializerScript] ONNX WASM paths configured to: ${wasmDirectory}`);
    // Log the WASM environment configuration for debugging.
    console.log("[MainWorldInitializerScript] ort.env.wasm after config:", JSON.stringify(ortInWindow.env.wasm, null, 2));

    // Create the ONNX inference session.
    // This asynchronously loads the .onnx model file specified by `modelPath`.
    // It uses the 'wasm' execution provider for running on the CPU via WebAssembly.
    console.log(`[MainWorldInitializerScript] Loading ONNX model from: ${modelPath}`);
    const session = await ortInWindow.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
    console.log("[MainWorldInitializerScript] ONNX Session created successfully in main world.");

    // Store the created session on a global object (window.phishingDetectorSharedOrtSession) in the main world.
    // This makes the session accessible to the event listener that handles inference requests.
    window.phishingDetectorSharedOrtSession = session;

    // Dispatch a custom event to content.js to signal that ORT and the session are initialized.
    // Include input/output names from the session, which content.js might need.
    document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
      detail: {
        success: true,
        inputNames: session.inputNames,   // Names of the input nodes of the ONNX model
        outputNames: session.outputNames, // Names of the output nodes of the ONNX model
        message: "ONNX Runtime and session initialized successfully in main world."
      }
    }));
  } catch (e) {
    // Catch any errors during ORT setup or session creation.
    console.error("[MainWorldInitializerScript] Error during ORT setup or session creation:", e.message, e.stack);
    document.dispatchEvent(new CustomEvent('ortMainWorldResponse', {
      detail: { success: false, error: e.message || String(e) } // Send error message back to content.js
    }));
    // Do not return here, still set up the inference request listener if possible,
    // or content.js might hang waiting for 'ortInitializerScriptReady'.
    // The 'ortMainWorldResponse' failure will prevent actual inference.
  }

  // --- Event Listener for Inference Requests ---
  // This listener waits for 'runOrtInferenceRequest' events dispatched by content.js.
  // When an event is received, it performs inference using the shared ONNX session.
  document.addEventListener('runOrtInferenceRequest', async (event) => {
    console.log("[MainWorldBridge] Received 'runOrtInferenceRequest' event from content script", event.detail);
    const { requestId, features, inputName } = event.detail; // Destructure details from the event

    // Check if the ONNX session is available.
    if (!window.phishingDetectorSharedOrtSession) {
      console.error("[MainWorldBridge] ONNX session not available for inference.");
      document.dispatchEvent(new CustomEvent('ortPredictionResponse', {
        detail: { success: false, error: "ONNX session not available in main world.", requestId: requestId }
      }));
      return;
    }
    // Validate that necessary data (features, inputName) for inference was provided.
    if (!inputName || !features) {
      console.error("[MainWorldBridge] Missing features or inputName for inference.");
      document.dispatchEvent(new CustomEvent('ortPredictionResponse', {
        detail: { success: false, error: "Missing features or inputName.", requestId: requestId }
      }));
      return;
    }

    try {
      // Convert the feature array (received from content.js) into a Float32Array.
      const tensorData = new Float32Array(features);
      // Create an ONNX Tensor. The shape [1, tensorData.length] indicates a batch size of 1
      // and a 1D array of features. This shape must match the model's expected input.
      const inputTensor = new ortInWindow.Tensor('float32', tensorData, [1, tensorData.length]);

      // Prepare the 'feeds' object for the model. The key must match the model's input name.
      const feeds = {};
      feeds[inputName] = inputTensor;

      console.log("[MainWorldBridge] Running inference with feeds:", feeds);
      // Perform inference using the session's run method.
      const results = await window.phishingDetectorSharedOrtSession.run(feeds);
      console.log("[MainWorldBridge] Inference results obtained:", results);

      // Extract the output data. For scikit-learn classifiers, the primary output (label)
      // is typically the first one.
      const outputTensor = results[window.phishingDetectorSharedOrtSession.outputNames[0]];
      const predictionData = outputTensor.data; // This will be a Float32Array or similar containing the raw numerical output(s)

      // Convert the numerical prediction (0 or 1) to a human-readable label.
      // This assumes the model outputs 1 for "PHISHING" and 0 for "SAFE".
      let finalPrediction = Number(predictionData[0]) === 1 ? "PHISHING" : "SAFE";

      console.log("[MainWorldBridge] Final prediction:", finalPrediction);
      // Dispatch a custom event back to content.js with the prediction result.
      document.dispatchEvent(new CustomEvent('ortPredictionResponse', {
        detail: {
            success: true,
            prediction: finalPrediction,
            rawOutput: Array.from(predictionData), // Send raw numerical output as well for potential debugging
            requestId: requestId // Include original requestId to match response in content.js
        }
      }));

    } catch (e) {
      // Catch errors during the inference process.
      console.error("[MainWorldBridge] Error during inference:", e.message, e.stack);
      document.dispatchEvent(new CustomEvent('ortPredictionResponse', {
        detail: { success: false, error: e.message || String(e), requestId: requestId }
      }));
    }
  });

  // Signal to content.js that this initializer script has finished its setup
  // and the inference event listener ('runOrtInferenceRequest') is now active.
  document.dispatchEvent(new CustomEvent('ortInitializerScriptReady'));
  console.log("[MainWorldInitializerScript] ort-page-initializer.js finished and inference bridge is ready via event listening.");

})();
