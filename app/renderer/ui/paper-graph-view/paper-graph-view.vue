<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, Ref, ref, shallowRef, watch } from "vue";
import { BIconSearch } from "bootstrap-icons-vue";

import { disposable } from "@/base/dispose";
import { Entity, IEntityCollection } from "@/models/entity";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    externalSearchText?: string;
    searchSubmitTick?: number;
  }>(),
  {
    embedded: false,
    externalSearchText: "",
    searchSubmitTick: 0,
  }
);

type GraphNode = {
  id: string;
  title: string;
  kind: "paper" | "author" | "topic" | "year";
  group: string;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  selected: boolean;
  fixed?: boolean;
};

type GraphEdge = {
  source: string;
  target: string;
  width: number;
  opacity: number;
  semantic?: boolean;
};

type SemanticGraphEdge = {
  source: string;
  target: string;
  score: number;
};

const uiApiLocal = (globalThis as any).PLUIAPILocal;
const uiState =
  uiApiLocal?.uiStateService?.useState?.() ||
  reactive({
    paperGraphViewShown: false,
    selectedPaperEntities: [],
  });
const injectedPaperEntities = inject<Ref<IEntityCollection> | null>("paperEntities", null);
const localPaperEntities: Ref<IEntityCollection> = ref([] as any);
const semanticGraphEdges = ref<SemanticGraphEdge[]>([]);
const graphReloadToken = ref(0);
const graphPaperEntities = computed(
  () => injectedPaperEntities?.value || localPaperEntities.value
);
const darkMode = ref(false);
const graphBackgroundColor = ref("#ffffff");
const searchText = ref("");
const matchedNodeIds = ref(new Set<string>());
const searchResultIds = ref<string[]>([]);
const searchFocusIndex = ref(-1);
let lastSearchQuery = "";
const selectedNodeId = ref("");
const hoveredNodeId = ref("");
const draggingNodeId = ref("");
const panning = ref(false);
const lastPointer = ref({ x: 0, y: 0 });
const dragOffset = ref({ x: 0, y: 0 });
const viewport = reactive({ x: 0, y: 0, scale: 1 });
const canvasRef = ref<HTMLCanvasElement | null>(null);
const graph = shallowRef<{ nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }>({
  nodes: [],
  edges: [],
  width: 980,
  height: 560,
});
let animationFrame = 0;
let viewportAnimationFrame = 0;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestId = 0;
let settlingTicks = 0;
const layoutReady = ref(false);
const simulationRunning = ref(false);

const snapshotEntities = (items: any[]) =>
  Array.from(items || [])
    .map((paper: any) => {
      try {
        return new Entity(paper);
      } catch {
        return null;
      }
    })
    .filter((paper): paper is Entity => Boolean(paper))
    .filter((paper) => paper._id && paper.title);

const reloadSemanticGraphEdges = async (papers: Entity[]) => {
  const ids = papers.map((paper) => `${paper._id || ""}`).filter(Boolean);
  if (ids.length < 2) {
    semanticGraphEdges.value = [];
    graphReloadToken.value += 1;
    return;
  }

  try {
    semanticGraphEdges.value = (await PLAPI.semanticSearchService.semanticGraphEdges(
      ids,
      4,
      0.7
    )) as SemanticGraphEdge[];
  } catch {
    semanticGraphEdges.value = [];
  }
  graphReloadToken.value += 1;
};

const reloadLocalPaperEntities = async () => {
  if (injectedPaperEntities) {
    return;
  }
  const loaded = await PLAPI.paperService.load(
    "",
    "addTime",
    "desc"
  );
  const papers = snapshotEntities(loaded as any[]);
  localPaperEntities.value = papers as IEntityCollection;
  graphReloadToken.value += 1;
  void reloadSemanticGraphEdges(papers);
};

const scheduleReloadLocalPaperEntities = () => {
  if (injectedPaperEntities) {
    return;
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer);
  }
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reloadLocalPaperEntities();
  }, 80);
};

const colors = [
  "#4E79A7",
  "#59A14F",
  "#F28E2B",
  "#B07AA1",
  "#76B7B2",
  "#E15759",
  "#8CD17D",
  "#A0CBE8",
  "#9C755F",
  "#BAB0AC",
];

const categorizerColors: Record<string, string> = {
  red: "#E15759",
  green: "#59A14F",
  blue: "#4E79A7",
  yellow: "#F1CE63",
  orange: "#F28E2B",
  cyan: "#76B7B2",
  purple: "#B07AA1",
  pink: "#FF9DA7",
};

const groupColors: Record<string, string> = {
  vision: "#4E79A7",
  llm: "#F28E2B",
  efficiency: "#59A14F",
  retrieval: "#B07AA1",
  benchmark: "#F1CE63",
  graph: "#76B7B2",
  data: "#A0CBE8",
  default: "#BAB0AC",
};

const close = () => {
  if (props.embedded) {
    return;
  }
  uiState.paperGraphViewShown = false;
};

const graphBackground = () => graphBackgroundColor.value;
const graphLineColor = () =>
  darkMode.value ? "rgba(212, 212, 212, 0.46)" : "rgba(115, 115, 115, 0.34)";

const nodeKindLabel = (node: GraphNode) =>
  ({
    paper: "Paper",
    author: "Author",
    topic: "Topic",
    year: "Year",
  }[node.kind]);

const activeLabelNode = () => {
  const id = hoveredNodeId.value || selectedNodeId.value;
  return graph.value.nodes.find((node) => node.id === id);
};

const updateDarkMode = async () => {
  darkMode.value = await PLMainAPI.windowProcessManagementService.isDarkMode();
  graphBackgroundColor.value = darkMode.value
    ? "rgb(38, 38, 38)"
    : "rgb(245, 245, 245)";
  drawGraph();
};

const resetViewportToFit = () => {
  const canvas = canvasRef.value;
  const rect = canvas?.getBoundingClientRect();
  const nodes = graph.value.nodes;
  if (!rect || nodes.length === 0) {
    viewport.x = 0;
    viewport.y = 0;
    viewport.scale = 1;
    return;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r - 6);
    minY = Math.min(minY, node.y - node.r - 6);
    maxX = Math.max(maxX, node.x + node.r + 6);
    maxY = Math.max(maxY, node.y + node.r + 6);
  }

  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const baseScale = Math.min(rect.width / graph.value.width, rect.height / graph.value.height);
  const visibleWidth = rect.width / Math.max(0.001, baseScale);
  const visibleHeight = rect.height / Math.max(0.001, baseScale);
  const scale = Math.min(2.4, Math.max(1, Math.min(visibleWidth / graphWidth, visibleHeight / graphHeight) * 0.92));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  viewport.scale = scale;
  viewport.x = graph.value.width / 2 - scale * centerX;
  viewport.y = graph.value.height / 2 - scale * centerY;
};

const animateViewportTo = (target: { x: number; y: number; scale: number }) => {
  cancelAnimationFrame(viewportAnimationFrame);
  const start = {
    x: viewport.x,
    y: viewport.y,
    scale: viewport.scale,
  };
  const duration = 360;
  const startedAt = performance.now();
  const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

  const step = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = easeOutCubic(progress);
    viewport.x = start.x + (target.x - start.x) * eased;
    viewport.y = start.y + (target.y - start.y) * eased;
    viewport.scale = start.scale + (target.scale - start.scale) * eased;
    drawGraph();
    if (progress < 1) {
      viewportAnimationFrame = requestAnimationFrame(step);
    }
  };

  viewportAnimationFrame = requestAnimationFrame(step);
};

const centerNode = (node: GraphNode) => {
  const scale = Math.max(viewport.scale, 2.1);
  animateViewportTo({
    scale,
    x: graph.value.width / 2 - scale * node.x,
    y: graph.value.height / 2 - scale * node.y,
  });
};

const updateSearchMatches = async (focus = false) => {
  const rawQuery = searchText.value.trim();
  const query = rawQuery.toLowerCase();
  const requestId = ++searchRequestId;
  if (!query) {
    matchedNodeIds.value = new Set();
    searchResultIds.value = [];
    searchFocusIndex.value = -1;
    lastSearchQuery = "";
    drawGraph();
    return;
  }

  const textMatches = graph.value.nodes.filter((node) =>
    node.title.toLowerCase().includes(query)
  );
  let semanticMatchIds: string[] = [];
  try {
    const semanticResults = (await PLAPI.semanticSearchService.search(
      rawQuery,
      24
    )) as Entity[];
    if (requestId !== searchRequestId) {
      return;
    }
    const availableNodeIds = new Set(graph.value.nodes.map((node) => node.id));
    semanticMatchIds = semanticResults
      .map((paper: any) => `paper:${paper._id || ""}`)
      .filter((id) => availableNodeIds.has(id));
  } catch {
    semanticMatchIds = [];
  }

  if (requestId !== searchRequestId) {
    return;
  }

  const matchIds = [
    ...semanticMatchIds,
    ...textMatches
      .map((node) => node.id)
      .filter((id) => !semanticMatchIds.includes(id)),
  ];
  const matches = matchIds
    .map((id) => graph.value.nodes.find((node) => node.id === id))
    .filter((node): node is GraphNode => Boolean(node));
  matchedNodeIds.value = new Set(matchIds);
  searchResultIds.value = matchIds;

  if (lastSearchQuery !== query) {
    searchFocusIndex.value = -1;
    lastSearchQuery = query;
  }

  if (matches[0]) {
    if (focus) {
      searchFocusIndex.value = (searchFocusIndex.value + 1) % matches.length;
    } else if (searchFocusIndex.value < 0 || searchFocusIndex.value >= matches.length) {
      searchFocusIndex.value = 0;
    }
    const target = matches[searchFocusIndex.value] || matches[0];
    selectedNodeId.value = target.id;
    if (focus) {
      centerNode(target);
    }
  }
  drawGraph();
};

const hash = (text: string) => {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value += (value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24);
  }
  return Math.abs(value >>> 0);
};

const stopTerms = new Set([
  "with",
  "from",
  "using",
  "based",
  "towards",
  "through",
  "paper",
  "model",
  "models",
  "large",
  "language",
  "learning",
  "neural",
  "network",
  "networks",
  "efficient",
]);

const titleTerms = (title: string) =>
  `${title || ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4 && !stopTerms.has(term))
    .slice(0, 10);

const authorSet = (authors: string) =>
  new Set(
    `${authors || ""}`
      .split(/[,;]| and /i)
      .map((author) => author.trim().toLowerCase())
      .filter(Boolean)
  );

const paperGroupColor = (paper: Entity, fallbackKey: string) => {
  const tagColor = paper.tags?.find((tag) => tag.color)?.color;
  const folderColor = paper.folders?.find((folder) => folder.color)?.color;
  const color = `${tagColor || folderColor || ""}`.toLowerCase();
  if (categorizerColors[color]) {
    return categorizerColors[color];
  }
  if (paper.tags?.length || paper.folders?.length) {
    const groupName = `${paper.tags?.[0]?.name || paper.folders?.[0]?.name || ""}`;
    return colors[hash(groupName) % colors.length];
  }
  return groupColors[paperGroup(paper, fallbackKey)];
};

const semanticGroup = (text: string) => {
  const lower = `${text || ""}`.toLowerCase();
  if (/\b(video|vision|image|visual|multimodal|llava|clip|restoration)\b/.test(lower)) return "vision";
  if (/\b(llm|language|transformer|token|prompt|rag|attention)\b/.test(lower)) return "llm";
  if (/\b(accelerat|efficient|inference|memory|spars|quant|prefill|serv|latency|throughput)\b/.test(lower)) return "efficiency";
  if (/\b(retriev|search|rank|embedding|recommend|index)\b/.test(lower)) return "retrieval";
  if (/\b(dataset|benchmark|evaluation|metric|survey|leaderboard)\b/.test(lower)) return "benchmark";
  if (/\b(graph|network|agent|planning|reasoning|tree)\b/.test(lower)) return "graph";
  if (/\b(data|training|corpus|annotation|synthetic)\b/.test(lower)) return "data";
  return "default";
};

const paperGroup = (paper: Entity, fallbackKey: string) => {
  const tagName = paper.tags?.[0]?.name;
  const folderName = paper.folders?.[0]?.name;
  if (tagName || folderName) {
    return `categorizer:${tagName || folderName}`;
  }
  const group = semanticGroup(`${paper.title} ${paper.abstract || ""}`);
  return group === "default" ? `fallback:${hash(fallbackKey) % 6}` : group;
};

const groupColor = (group: string) => {
  if (group.startsWith("categorizer:")) {
    return colors[hash(group) % colors.length];
  }
  if (group.startsWith("fallback:")) {
    return ["#cbd5e1", "#94a3b8", "#64748b", "#a1a1aa", "#9ca3af", "#d1d5db"][
      hash(group) % 6
    ];
  }
  return groupColors[group] || groupColors.default;
};

const nodeRadius = (kind: GraphNode["kind"], weight: number, selected = false) => {
  if (selected) {
    return 7.6;
  }
  const scaled = Math.sqrt(Math.max(1, weight));
  if (kind === "paper") {
    return Math.min(5.8, 2.85 + scaled * 0.55);
  }
  if (kind === "author") {
    return Math.min(6.5, 2.95 + scaled * 0.72);
  }
  if (kind === "topic") {
    return Math.min(6.0, 2.75 + scaled * 0.68);
  }
  return 3.35;
};

const buildGraph = () => {
  const selectedIds = new Set(
    (uiState.selectedPaperEntities || [])
      .map((paper) => {
        try {
          return `${paper._id}`;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
  const papers = snapshotEntities(graphPaperEntities.value as any[]).slice(0, 260);
  const selectedPapers = snapshotEntities((uiState.selectedPaperEntities || []) as any[]);

  const displayPapers = (papers.length > 0 ? papers : selectedPapers).slice(0, 320);
  const width = 980;
  const height = 560;
  const centerX = width / 2;
  const centerY = height / 2;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

const addNode = (node: GraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (
    source: string,
    target: string,
    width = 0.55,
    opacity = 0.22,
    semantic = false
  ) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    edges.push({ source, target, width, opacity, semantic });
  };

  const topicCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  for (const paper of displayPapers) {
    for (const term of titleTerms(paper.title)) {
      topicCounts.set(term, (topicCounts.get(term) || 0) + 1);
    }
    for (const author of authorSet(paper.authors)) {
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    }
  }
  const topTopics = new Set(
    [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 260)
      .map(([term]) => term)
  );
  const topAuthors = new Set(
    [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 180)
      .map(([author]) => author)
  );

  displayPapers.forEach((paper, index) => {
    const key = `paper:${paper._id || paper.title}`;
    const h = hash(`${paper.title}-${paper.authors}-${index}`);
    const cluster = h % colors.length;
    const angle = index * 2.399963 + (cluster % 7) * 0.04;
    const ring = 16 + Math.sqrt((index + 0.5) / Math.max(1, displayPapers.length)) * 245;
    const selected = selectedIds.has(`${paper._id}`);
    const group = paperGroup(paper, `${paper.title}-${paper.authors}-${cluster}`);
    addNode({
      id: key,
      title: paper.title,
      kind: "paper",
      group,
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      r: nodeRadius("paper", authorSet(paper.authors).size + titleTerms(paper.title).length, selected),
      color: groupColor(group),
      selected,
    });
  });

  const paperMeta = displayPapers.map((paper) => ({
    id: `paper:${paper._id || paper.title}`,
    year: `${paper.year || ""}`.slice(0, 4),
    authors: authorSet(paper.authors),
    terms: new Set(titleTerms(paper.title)),
    group: paperGroup(paper, `${paper.title}-${paper.authors}`),
    color: paperGroupColor(paper, `${paper.title}-${paper.authors}`),
  }));

  for (const meta of paperMeta) {
    const paperNode = nodes.find((node) => node.id === meta.id);
    const yearId = meta.year ? `year:${meta.year}` : "";
    if (yearId) {
      const h = hash(yearId);
      addNode({
        id: yearId,
        title: meta.year,
        kind: "year",
        group: "default",
        x: centerX + Math.cos(h) * 270,
        y: centerY + Math.sin(h) * 270,
        vx: 0,
        vy: 0,
        r: nodeRadius("year", 1),
        color: "#94a3b8",
        selected: false,
      });
      addEdge(meta.id, yearId, 0.35, 0.11);
    }

    for (const author of meta.authors) {
      if (!topAuthors.has(author)) continue;
      const id = `author:${author}`;
      const h = hash(id);
      const count = authorCounts.get(author) || 1;
      addNode({
        id,
        title: author,
        kind: "author",
        group: meta.group,
        x: (paperNode?.x || centerX) + Math.cos(h) * (18 + (h % 45)),
        y: (paperNode?.y || centerY) + Math.sin(h) * (18 + (h % 45)),
        vx: 0,
        vy: 0,
        r: nodeRadius("author", count),
        color: meta.color,
        selected: false,
      });
      addEdge(meta.id, id, 0.45, 0.2);
    }

    for (const term of meta.terms) {
      if (!topTopics.has(term)) continue;
      const id = `topic:${term}`;
      const h = hash(id);
      const count = topicCounts.get(term) || 1;
      const topicGroup = semanticGroup(term);
      const group = topicGroup === "default" ? meta.group : topicGroup;
      addNode({
        id,
        title: term,
        kind: "topic",
        group,
        x: (paperNode?.x || centerX) + Math.cos(h) * (24 + (h % 62)),
        y: (paperNode?.y || centerY) + Math.sin(h) * (24 + (h % 62)),
        vx: 0,
        vy: 0,
        r: nodeRadius("topic", count),
        color: groupColor(group),
        selected: false,
      });
      addEdge(meta.id, id, 0.42, 0.18);

      if (hash(`${meta.id}-${term}`) % 3 === 0) {
        const microId = `micro:${meta.id}:${term}`;
        const mh = hash(microId);
        addNode({
          id: microId,
          title: term,
          kind: "topic",
          group,
          x: (paperNode?.x || centerX) + Math.cos(mh) * (12 + (mh % 75)),
          y: (paperNode?.y || centerY) + Math.sin(mh) * (12 + (mh % 75)),
          vx: 0,
          vy: 0,
          r: 2.25 + (mh % 5) / 10,
          color: groupColor(group),
          selected: false,
        });
        addEdge(meta.id, microId, 0.22, 0.1);
        addEdge(microId, id, 0.18, 0.08);
      }
    }
  }

  for (const [term, count] of topicCounts.entries()) {
    if (!topTopics.has(term) || count < 3) continue;
    for (const [other, otherCount] of topicCounts.entries()) {
      if (term >= other || !topTopics.has(other) || otherCount < 3) continue;
      if (hash(`${term}-${other}`) % 7 === 0) {
        addEdge(`topic:${term}`, `topic:${other}`, 0.32, 0.09);
      }
    }
  }

  for (const edge of semanticGraphEdges.value) {
    const source = `paper:${edge.source}`;
    const target = `paper:${edge.target}`;
    const score = Math.max(0, Math.min(1, Number(edge.score || 0)));
    addEdge(
      source,
      target,
      0.55 + Math.max(0, score - 0.7) * 2.4,
      0.14 + Math.max(0, score - 0.7) * 0.62,
      true
    );
  }

  applyForceDirectedLayout(nodes, edges, width, height);
  resolveAllOverlaps(nodes, 120);
  fitNodesToCircle(nodes, width, height);
  for (const node of nodes) {
    node.tx = node.x;
    node.ty = node.y;
    node.vx = 0;
    node.vy = 0;
  }
  graph.value = { nodes, edges: edges.slice(0, 2400), width, height };
  resetViewportToFit();
  layoutReady.value = true;
  settlingTicks = 0;
  simulationRunning.value = true;
  void updateSearchMatches();
  void nextTick(drawGraph);
};

const applyForceDirectedLayout = (
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  }

  const layoutRadius = Math.min(width, height) * 0.32;
  const sortedNodes = [...nodes].sort((a, b) => {
    const degreeDiff = (degree.get(b.id) || 0) - (degree.get(a.id) || 0);
    return degreeDiff || hash(a.id) - hash(b.id);
  });
  const colorBuckets = [...nodes.reduce((map, node) => {
    const bucket = map.get(node.color);
    if (bucket) {
      bucket.push(node);
    } else {
      map.set(node.color, [node]);
    }
    return map;
  }, new Map<string, GraphNode[]>()).entries()].sort((a, b) => b[1].length - a[1].length);
  const colorAnchors = new Map<string, { x: number; y: number }>();
  colorBuckets.forEach(([color], index) => {
    const angle = index * 2.399963 - Math.PI / 2;
    const radius =
      colorBuckets.length <= 1
        ? 0
        : Math.sqrt((index + 0.35) / colorBuckets.length) * layoutRadius * 0.28;
    colorAnchors.set(color, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  sortedNodes.forEach((node, index) => {
    const nodeDegree = degree.get(node.id) || 0;
    if (nodeDegree >= 6 || node.selected) {
      node.r = Math.max(node.r, Math.min(8.8, 4.2 + Math.sqrt(nodeDegree) * 0.55));
    }
    const anchor = colorAnchors.get(node.color) || { x: centerX, y: centerY };
    const localIndex = colorBuckets
      .find(([, bucket]) => bucket.includes(node))?.[1]
      .indexOf(node) || index;
    const angle = localIndex * 2.399963 + (hash(node.color) % 100) / 700;
    const radius = Math.sqrt((localIndex + 0.5) / Math.max(1, sortedNodes.length)) * layoutRadius * 0.4;
    node.x = anchor.x + Math.cos(angle) * radius;
    node.y = anchor.y + Math.sin(angle) * radius;
    node.vx = 0;
    node.vy = 0;
  });

  const activeEdges = edges
    .map((edge) => ({
      edge,
      source: nodeMap.get(edge.source),
      target: nodeMap.get(edge.target),
    }))
    .filter((edge) => edge.source && edge.target) as Array<{
    edge: GraphEdge;
    source: GraphNode;
    target: GraphNode;
  }>;

  const idealDistance =
    Math.sqrt((Math.PI * layoutRadius * layoutRadius) / Math.max(1, nodes.length)) * 0.92;
  for (let iteration = 0; iteration < 360; iteration += 1) {
    const alpha = 1 - iteration / 360;
    const temperature = Math.max(0.35, layoutRadius * (0.11 * alpha + 0.006));

    for (const node of nodes) {
      node.vx = 0;
      node.vy = 0;
    }

    const colorCentroids = new Map<string, { x: number; y: number; count: number }>();
    for (const node of nodes) {
      const centroid = colorCentroids.get(node.color) || { x: 0, y: 0, count: 0 };
      centroid.x += node.x;
      centroid.y += node.y;
      centroid.count += 1;
      colorCentroids.set(node.color, centroid);
    }
    for (const centroid of colorCentroids.values()) {
      centroid.x /= Math.max(1, centroid.count);
      centroid.y /= Math.max(1, centroid.count);
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 0.01) {
          const angle = hash(`${a.id}:${b.id}`) / 100;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distSq = 1;
        }
        const dist = Math.sqrt(distSq);
        const minDist = a.r + b.r + 4;
        const collision = Math.max(0, minDist - dist) * 0.72;
        const repulsion = (idealDistance * idealDistance) / Math.max(1, dist);
        const force = repulsion + collision;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const { edge, source, target } of activeEdges) {
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
      const force =
        ((dist * dist) / Math.max(1, idealDistance)) *
        0.018 *
        Math.max(0.45, edge.width);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of nodes) {
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const centroid = colorCentroids.get(node.color);
      if (centroid && centroid.count > 1) {
        node.vx += (centroid.x - node.x) * 0.006;
        node.vy += (centroid.y - node.y) * 0.006;
        const anchor = colorAnchors.get(node.color);
        if (anchor) {
          node.vx += (anchor.x - node.x) * 0.002;
          node.vy += (anchor.y - node.y) * 0.002;
        }
      }
      node.vx += dx * 0.014;
      node.vy += dy * 0.014;
      if (distance > layoutRadius * 0.72) {
        const outward = distance - layoutRadius * 0.72;
        node.vx += (dx / distance) * outward * 0.022;
        node.vy += (dy / distance) * outward * 0.022;
      }
      if (distance > layoutRadius) {
        const overflow = distance - layoutRadius;
        node.vx += (dx / distance) * overflow * 0.13;
        node.vy += (dy / distance) * overflow * 0.13;
      }
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > temperature) {
        node.vx = (node.vx / speed) * temperature;
        node.vy = (node.vy / speed) * temperature;
      }
      node.x += node.vx;
      node.y += node.vy;
    }
  }
};

const fitNodesToCircle = (nodes: GraphNode[], width: number, height: number) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.38;
  let sumX = 0;
  let sumY = 0;
  for (const node of nodes) {
    sumX += node.x;
    sumY += node.y;
  }
  const graphCenterX = sumX / Math.max(1, nodes.length);
  const graphCenterY = sumY / Math.max(1, nodes.length);
  let currentRadius = 1;
  for (const node of nodes) {
    const dx = node.x - graphCenterX;
    const dy = node.y - graphCenterY;
    currentRadius = Math.max(currentRadius, Math.sqrt(dx * dx + dy * dy) + node.r);
  }
  const scale = Math.min(1, maxRadius / currentRadius);
  for (const node of nodes) {
    node.x = centerX + (node.x - graphCenterX) * scale;
    node.y = centerY + (node.y - graphCenterY) * scale;
    const dx = node.x - centerX;
    const dy = node.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const limit = maxRadius - node.r - 2;
    if (distance > limit) {
      const angle = distance < 0.1 ? hash(node.id) / 100 : Math.atan2(dy, dx);
      node.x = centerX + Math.cos(angle) * limit;
      node.y = centerY + Math.sin(angle) * limit;
    }
    node.vx = 0;
    node.vy = 0;
  }
};

const packNodes = (nodes: GraphNode[], width: number, height: number) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = node.kind === "year" ? "year" : node.group || "default";
    const bucket = groups.get(group);
    if (bucket) {
      bucket.push(node);
    } else {
      groups.set(group, [node]);
    }
  }

  const groupEntries = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  const groupCenters = new Map<string, { x: number; y: number; radius: number }>();
  const groupCount = Math.max(1, groupEntries.length);
  groupEntries.forEach(([group, groupNodes], index) => {
    const radius = Math.max(
      36,
      Math.sqrt(groupNodes.reduce((sum, node) => sum + (node.r + 2) ** 2, 0)) *
        1.14
    );
    const angle = index * 2.399963 + 0.35;
    const ring = 18 + Math.sqrt((index + 0.45) / groupCount) * 116;
    groupCenters.set(group, {
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
      radius,
    });
  });

  const placed: GraphNode[] = [];
  for (const [group, groupNodes] of groupEntries) {
    const groupCenter = groupCenters.get(group)!;
    const sortedNodes = [...groupNodes].sort((a, b) => b.r - a.r);
    const localPlaced: GraphNode[] = [];
    for (const node of sortedNodes) {
      const point = findPackedPosition(node, groupCenter, localPlaced, placed);
      node.x = point.x;
      node.y = point.y;
      node.vx = 0;
      node.vy = 0;
      localPlaced.push(node);
      placed.push(node);
    }
  }
};

const layoutHubClusters = (nodes: GraphNode[], width: number, height: number) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = node.kind === "year" ? "year" : node.group || "default";
    const bucket = groups.get(group);
    if (bucket) {
      bucket.push(node);
    } else {
      groups.set(group, [node]);
    }
  }

  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const maxBlobRadius = Math.min(width, height) * 0.42;
  const clusterCenters = new Map<string, { x: number; y: number; radius: number }>();
  const placedClusters: Array<{ x: number; y: number; radius: number }> = [];
  const hubRadii = new Map<string, number>();

  entries.forEach(([group, groupNodes], index) => {
    const sortedNodes = [...groupNodes].sort((a, b) => {
      if (a.selected !== b.selected) {
        return a.selected ? -1 : 1;
      }
      return b.r - a.r;
    });
    const hubRadius = hubRadiusFor(sortedNodes[0], sortedNodes.length);
    hubRadii.set(group, hubRadius);
    const clusterRadius = estimateRingClusterRadius(sortedNodes.slice(1), hubRadius);
    const center = findClusterCenter(
      group,
      index,
      clusterRadius,
      { x: centerX, y: centerY, radius: maxBlobRadius },
      placedClusters
    );
    clusterCenters.set(group, { ...center, radius: clusterRadius });
    placedClusters.push({ ...center, radius: clusterRadius });
  });

  for (const [group, groupNodes] of entries) {
    const cluster = clusterCenters.get(group)!;
    const sortedNodes = [...groupNodes].sort((a, b) => {
      if (a.selected !== b.selected) {
        return a.selected ? -1 : 1;
      }
      return b.r - a.r;
    });
    const hub = sortedNodes[0];
    hub.r = hubRadii.get(group) || hub.r;
    hub.x = cluster.x;
    hub.y = cluster.y;
    hub.tx = cluster.x;
    hub.ty = cluster.y;
    hub.vx = 0;
    hub.vy = 0;

    const satellitePositions = ringSatellitePositions(sortedNodes.slice(1), hub, group);
    sortedNodes.slice(1).forEach((node, index) => {
      const point = satellitePositions.get(node.id) || { x: hub.x, y: hub.y };
      node.x = point.x;
      node.y = point.y;
      node.tx = point.x;
      node.ty = point.y;
      node.vx = 0;
      node.vy = 0;
    });
  }
};

const hubRadiusFor = (hub: GraphNode, clusterSize: number) =>
  Math.max(hub?.r || 0, Math.min(9.2, 5.8 + Math.sqrt(clusterSize) * 0.28));

const estimateRingClusterRadius = (satellites: GraphNode[], hubRadius: number) => {
  if (satellites.length === 0) {
    return hubRadius + 8;
  }
  const maxDiameter = Math.max(...satellites.map((node) => node.r * 2));
  const ringGap = Math.max(16, maxDiameter + 10);
  let cursor = 0;
  let ringIndex = 0;
  let lastRadius = hubRadius + ringGap;

  while (cursor < satellites.length) {
    const radius = hubRadius + ringGap * (ringIndex + 1);
    const capacity = Math.max(
      6,
      Math.floor((Math.PI * 2 * radius) / Math.max(10, maxDiameter + 9))
    );
    cursor += Math.min(capacity, satellites.length - cursor);
    lastRadius = radius;
    ringIndex += 1;
  }

  return lastRadius + maxDiameter + 8;
};

const findClusterCenter = (
  group: string,
  index: number,
  radius: number,
  bounds: { x: number; y: number; radius: number },
  placed: Array<{ x: number; y: number; radius: number }>
) => {
  const collides = (x: number, y: number) =>
    placed.some((other) => {
      const dx = x - other.x;
      const dy = y - other.y;
      const minDist = radius + other.radius + 8;
      return dx * dx + dy * dy < minDist * minDist;
    });
  if (index === 0) {
    return { x: bounds.x, y: bounds.y };
  }
  for (let i = 0; i < 1200; i += 1) {
    const angle = i * 2.399963 + (hash(group) % 100) / 500;
    const distance = Math.sqrt(i + 1) * (radius * 0.28 + 4);
    const x = bounds.x + Math.cos(angle) * distance;
    const y = bounds.y + Math.sin(angle) * distance;
    const fromCenter = Math.sqrt((x - bounds.x) ** 2 + (y - bounds.y) ** 2);
    if (fromCenter + radius > bounds.radius || collides(x, y)) {
      continue;
    }
    return { x, y };
  }
  const angle = index * 2.399963;
  const distance = Math.min(bounds.radius - radius, 26 + Math.sqrt(index) * 28);
  return {
    x: bounds.x + Math.cos(angle) * distance,
    y: bounds.y + Math.sin(angle) * distance,
  };
};

const ringSatellitePositions = (
  satellites: GraphNode[],
  hub: GraphNode,
  seed: string
) => {
  const positions = new Map<string, { x: number; y: number }>();
  if (satellites.length === 0) {
    return positions;
  }

  const sorted = [...satellites].sort((a, b) => b.r - a.r);
  const maxDiameter = Math.max(...sorted.map((node) => node.r * 2));
  const ringGap = Math.max(16, maxDiameter + 10);
  let cursor = 0;
  let ringIndex = 0;

  while (cursor < sorted.length) {
    const radius = hub.r + ringGap * (ringIndex + 1);
    const capacity = Math.max(
      6,
      Math.floor((Math.PI * 2 * radius) / Math.max(10, maxDiameter + 9))
    );
    const count = Math.min(capacity, sorted.length - cursor);
    const startAngle =
      ((hash(`${seed}:${ringIndex}`) % 1000) / 1000) * Math.PI * 2;

    for (let i = 0; i < count; i += 1) {
      const node = sorted[cursor + i];
      const angle = startAngle + (Math.PI * 2 * i) / count;
      positions.set(node.id, {
        x: hub.x + Math.cos(angle) * radius,
        y: hub.y + Math.sin(angle) * radius,
      });
    }

    cursor += count;
    ringIndex += 1;
  }

  return positions;
};

const pullNodesToClusterTargets = (nodes: GraphNode[], strength: number) => {
  for (const node of nodes) {
    if (node.fixed || node.tx === undefined || node.ty === undefined) {
      continue;
    }
    node.x += (node.tx - node.x) * strength;
    node.y += (node.ty - node.y) * strength;
    node.vx = 0;
    node.vy = 0;
  }
};

const findPackedPosition = (
  node: GraphNode,
  center: { x: number; y: number; radius: number },
  localPlaced: GraphNode[],
  globalPlaced: GraphNode[]
) => {
  const padding = node.kind === "paper" ? 3.4 : 2.8;
  const collides = (x: number, y: number, candidates: GraphNode[]) =>
    candidates.some((other) => {
      const dx = x - other.x;
      const dy = y - other.y;
      const minDist = node.r + other.r + padding;
      return dx * dx + dy * dy < minDist * minDist;
    });
  const nearbyGlobal = globalPlaced.filter((other) => {
    if (other.group === node.group) {
      return false;
    }
    const dx = other.x - center.x;
    const dy = other.y - center.y;
    return dx * dx + dy * dy < (center.radius + 52) ** 2;
  });

  for (let i = 0; i < 2200; i += 1) {
    const angle = i * 2.399963;
    const radius = Math.sqrt(i) * (node.r + 3.05);
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (
      !collides(x, y, localPlaced) &&
      !collides(x, y, nearbyGlobal)
    ) {
      return { x, y };
    }
  }

  const fallbackAngle = hash(node.id) / 100;
  const fallbackRadius = center.radius + (hash(`${node.id}:r`) % 38);
  return {
    x: center.x + Math.cos(fallbackAngle) * fallbackRadius,
    y: center.y + Math.sin(fallbackAngle) * fallbackRadius,
  };
};

const constrainNodesToCircle = (nodes: GraphNode[], width: number, height: number) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.35;
  for (const node of nodes) {
    const dx = node.x - centerX;
    const dy = node.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const limit = Math.max(24, maxRadius - node.r - 2);
    if (distance <= limit) {
      continue;
    }
    const angle = distance < 0.1 ? hash(node.id) / 100 : Math.atan2(dy, dx);
    node.x = centerX + Math.cos(angle) * limit;
    node.y = centerY + Math.sin(angle) * limit;
    node.tx = node.x;
    node.ty = node.y;
    node.vx = 0;
    node.vy = 0;
  }
};

const applyRoundDiskTargets = (
  nodes: GraphNode[],
  width: number,
  height: number,
  strength: number
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) * 0.34;
  const innerRadius = Math.min(width, height) * 0.045;
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = node.kind === "year" ? "year" : node.group || "default";
    const bucket = groups.get(group);
    if (bucket) {
      bucket.push(node);
    } else {
      groups.set(group, [node]);
    }
  }

  const entries = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  const totalWeight = entries.reduce(
    (sum, [, groupNodes]) => sum + Math.sqrt(groupNodes.length),
    0
  );
  let cursor = -Math.PI / 2;

  for (const [group, groupNodes] of entries) {
    const weight = Math.sqrt(groupNodes.length);
    const span =
      entries.length === 1
        ? Math.PI * 2
        : Math.max(0.34, (Math.PI * 2 * weight) / Math.max(1, totalWeight));
    const sortedNodes = [...groupNodes].sort((a, b) => hash(a.id) - hash(b.id));
    sortedNodes.forEach((node, index) => {
      const local = (index + 0.5) / Math.max(1, sortedNodes.length);
      const jitter = ((hash(`${node.id}:j`) % 1000) / 1000 - 0.5) * 0.1;
      const angle = cursor + span * local + jitter;
      const radiusRatio = Math.sqrt((index + 1.6) / (sortedNodes.length + 3.2));
      const targetRadius = innerRadius + radiusRatio * (outerRadius - innerRadius);
      const targetX = centerX + Math.cos(angle) * targetRadius;
      const targetY = centerY + Math.sin(angle) * targetRadius;
      node.x += (targetX - node.x) * strength;
      node.y += (targetY - node.y) * strength;
      node.vx = 0;
      node.vy = 0;
    });
    cursor += span;
  }
};

const shapeCircularDensity = (
  nodes: GraphNode[],
  width: number,
  height: number,
  strength: number
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const outerRadius = Math.min(width, height) * 0.35;
  const ranked = [...nodes]
    .map((node) => {
      const dx = node.x - centerX;
      const dy = node.y - centerY;
      return {
        node,
        distance: Math.sqrt(dx * dx + dy * dy),
        angle: Math.atan2(dy, dx),
      };
    })
    .sort((a, b) => a.distance - b.distance);

  const count = Math.max(1, ranked.length);
  ranked.forEach((item, index) => {
    const node = item.node;
    const angle =
      item.distance < 0.1 ? hash(`${node.id}:angle`) / 100 : item.angle;
    const targetRadius =
      outerRadius * Math.sqrt((index + 1.8) / (count + 3.6));
    const nextRadius =
      item.distance + (targetRadius - item.distance) * strength;
    node.x = centerX + Math.cos(angle) * nextRadius;
    node.y = centerY + Math.sin(angle) * nextRadius;
    node.vx = 0;
    node.vy = 0;
  });
};

const graphPoint = (event: PointerEvent | WheelEvent) => {
  const canvas = canvasRef.value;
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  const baseScale = Math.min(rect.width / graph.value.width, rect.height / graph.value.height);
  const offsetX = (rect.width - graph.value.width * baseScale) / 2;
  const offsetY = (rect.height - graph.value.height * baseScale) / 2;
  return {
    x: ((event.clientX - rect.left - offsetX) / baseScale - viewport.x) / viewport.scale,
    y: ((event.clientY - rect.top - offsetY) / baseScale - viewport.y) / viewport.scale,
  };
};

const nodeAt = (point: { x: number; y: number }) =>
  [...graph.value.nodes]
    .reverse()
    .find((node) => {
      const dx = node.x - point.x;
      const dy = node.y - point.y;
      return dx * dx + dy * dy <= Math.max(5, node.r + 5) ** 2;
    });

const canvasBaseScale = () => {
  const canvas = canvasRef.value;
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return 1;
  return Math.min(rect.width / graph.value.width, rect.height / graph.value.height);
};

const onNodePointerDown = (event: PointerEvent, node: GraphNode) => {
  event.stopPropagation();
  selectedNodeId.value = node.id;
  draggingNodeId.value = node.id;
  node.fixed = true;
  const point = graphPoint(event);
  dragOffset.value = { x: node.x - point.x, y: node.y - point.y };
  simulationRunning.value = true;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  lastPointer.value = { x: event.clientX, y: event.clientY };
};

const onCanvasPointerDown = (event: PointerEvent) => {
  const point = graphPoint(event);
  const hit = nodeAt(point);
  if (hit) {
    onNodePointerDown(event, hit);
    return;
  }
  panning.value = true;
  (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  lastPointer.value = { x: event.clientX, y: event.clientY };
};

const onPointerMove = (event: PointerEvent) => {
  const screenDx = event.clientX - lastPointer.value.x;
  const screenDy = event.clientY - lastPointer.value.y;
  lastPointer.value = { x: event.clientX, y: event.clientY };

  if (draggingNodeId.value) {
    const node = graph.value.nodes.find((item) => item.id === draggingNodeId.value);
    if (node) {
      const point = graphPoint(event);
      node.x = point.x + dragOffset.value.x;
      node.y = point.y + dragOffset.value.y;
      keepDraggedNodeSeparated(node);
      drawGraph();
    }
    return;
  }
  if (panning.value) {
    const baseScale = canvasBaseScale();
    viewport.x += screenDx / baseScale;
    viewport.y += screenDy / baseScale;
    drawGraph();
    return;
  }

  const hover = nodeAt(graphPoint(event));
  hoveredNodeId.value = hover?.id || "";
  drawGraph();
};

const onPointerUp = () => {
  const node = graph.value.nodes.find((item) => item.id === draggingNodeId.value);
  if (node) {
    node.fixed = false;
    const targetX = node.tx ?? node.x;
    const targetY = node.ty ?? node.y;
    node.vx += (targetX - node.x) * 0.075;
    node.vy += (targetY - node.y) * 0.075;
  }
  draggingNodeId.value = "";
  simulationRunning.value = true;
  panning.value = false;
};

const keepDraggedNodeSeparated = (node: GraphNode) => {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let moved = false;
    for (const other of graph.value.nodes) {
      if (other === node) {
        continue;
      }
      let dx = node.x - other.x;
      let dy = node.y - other.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) {
        const angle = hash(`${node.id}:${other.id}`) / 100;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const minDist = node.r + other.r + 4.5;
      if (dist >= minDist) {
        continue;
      }
      const overlap = minDist - dist;
      const softness = 0.28;
      const draggedPush = overlap * 0.42;
      const neighborPush = overlap * softness;
      node.x += (dx / dist) * draggedPush;
      node.y += (dy / dist) * draggedPush;
      if (!other.fixed) {
        other.x -= (dx / dist) * neighborPush;
        other.y -= (dy / dist) * neighborPush;
        other.vx *= 0.72;
        other.vy *= 0.72;
      }
      moved = true;
    }
    if (!moved) {
      break;
    }
  }
};

const resolveAllOverlaps = (nodes: GraphNode[], maxIterations: number) => {
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) {
          const angle = hash(`${a.id}:${b.id}:${iteration}`) / 100;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const minDist = a.r + b.r + 4.5;
        const overlap = minDist - dist;
        if (overlap <= 0) {
          continue;
        }
        const px = (dx / dist) * (overlap / 2);
        const py = (dy / dist) * (overlap / 2);
        if (!a.fixed) {
          a.x -= px;
          a.y -= py;
        }
        if (!b.fixed) {
          b.x += px;
          b.y += py;
        }
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
  }
  for (const node of nodes) {
    node.vx = 0;
    node.vy = 0;
  }
};

const onWheel = (event: WheelEvent) => {
  event.preventDefault();
  const before = graphPoint(event);
  const nextScale = Math.min(2.8, Math.max(0.55, viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
  viewport.scale = nextScale;
  const after = graphPoint(event);
  viewport.x += (after.x - before.x) * viewport.scale;
  viewport.y += (after.y - before.y) * viewport.scale;
  drawGraph();
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  if (!draggingNodeId.value && !panning.value && viewport.scale === 1) {
    resetViewportToFit();
  }
  drawGraph();
};

const drawGraph = () => {
  const canvas = canvasRef.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const graphBg = graphBackground();
  ctx.fillStyle = graphBg;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const baseScale = Math.min(rect.width / graph.value.width, rect.height / graph.value.height);
  const offsetX = (rect.width - graph.value.width * baseScale) / 2;
  const offsetY = (rect.height - graph.value.height * baseScale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(baseScale, baseScale);
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.scale, viewport.scale);

  const map = new Map(graph.value.nodes.map((node) => [node.id, node]));
  ctx.lineCap = "round";
  for (const edge of graph.value.edges) {
    const a = map.get(edge.source);
    const b = map.get(edge.target);
    if (!a || !b) continue;
    ctx.globalAlpha = edge.opacity;
    ctx.strokeStyle = edge.semantic
      ? darkMode.value
        ? "rgba(125, 211, 252, 0.62)"
        : "rgba(37, 99, 235, 0.42)"
      : graphLineColor();
    ctx.lineWidth = edge.width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const node of graph.value.nodes) {
    const searchMatched = matchedNodeIds.value.has(node.id);
    ctx.globalAlpha = node.selected ? 1 : 0.96;
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
    if (searchMatched) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = darkMode.value ? "#facc15" : "#2563eb";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r + 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (node.id === selectedNodeId.value || node.id === hoveredNodeId.value || node.selected) {
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
};

const simulateStep = () => {
  const nodes = graph.value.nodes;
  let energy = 0;
  for (const node of nodes) {
    if (!node.fixed) {
      const targetX = node.tx ?? node.x;
      const targetY = node.ty ?? node.y;
      const dx = targetX - node.x;
      const dy = targetY - node.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const attraction = Math.min(0.34, 0.038 + distance * 0.0019);
      node.vx += dx * attraction;
      node.vy += dy * attraction;
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      const maxSpeed = Math.min(18, 2.4 + distance * 0.078);
      if (speed > maxSpeed) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }
      const damping = distance > 18 ? 0.9 : distance > 5 ? 0.84 : 0.76;
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
      energy += Math.abs(node.vx) + Math.abs(node.vy);
    }
  }

  applyCollision(nodes);
  return energy / Math.max(1, nodes.length);
};

const applyRepulsion = (nodes: GraphNode[]) => {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j += 18) {
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = Math.max(64, dx * dx + dy * dy);
      const dist = Math.sqrt(distSq);
      const force = 2.4 / distSq;
      if (!a.fixed) {
        a.vx -= (dx / dist) * force;
        a.vy -= (dy / dist) * force;
      }
      if (!b.fixed) {
        b.vx += (dx / dist) * force;
        b.vy += (dy / dist) * force;
      }
    }
  }
};

const applyCollision = (nodes: GraphNode[]) => {
  const cellSize = 18;
  const grid = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const key = `${cellX}:${cellY}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      grid.set(key, [node]);
    }
  }

  const visited = new Set<string>();
  for (const node of nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        const bucket = grid.get(`${x}:${y}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (node === other) continue;
          const pairKey = node.id < other.id ? `${node.id}|${other.id}` : `${other.id}|${node.id}`;
          if (visited.has(pairKey)) continue;
          visited.add(pairKey);

          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const dist = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
          const minDist = node.r + other.r + 2.8;
          const overlap = minDist - dist;
          if (overlap <= 0) continue;

          const push = overlap * 0.5;
          const px = (dx / dist) * push;
          const py = (dy / dist) * push;
          if (!node.fixed) {
            node.x -= px;
            node.y -= py;
            node.vx *= 0.4;
            node.vy *= 0.4;
          }
          if (!other.fixed) {
            other.x += px;
            other.y += py;
            other.vx *= 0.4;
            other.vy *= 0.4;
          }
        }
      }
    }
  }
};

const tick = () => {
  let changed = false;
  if (settlingTicks > 0) {
    const steps = Math.min(8, settlingTicks);
    for (let i = 0; i < steps; i += 1) {
      simulateStep();
    }
    settlingTicks -= steps;
    changed = true;
    if (settlingTicks <= 0) {
      layoutReady.value = true;
    }
  } else if (simulationRunning.value || draggingNodeId.value) {
    simulateStep();
    changed = true;
  }
  if (changed) {
    drawGraph();
  }
  animationFrame = requestAnimationFrame(tick);
};

watch(
  () => [
    graphReloadToken.value,
    graphPaperEntities.value.length,
    semanticGraphEdges.value.length,
    (uiState.selectedPaperEntities || [])
      .map((paper) => {
        try {
          return `${paper._id}`;
        } catch {
          return "";
        }
      })
      .join(","),
  ],
  buildGraph,
  { immediate: true }
);
watch(
  () =>
    snapshotEntities(graphPaperEntities.value as any[])
      .map((paper) => `${paper._id}`)
      .join(","),
  () => {
    if (!injectedPaperEntities) {
      return;
    }
    void reloadSemanticGraphEdges(snapshotEntities(graphPaperEntities.value as any[]));
  },
  { immediate: true }
);
watch(searchText, () => void updateSearchMatches());
watch(
  () => props.searchSubmitTick,
  () => {
    if (!props.embedded) {
      return;
    }
    void updateSearchMatches(true);
  }
);
watch(
  () => props.externalSearchText,
  (value) => {
    if (!props.embedded) {
      return;
    }
    searchText.value = `${value || ""}`;
  },
  { immediate: true }
);

onMounted(() => {
  void updateDarkMode();
  void reloadLocalPaperEntities();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  animationFrame = requestAnimationFrame(tick);
});

onUnmounted(() => {
  window.removeEventListener("resize", resizeCanvas);
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  cancelAnimationFrame(animationFrame);
  cancelAnimationFrame(viewportAnimationFrame);
});

if (!props.embedded && uiApiLocal?.shortcutService) {
  disposable(
    uiApiLocal.shortcutService.updateWorkingViewScope(
      uiApiLocal.shortcutService.viewScope.OVERLAY
    )
  );
  disposable(uiApiLocal.shortcutService.register("Escape", close));
}
disposable(PLMainAPI.preferenceService.onChanged(["preferedTheme"], updateDarkMode));
if (uiApiLocal?.uiStateService) {
  disposable(uiApiLocal.uiStateService.onChanged(["renderRequired"], updateDarkMode));
}
if (!injectedPaperEntities) {
  disposable(PLAPI.paperService.on("updated", () => {
    scheduleReloadLocalPaperEntities();
  }));
}
</script>

<template>
  <div
    v-if="embedded"
    class="relative h-full w-full overflow-hidden"
    :style="{ backgroundColor: graphBackground() }"
  >
    <canvas
      ref="canvasRef"
      class="h-full w-full cursor-grab active:cursor-grabbing graph-canvas"
      :style="{ backgroundColor: graphBackground() }"
      @pointerdown="onCanvasPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel="onWheel"
    />
    <div
      v-if="hoveredNodeId || selectedNodeId"
      class="pointer-events-none absolute bottom-1 left-1 max-w-sm rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-200"
    >
      {{
        activeLabelNode()
          ? `${nodeKindLabel(activeLabelNode()!)}: ${activeLabelNode()!.title}`
          : ""
      }}
    </div>
  </div>
  <div v-else id="paper-graph-view" class="absolute left-0 top-0 h-full w-full">
    <div
      class="fixed inset-0 z-50 flex bg-neutral-800/50 text-neutral-700 dark:bg-neutral-950/80 dark:text-neutral-200"
      @click="close"
    >
      <div
        class="m-auto flex h-[280px] max-h-[calc(100vh-48px)] w-[600px] min-w-[600px] max-w-[600px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        @click.stop=""
      >
        <div class="relative flex h-full w-full flex-col overflow-hidden text-neutral-700 dark:text-neutral-200">
          <div class="flex">
            <input
              v-model="searchText"
              class="w-full h-12 text-sm px-3 bg-transparent focus:outline-none grow"
              type="text"
              autofocus
              placeholder="Search graph"
              @keydown.stop
            />
            <div
              class="mr-2 my-auto flex flex-none select-none whitespace-nowrap rounded-md border-[1px] border-neutral-400 px-2 py-1 text-xxs text-neutral-400 transition-colors hover:border-neutral-600 hover:text-neutral-600 hover:dark:border-neutral-200 hover:dark:text-neutral-200 dark:border-neutral-500"
              @click="() => void updateSearchMatches(true)"
            >
              Search
            </div>
          </div>

          <hr class="border-neutral-300 dark:border-neutral-700 mx-2" />

          <div
            class="mx-2 mt-2 h-40 overflow-hidden rounded-md bg-neutral-100 px-3 py-2 text-xs leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            :style="{ backgroundColor: graphBackground() }"
          >
            <div class="relative h-full w-full overflow-hidden">
              <canvas
                ref="canvasRef"
                class="h-full w-full cursor-grab active:cursor-grabbing graph-canvas"
                :style="{ backgroundColor: graphBackground() }"
                @pointerdown="onCanvasPointerDown"
                @pointermove="onPointerMove"
                @pointerup="onPointerUp"
                @pointerleave="onPointerUp"
                @wheel="onWheel"
              />
              <div
                v-if="hoveredNodeId || selectedNodeId"
                class="pointer-events-none absolute bottom-1 left-1 max-w-sm rounded bg-white/90 px-2 py-1 text-[10px] font-semibold text-neutral-700 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-200"
              >
                {{
                  activeLabelNode()
                    ? `${nodeKindLabel(activeLabelNode()!)}: ${activeLabelNode()!.title}`
                    : ""
                }}
              </div>
            </div>
          </div>

          <div
            class="mb-2 mt-1 h-[24px] flex-none px-2 text-xxs text-neutral-400 flex justify-between"
          >
            <div class="flex my-auto space-x-4 ml-1">
              <div class="flex space-x-1 text-neutral-500 dark:text-neutral-300">
                <span class="my-auto mr-1 select-none">Paper graph</span>
              </div>
            </div>
            <div class="flex my-auto space-x-1">
              <span class="my-auto mr-1 select-none">
                {{ searchText ? `${matchedNodeIds.size} matched` : `${graph.nodes.length} nodes` }}
              </span>
              <BIconSearch class="my-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-canvas {
  --graph-bg: #ffffff;
}

:global(.dark) .graph-canvas {
  --graph-bg: #070c10;
}
</style>
