/** Left-hand module library: drag onto the canvas or click to add. */

import { ALL_NODES, NODE_CATEGORIES } from '@/engine/registry';
import { useProjectStore } from '@/state/projectStore';

const CAT_COLORS: Record<string, string> = {
  source: 'var(--sig-source)',
  process: 'var(--sig-process)',
  analyze: 'var(--sig-analyze)',
  output: 'var(--sig-output)',
};

export function NodeLibrary() {
  const addNode = useProjectStore((s) => s.addNode);
  const nodes = useProjectStore((s) => s.project.graph.nodes);

  const clickAdd = (type: string) => {
    // Place near the right of the existing layout so new nodes don't stack
    const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
    const y = 120 + (nodes.length % 5) * 90;
    addNode(type, nodes.length ? maxX + 240 : 120, y);
  };

  return (
    <aside className="library" aria-label="Module library">
      <div className="library-head">
        <span className="panel-label">Module Library</span>
      </div>
      <div className="library-body">
        {NODE_CATEGORIES.map((cat) => (
          <div className="lib-cat" key={cat.id}>
            <div className="lib-cat-head">
              <span className="swatch" style={{ background: CAT_COLORS[cat.id] }} aria-hidden />
              <span className="panel-label">{cat.label}</span>
            </div>
            {ALL_NODES.filter((n) => n.category === cat.id).map((def) => (
              <button
                key={def.type}
                type="button"
                className="lib-item"
                draggable
                data-testid={`lib-${def.type}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/spp-node-type', def.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => clickAdd(def.type)}
                title={`${def.description}\n\nClick to add, or drag onto the canvas.`}
              >
                <span className="t">{def.title}</span>
                <span className="b">{def.blurb}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
