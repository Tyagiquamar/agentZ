import type { EdgeProps, InternalNode, Node } from "@xyflow/react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
} from "@xyflow/react"

export function GraphEdge({ id, label, source, target, markerEnd, style, type }: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const [sourceX, sourceY] = handleCoordinates(sourceNode, Position.Right)
  const [targetX, targetY] = handleCoordinates(targetNode, Position.Left)
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded bg-background/95 px-2 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-border"
            style={{
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {type === "animated" ? (
        <circle fill="var(--primary)" r="4">
          <animateMotion dur="2s" path={edgePath} repeatCount="indefinite" />
        </circle>
      ) : null}
    </>
  )
}

function handleCoordinates(node: InternalNode<Node>, position: Position.Left | Position.Right) {
  const type = position === Position.Left ? "target" : "source"
  const handle = node.internals.handleBounds?.[type]?.find((handle) => handle.position === position)
  if (!handle) return [0, 0] as const
  return [
    node.internals.positionAbsolute.x + handle.x + (position === Position.Right ? handle.width : 0),
    node.internals.positionAbsolute.y + handle.y + handle.height / 2,
  ] as const
}
