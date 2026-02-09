"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface GraphNode {
  id: string;
  name: string;
  type: string;
  event_count: number;
  description: string | null;
  is_owner: boolean;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  strength: number;
}

interface MemoryStats {
  events: number;
  entities: number;
  edges: number;
  topics: number;
  summary_nodes: number;
  facts: number;
  learnings: number;
  extraction_status: Record<string, number>;
}

const TYPE_COLORS: Record<string, string> = {
  person: "#3b82f6",
  org: "#22c55e",
  tool: "#a855f7",
  concept: "#f97316",
};

const TYPE_LABELS: Record<string, string> = {
  person: "People",
  org: "Organizations",
  tool: "Tools",
  concept: "Concepts",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] || "#6b7280";
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "person":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "org":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "tool":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "concept":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// Simple force-directed graph on Canvas
function ForceGraph({
  nodes,
  links,
  onNodeClick,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const positionsRef = useRef<
    Map<string, { x: number; y: number; vx: number; vy: number }>
  >(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Initialize positions
    const pos = positionsRef.current;
    for (const node of nodes) {
      if (!pos.has(node.id)) {
        pos.set(node.id, {
          x: W / 2 + (Math.random() - 0.5) * W * 0.6,
          y: H / 2 + (Math.random() - 0.5) * H * 0.6,
          vx: 0,
          vy: 0,
        });
      }
    }

    // Build adjacency for quick lookup
    const linkIndex = new Map<string, string[]>();
    for (const link of links) {
      if (!linkIndex.has(link.source))
        linkIndex.set(link.source, []);
      linkIndex.get(link.source)!.push(link.target);
      if (!linkIndex.has(link.target))
        linkIndex.set(link.target, []);
      linkIndex.get(link.target)!.push(link.source);
    }

    let tickCount = 0;
    const maxTicks = 300;

    function tick() {
      if (tickCount > maxTicks) {
        // Just redraw, no more simulation
        draw();
        return;
      }
      tickCount++;

      const alpha = Math.max(0.01, 1 - tickCount / maxTicks);

      // Repulsion between all nodes
      const nodeArr = nodes.map((n) => ({ ...n, pos: pos.get(n.id)! }));
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const a = nodeArr[i].pos;
          const b = nodeArr[j].pos;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = (800 * alpha) / (dist * dist);
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          a.vx -= dx;
          a.vy -= dy;
          b.vx += dx;
          b.vy += dy;
        }
      }

      // Attraction along links
      for (const link of links) {
        const a = pos.get(link.source);
        const b = pos.get(link.target);
        if (!a || !b) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (dist - 120) * 0.005 * alpha;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
      }

      // Center gravity
      for (const p of pos.values()) {
        p.vx += (W / 2 - p.x) * 0.001 * alpha;
        p.vy += (H / 2 - p.y) * 0.001 * alpha;
      }

      // Apply velocity with damping
      for (const p of pos.values()) {
        p.vx *= 0.85;
        p.vy *= 0.85;
        p.x += p.vx;
        p.y += p.vy;
        // Bounds
        p.x = Math.max(30, Math.min(W - 30, p.x));
        p.y = Math.max(30, Math.min(H - 30, p.y));
      }

      draw();
      animRef.current = requestAnimationFrame(tick);
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      // Draw links
      ctx.lineWidth = 1;
      for (const link of links) {
        const a = pos.get(link.source);
        const b = pos.get(link.target);
        if (!a || !b) continue;
        ctx.strokeStyle = `rgba(100, 116, 139, ${0.2 + link.strength * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Draw relation label at midpoint
        if (link.relation) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(link.relation, mx, my - 3);
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const p = pos.get(node.id);
        if (!p) continue;
        const radius = Math.max(6, Math.min(20, 4 + node.event_count * 0.5));
        const color = typeColor(node.type);

        // Glow for owner
        if (node.is_owner) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = "#e2e8f0";
        ctx.font = `${node.is_owner ? "bold " : ""}11px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(node.name, p.x, p.y + radius + 14);
      }
    }

    // Click handler
    function handleClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const node of nodes) {
        const p = pos.get(node.id);
        if (!p) continue;
        const radius = Math.max(6, Math.min(20, 4 + node.event_count * 0.5));
        const dx = mx - p.x;
        const dy = my - p.y;
        if (dx * dx + dy * dy < (radius + 5) * (radius + 5)) {
          onNodeClick(node);
          return;
        }
      }
    }

    canvas.addEventListener("click", handleClick);
    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener("click", handleClick);
    };
  }, [nodes, links, onNodeClick]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No entities in memory yet. Chat with BabyAGI to build the knowledge graph.
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}

export function MemoryContainer() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [nodeEdges, setNodeEdges] = useState<GraphLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [graphData, statsData] = await Promise.all([
        apiFetch<{ nodes: GraphNode[]; links: GraphLink[] }>("/memory/graph?limit=80"),
        apiFetch<MemoryStats>("/memory/stats"),
      ]);
      setNodes(graphData.nodes || []);
      setLinks(graphData.links || []);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleNodeClick = useCallback(
    async (node: GraphNode) => {
      setSelectedNode(node);
      // Fetch edges for this node
      try {
        const data = await apiFetch<{
          edges: {
            id: string;
            source_entity_id: string;
            target_entity_id: string;
            relation: string;
            strength: number;
          }[];
        }>(`/memory/edges?entity_id=${node.id}`);
        setNodeEdges(
          (data.edges || []).map((e) => ({
            source: e.source_entity_id,
            target: e.target_entity_id,
            relation: e.relation,
            strength: e.strength,
          }))
        );
      } catch {
        setNodeEdges([]);
      }
    },
    []
  );

  const filteredNodes = typeFilter
    ? nodes.filter((n) => n.type === typeFilter)
    : nodes;
  const filteredLinks = typeFilter
    ? links.filter(
        (l) =>
          filteredNodes.some((n) => n.id === l.source) &&
          filteredNodes.some((n) => n.id === l.target)
      )
    : links;

  const types = Array.from(new Set(nodes.map((n) => n.type))).sort();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading memory...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <p className="text-destructive text-sm">Failed to load memory: {error}</p>
        <p className="text-xs text-muted-foreground max-w-md">
          Make sure the backend is running with memory enabled.
        </p>
        <Button variant="outline" size="sm" onClick={fetchData}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b shrink-0 overflow-x-auto">
        <h1 className="text-lg font-semibold shrink-0">Memory</h1>
        {stats && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{stats.entities} entities</span>
            <span className="text-border">|</span>
            <span>{stats.edges} relationships</span>
            <span className="text-border">|</span>
            <span>{stats.events} events</span>
            <span className="text-border">|</span>
            <span>{stats.topics} topics</span>
            {stats.facts > 0 && (
              <>
                <span className="text-border">|</span>
                <span>{stats.facts} facts</span>
              </>
            )}
            {stats.learnings > 0 && (
              <>
                <span className="text-border">|</span>
                <span>{stats.learnings} learnings</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Type filter pills */}
      {types.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2 border-b shrink-0">
          <button
            onClick={() => setTypeFilter(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              typeFilter === null
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({nodes.length})
          </button>
          {types.map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                typeFilter === type
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {TYPE_LABELS[type] || type} (
              {nodes.filter((n) => n.type === type).length})
            </button>
          ))}
        </div>
      )}

      {/* Main content: graph + detail panel */}
      <div className="flex flex-1 min-h-0">
        {/* Graph */}
        <div className="flex-1 min-w-0 relative">
          <ForceGraph
            nodes={filteredNodes}
            links={filteredLinks}
            onNodeClick={handleNodeClick}
          />
          {/* Legend */}
          <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-card/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted-foreground capitalize">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-72 border-l p-4 overflow-y-auto shrink-0 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-sm">{selectedNode.name}</h3>
                <Badge
                  variant="outline"
                  className={`text-[10px] mt-1 ${typeBadgeClass(selectedNode.type)}`}
                >
                  {selectedNode.type}
                </Badge>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                ✕
              </button>
            </div>

            {selectedNode.description && (
              <p className="text-xs text-muted-foreground">
                {selectedNode.description}
              </p>
            )}

            <div className="text-xs text-muted-foreground">
              {selectedNode.event_count} events
              {selectedNode.is_owner && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  Owner
                </Badge>
              )}
            </div>

            {nodeEdges.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Relationships ({nodeEdges.length})
                </h4>
                {nodeEdges.map((edge, i) => {
                  const otherNodeId =
                    edge.source === selectedNode.id
                      ? edge.target
                      : edge.source;
                  const otherNode = nodes.find((n) => n.id === otherNodeId);
                  return (
                    <Card key={i} className="p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor: typeColor(
                              otherNode?.type || "concept"
                            ),
                          }}
                        />
                        <span className="font-medium truncate">
                          {otherNode?.name || otherNodeId.slice(0, 8)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 italic">
                        {edge.relation}
                      </p>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Entity list below graph */}
      <div className="border-t max-h-60 overflow-y-auto shrink-0">
        <div className="px-6 py-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            All Entities
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredNodes.map((node) => (
              <button
                key={node.id}
                onClick={() => handleNodeClick(node)}
                className={`text-left p-2 rounded-md text-xs transition-colors hover:bg-muted/50 ${
                  selectedNode?.id === node.id ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: typeColor(node.type) }}
                  />
                  <span className="font-medium truncate">{node.name}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">
                    {node.event_count}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
