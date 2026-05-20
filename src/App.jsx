import React, { useEffect, useMemo, useRef, useState } from "react";
import * as bodySegmentation from "@tensorflow-models/body-segmentation";
import "@tensorflow/tfjs-backend-webgl";

const POSE_WIDTH = 468;
const POSE_HEIGHT = 702;
const SHEET_WIDTH = 1200;
const SHEET_HEIGHT = 1800;
const FRAME_SRC = "/frame.png";
const PERSON_SCALE = 1;
const FRAME_SHADOW_CROP = 64;
const BACKGROUND_OPTIONS = [
  { id: "bg-1", name: "Mountains", previewSrc: "/select1.png", src: "/bg1.png" },
  { id: "bg-2", name: "Beach", previewSrc: "/select2.png", src: "/bg2.png" },
  { id: "bg-3", name: "Desert", previewSrc: "/select3.png", src: "/bg3.png" },
];
const STRIP_OPTIONS = [
  { id: "strip-3", count: 3, name: "3 Strip", previewSrc: "/strip3.png" },
  { id: "strip-5", count: 5, name: "5 Strip", previewSrc: "/strip5.png" },
];
const EMOJI_COUNT = 17;
const AVAILABLE_EMOJIS = Array.from({ length: EMOJI_COUNT }, (_, index) => index + 1).map((number) => ({
  id: String(number),
  src: `/emojis/${number}.png`,
  name: `Emoji ${number}`,
}));
const FIXED_EMOJI_POSITIONS = {
  3: [
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.56 },
    { x: 0.15, y: 0.86 },
  ],
  5: [
    { x: 0.1, y: 0.7 },
    { x: 0.9, y: 0.86 },
    { x: 0.15, y: 0.86 },
    { x: 0.88, y: 0.86 },
    { x: 0.13, y: 0.84 },
  ],
};

function setCanvasCover(ctx, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  setCanvasCoverWithFocus(ctx, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight, 0.5, 0.5);
}

function setCanvasCoverWithFocus(ctx, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight, focusX = 0.5, focusY = 0.5) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = sourceHeight * targetRatio;
    cropX = (sourceWidth - cropWidth) * focusX;
  } else {
    cropHeight = sourceWidth / targetRatio;
    cropY = (sourceHeight - cropHeight) * focusY;
  }

  cropX = Math.max(0, Math.min(sourceWidth - cropWidth, cropX));
  cropY = Math.max(0, Math.min(sourceHeight - cropHeight, cropY));

  ctx.drawImage(source, cropX, cropY, cropWidth, cropHeight, targetX, targetY, targetWidth, targetHeight);
}

function setCanvasContain(ctx, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let drawWidth = targetWidth;
  let drawHeight = targetHeight;

  if (sourceRatio > targetRatio) {
    drawHeight = targetWidth / sourceRatio;
  } else {
    drawWidth = targetHeight * sourceRatio;
  }

  ctx.drawImage(
    source,
    targetX + (targetWidth - drawWidth) / 2,
    targetY + (targetHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
}

function drawFrameBackground(ctx, frameImage) {
  const sourceWidth = Math.max(1, frameImage.naturalWidth - FRAME_SHADOW_CROP);
  const sourceHeight = Math.max(1, frameImage.naturalHeight - FRAME_SHADOW_CROP);
  ctx.drawImage(frameImage, 0, 0, sourceWidth, sourceHeight, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
}

function getSheetBoxes(stripCount) {
  const columns = 2;
  const rows = stripCount;
  const stripWidth = SHEET_WIDTH / columns;
  const stripSideMargin = stripCount === 3 ? 44 : 50;
  const rowGap = stripCount === 3 ? 42 : 24;
  const gridScale = stripCount === 3 ? 0.86 : 0.88;
  const gridTop = 24;
  const imageWidth = stripWidth - stripSideMargin * 2;
  const imageHeight = ((SHEET_HEIGHT - gridTop * 2 - rowGap * (rows - 1)) / rows) * gridScale;
  const boxes = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      boxes.push({
        poseIndex: row,
        x: column * stripWidth + stripSideMargin,
        y: gridTop + row * (imageHeight + rowGap),
        width: imageWidth,
        height: imageHeight,
      });
    }
  }

  return boxes;
}

function drawEmojiAt(ctx, emojiImage, x, y, size) {
  if (!emojiImage) return;

  const imageWidth = emojiImage.naturalWidth || size;
  const imageHeight = emojiImage.naturalHeight || size;
  const ratio = imageWidth / imageHeight;
  const drawWidth = ratio >= 1 ? size : size * ratio;
  const drawHeight = ratio >= 1 ? size / ratio : size;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  ctx.drawImage(emojiImage, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

function makePreviewUrl(sourceCanvas, ratio, focusY = 0.5) {
  const width = 380;
  const height = Math.round(width / ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  setCanvasCoverWithFocus(ctx, sourceCanvas, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height, 0.5, focusY);
  return canvas.toDataURL("image/png");
}

function drawBlackBackgroundReplacement(ctx, keyedCanvas, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  keyedCanvas.width = targetWidth;
  keyedCanvas.height = targetHeight;

  const keyedCtx = keyedCanvas.getContext("2d", { willReadFrequently: true });
  keyedCtx.clearRect(0, 0, targetWidth, targetHeight);
  setCanvasContain(keyedCtx, source, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const frame = keyedCtx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = frame.data;
  const subjectBounds = { left: targetWidth, right: 0, top: targetHeight, bottom: 0 };
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
  drawPositionedPerson(ctx, keyedCanvas, subjectBounds, targetX, targetY, targetWidth, targetHeight);
}

function drawPositionedPerson(ctx, keyedCanvas, subjectBounds, targetX, targetY, targetWidth, targetHeight) {
  let offsetX = 0;
  let offsetY = 0;

  if (subjectBounds.left <= subjectBounds.right) {
    const subjectCenterX = (subjectBounds.left + subjectBounds.right) / 2;

    offsetX = targetWidth / 2 - subjectCenterX;
    offsetY = targetHeight - subjectBounds.bottom;
    offsetX = Math.max(-targetWidth * 0.18, Math.min(targetWidth * 0.18, offsetX));
    offsetY = Math.max(-targetHeight * 0.18, Math.min(targetHeight * 0.18, offsetY));
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

async function drawSegmentedPerson(ctx, segmenter, keyedCanvas, source, sourceWidth, sourceHeight, targetX, targetY, targetWidth, targetHeight) {
  keyedCanvas.width = targetWidth;
  keyedCanvas.height = targetHeight;

  const keyedCtx = keyedCanvas.getContext("2d", { willReadFrequently: true });
  keyedCtx.clearRect(0, 0, targetWidth, targetHeight);
  setCanvasContain(keyedCtx, source, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

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
  const subjectBounds = { left: targetWidth, right: 0, top: targetHeight, bottom: 0 };

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
  drawPositionedPerson(ctx, keyedCanvas, subjectBounds, targetX, targetY, targetWidth, targetHeight);
}

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const keyedCanvasRef = useRef(document.createElement("canvas"));
  const backgroundImageRef = useRef(null);
  const frameImageRef = useRef(null);
  const emojiImagesRef = useRef({});
  const segmenterRef = useRef(null);
  const segmenterLoadingRef = useRef(null);
  const imageBoxesRef = useRef([]);

  const [step, setStep] = useState(() => sessionStorage.getItem("photoBoothStep") || "background");
  const [status, setStatus] = useState({ message: "Select a background", type: "" });
  const [cameras, setCameras] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedBackground, setSelectedBackground] = useState(BACKGROUND_OPTIONS[0]);
  const [stripCount, setStripCount] = useState(3);
  const [cameraReady, setCameraReady] = useState(false);
  const [isCapturingSequence, setIsCapturingSequence] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [poses, setPoses] = useState([]);
  const [activeEmoji, setActiveEmoji] = useState(AVAILABLE_EMOJIS[0]);
  const [emojiPlacements, setEmojiPlacements] = useState([]);
  const [sheetUrl, setSheetUrl] = useState("");

  const captureLabel = useMemo(() => {
    if (isCapturingSequence) return "Capturing...";
    if (poses.length >= stripCount) return "Preview";
    return "Capture";
  }, [isCapturingSequence, poses.length, stripCount]);
  const selectedBackgroundIndex = BACKGROUND_OPTIONS.findIndex((option) => option.id === selectedBackground.id);
  const carouselBackgrounds = BACKGROUND_OPTIONS.map((_, index) => BACKGROUND_OPTIONS[(selectedBackgroundIndex + index) % BACKGROUND_OPTIONS.length]);
  const capturePreviewBox = getSheetBoxes(stripCount)[0];
  const capturePreviewRatioValue = capturePreviewBox ? capturePreviewBox.width / capturePreviewBox.height : 2 / 3;
  const capturePreviewRatio = capturePreviewBox ? `${capturePreviewBox.width} / ${capturePreviewBox.height}` : "2 / 3";

  useEffect(() => {
    const frame = new Image();
    frame.src = FRAME_SRC;
    frameImageRef.current = frame;

    emojiImagesRef.current = AVAILABLE_EMOJIS.reduce((images, emoji) => {
      const image = new Image();
      image.src = emoji.src;
      images[emoji.id] = image;
      return images;
    }, {});

    listCameras();

    return () => {
      stopStream();
    };
  }, []);

  useEffect(() => {
    const image = new Image();
    image.src = selectedBackground.src;
    backgroundImageRef.current = image;
  }, [selectedBackground]);

  useEffect(() => {
    if (step === "capture") {
      startCamera();
      return;
    }

    stopStream();
  }, [step]);

  useEffect(() => {
    sessionStorage.setItem("photoBoothStep", step);
  }, [step]);

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
    setCameraReady(false);
  }

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === "videoinput");
    setCameras(videoInputs);
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
      updateStatus(`Capture ${stripCount} photos`, "ready");
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

  async function ensureImageLoaded(image, message) {
    if (!image) return false;
    if (image.complete && image.naturalWidth) return true;

    updateStatus(message);
    try {
      await image.decode();
      return Boolean(image.naturalWidth);
    } catch {
      return false;
    }
  }

  async function makePoseCanvas() {
    const video = videoRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) return null;

    const backgroundLoaded = await ensureImageLoaded(backgroundImageRef.current, "Loading background");
    if (!backgroundLoaded) {
      updateStatus("Could not load selected background", "error");
      return null;
    }

    const poseCanvas = document.createElement("canvas");
    poseCanvas.width = width;
    poseCanvas.height = height;

    const ctx = poseCanvas.getContext("2d");
    const backgroundImage = backgroundImageRef.current;
    setCanvasCover(ctx, backgroundImage, backgroundImage.naturalWidth, backgroundImage.naturalHeight, 0, 0, poseCanvas.width, poseCanvas.height);

    const segmenter = await getSegmenter();
    if (segmenter) {
      await drawSegmentedPerson(ctx, segmenter, keyedCanvasRef.current, video, width, height, 0, 0, poseCanvas.width, poseCanvas.height);
    } else {
      drawBlackBackgroundReplacement(ctx, keyedCanvasRef.current, video, width, height, 0, 0, poseCanvas.width, poseCanvas.height);
    }

    return poseCanvas;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function drawSheet(nextPoses = poses, nextPlacements = emojiPlacements) {
    const canvas = canvasRef.current;
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);

    const frameLoaded = await ensureImageLoaded(frameImageRef.current, "Loading strip frame");
    if (frameLoaded) {
      drawFrameBackground(ctx, frameImageRef.current);
    }

    const boxes = getSheetBoxes(stripCount);
    imageBoxesRef.current = boxes;

    boxes.forEach((box) => {
      const pose = nextPoses[box.poseIndex];
      if (!pose) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
      setCanvasCoverWithFocus(
        ctx,
        pose.baseCanvas,
        pose.baseCanvas.width,
        pose.baseCanvas.height,
        box.x,
        box.y,
        box.width,
        box.height,
        0.5,
        stripCount === 5 ? 0.92 : 0.5
      );
    });

    boxes.forEach((box) => {
      const placement = nextPlacements[box.poseIndex];
      if (!placement) return;
      const emojiImage = emojiImagesRef.current[placement.emoji.id];

      drawEmojiAt(
        ctx,
        emojiImage,
        box.x + box.width * placement.x,
        box.y + box.height * placement.y,
        box.width * 0.32
      );
    });

    const dataUrl = canvas.toDataURL("image/png");
    setSheetUrl(dataUrl);
    updateStatus("Preview ready", "ready");
    return dataUrl;
  }

  function resetProject(nextStep = "background") {
    setPoses([]);
    setEmojiPlacements([]);
    setSheetUrl("");
    setStep(nextStep);
    updateStatus(nextStep === "background" ? "Select a background" : `Capture ${stripCount} photos`, "ready");
  }

  function chooseBackground(option) {
    setSelectedBackground(option);
    setSheetUrl("");
  }

  function chooseStrip(count) {
    setStripCount(count);
    setPoses([]);
    setEmojiPlacements(Array(count).fill(null));
    setSheetUrl("");
  }

  function goToCapture() {
    setPoses([]);
    setEmojiPlacements(Array(stripCount).fill(null));
    setSheetUrl("");
    setSelectedDevice("");
    setStep("capture");
  }

  async function goToEdit() {
    await drawSheet(poses, emojiPlacements);
    setStep("edit");
  }

  async function captureOnePhoto() {
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      updateStatus("Camera frame is not ready yet", "error");
      return null;
    }

    updateStatus("Adding background");
    const poseCanvas = await makePoseCanvas();
    if (!poseCanvas) {
      updateStatus("Camera frame is not ready yet", "error");
      return null;
    }

    return {
      id: crypto.randomUUID(),
      url: poseCanvas.toDataURL("image/png"),
      previewUrl: makePreviewUrl(poseCanvas, capturePreviewRatioValue, stripCount === 5 ? 0.92 : 0.5),
      baseCanvas: poseCanvas,
    };
  }

  async function captureImage() {
    if (poses.length >= stripCount) {
      await goToEdit();
      return;
    }

    if (isCapturingSequence) return;

    if (!cameraReady) {
      updateStatus("Camera frame is not ready yet", "error");
      return;
    }

    setIsCapturingSequence(true);

    try {
      const nextPoses = [...poses];

      while (nextPoses.length < stripCount) {
        for (let value = 3; value >= 1; value -= 1) {
          setCountdown(value);
          updateStatus(`Photo ${nextPoses.length + 1} in ${value}`);
          await wait(1000);
        }

        setCountdown(null);
        const pose = await captureOnePhoto();
        if (!pose) return;

        nextPoses.push(pose);
        setPoses([...nextPoses]);
        updateStatus(`Photo ${nextPoses.length} captured`, "ready");
        await wait(350);
      }

      updateStatus("All photos captured. Open preview.", "ready");
    } finally {
      setCountdown(null);
      setIsCapturingSequence(false);
    }
  }

  async function placeEmoji(event) {
    if (!sheetUrl || !activeEmoji) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const sheetX = ((event.clientX - rect.left) / rect.width) * (SHEET_WIDTH / 2);
    const sheetY = ((event.clientY - rect.top) / rect.height) * SHEET_HEIGHT;
    const box = imageBoxesRef.current.find(
      (candidate) =>
        sheetX >= candidate.x &&
        sheetX <= candidate.x + candidate.width &&
        sheetY >= candidate.y &&
        sheetY <= candidate.y + candidate.height
    );

    if (!box) {
      updateStatus("Click inside a captured photo to place the emoji", "error");
      return;
    }

    const nextPlacements = [...emojiPlacements];
    nextPlacements[box.poseIndex] = {
      emoji: activeEmoji,
      x: Math.max(0, Math.min(1, (sheetX - box.x) / box.width)),
      y: Math.max(0, Math.min(1, (sheetY - box.y) / box.height)),
    };

    setEmojiPlacements(nextPlacements);
    await drawSheet(poses, nextPlacements);
  }

  async function selectEmojiForFixedSlot(emoji) {
    const positions = FIXED_EMOJI_POSITIONS[stripCount] || FIXED_EMOJI_POSITIONS[3];
    const existingIndex = emojiPlacements.findIndex((placement) => placement?.emoji.id === emoji.id);
    const nextPlacements = [...emojiPlacements];

    if (existingIndex >= 0) {
      nextPlacements[existingIndex] = null;
    } else {
      const emptyIndex = nextPlacements.findIndex((placement, index) => index < stripCount && !placement);
      const targetIndex = emptyIndex >= 0 ? emptyIndex : stripCount - 1;
      nextPlacements[targetIndex] = {
        emoji,
        ...positions[targetIndex],
      };
    }

    setActiveEmoji(emoji);
    setEmojiPlacements(nextPlacements);
    await drawSheet(poses, nextPlacements);
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
            @page { size: 4in 6in; margin: 0; }
            html, body {
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

  return (
    <div className="app">
      {step === "background" && (
        <main className="background-selection-screen">
          <section className="background-chooser">
            <h2>
              Choose your <span>background</span>
            </h2>
            <div className="background-carousel" aria-label="Background choices">
              {carouselBackgrounds.map((option, index) => (
                <button
                  className={`background-card position-${index} ${index === 0 ? "selected" : ""}`.trim()}
                  type="button"
                  key={option.id}
                  onClick={() => chooseBackground(option)}
                  aria-label={option.name}
                >
                  <img src={option.previewSrc} alt={option.name} />
                </button>
              ))}
            </div>
            <div className="background-actions">
              <button className="primary" type="button" onClick={() => setStep("strip")}>
                Next
              </button>
            </div>
          </section>
        </main>
      )}

      {step === "strip" && (
        <main className="strip-selection-screen">
          <section className="strip-chooser">
            <h2>
              Pick your <span>strip</span>
            </h2>
            <div className="strip-grid">
              {STRIP_OPTIONS.map((option) => (
                <button
                  className={`strip-choice ${stripCount === option.count ? "selected" : ""}`.trim()}
                  type="button"
                  key={option.id}
                  onClick={() => chooseStrip(option.count)}
                >
                  <i aria-hidden="true" />
                  <img className="strip-preview-image" src={option.previewSrc} alt={option.name} />
                  <strong>{option.count} Strips</strong>
                </button>
              ))}
            </div>
            <div className="strip-actions">
              <button className="ghost" type="button" onClick={() => setStep("background")}>
                Back
              </button>
              <button className="primary" type="button" onClick={goToCapture}>
                Next
              </button>
            </div>
          </section>
        </main>
      )}

      {step === "capture" && (
        <main className={`capture-screen strip-${stripCount}`}>
          <h2 className="capture-title">
            Show your best <span>poses</span>
          </h2>
          <section className="camera-area" aria-label="Camera preview">
            <div className="video-wrap">
              <video ref={videoRef} autoPlay playsInline muted />
              {countdown && <div className="countdown-overlay">{countdown}</div>}
            </div>
            <div className="capture-actions">
              <button className="primary" type="button" disabled={!cameraReady || isCapturingSequence} onClick={captureImage}>
                {captureLabel}
              </button>
            </div>
          </section>

          <aside className="capture-side">
            <section className="captured" aria-label="Captured photos">
              <div
                className={`pose-list strip-${stripCount}`}
                style={{ "--pose-count": stripCount, "--thumb-ratio": capturePreviewRatio }}
              >
                {poses.map((pose, index) => (
                  <div className="pose-slot" key={index}>
                    <img src={pose.previewUrl || pose.url} alt={`Photo ${index + 1}`} />
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </main>
      )}

      {step === "edit" && (
        <main className="editor-screen">
          <div className="edit-content">
            <section className="sheet-workspace">
              <div className="sheet-preview left-strip-preview">
                {sheetUrl ? <img src={sheetUrl} alt="Editable output preview" /> : "Preparing preview"}
              </div>
            </section>

            <aside className="emoji-side">
              <section className="emoji-panel">
                <div className="emoji-toolbar">
                  <h2>Choose Emoji’s to display on strip</h2>
                </div>
                <div className="emoji-grid" aria-label="Emoji choices">
                  {AVAILABLE_EMOJIS.map((emoji) => (
                    <button
                      className={activeEmoji.id === emoji.id ? "selected" : ""}
                    type="button"
                    key={emoji.id}
                    aria-pressed={activeEmoji.id === emoji.id}
                    onClick={() => selectEmojiForFixedSlot(emoji)}
                  >
                      <img src={emoji.src} alt={emoji.name} />
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <div className="edit-actions">
            <button className="primary" type="button" onClick={() => resetProject("background")}>
              Home
            </button>
            <button className="primary" type="button" onClick={printSheet}>
              Print
            </button>
          </div>
        </main>
      )}

      <canvas ref={canvasRef} />
    </div>
  );
}
