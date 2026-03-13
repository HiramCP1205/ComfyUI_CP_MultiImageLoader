import { app } from "../../scripts/app.js";

const MAX_SINGLE_OUTPUTS = 32;
const NODE_NAME = "RH_MultiImageLoaderUI";
const DEFAULT_NODE_WIDTH = 520;
const DEFAULT_NODE_HEIGHT = 680;
const MIN_NODE_WIDTH = 500;
const MIN_NODE_HEIGHT = 260;
const LIST_MAX_HEIGHT = 520;
const LIST_MIN_HEIGHT = 90;

function findWidget(node, name) {
  return (node.widgets || []).find((w) => w.name === name);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildOutputs(node) {
  const imageCount = Array.isArray(node.__rh_image_list) ? node.__rh_image_list.length : 0;
  const singleCount = Math.min(Math.max(imageCount, 0), MAX_SINGLE_OUTPUTS);

  const outputs = node.outputs || [];
  const hasImageListHead =
    outputs.length > 0 && outputs[0]?.name === "image_list" && outputs[0]?.type === "IMAGE";
  let sequentialSingles = true;
  for (let i = 1; i < outputs.length; i += 1) {
    if (outputs[i]?.name !== `image_${i}` || outputs[i]?.type !== "IMAGE") {
      sequentialSingles = false;
      break;
    }
  }

  // One-time migration: if historical output layout is unexpected, rebuild once.
  if (!hasImageListHead || !sequentialSingles) {
    while ((node.outputs || []).length > 0) {
      node.removeOutput(node.outputs.length - 1);
    }
    node.addOutput("image_list", "IMAGE");
    for (let i = 0; i < singleCount; i += 1) {
      node.addOutput(`image_${i + 1}`, "IMAGE");
    }
    node.__rh_output_count = singleCount;
    return;
  }

  const currentSingleCount = Math.max(0, outputs.length - 1);
  if (currentSingleCount < singleCount) {
    for (let i = currentSingleCount; i < singleCount; i += 1) {
      node.addOutput(`image_${i + 1}`, "IMAGE");
    }
  } else if (currentSingleCount > singleCount) {
    // Shrink from bottom only, so existing upper outputs keep their links.
    for (let i = currentSingleCount; i > singleCount; i -= 1) {
      node.removeOutput(node.outputs.length - 1);
    }
  }

  node.__rh_output_count = singleCount;
}

function applyDefaultNodeSizeOnce(node) {
  if (node.__rh_size_initialized) return;
  if (!Array.isArray(node.size) || node.size.length < 2) {
    node.size = [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
  } else {
    const w = Number(node.size[0]) || 0;
    const h = Number(node.size[1]) || 0;
    // Only force default size when node is first created with tiny default canvas size.
    if (w <= 220 && h <= 120) {
      node.size = [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
    }
  }
  node.__rh_size_initialized = true;
}

async function uploadImage(file) {
  const body = new FormData();
  body.append("image", file);
  body.append("type", "input");
  body.append("overwrite", "true");
  const resp = await fetch("/upload/image", { method: "POST", body });
  if (!resp.ok) {
    throw new Error(`Upload failed: ${resp.status}`);
  }
  const json = await resp.json();
  if (!json || !json.name) {
    throw new Error("Upload response invalid.");
  }
  return json.subfolder ? `${json.subfolder}/${json.name}` : json.name;
}

async function deleteImageOnServer(path) {
  const resp = await fetch("/cp/multi_image_loader/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) {
    throw new Error(`Delete failed: ${resp.status}`);
  }
  return resp.json();
}

function imageUrl(path) {
  const [subfolder, ...rest] = String(path).split("/");
  if (rest.length === 0) {
    return `/view?filename=${encodeURIComponent(path)}&type=input`;
  }
  return `/view?filename=${encodeURIComponent(rest.join("/"))}&subfolder=${encodeURIComponent(subfolder)}&type=input`;
}

function showImagePreview(src, title) {
  const old = document.getElementById("cp-multi-loader-preview");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.id = "cp-multi-loader-preview";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0, 0, 0, 0.78)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "99999";
  overlay.style.padding = "24px";

  const box = document.createElement("div");
  box.style.position = "relative";
  box.style.maxWidth = "92vw";
  box.style.maxHeight = "92vh";
  box.style.display = "flex";
  box.style.flexDirection = "column";
  box.style.gap = "8px";

  const close = document.createElement("button");
  close.textContent = "关闭";
  close.type = "button";
  close.style.position = "absolute";
  close.style.top = "8px";
  close.style.right = "8px";
  close.style.zIndex = "1";

  const img = document.createElement("img");
  img.src = src;
  img.alt = title || "preview";
  img.style.maxWidth = "92vw";
  img.style.maxHeight = "92vh";
  img.style.objectFit = "contain";
  img.style.borderRadius = "8px";
  img.style.boxShadow = "0 8px 28px rgba(0,0,0,.5)";

  const caption = document.createElement("div");
  caption.textContent = title || "";
  caption.style.color = "#ddd";
  caption.style.fontSize = "12px";
  caption.style.textAlign = "center";
  caption.style.wordBreak = "break-all";

  const closeModal = () => overlay.remove();
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeModal();
  });
  close.onclick = closeModal;
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key === "Escape") closeModal();
    },
    { once: true }
  );

  box.appendChild(close);
  box.appendChild(img);
  box.appendChild(caption);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

app.registerExtension({
  name: "cp.multi-image-loader-ui",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const result = onResize ? onResize.call(this, size) : undefined;
      if (typeof this.__cpApplyLayout === "function") {
        this.__cpApplyLayout();
      }
      return result;
    };

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onCreated ? onCreated.apply(this, arguments) : undefined;

      const jsonWidget = findWidget(this, "images_json");
      if (!jsonWidget) return result;

      // Hide raw JSON widget, all edits from custom UI.
      jsonWidget.hidden = true;
      jsonWidget.computeSize = () => [0, -4];

      let imageList = [];
      try {
        const parsed = JSON.parse(jsonWidget.value || "[]");
        if (Array.isArray(parsed)) imageList = parsed.map((v) => String(v));
      } catch (_) {}

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "6px";
      wrap.style.padding = "4px 0";
      wrap.style.minWidth = "320px";
      wrap.style.overflow = "hidden";

      const actionBar = document.createElement("div");
      actionBar.style.display = "flex";
      actionBar.style.gap = "6px";

      const addBtn = document.createElement("button");
      addBtn.textContent = "添加图片";
      addBtn.type = "button";

      const clearBtn = document.createElement("button");
      clearBtn.textContent = "清空";
      clearBtn.type = "button";

      actionBar.appendChild(addBtn);
      actionBar.appendChild(clearBtn);

      const info = document.createElement("div");
      info.style.fontSize = "12px";
      info.style.opacity = "0.8";

      const listEl = document.createElement("div");
      listEl.style.display = "flex";
      listEl.style.flexDirection = "column";
      listEl.style.gap = "6px";
      listEl.style.maxHeight = "520px";
      listEl.style.minHeight = "0";
      listEl.style.overflow = "auto";
      listEl.style.overflowY = "auto";
      listEl.style.overflowX = "hidden";
      listEl.style.paddingRight = "2px";

      wrap.appendChild(actionBar);
      wrap.appendChild(info);
      wrap.appendChild(listEl);

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.style.display = "none";
      wrap.appendChild(input);

      // Ensure mouse wheel scrolls the inner image list, not canvas zoom/pan.
      listEl.addEventListener(
        "wheel",
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          listEl.scrollTop += ev.deltaY;
        },
        { passive: false }
      );

      // Avoid dragging the whole node when user interacts with list area.
      listEl.addEventListener("pointerdown", (ev) => {
        ev.stopPropagation();
      });

      const sync = () => {
        if (imageList.length > MAX_SINGLE_OUTPUTS) {
          imageList = imageList.slice(0, MAX_SINGLE_OUTPUTS);
        }
        this.__rh_image_list = imageList;
        jsonWidget.value = JSON.stringify(imageList);
        info.textContent = `已选 ${imageList.length} 张（单图输出上限 ${MAX_SINGLE_OUTPUTS}）`;
        buildOutputs(this);
        if (typeof this.__cpApplyLayout === "function") {
          this.__cpApplyLayout();
        }
        app.graph.setDirtyCanvas(true, true);
      };

      this.__cpApplyLayout = () => {
        if (!Array.isArray(this.size) || this.size.length < 2) return;
        if (this.size[0] < MIN_NODE_WIDTH) this.size[0] = MIN_NODE_WIDTH;
        const outputCount = Math.max(1, (this.outputs || []).length);
        const outputMinHeight = 44 + outputCount * 22;
        const dynamicMinHeight = Math.max(MIN_NODE_HEIGHT, outputMinHeight, 320);
        if (this.size[1] < dynamicMinHeight) this.size[1] = dynamicMinHeight;
        const available = Math.floor(this.size[1] - 170);
        const targetHeight = Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, available));
        listEl.style.maxHeight = `${targetHeight}px`;
      };

      const render = () => {
        listEl.innerHTML = "";
        imageList.forEach((path, index) => {
          const row = document.createElement("div");
          row.draggable = true;
          row.dataset.index = String(index);
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.gap = "6px";
          row.style.border = "1px solid #444";
          row.style.borderRadius = "6px";
          row.style.padding = "4px";
          row.style.background = "#1f1f1f";
          row.style.cursor = "grab";

          const thumb = document.createElement("img");
          thumb.src = imageUrl(path);
          thumb.alt = path;
          thumb.style.width = "42px";
          thumb.style.height = "42px";
          thumb.style.objectFit = "cover";
          thumb.style.borderRadius = "4px";
          thumb.style.border = "1px solid #555";
          thumb.style.cursor = "zoom-in";
          thumb.title = "双击预览大图";
          thumb.ondblclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showImagePreview(imageUrl(path), path);
          };

          const text = document.createElement("div");
          text.style.flex = "1";
          text.style.fontSize = "12px";
          text.style.overflow = "hidden";
          text.style.whiteSpace = "nowrap";
          text.style.textOverflow = "ellipsis";
          text.innerHTML = `${index + 1}. ${escapeHtml(path)}`;

          const del = document.createElement("button");
          del.type = "button";
          del.textContent = "删除";
          del.onclick = async () => {
            const removed = imageList[index];
            imageList.splice(index, 1);
            render();
            sync();
            // Only delete physical file when there is no remaining reference in list.
            if (!imageList.includes(removed)) {
              try {
                await deleteImageOnServer(removed);
              } catch (err) {
                console.warn("Delete image failed:", err);
              }
            }
          };

          row.appendChild(thumb);
          row.appendChild(text);
          row.appendChild(del);
          listEl.appendChild(row);

          row.addEventListener("dragstart", (ev) => {
            ev.dataTransfer?.setData("text/plain", String(index));
            ev.dataTransfer.dropEffect = "move";
            row.style.opacity = "0.5";
          });
          row.addEventListener("dragend", () => {
            row.style.opacity = "1";
          });
          row.addEventListener("dragover", (ev) => {
            ev.preventDefault();
          });
          row.addEventListener("drop", (ev) => {
            ev.preventDefault();
            const from = Number(ev.dataTransfer?.getData("text/plain"));
            const to = index;
            if (!Number.isInteger(from) || from < 0 || from >= imageList.length || from === to) {
              return;
            }
            const moved = imageList.splice(from, 1)[0];
            imageList.splice(to, 0, moved);
            render();
            sync();
          });
        });
      };

      addBtn.onclick = () => input.click();
      clearBtn.onclick = async () => {
        const toDelete = Array.from(new Set(imageList));
        imageList = [];
        render();
        sync();
        for (const item of toDelete) {
          try {
            await deleteImageOnServer(item);
          } catch (err) {
            console.warn("Delete image failed:", err);
          }
        }
      };

      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        addBtn.disabled = true;
        try {
          for (const file of files) {
            const rel = await uploadImage(file);
            imageList.push(rel);
          }
          render();
          sync();
        } catch (err) {
          console.error(err);
          alert("上传失败，请查看浏览器控制台。");
        } finally {
          addBtn.disabled = false;
          input.value = "";
        }
      };

      if (this.addDOMWidget) {
        this.addDOMWidget("image_manager", "div", wrap, {
          serialize: false,
        });
      }

      applyDefaultNodeSizeOnce(this);
      this.__cpApplyLayout();
      render();
      sync();

      return result;
    };
  },
});
