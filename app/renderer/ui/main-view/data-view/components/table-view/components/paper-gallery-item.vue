<script setup lang="ts">
import { BIconFileEarmarkPdf } from "bootstrap-icons-vue";
import { onBeforeUnmount, onMounted, PropType, ref, watch } from "vue";

import { getProtocol } from "@/base/url";
import { Entity } from "@/models/entity";
import { sanitizeHTML } from "@/renderer/utils/sanitize";

const props = defineProps({
  item: {
    type: Object as PropType<Entity>,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
});

const MAX_PARALLEL_RENDERS = 1;
let activeRenderCount = 0;
const renderQueue: Array<() => Promise<void>> = [];
const previewBlobURLCache = new Map<string, string>();
const thumbnailBinaryCache = new Map<
  string,
  { blob: ArrayBuffer; width: number; height: number }
>();

const runQueuedRender = async (job: () => Promise<void>) => {
  if (activeRenderCount >= MAX_PARALLEL_RENDERS) {
    renderQueue.push(job);
    return;
  }

  activeRenderCount += 1;
  try {
    await job();
  } finally {
    activeRenderCount -= 1;
    const next = renderQueue.shift();
    if (next) {
      void runQueuedRender(next);
    }
  }
};

const canvas = ref<HTMLCanvasElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const imageURL = ref("");
const isRendering = ref(false);
const hasPreview = ref(false);
const isVisible = ref(false);
let observer: IntersectionObserver | null = null;
let isRenderQueued = false;

const renderCanvas = async (
  buffer: ArrayBuffer | Uint8Array,
  width: number,
  height: number
) => {
  if (!canvas.value) {
    return;
  }

  const context = canvas.value.getContext("2d");
  if (!context) {
    return;
  }

  canvas.value.width = width;
  canvas.value.height = height;
  context.clearRect(0, 0, canvas.value.width, canvas.value.height);

  const img = new Image();
  img.onload = () => {
    if (!canvas.value) {
      return;
    }
    context.drawImage(img, 0, 0, canvas.value.width, canvas.value.height);
    if (imageURL.value !== img.src) {
      URL.revokeObjectURL(img.src);
    }
  };

  if (imageURL.value && imageURL.value.startsWith("blob:")) {
    URL.revokeObjectURL(imageURL.value);
  }
  imageURL.value = URL.createObjectURL(
    new Blob([buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer], {
      type: "image/jpeg",
    })
  );
  img.src = imageURL.value;
};

const renderFromCachedBlobURL = (blobURL: string) => {
  if (!canvas.value) {
    return false;
  }

  const context = canvas.value.getContext("2d");
  if (!context) {
    return false;
  }

  const img = new Image();
  img.onload = () => {
    if (!canvas.value) {
      return;
    }
    canvas.value.width = img.width || 720;
    canvas.value.height = img.height || 960;
    context.clearRect(0, 0, canvas.value.width, canvas.value.height);
    context.drawImage(img, 0, 0, canvas.value.width, canvas.value.height);
  };
  imageURL.value = blobURL;
  img.src = blobURL;
  hasPreview.value = true;
  return true;
};

const render = async () => {
  const cacheKey = `${props.item._id}`;
  const cachedBlobURL = previewBlobURLCache.get(cacheKey);
  if (cachedBlobURL && renderFromCachedBlobURL(cachedBlobURL)) {
    return;
  }

  if (!isVisible.value || isRendering.value || hasPreview.value) {
    return;
  }

  hasPreview.value = false;
  const defaultSup = props.item.defaultSup;
  if (
    defaultSup === undefined ||
    defaultSup === null ||
    !props.item.supplementaries[defaultSup] ||
    !["file", "downloadRequired"].includes(
      getProtocol(props.item.supplementaries[defaultSup].url)
    )
  ) {
    return;
  }

  if (isRenderQueued) {
    return;
  }
  isRenderQueued = true;
  await runQueuedRender(async () => {
    try {
      if (
        !isVisible.value ||
        !canvas.value ||
        isRendering.value ||
        hasPreview.value
      ) {
        return;
      }
      isRendering.value = true;
      const inMemoryCached = previewBlobURLCache.get(cacheKey);
      if (inMemoryCached && renderFromCachedBlobURL(inMemoryCached)) {
        return;
      }

      const cachedThumbnail = await PLAPI.cacheService.loadThumbnail(props.item);
      if (cachedThumbnail?.blob && cachedThumbnail.blob.byteLength > 0) {
        thumbnailBinaryCache.set(cacheKey, {
          blob: cachedThumbnail.blob.slice(0),
          width: cachedThumbnail.width,
          height: cachedThumbnail.height,
        });
        await renderCanvas(
          cachedThumbnail.blob,
          cachedThumbnail.width,
          cachedThumbnail.height
        );
        previewBlobURLCache.set(cacheKey, imageURL.value);
        hasPreview.value = true;
        return;
      }

      const binaryCached = thumbnailBinaryCache.get(cacheKey);
      if (binaryCached?.blob && binaryCached.blob.byteLength > 0) {
        await renderCanvas(
          binaryCached.blob,
          binaryCached.width,
          binaryCached.height
        );
        previewBlobURLCache.set(cacheKey, imageURL.value);
        hasPreview.value = true;
        return;
      }

      const fileURL = await PLAPI.fileService.access(
        props.item.supplementaries[defaultSup].url,
        false
      );
      if (!fileURL || fileURL.startsWith("downloadRequired://")) {
        return;
      }

      const thumbnailBuffer = await PLAPI.renderService.renderPDF(
        fileURL,
        0.8,
        72
      );
      if (thumbnailBuffer && canvas.value) {
        PLAPI.cacheService.updateThumbnailCache(props.item, {
          blob: thumbnailBuffer.buffer as ArrayBuffer,
          width: canvas.value.width || 720,
          height: canvas.value.height || 960,
        });
        thumbnailBinaryCache.set(cacheKey, {
          blob: thumbnailBuffer.buffer.slice(0),
          width: canvas.value.width || 720,
          height: canvas.value.height || 960,
        });
        await renderCanvas(
          thumbnailBuffer,
          canvas.value.width || 720,
          canvas.value.height || 960
        );
        previewBlobURLCache.set(cacheKey, imageURL.value);
        hasPreview.value = true;
      }
    } finally {
      isRendering.value = false;
      isRenderQueued = false;
    }
  });
};

watch(
  () => props.item._id,
  () => {
    const cacheKey = `${props.item._id}`;
    const cachedBlobURL = previewBlobURLCache.get(cacheKey);
    if (cachedBlobURL && renderFromCachedBlobURL(cachedBlobURL)) {
      return;
    }
    hasPreview.value = false;
    if (isVisible.value) {
      void render();
    }
  },
  { immediate: true }
);

watch(isVisible, (visible) => {
  if (visible) {
    void render();
  }
});

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        isVisible.value = entry.isIntersecting;
      }
    },
    { rootMargin: "60px 0px 120px 0px", threshold: 0.01 }
  );
  if (rootRef.value) {
    observer.observe(rootRef.value);
  }
});

onBeforeUnmount(() => {
  if (observer && rootRef.value) {
    observer.unobserve(rootRef.value);
  }
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <div
    ref="rootRef"
    class="group w-full min-w-[8.25rem] max-w-[10rem] select-none cursor-pointer"
    :class="active ? 'text-accentlight dark:text-accentdark' : ''"
  >
    <div
      class="aspect-[3/4] w-full overflow-hidden rounded border-[1px] bg-neutral-100 shadow-sm transition dark:border-neutral-700 dark:bg-neutral-700"
      :class="
        active
          ? 'ring-2 ring-accentlight dark:ring-accentdark'
          : 'group-hover:shadow-md'
      "
    >
      <canvas
        ref="canvas"
        class="h-full w-full object-cover"
        width="720"
        height="960"
        v-show="hasPreview"
      />
      <div
        class="flex h-full w-full text-neutral-400 dark:text-neutral-500"
        v-show="!hasPreview"
      >
        <BIconFileEarmarkPdf class="m-auto text-4xl" v-if="!isRendering" />
        <svg
          v-else
          role="status"
          class="m-auto h-5 w-5 animate-spin fill-neutral-500 text-neutral-200 dark:text-neutral-700"
          viewBox="0 0 100 101"
          fill="none"
        >
          <path
            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908Z"
            fill="currentColor"
          />
          <path
            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326Z"
            fill="currentFill"
          />
        </svg>
      </div>
    </div>
    <div
      class="mt-2 line-clamp-2 min-h-[2rem] text-center text-xxs leading-4 text-neutral-700 dark:text-neutral-300"
      v-html="sanitizeHTML(item.title)"
    />
  </div>
</template>
