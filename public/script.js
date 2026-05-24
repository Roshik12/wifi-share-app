const groupInput = document.querySelector("#groupName");
const accessCodeInput = document.querySelector("#accessCode");
const messagesEl = document.querySelector("#messages");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const fileInput = document.querySelector("#fileInput");
const uploadPreview = document.querySelector("#uploadPreview");
const fileName = document.querySelector("#fileName");
const clearFile = document.querySelector("#clearFile");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const serverWarning = document.querySelector("#serverWarning");
const chatApp = document.querySelector("#chatApp");
const roomLabel = document.querySelector("#roomLabel");
const modeKicker = document.querySelector("#modeKicker");
const modeTitle = document.querySelector("#modeTitle");
const modeCopy = document.querySelector("#modeCopy");
const modePill = document.querySelector("#modePill");
const randomGroup = document.querySelector("#randomGroup");
const createGroup = document.querySelector("#createGroup");
const joinGroup = document.querySelector("#joinGroup");
const mainGroup = document.querySelector("#mainGroup");
const groupStatus = document.querySelector("#groupStatus");

let groupName = "main";
let accessCode = "";
let socket;
let pollTimer;
let realtimeMode = false;

groupInput.value = "";
connectToGroup(groupName, accessCode);

function writeCookie(name, value) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function setStatus(connected) {
  statusDot.classList.toggle("connected", connected);
  statusText.textContent = connected ? (realtimeMode ? "Connected" : "Online") : "Disconnected";
}

function setGroupStatus(message, isError = false) {
  groupStatus.textContent = message;
  groupStatus.classList.toggle("error", isError);
}

function updateRoomLabel() {
  const isMain = groupName === "main";
  const roomName = isMain ? "Main room" : `Private group: ${groupName}`;
  chatApp.classList.toggle("group-mode", !isMain);
  modeKicker.textContent = isMain ? "Main board" : "Private group";
  modeTitle.textContent = isMain ? "Normal share" : "Group talk";
  modeCopy.textContent = isMain
    ? "Open anonymous room for quick text, code, links, images, and files."
    : "Password-matched private room for focused group discussion.";
  modePill.textContent = isMain ? "Open" : "Locked";
  roomLabel.textContent = `${roomName} · messages expire after 28 hours`;
}

function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendTextWithCode(container, text) {
  const parts = String(text || "").split(/```/g);

  parts.forEach((part, index) => {
    if (!part) return;

    if (index % 2 === 1) {
      const block = document.createElement("div");
      block.className = "code-block";

      const button = document.createElement("button");
      button.className = "copy-code";
      button.type = "button";
      button.textContent = "Copy";

      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = part.replace(/^\w+\n/, "");
      pre.append(code);

      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 1200);
      });

      block.append(button, pre);
      container.append(block);
      return;
    }

    const textEl = document.createElement("div");
    textEl.className = "message-text";
    textEl.textContent = part;
    container.append(textEl);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function canPreviewImage(fileType) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(fileType || "");
}

function renderMessage(message) {
  const shouldScroll = isNearBottom();
  const article = document.createElement("article");
  article.className = "message";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const user = document.createElement("span");
  user.className = "message-user";
  user.textContent = "Anonymous";

  const time = document.createElement("time");
  time.dateTime = new Date(message.timestamp).toISOString();
  time.textContent = formatTime(message.timestamp);

  meta.append(user, time);
  article.append(meta);

  appendTextWithCode(article, message.text);

  if (message.fileUrl && canPreviewImage(message.fileType)) {
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = message.fileUrl;
    image.alt = message.fileName || "Shared image";
    image.loading = "lazy";
    article.append(image);
  } else if (message.fileUrl) {
    const fileLink = document.createElement("a");
    fileLink.className = "message-file";
    fileLink.href = message.fileUrl;
    fileLink.download = message.fileName || "";

    const name = document.createElement("span");
    name.className = "file-card-name";
    name.textContent = message.fileName || "Download file";

    const meta = document.createElement("span");
    meta.className = "file-card-meta";
    meta.textContent = `${message.fileType || "File"} · ${formatBytes(message.fileSize)}`;

    fileLink.append(name, meta);
    article.append(fileLink);
  }

  messagesEl.append(article);
  if (shouldScroll) scrollToBottom();
}

function resetFileInput() {
  fileInput.value = "";
  uploadPreview.classList.add("hidden");
  fileName.textContent = "";
}

async function loadMessages() {
  const params = new URLSearchParams({ group: groupName, accessCode });
  const response = await fetch(`/api/messages?${params.toString()}`);
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error(payload.error || "Could not load messages.");
  messagesEl.textContent = "";
  payload.forEach(renderMessage);
  scrollToBottom();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read file.")));
    reader.readAsDataURL(file);
  });
}

async function postServerlessMessage(text, file) {
  let encodedFile = null;

  if (file) {
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("Netlify uploads are limited to 4MB per file.");
    }

    encodedFile = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      data: await readFileAsBase64(file),
    };
  }

  const response = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group: groupName,
      accessCode,
      text,
      file: encodedFile,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Message failed to send.");
  return payload;
}

function connectToGroup(nextGroupName, nextAccessCode) {
  groupName = nextGroupName || "main";
  accessCode = nextAccessCode || "";
  if (groupName === "main") {
    writeCookie("wifiShareGroup", "main");
  }
  updateRoomLabel();
  messagesEl.textContent = "";

  if (socket) socket.disconnect();
  if (pollTimer) clearInterval(pollTimer);

  if (window.location.protocol === "file:") {
    serverWarning.classList.remove("hidden");
    setStatus(false);
    return;
  }

  if (typeof io !== "function") {
    realtimeMode = false;
    setStatus(true);
    loadMessages().catch((error) => setGroupStatus(error.message, true));
    pollTimer = setInterval(() => {
      loadMessages().catch(() => {});
    }, 3000);
    return;
  }

  realtimeMode = true;
  socket = io({ query: { group: groupName, accessCode } });

  socket.on("connect", () => {
    serverWarning.classList.add("hidden");
    setStatus(true);
  });
  socket.on("disconnect", () => setStatus(false));
  socket.on("connect_error", () => {
    serverWarning.classList.remove("hidden");
    setStatus(false);
  });
  socket.on("group:error", (message) => {
    setGroupStatus(message, true);
  });

  socket.on("messages:init", (messages) => {
    messagesEl.textContent = "";
    messages.forEach(renderMessage);
    scrollToBottom();
  });

  socket.on("message:new", renderMessage);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

randomGroup.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/groups/suggest");
    const payload = await response.json();
    groupInput.value = payload.name || "";
    setGroupStatus("Random group name generated.");
  } catch {
    const fallback = `group-${Math.floor(100000 + Math.random() * 900000)}`;
    groupInput.value = fallback;
    setGroupStatus("Random group name generated.");
  }
});

createGroup.addEventListener("click", async () => {
  const name = groupInput.value.trim();
  const password = accessCodeInput.value;
  if (!name || !password.trim()) {
    setGroupStatus("Add a group name and password to create a private group.", true);
    return;
  }

  try {
    const group = await postJson("/api/groups", { name, password });
    connectToGroup(group.name, password);
    setGroupStatus(`Created and joined ${group.name}.`);
  } catch (error) {
    setGroupStatus(error.message, true);
  }
});

joinGroup.addEventListener("click", async () => {
  const name = groupInput.value.trim();
  const password = accessCodeInput.value;
  if (!name || !password.trim()) {
    setGroupStatus("Enter the group name and matching password.", true);
    return;
  }

  try {
    const group = await postJson("/api/groups/join", { name, password });
    connectToGroup(group.name, password);
    setGroupStatus(`Joined ${group.name}.`);
  } catch (error) {
    setGroupStatus(error.message, true);
  }
});

mainGroup.addEventListener("click", () => {
  groupInput.value = "";
  accessCodeInput.value = "";
  connectToGroup("main", "");
  setGroupStatus("Back in the open main room.");
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (!file) {
    resetFileInput();
    return;
  }

  fileName.textContent = `${file.name} (${formatBytes(file.size)})`;
  uploadPreview.classList.remove("hidden");
});

clearFile.addEventListener("click", resetFileInput);

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = messageInput.value;
  const [file] = fileInput.files;
  if (!text.trim() && !file) return;

  if (window.location.protocol === "file:") {
    serverWarning.classList.remove("hidden");
    alert("Start the local server first, then open http://localhost:3000 instead of this file.");
    return;
  }

  const formData = new FormData();
  formData.append("group", groupName);
  formData.append("accessCode", accessCode);
  formData.append("text", text);
  if (file) formData.append("file", file);

  const submitButton = messageForm.querySelector("button[type='submit']");
  submitButton.disabled = true;

  try {
    if (realtimeMode) {
      const response = await fetch("/api/messages", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Message failed to send.");
      }
    } else {
      await postServerlessMessage(text, file);
      await loadMessages();
    }

    messageInput.value = "";
    resetFileInput();
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    messageInput.focus();
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    messageForm.requestSubmit();
  }
});
