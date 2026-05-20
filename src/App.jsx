import React, { useEffect, useMemo, useRef, useState } from "react";
import * as bodySegmentation from "@tensorflow-models/body-segmentation";
import "@tensorflow/tfjs-backend-webgl";

const POSE_WIDTH = 468;
const POSE_HEIGHT = 702;
const SHEET_WIDTH = 1200;
const SHEET_HEIGHT = 1800;
const BG_SRC = "/bg.png";
const FRAME_SRC = "/frame.png";
const AVAILABLE_EMOJIS = ["🥳", "🎸", "🎷", "🎵", "💖", "🧚🏻‍♂️", "💎", "🌸", "💫", "🌈"];
const EMOJI_LIMIT = AVAILABLE_EMOJIS.length;
const PERSON_SCALE = 1.08;
const FRAME_SHADOW_CROP = 64;

function setCanvasCover(ctx, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = sourceHeight * targetRatio;
    cropX = (sourceWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceWidth / targetRatio;
    cropY = (sourceHeight - cropHeight) / 2;
  }

  ctx.drawImage(source, cropX, cropY, cropWidth, cropHeight, targetX, targetY, targetWidth, targetHeight);
}

function drawBlackBackgroundReplacement(ctx, keyedCanvas, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  keyedCanvas.width = targetWidth;
  keyedCanvas.height = targetHeight;

  const keyedCtx = keyedCanvas.getContext("2d", { willReadFrequently: true });
  setCanvasCover(keyedCtx, source, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const frame = keyedCtx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = frame.data;
  const subjectBounds = {
    left: targetWidth,
    right: 0,
    top: targetHeight,
    bottom: 0,
  };
  const subjectScanHeight = Math.round(targetHeight * 0.82);

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const brightness = (red + green + blue) / 3;
    const colorSpread = Math.max(red, green, blue) - Math.min(red, green, blue);

    if (brightness < 42 && colorSpread < 28) {
      pixels[index + 3] = 0;
    } else if (brightness < 72 && colorSpread < 34) {
      pixels[index + 3] = Math.round(((brightness - 42) / 30) * 255);
    }

    if (pixels[index + 3] > 32) {
      const pixel = index / 4;
      const x = pixel % targetWidth;
      const y = Math.floor(pixel / targetWidth);

      if (y < subjectScanHeight) {
        subjectBounds.left = Math.min(subjectBounds.left, x);
        subjectBounds.right = Math.max(subjectBounds.right, x);
        subjectBounds.top = Math.min(subjectBounds.top, y);
        subjectBounds.bottom = Math.max(subjectBounds.bottom, y);
      }
    }
  }

  keyedCtx.putImageData(frame, 0, 0);

  let offsetX = 0;
  let offsetY = 0;

  if (subjectBounds.left <= subjectBounds.right) {
    const subjectCenterX = (subjectBounds.left + subjectBounds.right) / 2;
    const subjectCenterY = (subjectBounds.top + subjectBounds.bottom) / 2;
    const desiredCenterX = targetWidth / 2;
    const desiredCenterY = targetHeight * 0.5;

    offsetX = desiredCenterX - subjectCenterX;
    offsetY = desiredCenterY - subjectCenterY;
    offsetX = Math.max(-targetWidth * 0.18, Math.min(targetWidth * 0.18, offsetX));
    offsetY = Math.max(-targetHeight * 0.1, Math.min(targetHeight * 0.1, offsetY));
  }

  const scaledWidth = targetWidth * PERSON_SCALE;
  const scaledHeight = targetHeight * PERSON_SCALE;
  ctx.drawImage(
    keyedCanvas,
    targetX + offsetX - (scaledWidth - targetWidth) / 2,
    targetY + offsetY - (scaledHeight - targetHeight) / 2,
    scaledWidth,
    scaledHeight
  );
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function drawEmojiOverlays(baseCanvas, emojis) {
  const canvas = cloneCanvas(baseCanvas);
  const ctx = canvas.getContext("2d");

  if (!emojis.length) return canvas;

  const placements = [
    { x: 0.23, y: 0.19, rotation: -0.1 },
    { x: 0.77, y: 0.75, rotation: 0.1 },
    { x: 0.77, y: 0.19, rotation: 0.08 },
    { x: 0.23, y: 0.75, rotation: -0.08 },
    { x: 0.5, y: 0.18, rotation: 0 },
    { x: 0.5, y: 0.76, rotation: 0 },
    { x: 0.2, y: 0.5, rotation: -0.06 },
    { x: 0.8, y: 0.5, rotation: 0.06 },
    { x: 0.28, y: 0.66, rotation: 0.08 },
    { x: 0.72, y: 0.34, rotation: -0.08 },
  ];

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(canvas.width * 0.24)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

  emojis.forEach((emoji, index) => {
    const placement = placements[index % placements.length];
    const x = canvas.width * placement.x;
    const y = canvas.height * placement.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(placement.rotation);
    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  });

  return canvas;
}

function drawFrameBackground(ctx, frameImage) {
  const sourceWidth = Math.max(1, frameImage.naturalWidth - FRAME_SHADOW_CROP);
  const sourceHeight = Math.max(1, frameImage.naturalHeight - FRAME_SHADOW_CROP);
  ctx.drawImage(frameImage, 0, 0, sourceWidth, sourceHeight, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
}

function drawSheetEmojiOverlays(ctx, emojis, x, y, width, height) {
  if (!emojis.length) return;

  const placements = [
    { x: 0.18, y: -0.01, rotation: -0.1 },
    { x: 0.86, y: 1.01, rotation: 0.1 },
    { x: 0.84, y: -0.01, rotation: 0.08 },
    { x: 0.16, y: 1.01, rotation: -0.08 },
    { x: 0.5, y: -0.015, rotation: 0 },
    { x: 0.5, y: 1.015, rotation: 0 },
    { x: -0.005, y: 0.5, rotation: -0.06 },
    { x: 1.005, y: 0.5, rotation: 0.06 },
    { x: 0.25, y: 0.98, rotation: 0.08 },
    { x: 0.75, y: 0.02, rotation: -0.08 },
  ];

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(width * 0.2)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

  emojis.forEach((emoji, index) => {
    const placement = placements[index % placements.length];
    const emojiX = x + width * placement.x;
    const emojiY = y + height * placement.y;

    ctx.save();
    ctx.translate(emojiX, emojiY);
    ctx.rotate(placement.rotation);
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  });
}

async function drawSegmentedPerson(ctx, segmenter, keyedCanvas, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  keyedCanvas.width = targetWidth;
  keyedCanvas.height = targetHeight;

  const keyedCtx = keyedCanvas.getContext("2d", { willReadFrequently: true });
  setCanvasCover(keyedCtx, source, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const segmentations = await segmenter.segmentPeople(keyedCanvas, {
    flipHorizontal: false,
    multiSegmentation: false,
    segmentBodyParts: false,
  });

  if (!segmentations.length) {
    drawBlackBackgroundReplacement(ctx, keyedCanvas, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight);
    return;
  }

  const mask = await bodySegmentation.toBinaryMask(
    segmentations,
    { r: 255, g: 255, b: 255, a: 255 },
    { r: 0, g: 0, b: 0, a: 0 },
    false,
    0.45
  );
  const frame = keyedCtx.getImageData(0, 0, targetWidth, targetHeight);
  const framePixels = frame.data;
  const maskPixels = mask.data;
  const subjectBounds = {
    left: targetWidth,
    right: 0,
    top: targetHeight,
    bottom: 0,
  };

  for (let index = 0; index < framePixels.length; index += 4) {
    const alpha = maskPixels[index + 3];
    framePixels[index + 3] = alpha;

    if (alpha > 32) {
      const pixel = index / 4;
      const x = pixel % targetWidth;
      const y = Math.floor(pixel / targetWidth);

      subjectBounds.left = Math.min(subjectBounds.left, x);
      subjectBounds.right = Math.max(subjectBounds.right, x);
      subjectBounds.top = Math.min(subjectBounds.top, y);
      subjectBounds.bottom = Math.max(subjectBounds.bottom, y);
    }
  }

  keyedCtx.putImageData(frame, 0, 0);

  let offsetX = 0;
  let offsetY = 0;

  if (subjectBounds.left <= subjectBounds.right) {
    const subjectCenterX = (subjectBounds.left + subjectBounds.right) / 2;
    const subjectCenterY = (subjectBounds.top + subjectBounds.bottom) / 2;

    offsetX = targetWidth / 2 - subjectCenterX;
    offsetY = targetHeight * 0.5 - subjectCenterY;
    offsetX = Math.max(-targetWidth * 0.18, Math.min(targetWidth * 0.18, offsetX));
    offsetY = Math.max(-targetHeight * 0.1, Math.min(targetHeight * 0.1, offsetY));
  }

  const scaledWidth = targetWidth * PERSON_SCALE;
  const scaledHeight = targetHeight * PERSON_SCALE;
  ctx.drawImage(
    keyedCanvas,
    targetX + offsetX - (scaledWidth - targetWidth) / 2,
    targetY + offsetY - (scaledHeight - targetHeight) / 2,
    scaledWidth,
    scaledHeight
  );
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const keyedCanvasRef = useRef(document.createElement("canvas"));
  const backgroundImageRef = useRef(null);
  const frameImageRef = useRef(null);
  const segmenterRef = useRef(null);
  const segmenterLoadingRef = useRef(null);

  const [status, setStatus] = useState({ message: "Waiting for camera permission", type: "" });
  const [cameras, setCameras] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [poses, setPoses] = useState([]);
  const [activePoseIndex, setActivePoseIndex] = useState(0);
  const [sheetUrl, setSheetUrl] = useState("");

  const captureLabel = useMemo(() => {
    if (poses.length >= 3) return "Start Over";
    return `Capture ${poses.length + 1}/3`;
  }, [poses.length]);

  useEffect(() => {
    const image = new Image();
    image.src = BG_SRC;
    backgroundImageRef.current = image;

    const frame = new Image();
    frame.src = FRAME_SRC;
    frameImageRef.current = frame;

    return () => {
      stopStream();
    };
  }, []);

  useEffect(() => {
    listCameras().finally(() => {
      startCamera();
    });
  }, []);

  async function getSegmenter() {
    if (segmenterRef.current) return segmenterRef.current;
    if (segmenterLoadingRef.current) return segmenterLoadingRef.current;

    updateStatus("Loading person mask");
    segmenterLoadingRef.current = bodySegmentation
      .createSegmenter(bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation, {
        runtime: "mediapipe",
        modelType: "general",
        solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation",
      })
      .then((segmenter) => {
        segmenterRef.current = segmenter;
        return segmenter;
      })
      .catch((error) => {
        console.warn("MediaPipe segmentation failed, using black key fallback.", error);
        segmenterLoadingRef.current = null;
        updateStatus("Person mask unavailable, using fallback", "error");
        return null;
      });

    return segmenterLoadingRef.current;
  }

  function updateStatus(message, type = "") {
    setStatus({ message, type });
  }

  function stopStream() {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    setCameras(videoInputs);

    const nvidiaCamera = videoInputs.find((camera) => /nvidia|broadcast/i.test(camera.label));
    setSelectedDevice((current) => current || nvidiaCamera?.deviceId || videoInputs[0]?.deviceId || "");
  }

  async function startCamera(deviceId = selectedDevice) {
    if (!navigator.mediaDevices?.getUserMedia) {
      updateStatus("Camera access is not supported in this browser", "error");
      return;
    }

    stopStream();
    updateStatus("Starting camera");

    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await listCameras();
      setCameraReady(true);
      updateStatus("Camera is live", "ready");
    } catch (error) {
      setCameraReady(false);
      updateStatus(error.message || "Could not start camera", "error");
    }
  }

  async function handleDeviceChange(event) {
    const deviceId = event.target.value;
    setSelectedDevice(deviceId);
    await startCamera(deviceId);
  }

  async function ensureBackgroundLoaded() {
    const image = backgroundImageRef.current;
    if (!image) return false;
    if (image.complete) return true;

    updateStatus("Loading background image");
    try {
      await image.decode();
      return true;
    } catch {
      updateStatus("Could not load bg.png", "error");
      return false;
    }
  }

  async function ensureFrameLoaded() {
    const image = frameImageRef.current;
    if (!image) return null;
    if (image.complete && image.naturalWidth) return image;

    try {
      await image.decode();
      return image.naturalWidth ? image : null;
    } catch {
      return null;
    }
  }

  async function makePoseCanvas() {
    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) return null;

    const poseCanvas = document.createElement("canvas");
    poseCanvas.width = POSE_WIDTH;
    poseCanvas.height = POSE_HEIGHT;

    const ctx = poseCanvas.getContext("2d");
    ctx.clearRect(0, 0, POSE_WIDTH, POSE_HEIGHT);

    const backgroundImage = backgroundImageRef.current;
    if (backgroundImage?.naturalWidth) {
      setCanvasCover(ctx, backgroundImage, backgroundImage.naturalWidth, backgroundImage.naturalHeight, 0, 0, POSE_WIDTH, POSE_HEIGHT);
    }

    const segmenter = await getSegmenter();
    if (segmenter) {
      await drawSegmentedPerson(ctx, segmenter, keyedCanvasRef.current, video, width, height, 0, 0, POSE_WIDTH, POSE_HEIGHT);
    } else {
      drawBlackBackgroundReplacement(ctx, keyedCanvasRef.current, video, width, height, 0, 0, POSE_WIDTH, POSE_HEIGHT);
    }

    return poseCanvas;
  }

  async function drawSheet(nextPoses) {
    const canvas = canvasRef.current;
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);

    const frameImage = await ensureFrameLoaded();
    if (frameImage) {
      drawFrameBackground(ctx, frameImage);
    }

    const columns = 2;
    const rows = 3;
    const stripWidth = SHEET_WIDTH / columns;
    const stripSideMargin = 44;
    const rowGap = 42;
    const gridScale = 0.86;
    const gridTop = 24;
    const imageWidth = stripWidth - stripSideMargin * 2;
    const imageHeight = ((SHEET_HEIGHT - gridTop * 2 - rowGap * (rows - 1)) / rows) * gridScale;
    const imageBoxes = [];

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const pose = nextPoses[row];
        const x = column * stripWidth + stripSideMargin;
        const y = gridTop + row * (imageHeight + rowGap);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - 4, y - 4, imageWidth + 8, imageHeight + 8);
        setCanvasCover(ctx, pose.baseCanvas, pose.baseCanvas.width, pose.baseCanvas.height, x, y, imageWidth, imageHeight);
        imageBoxes.push({ pose, x, y, imageWidth, imageHeight });
      }
    }

    imageBoxes.forEach(({ pose, x, y, imageWidth, imageHeight }) => {
      drawSheetEmojiOverlays(ctx, pose.emojis, x, y, imageWidth, imageHeight);
    });

    const dataUrl = canvas.toDataURL("image/png");
    setSheetUrl(dataUrl);
    updateStatus("4 x 6 sheet ready", "ready");
  }

  function resetPoses() {
    setPoses([]);
    setActivePoseIndex(0);
    setSheetUrl("");
    updateStatus("Ready for pose 1", "ready");
  }

  function updatePoseEmojis(poseIndex, emoji) {
    setPoses((currentPoses) => {
      if (!currentPoses[poseIndex]) return currentPoses;

      const nextPoses = currentPoses.map((pose, index) => {
        if (index !== poseIndex) return pose;

        const selected = pose.emojis.includes(emoji)
          ? pose.emojis.filter((selectedEmoji) => selectedEmoji !== emoji)
          : pose.emojis.length < EMOJI_LIMIT
            ? [...pose.emojis, emoji]
            : [pose.emojis[1], emoji];
        const canvas = drawEmojiOverlays(pose.baseCanvas, selected);

        return {
          ...pose,
          emojis: selected,
          canvas,
          url: canvas.toDataURL("image/png"),
        };
      });

      if (nextPoses.length === 3) {
        requestAnimationFrame(() => {
          drawSheet(nextPoses);
        });
      }

      return nextPoses;
    });
  }

  function printSheet() {
    if (!sheetUrl) return;

    const printWindow = window.open("", "_blank", "width=700,height=900");
    if (!printWindow) {
      updateStatus("Allow popups to print the sheet", "error");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Print 4 x 6 Sheet</title>
          <style>
            @page {
              size: 4in 6in;
              margin: 0;
            }

            html,
            body {
              margin: 0;
              width: 4in;
              height: 6in;
              background: #2a2c69;
            }

            img {
              display: block;
              width: 4in;
              height: 6in;
              object-fit: fill;
            }
          </style>
        </head>
        <body>
          <img src="${sheetUrl}" alt="4 by 6 photo sheet" />
          <script>
            window.addEventListener("load", () => {
              window.focus();
              window.print();
            });
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  async function captureImage() {
    if (poses.length >= 3) {
      resetPoses();
      return;
    }

    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      updateStatus("Camera frame is not ready yet", "error");
      return;
    }

    const backgroundLoaded = await ensureBackgroundLoaded();
    if (!backgroundLoaded) return;

    updateStatus("Adding background");
    const poseCanvas = await makePoseCanvas();
    if (!poseCanvas) {
      updateStatus("Camera frame is not ready yet", "error");
      return;
    }

    const finalCanvas = drawEmojiOverlays(poseCanvas, []);

    const nextPoses = [
      ...poses,
      {
        id: crypto.randomUUID(),
        url: finalCanvas.toDataURL("image/png"),
        baseCanvas: poseCanvas,
        canvas: finalCanvas,
        emojis: [],
      },
    ];

    setPoses(nextPoses);
    setActivePoseIndex(nextPoses.length - 1);

    if (nextPoses.length === 3) {
      await drawSheet(nextPoses);
    } else {
      updateStatus(`Pose ${nextPoses.length} captured. Choose emojis`, "ready");
    }
  }

  const activePose = poses[activePoseIndex] || null;

  return (
    <div className="app">
      <header>
        <h1>NVIDIA Broadcast Camera Capture</h1>
        <div className={`status ${status.type}`.trim()}>{status.message}</div>
      </header>

      <main>
        <section className="preview" aria-label="Camera preview">
          <div className="video-wrap">
            <video ref={videoRef} autoPlay playsInline muted />
          </div>
        </section>

        <aside>
          <div className="field">
            <label htmlFor="cameraSelect">Camera source</label>
            <select id="cameraSelect" value={selectedDevice} onChange={handleDeviceChange}>
              {cameras.length ? (
                cameras.map((camera, index) => (
                  <option key={camera.deviceId || index} value={camera.deviceId}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))
              ) : (
                <option value="">No cameras found</option>
              )}
            </select>
          </div>

          <div className="actions">
            <button type="button" onClick={() => startCamera()}>
              Start
            </button>
            <button className="primary" type="button" disabled={!cameraReady} onClick={captureImage}>
              {captureLabel}
            </button>
          </div>

          <section className="captured" aria-label="Captured picture">
            <h2>Captured poses</h2>
            <div className="pose-list">
              {[0, 1, 2].map((index) => (
                <button
                  className={`pose-slot ${activePoseIndex === index ? "selected" : ""}`.trim()}
                  type="button"
                  key={index}
                  disabled={!poses[index]}
                  onClick={() => setActivePoseIndex(index)}
                >
                  {poses[index] ? (
                    <>
                      <img src={poses[index].url} alt={`Pose ${index + 1}`} />
                      <span>{poses[index].emojis.length}/{EMOJI_LIMIT}</span>
                    </>
                  ) : (
                    index + 1
                  )}
                </button>
              ))}
            </div>

            <div className="emoji-panel">
              <div className="emoji-toolbar">
                <h2>Emoji selection</h2>
                <span>{activePose ? `${activePose.emojis.length}/${EMOJI_LIMIT} selected` : "Capture a pose"}</span>
              </div>
              <div className="emoji-grid" aria-label="Emoji choices">
                {AVAILABLE_EMOJIS.map((emoji) => {
                  const selected = activePose?.emojis.includes(emoji);

                  return (
                    <button
                      className={selected ? "selected" : ""}
                      type="button"
                      key={emoji}
                      disabled={!activePose}
                      aria-pressed={selected || false}
                      onClick={() => updatePoseEmojis(activePoseIndex, emoji)}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>

            <h2>4 x 6 sheet</h2>
            <div className="capture-box">
              {sheetUrl ? <img src={sheetUrl} alt="4 by 6 sheet with six captured photos" /> : "Capture 3 poses"}
            </div>
            <div className={`output-actions ${sheetUrl ? "visible" : ""}`}>
              <a className="download" href={sheetUrl || undefined} download="nvidia-broadcast-4x6-sheet.png">
                Save 4 x 6 PNG
              </a>
              <button type="button" onClick={printSheet}>
                Print
              </button>
            </div>
          </section>

          <p className="hint">
            Pick the NVIDIA Broadcast virtual camera, capture three poses, then select emojis for each pose before saving or printing.
          </p>
        </aside>
      </main>

      <canvas ref={canvasRef} />
    </div>
  );
}
