'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useAuthedSWR from '@/hooks/useAuthedSWR';
import { useSocket } from '@/contexts/SocketContext';
import { useTheme } from '@/contexts/ThemeContext';

const NW = 214;
const NH = 164;
const H_GAP = 20;
const ROW_GAP = 34;
const BAND_GAP = 78;
const AVATAR_H = 36;
const PAD_X = 42;

const LEVELS = [9, 8, 7, 6, 5, 4, 3, 2, 1];
const BAND_ORDER = [9, 8, 7, 'HR', 6, 5, 4, 3, 2, 1];
const LEVEL_NAMES = {
  9: 'Director',
  8: 'Assistant Director',
  7: 'C-Suite',
  6: 'Manager',
  5: 'Assistant Manager',
  4: 'Team Lead',
  3: 'Senior',
  2: 'Mid Level',
  1: 'Entry',
};
const BAND_LABELS = {
  9: 'DIRECTORS',
  8: 'ASSISTANT DIRECTORS',
  7: 'C-SUITE',
  HR: 'HUMAN RESOURCES',
  6: 'MANAGERS',
  5: 'ASSISTANT MANAGERS',
  4: 'TEAM LEADS',
  3: 'SENIOR',
  2: 'MID LEVEL',
  1: 'ENTRY',
};
const BAND_COLORS = {
  9: '#f59e0b',
  8: '#fb923c',
  7: '#8b5cf6',
  HR: '#ec4899',
  6: '#06b6d4',
  5: '#22d3ee',
  4: '#10b981',
  3: '#6366f1',
  2: '#94a3b8',
  1: '#64748b',
};

function isHrNode(node) {
  if (node?.isHR) return true;
  const dept = (node?.department || '').toString().trim().toLowerCase();
  const desig = (node?.designation || '').toString().trim().toLowerCase();
  const re = /(human\s*resource|people\s*operations|people\s*&?\s*culture|talent\s*management|^hr$|\bhr\b|hrbp|hr\s*ops)/;
  return re.test(dept) || re.test(desig);
}

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

function deptColor(id) {
  if (!id) return PALETTE[0];
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function flattenTree(nodes, acc = { nodes: [], edges: [] }) {
  for (const n of nodes || []) {
    acc.nodes.push(n);
    if (n.children?.length) {
      for (const c of n.children) acc.edges.push({ fromId: n.id, toId: c.id });
      flattenTree(n.children, acc);
    }
  }
  return acc;
}

function parseDateSafe(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function compareByTenureThenAge(a, b) {
  const joinA = parseDateSafe(a.dateOfJoining);
  const joinB = parseDateSafe(b.dateOfJoining);
  if (joinA !== null && joinB !== null && joinA !== joinB) return joinA - joinB;
  if (joinA !== null && joinB === null) return -1;
  if (joinA === null && joinB !== null) return 1;

  const dobA = parseDateSafe(a.dateOfBirth);
  const dobB = parseDateSafe(b.dateOfBirth);
  if (dobA !== null && dobB !== null && dobA !== dobB) return dobA - dobB;
  if (dobA !== null && dobB === null) return -1;
  if (dobA === null && dobB !== null) return 1;

  return (a.name || '').localeCompare(b.name || '');
}

function buildLayout(allNodes, canvasW) {
  const maxCols = Math.max(3, Math.floor((canvasW - PAD_X * 2 + H_GAP) / (NW + H_GAP)));

  const byLevel = {};
  for (const key of BAND_ORDER) byLevel[key] = [];
  for (const n of allNodes) {
    if (isHrNode(n)) {
      byLevel.HR.push(n);
      continue;
    }
    const lvl = Math.min(Math.max(Number(n.level) || 1, 1), 9);
    byLevel[lvl].push(n);
  }
  for (const key of BAND_ORDER) byLevel[key].sort(compareByTenureThenAge);

  const bandInfo = {};
  let currentY = AVATAR_H + 8;

  // Bands that should always render a divider/label even when empty
  const ALWAYS_SHOW = new Set(['HR', 6, 5, 4]);
  const EMPTY_BAND_H = 28;

  for (const lvl of BAND_ORDER) {
    const group = byLevel[lvl];
    if (!group.length) {
      if (!ALWAYS_SHOW.has(lvl)) continue;
      const bandStartY = currentY;
      bandInfo[lvl] = { startY: bandStartY, endY: bandStartY + EMPTY_BAND_H, count: 0 };
      currentY += EMPTY_BAND_H + BAND_GAP;
      continue;
    }

    const bandStartY = currentY;
    const numRows = Math.ceil(group.length / maxCols);

    for (let i = 0; i < group.length; i++) {
      const rowIdx = Math.floor(i / maxCols);
      const colIdx = i % maxCols;

      const rowStart = rowIdx * maxCols;
      const rowCount = Math.min(maxCols, group.length - rowStart);
      const rowW = rowCount * NW + (rowCount - 1) * H_GAP;
      const startX = (canvasW - rowW) / 2;

      group[i]._x = startX + colIdx * (NW + H_GAP) + NW / 2;
      group[i]._y = currentY + rowIdx * (NH + ROW_GAP);
    }

    const bandH = numRows * NH + (numRows - 1) * ROW_GAP;
    bandInfo[lvl] = { startY: bandStartY, endY: bandStartY + bandH, count: group.length };
    currentY += bandH + BAND_GAP;
  }

  return { bandInfo, canvasH: currentY + 20 };
}

function OrgCard({
  node,
  isViewer,
  isSearchHit,
  color,
  isHovered,
  isRelated,
  isDimmed,
  tooltipData,
  onHoverStart,
  onHoverEnd,
  onCardClick,
  tooltipSide,
  isDarkMode,
}) {
  const ref = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [spec, setSpec] = useState({ x: 50, y: 50 });

  function onMove(e) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ rx: (py - 0.5) * -12, ry: (px - 0.5) * 12 });
    setSpec({ x: px * 100, y: py * 100 });
  }

  function onLeave() {
    setTilt({ rx: 0, ry: 0 });
    setSpec({ x: 50, y: 50 });
    onHoverEnd?.(node.id);
  }

  const accent = isViewer ? '#10b981' : color;
  const levelName = LEVEL_NAMES[node.level] || `L${node.level}`;
  const cardBg = isViewer
    ? (isDarkMode
      ? 'linear-gradient(155deg, rgba(16,185,129,0.18) 0%, rgba(10,18,26,0.96) 72%)'
      : 'linear-gradient(155deg, rgba(16,185,129,0.18) 0%, rgba(245,252,248,0.96) 72%)')
    : (isDarkMode
      ? 'linear-gradient(165deg, rgba(17,24,39,0.96) 0%, rgba(5,8,15,0.98) 78%)'
      : 'linear-gradient(165deg, rgba(255,255,255,0.97) 0%, rgba(244,247,250,0.98) 80%)');

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => onHoverStart?.(node.id)}
      onMouseLeave={onLeave}
      onClick={() => onCardClick?.(node.id)}
      style={{
        position: 'absolute',
        left: node._x - NW / 2,
        top: node._y - AVATAR_H,
        width: NW,
        height: NH + AVATAR_H,
        cursor: 'pointer',
        zIndex: isHovered ? 26 : isRelated ? 20 : 12,
        opacity: isDimmed ? 0.2 : 1,
        filter: isDimmed ? 'grayscale(0.35) blur(0.2px)' : 'none',
        transition: 'opacity 260ms ease, filter 260ms ease, transform 220ms ease',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: AVATAR_H + 4,
          left: tooltipSide === 'right' ? `calc(100% + 12px)` : 'auto',
          right: tooltipSide === 'left' ? `calc(100% + 12px)` : 'auto',
          transform: `translateY(${isHovered ? '0px' : '6px'})`,
          pointerEvents: 'none',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 220ms ease, transform 220ms ease',
          width: 270,
          maxHeight: 'none',
          padding: '8px 10px',
          borderRadius: 10,
          background: isDarkMode ? 'rgba(2,6,23,0.92)' : 'rgba(255,255,255,0.95)',
          border: `1px solid ${accent}77`,
          boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
          color: isDarkMode ? '#dbeafe' : '#0f172a',
          fontSize: 11,
          lineHeight: 1.35,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{node.name}</div>
        <div style={{ opacity: 0.92, marginBottom: 6 }}>
          <span style={{ opacity: 0.7 }}>Reports To:</span>{' '}
          {tooltipData.parentName ? (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: 999,
                background: `${accent}26`,
                border: `1px solid ${accent}55`,
                color: isDarkMode ? '#e2e8f0' : '#0f172a',
                fontWeight: 600,
              }}
            >
              {tooltipData.parentName}
            </span>
          ) : (
            <span style={{ opacity: 0.7, fontStyle: 'italic' }}>Top Level</span>
          )}
        </div>
        <div style={{ opacity: 0.92 }}>
          <div style={{ opacity: 0.7, marginBottom: 4 }}>Direct Reports:</div>
          {tooltipData.childrenNames.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tooltipData.childrenNames.map((nm) => (
                <span
                  key={nm}
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.06)',
                    border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.32)' : 'rgba(15,23,42,0.14)'}`,
                    color: isDarkMode ? '#e2e8f0' : '#0f172a',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nm}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ opacity: 0.7, fontStyle: 'italic' }}>None</span>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: `translateX(-50%) ${isHovered ? 'scale(1.03)' : 'scale(1)'}`,
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: `3px solid ${accent}`,
          overflow: 'hidden',
          zIndex: 5,
          background: isDarkMode ? '#0f172a' : '#e2e8f0',
          boxShadow: isHovered ? `0 0 0 5px ${accent}2b, 0 8px 20px rgba(0,0,0,0.45)` : '0 4px 14px rgba(0,0,0,0.35)',
          transition: 'transform 180ms ease, box-shadow 180ms ease',
        }}
      >
        {node.profilePicture ? (
          <img src={node.profilePicture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: accent,
              fontSize: 21,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            {(node.name || '?')[0].toUpperCase()}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'absolute',
          top: AVATAR_H,
          left: 0,
          width: NW,
          height: NH,
          borderRadius: 18,
          background: cardBg,
          border: `1.5px solid ${isViewer ? '#10b981' : `${color}56`}`,
          boxShadow: isViewer
            ? '0 0 0 2px #10b98155, 0 10px 30px rgba(16,185,129,0.16), 0 2px 8px rgba(0,0,0,0.35)'
            : isSearchHit
              ? `0 0 0 2px ${accent}bb, 0 12px 36px ${accent}66, 0 2px 8px rgba(0,0,0,0.35)`
              : isHovered || isRelated
                ? `0 0 0 1.5px ${accent}88, 0 12px 32px ${accent}36, 0 2px 8px rgba(0,0,0,0.32)`
                : '0 8px 22px rgba(0,0,0,0.24), 0 2px 6px rgba(0,0,0,0.2)',
          transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) ${isHovered ? 'translateY(-2px)' : 'translateY(0px)'}`,
          transition: 'transform 180ms ease, box-shadow 220ms ease, border-color 220ms ease, opacity 220ms ease',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 30,
          paddingLeft: 10,
          paddingRight: 10,
          paddingBottom: 12,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 18,
            pointerEvents: 'none',
            background: `radial-gradient(circle at ${spec.x}% ${spec.y}%, rgba(255,255,255,0.09) 0%, transparent 60%)`,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 18 }}>
          <div>
            {node.isDepartmentHead && (
              <span
                style={{
                  background: '#92400e',
                  color: '#fde68a',
                  fontSize: 8.5,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 999,
                  letterSpacing: '0.05em',
                }}
              >
                HEAD
              </span>
            )}
          </div>
          <div
            style={{
              maxWidth: 98,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              background: `${accent}1f`,
              color: accent,
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: 999,
            }}
            title={node.department || ''}
          >
            {node.department || 'No Dept'}
          </div>
        </div>

        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            fontWeight: 800,
            color: 'var(--color-text-primary, #f1f5f9)',
            textAlign: 'center',
            lineHeight: 1.25,
            minHeight: 32,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {node.name}
          {isViewer && <span style={{ color: '#10b981' }}> (You)</span>}
        </div>

        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--color-text-secondary, #94a3b8)',
            textAlign: 'center',
            lineHeight: 1.25,
            minHeight: 28,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={node.designation || ''}
        >
          {node.designation}
        </div>

        <div
          style={{
            marginTop: 'auto',
            fontSize: 10,
            fontWeight: 800,
            color: accent,
            letterSpacing: '0.06em',
            textAlign: 'center',
          }}
        >
          L{node.level} · {levelName.toUpperCase()}
        </div>

        {isViewer && (
          <div
            style={{
              position: 'absolute',
              inset: -3,
              borderRadius: 22,
              border: '2px solid #10b98155',
              animation: 'pulseRing 2s ease-in-out infinite',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function HierarchyPage() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const { data, mutate } = useAuthedSWR('/api/hierarchy/tree');
  const { onEmployeeUpdated, onEmployeeCreated } = useSocket();

  useEffect(() => {
    const previousBody = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Also lock the dashboard layout's <main> scroll container so wheel/touch
    // events on the organogram never bubble into a page scroll.
    const mainEl = document.querySelector('main');
    let prevMainOverflow = '';
    let prevMainOverscroll = '';
    if (mainEl) {
      prevMainOverflow = mainEl.style.overflow;
      prevMainOverscroll = mainEl.style.overscrollBehavior;
      mainEl.style.overflow = 'hidden';
      mainEl.style.overscrollBehavior = 'contain';
    }

    return () => {
      document.body.style.overflow = previousBody;
      document.documentElement.style.overflow = previousHtml;
      if (mainEl) {
        mainEl.style.overflow = prevMainOverflow;
        mainEl.style.overscrollBehavior = prevMainOverscroll;
      }
    };
  }, []);

  useEffect(() => {
    const u1 = onEmployeeUpdated?.(() => mutate());
    const u2 = onEmployeeCreated?.(() => mutate());
    return () => {
      u1?.();
      u2?.();
    };
  }, [onEmployeeUpdated, onEmployeeCreated, mutate]);

  const vpRef = useRef(null);
  const [vpW, setVpW] = useState(0);

  useEffect(() => {
    function resize() {
      if (vpRef.current) setVpW(vpRef.current.clientWidth);
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (vpRef.current) ro.observe(vpRef.current);
    return () => ro.disconnect();
  }, []);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(24);
  const [scale, setScale] = useState(1);
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 });

  const canvasW = Math.max(vpW || 0, 1200);

  const { allNodes, edges, nodeMap, bandInfo, canvasH, viewerId, totalEmployees } = useMemo(() => {
    const roots = data?.data?.roots || [];
    const viewerEmployeeId = data?.data?.viewerEmployeeId;
    const total = data?.data?.totalEmployees || 0;

    if (!roots.length || canvasW === 0) {
      return {
        allNodes: [],
        edges: [],
        nodeMap: {},
        bandInfo: {},
        canvasH: 600,
        viewerId: viewerEmployeeId,
        totalEmployees: total,
      };
    }

    const cloned = JSON.parse(JSON.stringify(roots));
    const flat = flattenTree(cloned);
    const all = flat.nodes;
    const edgeList = flat.edges;
    const laidOut = buildLayout(all, canvasW);

    const map = {};
    for (const n of all) map[n.id] = n;

    return {
      allNodes: all,
      edges: edgeList,
      nodeMap: map,
      bandInfo: laidOut.bandInfo,
      canvasH: laidOut.canvasH,
      viewerId: viewerEmployeeId,
      totalEmployees: total,
    };
  }, [data, canvasW]);

  const relationship = useMemo(() => {
    const parentById = {};
    const childrenById = {};
    for (const node of allNodes) childrenById[node.id] = [];
    for (const e of edges) {
      parentById[e.toId] = e.fromId;
      if (!childrenById[e.fromId]) childrenById[e.fromId] = [];
      childrenById[e.fromId].push(e.toId);
    }
    return { parentById, childrenById };
  }, [allNodes, edges]);

  const [hoveredId, setHoveredId] = useState(null);

  const hoverRelatedIds = useMemo(() => {
    if (!hoveredId) return null;
    const { parentById, childrenById } = relationship;
    const related = new Set([hoveredId]);

    let p = parentById[hoveredId];
    while (p) {
      related.add(p);
      p = parentById[p];
    }

    const stack = [...(childrenById[hoveredId] || [])];
    while (stack.length) {
      const id = stack.pop();
      if (related.has(id)) continue;
      related.add(id);
      const kids = childrenById[id] || [];
      for (const k of kids) stack.push(k);
    }

    return related;
  }, [hoveredId, relationship]);

  const tooltipById = useMemo(() => {
    const { parentById, childrenById } = relationship;
    const result = {};
    for (const n of allNodes) {
      const parentId = parentById[n.id];
      const parentName = parentId ? (nodeMap[parentId]?.name || '') : '';
      const childrenNames = (childrenById[n.id] || []).map((cid) => nodeMap[cid]?.name).filter(Boolean);
      result[n.id] = { parentName, childrenNames };
    }
    return result;
  }, [allNodes, relationship, nodeMap]);

  const focusNode = useCallback(
    (id) => {
      const node = nodeMap[id];
      if (!node || !vpRef.current) return;
      const vw = vpRef.current.clientWidth;
      const vh = vpRef.current.clientHeight;
      const targetScale = 1.2;
      setScale(targetScale);
      // Center the card both horizontally and vertically in the viewport.
      setTx(vw / 2 - node._x * targetScale);
      setTy(vh / 2 - (node._y + NH / 2) * targetScale);
      setSelectedEmployeeId(id);
    },
    [nodeMap]
  );

  const fitToScreen = useCallback(() => {
    if (!vpRef.current) return;
    const vw = vpRef.current.clientWidth;
    // Default to 80% zoom, but shrink further if the canvas is wider than the viewport at 80%.
    const widthFitScale = vw / (canvasW + 10);
    const s = Math.min(0.8, widthFitScale);
    setScale(s);
    setTx((vw - canvasW * s) / 2);
    // Anchor near the top but leave comfortable headroom so the Directors band
    // isn't flush against the toolbar.
    setTy(72);
  }, [canvasW]);

  useEffect(() => {
    if (!allNodes.length) return;
    fitToScreen();
  }, [allNodes.length, fitToScreen]);

  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNodes.slice(0, 8);
    return allNodes
      .filter((n) => {
        const name = (n.name || '').toLowerCase();
        const desig = (n.designation || '').toLowerCase();
        const dept = (n.department || '').toLowerCase();
        return name.includes(q) || desig.includes(q) || dept.includes(q);
      })
      .slice(0, 8);
  }, [allNodes, query]);

  function selectSuggestion(node) {
    setQuery(node.name || '');
    setShowSuggestions(false);
    setSelectedEmployeeId(node.id);
    focusNode(node.id);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, ox: tx, oy: ty };
  }

  function onMouseMove(e) {
    if (!drag.current.active) return;
    if (Math.abs(e.clientX - drag.current.sx) > 3 || Math.abs(e.clientY - drag.current.sy) > 3) {
      drag.current.moved = true;
    }
    setTx(drag.current.ox + e.clientX - drag.current.sx);
    setTy(drag.current.oy + e.clientY - drag.current.sy);
  }

  function onMouseUp() {
    drag.current.active = false;
  }

  function onCardClick(id) {
    if (drag.current.moved) return;
    router.push(`/dashboard/employees/${id}`);
  }

  function onWheel(e) {
    e.preventDefault();
    if (!vpRef.current) return;
    const rect = vpRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;

    setScale((s) => {
      const next = Math.min(2, Math.max(0.18, s * factor));
      setTx((prev) => mx - (mx - prev) * (next / s));
      setTy((prev) => my - (my - prev) * (next / s));
      return next;
    });
  }

  function bezier(from, to) {
    const fx = from._x;
    const fy = from._y + NH;
    const tx2 = to._x;
    const ty2 = to._y;
    const mid = (fy + ty2) / 2;
    return `M ${fx} ${fy} C ${fx} ${mid}, ${tx2} ${mid}, ${tx2} ${ty2}`;
  }

  const loading = !data;

  return (
    <>
      <style>{`
        @keyframes pulseRing { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:0.9;transform:scale(1.03)} }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      <div
        ref={vpRef}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background: isDarkMode ? '#000000' : '#ffffff',
          userSelect: 'none',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ width: 38, height: 38, border: '3px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {totalEmployees > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: 16,
              zIndex: 40,
              background: isDarkMode ? 'rgba(2,6,23,0.65)' : 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(8px)',
              border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.14)'}`,
              borderRadius: 999,
              padding: '5px 14px',
              color: isDarkMode ? '#93c5fd' : '#334155',
              fontSize: 12,
              fontWeight: 650,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 800, letterSpacing: '0.04em', color: isDarkMode ? '#e2e8f0' : '#0f172a' }}>Organogram</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{totalEmployees} employees</span>
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 41,
            width: 'min(860px, calc(100vw - 44px))',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 10,
            alignItems: 'start',
          }}
        >
          <div style={{ position: 'relative' }}>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Search employee by name, role, or department"
              style={{
                width: '100%',
                height: 38,
                borderRadius: 12,
                border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.33)' : 'rgba(15,23,42,0.2)'}`,
                background: isDarkMode ? 'rgba(2, 6, 23, 0.72)' : 'rgba(255,255,255,0.88)',
                color: isDarkMode ? '#e2e8f0' : '#0f172a',
                padding: '0 12px',
                outline: 'none',
                backdropFilter: 'blur(8px)',
                fontSize: 13,
              }}
            />

            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  borderRadius: 10,
                  border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.3)' : 'rgba(15,23,42,0.16)'}`,
                  background: isDarkMode ? 'rgba(2, 6, 23, 0.93)' : 'rgba(255,255,255,0.97)',
                  backdropFilter: 'blur(8px)',
                  maxHeight: 260,
                  overflowY: 'auto',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                }}
              >
                {suggestions.map((n, idx) => (
                  <button
                    key={n.id}
                    onClick={() => selectSuggestion(n)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '9px 10px',
                      border: 'none',
                      borderBottom: idx === suggestions.length - 1 ? 'none' : `1px solid ${isDarkMode ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.1)'}`,
                      background: 'transparent',
                      color: isDarkMode ? '#cbd5e1' : '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#0f172a' }}>{n.name}</div>
                    <div style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                      {n.designation} • L{n.level}{n.department ? ` • ${n.department}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => viewerId && focusNode(viewerId)}
            disabled={!viewerId}
            style={{
              height: 38,
              padding: '0 16px',
              borderRadius: 12,
              border: '1.5px solid #10b981',
              background: 'rgba(16,185,129,0.16)',
              color: '#10b981',
              fontSize: 12,
              fontWeight: 700,
              cursor: viewerId ? 'pointer' : 'not-allowed',
              backdropFilter: 'blur(8px)',
              letterSpacing: '0.04em',
              opacity: viewerId ? 1 : 0.45,
              whiteSpace: 'nowrap',
            }}
          >
            ⊙ Find Me
          </button>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            zIndex: 35,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {[
            { l: '+', f: () => setScale((s) => Math.min(2, s * 1.2)) },
            { l: '⊡', f: fitToScreen },
            { l: '−', f: () => setScale((s) => Math.max(0.18, s / 1.2)) },
          ].map(({ l, f }) => (
            <button
              key={l}
              onClick={f}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: isDarkMode ? 'rgba(2,6,23,0.72)' : 'rgba(255,255,255,0.86)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${isDarkMode ? 'rgba(148,163,184,0.2)' : 'rgba(15,23,42,0.15)'}`,
                color: isDarkMode ? '#e2e8f0' : '#0f172a',
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              {l}
            </button>
          ))}
          <div style={{ textAlign: 'center', fontSize: 10, color: isDarkMode ? '#64748b' : '#475569' }}>{Math.round(scale * 100)}%</div>
        </div>

        <div
          style={{
            position: 'absolute',
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: canvasW,
            height: canvasH,
            transition: drag.current.active ? 'none' : 'transform 180ms ease',
          }}
        >
          {BAND_ORDER.map((lvl) => {
            const info = bandInfo[lvl];
            if (!info) return null;
            const col = BAND_COLORS[lvl];
            const midY = info.startY + (info.endY - info.startY) / 2;
            return (
              <div key={lvl}>
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: midY - 40,
                    width: 20,
                    textAlign: 'center',
                    fontSize: 9,
                    fontWeight: 800,
                    color: col,
                    letterSpacing: '0.1em',
                    opacity: 0.58,
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    transform: 'rotate(180deg)',
                  }}
                >
                  {BAND_LABELS[lvl]}
                </div>

                <div
                  style={{
                    position: 'absolute',
                    left: 30,
                    right: 0,
                    top: info.startY - BAND_GAP / 2 - AVATAR_H,
                    height: 1,
                    background: `linear-gradient(90deg, ${col}44, transparent)`,
                    opacity: isDarkMode ? 1 : 0.7,
                  }}
                />
              </div>
            );
          })}

          <svg style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} width={canvasW} height={canvasH}>
            {edges.map(({ fromId, toId }, i) => {
              const from = nodeMap[fromId];
              const to = nodeMap[toId];
              if (!from || !to) return null;
              const col = deptColor(to.departmentId || to.department);
              const active = hoveredId && hoverRelatedIds?.has(fromId) && hoverRelatedIds?.has(toId);
              return (
                <path
                  key={i}
                  d={bezier(from, to)}
                  stroke={col}
                  strokeWidth={active ? 2.4 : 1.4}
                  fill="none"
                  opacity={!hoveredId ? 0.34 : active ? 0.9 : 0.12}
                  strokeDasharray={to.level < from.level - 1 ? '4 3' : undefined}
                  style={{ transition: 'opacity 230ms ease, stroke-width 230ms ease' }}
                />
              );
            })}
          </svg>

          {allNodes.map((node) => {
            const isHovered = hoveredId === node.id;
            const isRelated = !!hoveredId && hoverRelatedIds?.has(node.id);
            const isDimmed = !!hoveredId && !isRelated;
            return (
              <OrgCard
                key={node.id}
                node={node}
                isViewer={node.id === viewerId}
                isSearchHit={node.id === selectedEmployeeId}
                isHovered={isHovered}
                isRelated={isRelated}
                isDimmed={isDimmed}
                tooltipData={tooltipById[node.id] || { parentName: '', childrenNames: [] }}
                onHoverStart={setHoveredId}
                onHoverEnd={() => setHoveredId(null)}
                onCardClick={onCardClick}
                tooltipSide={node._x > canvasW * 0.62 ? 'left' : 'right'}
                isDarkMode={isDarkMode}
                color={deptColor(node.departmentId || node.department)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
