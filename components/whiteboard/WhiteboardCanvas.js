'use client';

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import MiraLoadingOverlay from '@/components/ui/MiraLoadingOverlay';
import Loader from '@/components/ui/Loader';
import { useAILoading } from '@/contexts/AILoadingContext';

// Utility functions
const generateId = () => `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const getMidpoint = (p1, p2) => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });

// Helper to measure text dimensions
const measureText = (text, fontSize, fontFamily, fontWeight) => {
  const size = fontSize || 16;
  if (!text) return { width: 100, height: size * 1.4 };

  // Create a temporary canvas for measuring
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontWeight || 'normal'} ${size}px '${fontFamily || 'Poppins'}', system-ui, sans-serif`;

  const lines = text.split('\n');
  const lineHeight = size * 1.4;
  let maxWidth = 0;

  lines.forEach(line => {
    const metrics = ctx.measureText(line);
    maxWidth = Math.max(maxWidth, metrics.width);
  });

  return {
    width: Math.max(maxWidth + 24, 60), // Add padding and minimum width
    height: Math.max(lines.length * lineHeight + 10, size * 1.4)
  };
};

const getBoundingBox = (obj) => {
  if (!obj) return { x: 0, y: 0, width: 0, height: 0 };

  if (obj.type === 'pencil' || obj.type === 'line' || obj.type.includes('rrow')) {
    if (!obj.points || obj.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = obj.points.map(p => p.x);
    const ys = obj.points.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  }

  // Ensure x and y have default values
  const x = obj.x ?? 0;
  const y = obj.y ?? 0;

  // For text objects, calculate dimensions based on actual text content and font size
  if (obj.type === 'text') {
    const measured = measureText(obj.text, obj.fontSize, obj.fontFamily, obj.fontWeight);
    return {
      x,
      y,
      width: Math.max(obj.width || 0, measured.width, 50),
      height: Math.max(obj.height || 0, measured.height, 20)
    };
  }

  // For sticky notes, ensure minimum dimensions
  if (obj.type === 'sticky') {
    return {
      x,
      y,
      width: obj.width || 200,
      height: obj.height || 200
    };
  }

  return { x, y, width: obj.width || 0, height: obj.height || 0 };
};

// FigJam-style color palette
const COLORS = [
  '#1a1a1a', '#f24822', '#ff7262', '#ffc700', '#1bc47d',
  '#0d99ff', '#9747ff', '#ffffff', '#b3b3b3', '#757575'
];

const WhiteboardCanvas = forwardRef(({
  boardId,
  initialData = null,
  onSave,
  permission = 'editor',
  onClose,
  onFilePickerOpen
}, ref) => {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const [pages, setPages] = useState(initialData?.pages || [{ id: generateId(), objects: [] }]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(true);

  const [tool, setTool] = useState('select');
  const [arrowType, setArrowType] = useState('straight'); // straight, curved, elbow
  const [arrowLineStyle, setArrowLineStyle] = useState('solid'); // solid, dashed, dotted
  const [strokeColor, setStrokeColor] = useState('#1a1a1a');
  const [fillColor, setFillColor] = useState('transparent');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [showStrokeColorPicker, setShowStrokeColorPicker] = useState(false);
  const [showFillColorPicker, setShowFillColorPicker] = useState(false);
  const [clipboard, setClipboard] = useState(null);

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);
  const [startPoint, setStartPoint] = useState(null);

  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null); // { corner, startBounds, originalBounds, startPoint }

  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const [textEditing, setTextEditing] = useState(null);
  const [textValue, setTextValue] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showArrowMenu, setShowArrowMenu] = useState(false);
  const [showArrowOptions, setShowArrowOptions] = useState(false);
  const [showPenOptions, setShowPenOptions] = useState(false);
  const [showShapeOptions, setShowShapeOptions] = useState(false);
  const [showElementOptions, setShowElementOptions] = useState(false);
  const [showLineOptions, setShowLineOptions] = useState(false);
  const [showHighlighterOptions, setShowHighlighterOptions] = useState(false);
  const [showEraserOptions, setShowEraserOptions] = useState(false);
  const [borderRadius, setBorderRadius] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [highlighterColor, setHighlighterColor] = useState('#ffc700');
  const [highlighterOpacity, setHighlighterOpacity] = useState(0.4);
  const [eraserPreviewPath, setEraserPreviewPath] = useState([]);
  const [lastMousePos, setLastMousePos] = useState(null); // screen coords
  const [lastCanvasPoint, setLastCanvasPoint] = useState(null); // canvas coords for eraser
  const [isRotating, setIsRotating] = useState(false);
  const [showShapesMenu, setShowShapesMenu] = useState(false);
  const [currentShapeTool, setCurrentShapeTool] = useState('rect'); // rect, ellipse, diamond, triangle, star, hexagon, pentagon
  const [rotationCenter, setRotationCenter] = useState(null);
  const [showTextOptions, setShowTextOptions] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [fontWeight, setFontWeight] = useState('normal');
  const [textColor, setTextColor] = useState('#1a1a1a');
  const [fontFamily, setFontFamily] = useState('Poppins');
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [debouncedPanelPosition, setDebouncedPanelPosition] = useState(null);
  const panelPositionTimeoutRef = useRef(null);

  // Font options for text/sticky notes
  const FONT_OPTIONS = [
    { name: 'Poppins', label: 'Aa', displayName: 'Poppins', style: 'sans-serif' },
    { name: 'Caveat', label: 'Aa', displayName: 'Caveat', style: 'handwriting' },
    { name: 'Dancing Script', label: 'Aa', displayName: 'Dancing', style: 'handwriting' },
    { name: 'Indie Flower', label: 'Aa', displayName: 'Indie', style: 'handwriting' },
    { name: 'Patrick Hand', label: 'Aa', displayName: 'Patrick', style: 'handwriting' },
    { name: 'Shadows Into Light', label: 'Aa', displayName: 'Shadows', style: 'handwriting' },
  ];

  // Load Google Fonts for canvas rendering
  useEffect(() => {
    const fontLink = document.createElement('link');
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Dancing+Script:wght@400;700&family=Indie+Flower&family=Patrick+Hand&family=Poppins:wght@400;500;600;700&family=Shadows+Into+Light&display=swap';
    fontLink.rel = 'stylesheet';
    document.head.appendChild(fontLink);

    // Wait for fonts to load
    document.fonts.ready.then(() => {
      setFontsLoaded(true);
    });

    return () => {
      if (fontLink.parentNode) {
        document.head.removeChild(fontLink);
      }
    };
  }, []);

  const [touchStartDistance, setTouchStartDistance] = useState(null);
  const [touchStartZoom, setTouchStartZoom] = useState(1);
  const [lastTouchCenter, setLastTouchCenter] = useState(null);
  const [eraserRadius, setEraserRadius] = useState(20);
  const [confirmModal, setConfirmModal] = useState(null); // { message, onConfirm }

  const [isDirty, setIsDirty] = useState(false);
  const saveTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageCache = useRef(new Map()); // Cache for loaded images

  // AI Analysis state
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(initialData?.aiAnalysis || { summary: '', messages: [], notes: [], keyPoints: [] });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiError, setAiError] = useState(null);
  
  // Global AI loading animation
  const { startAILoading, stopAILoading } = useAILoading();
  const [showAgentMode, setShowAgentMode] = useState(false);
  const aiPanelRef = useRef(null);
  const aiMessagesEndRef = useRef(null);

  // AI-generated object animation state
  const [animatingIds, setAnimatingIds] = useState(new Set());
  const [animationProgress, setAnimationProgress] = useState({});
  const [isAnimatingZoom, setIsAnimatingZoom] = useState(false);
  const [isScanningCanvas, setIsScanningCanvas] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [imagesLoaded, setImagesLoaded] = useState(0); // Trigger redraw when images load

  const currentPage = pages[currentPageIndex];
  const objects = currentPage?.objects || [];
  const isReadOnly = permission === 'view_only';

  // Clear selection when board/page changes to avoid stale references
  useEffect(() => {
    setSelectedIds([]);
    setResizeHandle(null);
    setDragStart(null);
    setIsDrawing(false);
    setShowElementOptions(false);
    setDebouncedPanelPosition(null);
  }, [boardId, currentPageIndex]);

  // Reset debounced panel position when selection changes
  useEffect(() => {
    setDebouncedPanelPosition(null);
    // Clear any pending timeout
    if (panelPositionTimeoutRef.current) {
      clearTimeout(panelPositionTimeoutRef.current);
    }
  }, [selectedIds.length > 0 ? selectedIds.join(',') : '']);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (panelPositionTimeoutRef.current) {
        clearTimeout(panelPositionTimeoutRef.current);
      }
    };
  }, []);

  // Preload images when objects change
  useEffect(() => {
    const imageObjects = objects.filter(obj => obj.type === 'image' && obj.image);
    let loadedCount = 0;

    imageObjects.forEach(obj => {
      if (!imageCache.current.has(obj.image)) {
        const img = new Image();
        img.onload = () => {
          imageCache.current.set(obj.image, img);
          loadedCount++;
          if (loadedCount === imageObjects.length) {
            setImagesLoaded(prev => prev + 1); // Trigger redraw
          }
        };
        img.onerror = () => {
          console.error('Failed to load image:', obj.image?.substring(0, 50));
          loadedCount++;
        };
        img.src = obj.image;
      }
    });
  }, [objects]);

  // Helper to close all property panels
  const closeAllPanels = useCallback(() => {
    setShowPenOptions(false);
    setShowHighlighterOptions(false);
    setShowLineOptions(false);
    setShowArrowMenu(false);
    setShowArrowOptions(false);
    setShowShapesMenu(false);
    setShowEraserOptions(false);
    setShowTextOptions(false);
    setShowShapeOptions(false);
    setShowElementOptions(false);
  }, []);

  // Check if any panel is open
  const isAnyPanelOpen = showPenOptions || showHighlighterOptions || showLineOptions ||
    showArrowMenu || showArrowOptions || showShapesMenu || showEraserOptions || showTextOptions ||
    showShapeOptions || showElementOptions;

  // Click outside to close panels (except element options which is managed by selection)
  useEffect(() => {
    // Only close tool-related panels, not element options (which depends on selection)
    const toolPanelsOpen = showPenOptions || showHighlighterOptions || showLineOptions ||
      showArrowMenu || showArrowOptions || showShapesMenu || showEraserOptions || showTextOptions ||
      showShapeOptions;

    if (!toolPanelsOpen) return;

    const handleClickOutside = (e) => {
      // Check if click is on a panel or toolbar button
      const isPanelClick = e.target.closest('[data-panel]') ||
        e.target.closest('[data-toolbar]') ||
        e.target.closest('.property-panel');
      // Don't close if clicking on canvas (user might be selecting elements)
      const isCanvasClick = e.target.closest('canvas');
      if (!isPanelClick && !isCanvasClick) {
        // Close all tool panels
        setShowPenOptions(false);
        setShowHighlighterOptions(false);
        setShowLineOptions(false);
        setShowArrowMenu(false);
        setShowArrowOptions(false);
        setShowShapesMenu(false);
        setShowEraserOptions(false);
        setShowTextOptions(false);
        setShowShapeOptions(false);
        setShowElementOptions(false);
      }
    };

    // Use mousedown for immediate response
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPenOptions, showHighlighterOptions, showLineOptions, showArrowMenu, showArrowOptions, showShapesMenu, showEraserOptions, showTextOptions, showShapeOptions]);

  // Show/hide element options based on selection
  useEffect(() => {
    if (selectedIds.length > 0) {
      // Don't show element options if text options are already open (avoid duplicate panels)
      // Only show element options if text options is closed
      if (!showTextOptions) {
        setShowElementOptions(true);
      } else {
        // Text options is open, keep element options closed
        setShowElementOptions(false);
      }
    } else {
      setShowElementOptions(false);
      // Also close text options when nothing is selected
      setShowTextOptions(false);
    }
  }, [selectedIds, showTextOptions]);

  // Auto-center to drawings on mount
  useEffect(() => {
    if (objects.length === 0 || !canvasRef.current) return;

    // Calculate bounding box of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    objects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    if (minX === Infinity) return;

    // Calculate center of all objects
    const objectsCenterX = (minX + maxX) / 2;
    const objectsCenterY = (minY + maxY) / 2;

    // Calculate canvas center
    const canvas = canvasRef.current;
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Set pan to center objects in viewport
    setPanX(canvasCenterX - objectsCenterX * zoom);
    setPanY(canvasCenterY - objectsCenterY * zoom);
  }, []); // Run only on mount

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      draw();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Sync rotation state when selection changes
  useEffect(() => {
    if (selectedIds.length === 1) {
      const selectedObj = objects.find(o => o.id === selectedIds[0]);
      if (selectedObj && selectedObj.rotation !== undefined) {
        setRotation(selectedObj.rotation);
      } else {
        setRotation(0);
      }
    } else if (selectedIds.length > 1) {
      // For multiple selections, use first object's rotation
      const firstObj = objects.find(o => o.id === selectedIds[0]);
      setRotation(firstObj?.rotation || 0);
    } else {
      setRotation(0);
    }
  }, [selectedIds, objects]);

  // Draw function
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    // Light cream background like FigJam
    ctx.fillStyle = '#fffbf5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Subtle dot grid like FigJam
    if (showGrid) {
      const gridSize = 24;
      const dotSize = 1;
      ctx.fillStyle = '#e0ddd8';
      const startX = Math.floor(-panX / zoom / gridSize) * gridSize;
      const startY = Math.floor(-panY / zoom / gridSize) * gridSize;
      const endX = startX + canvas.width / zoom + gridSize * 2;
      const endY = startY + canvas.height / zoom + gridSize * 2;

      for (let x = startX; x < endX; x += gridSize) {
        for (let y = startY; y < endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, dotSize / zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw objects
    objects.forEach(obj => drawObject(ctx, obj));

    // Draw current path
    if (currentPath) {
      drawObject(ctx, currentPath);
    }

    // Draw selection
    if (selectedIds.length > 0) {
      drawSelectionOverlay(ctx);
    }

    // Draw selection box
    if (selectionBox) {
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([]);
      ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
      ctx.fillStyle = 'rgba(13, 153, 255, 0.08)';
      ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
    }

    // Draw eraser cursor and preview
    if (tool === 'eraser' && lastCanvasPoint) {
      // Draw eraser circle at the actual canvas point
      ctx.beginPath();
      ctx.arc(lastCanvasPoint.x, lastCanvasPoint.y, eraserRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw semi-transparent red fill showing what will be erased
      if (eraserPreviewPath.length > 0) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
        ctx.fill();
      }
    }

    ctx.restore();
  }, [objects, currentPath, selectedIds, selectionBox, showGrid, zoom, panX, panY, tool, eraserRadius, lastCanvasPoint, eraserPreviewPath, animatingIds, animationProgress, imagesLoaded]);

  const drawObject = useCallback((ctx, obj) => {
    ctx.save();

    // Check if this object is being animated (AI-generated fade-in)
    const isAnimating = animatingIds.has(obj.id);
    const progress = animationProgress[obj.id] || 1;

    // Apply animation effects
    if (isAnimating && progress < 1) {
      // Smoky particle fade-in effect
      ctx.globalAlpha = (obj.opacity ?? 1) * progress * progress; // Quadratic easing

      // Subtle scale effect (starts slightly smaller)
      const scale = 0.85 + (0.15 * progress);
      const bbox = getBoundingBox(obj);
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);
      ctx.translate(-centerX, -centerY);

      // Add blur-like effect by drawing multiple times with slight offsets
      if (progress < 0.5) {
        const blur = (1 - progress * 2) * 3;
        ctx.shadowColor = obj.fillColor || obj.strokeColor || '#888';
        ctx.shadowBlur = blur;
      }
    } else {
      ctx.globalAlpha = obj.opacity ?? 1;
    }

    ctx.strokeStyle = obj.strokeColor || strokeColor;
    ctx.fillStyle = obj.fillColor || 'transparent';
    ctx.lineWidth = obj.strokeWidth || strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Apply rotation if object has rotation property
    if (obj.rotation && obj.rotation !== 0) {
      const bbox = getBoundingBox(obj);
      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;
      ctx.translate(centerX, centerY);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    switch (obj.type) {
      case 'pencil':
      case 'highlighter':
        if (obj.points && obj.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(obj.points[0].x, obj.points[0].y);
          for (let i = 1; i < obj.points.length; i++) {
            const p0 = obj.points[i - 1];
            const p1 = obj.points[i];
            const mid = getMidpoint(p0, p1);
            ctx.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y);
          }
          ctx.stroke();
        } else if (obj.points && obj.points.length === 1) {
          // Draw a dot for single point (tap)
          ctx.beginPath();
          ctx.arc(obj.points[0].x, obj.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.fillStyle = obj.strokeColor || strokeColor;
          ctx.fill();
        }
        break;

      case 'line':
        if (obj.points && obj.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(obj.points[0].x, obj.points[0].y);
          ctx.lineTo(obj.points[obj.points.length - 1].x, obj.points[obj.points.length - 1].y);
          ctx.stroke();
        }
        break;

      case 'arrow':
        if (obj.points && obj.points.length >= 2) {
          const start = obj.points[0];
          const end = obj.points[obj.points.length - 1];

          // Apply line style (solid, dashed, dotted)
          const lineStyle = obj.lineStyle || 'solid';
          if (lineStyle === 'dashed') {
            ctx.setLineDash([12, 6]);
          } else if (lineStyle === 'dotted') {
            ctx.setLineDash([3, 6]);
          } else {
            ctx.setLineDash([]);
          }

          if (obj.arrowType === 'curved') {
            // Draw curved arrow using stored control point or calculate from path
            let controlX, controlY;

            if (obj.controlPoint) {
              // Use stored control point from drawn path
              controlX = obj.controlPoint.x;
              controlY = obj.controlPoint.y;
            } else if (obj.pathPoints && obj.pathPoints.length > 3) {
              // Use middle of drawing path as live control point
              const midIndex = Math.floor(obj.pathPoints.length / 2);
              controlX = obj.pathPoints[midIndex].x;
              controlY = obj.pathPoints[midIndex].y;
            } else {
              // Fallback to calculated control point
              controlX = (start.x + end.x) / 2 + (end.y - start.y) * 0.25;
              controlY = (start.y + end.y) / 2 - (end.x - start.x) * 0.25;
            }

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.quadraticCurveTo(controlX, controlY, end.x, end.y);
            ctx.stroke();

            // Calculate angle at end point for arrowhead
            const t = 0.99;
            const tangentX = 2 * (1 - t) * (controlX - start.x) + 2 * t * (end.x - controlX);
            const tangentY = 2 * (1 - t) * (controlY - start.y) + 2 * t * (end.y - controlY);
            const angle = Math.atan2(tangentY, tangentX);

            // Draw arrowhead (always solid)
            ctx.setLineDash([]);
            const arrowLength = 12;
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle - Math.PI / 6), end.y - arrowLength * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle + Math.PI / 6), end.y - arrowLength * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          } else if (obj.arrowType === 'elbow') {
            // Draw elbow arrow (right-angled) - direction aware
            const deltaX = Math.abs(end.x - start.x);
            const deltaY = Math.abs(end.y - start.y);
            const isHorizontalFirst = deltaX >= deltaY; // Determine primary direction

            ctx.beginPath();
            ctx.moveTo(start.x, start.y);

            let angle;
            if (isHorizontalFirst) {
              // Go horizontal first, then vertical
              const midX = end.x;
              ctx.lineTo(midX, start.y);
              ctx.lineTo(midX, end.y);
              ctx.lineTo(end.x, end.y);
              // Arrow points in the final segment direction (vertical)
              angle = end.y > start.y ? Math.PI / 2 : -Math.PI / 2;
            } else {
              // Go vertical first, then horizontal
              const midY = end.y;
              ctx.lineTo(start.x, midY);
              ctx.lineTo(end.x, midY);
              ctx.lineTo(end.x, end.y);
              // Arrow points in the final segment direction (horizontal)
              angle = end.x > start.x ? 0 : Math.PI;
            }
            ctx.stroke();

            // Draw arrowhead (always solid)
            ctx.setLineDash([]);
            const arrowLength = 12;
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle - Math.PI / 6), end.y - arrowLength * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle + Math.PI / 6), end.y - arrowLength * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          } else {
            // Straight arrow
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Draw arrowhead (always solid)
            ctx.setLineDash([]);
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const arrowLength = 12;
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle - Math.PI / 6), end.y - arrowLength * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - arrowLength * Math.cos(angle + Math.PI / 6), end.y - arrowLength * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }

          // Reset line dash
          ctx.setLineDash([]);
        }
        break;

      case 'rect':
        const rectRadius = obj.borderRadius ?? 0;
        ctx.beginPath();
        ctx.roundRect(obj.x, obj.y, obj.width, obj.height, rectRadius);
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(obj.x + obj.width / 2, obj.y + obj.height / 2, Math.abs(obj.width / 2), Math.abs(obj.height / 2), 0, 0, Math.PI * 2);
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(obj.x + obj.width / 2, obj.y);
        ctx.lineTo(obj.x + obj.width, obj.y + obj.height / 2);
        ctx.lineTo(obj.x + obj.width / 2, obj.y + obj.height);
        ctx.lineTo(obj.x, obj.y + obj.height / 2);
        ctx.closePath();
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(obj.x + obj.width / 2, obj.y);
        ctx.lineTo(obj.x + obj.width, obj.y + obj.height);
        ctx.lineTo(obj.x, obj.y + obj.height);
        ctx.closePath();
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'star':
        const starCx = obj.x + obj.width / 2;
        const starCy = obj.y + obj.height / 2;
        const outerRadius = Math.min(obj.width, obj.height) / 2;
        const innerRadius = outerRadius * 0.4;
        const spikes = 5;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const r = i % 2 === 0 ? outerRadius : innerRadius;
          const angle = (Math.PI / spikes) * i - Math.PI / 2;
          const px = starCx + Math.cos(angle) * r;
          const py = starCy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'hexagon':
        const hexCx = obj.x + obj.width / 2;
        const hexCy = obj.y + obj.height / 2;
        const hexRadius = Math.min(obj.width, obj.height) / 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 2;
          const px = hexCx + Math.cos(angle) * hexRadius;
          const py = hexCy + Math.sin(angle) * hexRadius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'pentagon':
        const pentCx = obj.x + obj.width / 2;
        const pentCy = obj.y + obj.height / 2;
        const pentRadius = Math.min(obj.width, obj.height) / 2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
          const px = pentCx + Math.cos(angle) * pentRadius;
          const py = pentCy + Math.sin(angle) * pentRadius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (obj.fillColor && obj.fillColor !== 'transparent') ctx.fill();
        ctx.stroke();
        break;

      case 'sticky':
        // Sticky note with shadow and auto-height
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = obj.fillColor || '#ffc700';
        const stickyWidth = obj.width || 200;
        const padding = 12;
        const fontSize = obj.fontSize || 14;
        const lineHeight = fontSize * 1.4;

        // Calculate required height based on text content
        let calculatedHeight = obj.height || 120;
        const objFontFamily = obj.fontFamily || 'Poppins';
        if (obj.text) {
          ctx.font = `${obj.fontWeight || 'normal'} ${fontSize}px '${objFontFamily}', system-ui, sans-serif`;
          const maxWidth = stickyWidth - padding * 2;
          const words = obj.text.split(/\s+/);
          let line = '';
          let lineCount = 1;

          for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
              line = words[i] + ' ';
              lineCount++;
            } else {
              line = testLine;
            }
          }

          // Calculate height with padding
          const textHeight = lineCount * lineHeight + padding * 2;
          calculatedHeight = Math.max(obj.height || 80, textHeight);
        }

        // Draw the sticky note background
        ctx.beginPath();
        ctx.roundRect(obj.x, obj.y, stickyWidth, calculatedHeight, obj.borderRadius || 4);
        ctx.fill();
        ctx.shadowColor = 'transparent';

        // Draw text with word wrap
        if (obj.text) {
          ctx.fillStyle = obj.strokeColor || '#1a1a1a';
          ctx.font = `${obj.fontWeight || 'normal'} ${fontSize}px '${objFontFamily}', system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';

          const maxWidth = stickyWidth - padding * 2;
          const words = obj.text.split(/\s+/);
          let line = '';
          let y = obj.y + padding;

          for (let i = 0; i < words.length; i++) {
            const testLine = line + words[i] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
              ctx.fillText(line.trim(), obj.x + padding, y);
              line = words[i] + ' ';
              y += lineHeight;
            } else {
              line = testLine;
            }
          }
          ctx.fillText(line.trim(), obj.x + padding, y);
        }
        break;

      case 'text':
        const textFontFamily = obj.fontFamily || 'Poppins';
        ctx.font = `${obj.fontWeight || 'normal'} ${obj.fontSize || 16}px '${textFontFamily}', system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = obj.strokeColor || strokeColor;

        const textLines = (obj.text || '').split('\n');
        const textLineHeight = (obj.fontSize || 16) * 1.4;
        textLines.forEach((line, i) => {
          ctx.fillText(line, obj.x, obj.y + i * textLineHeight);
        });
        break;

      case 'image':
        if (obj.image) {
          try {
            // Use cached image if available
            let img = imageCache.current.get(obj.image);
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, obj.x, obj.y, obj.width, obj.height);
            } else if (!img) {
              // Start loading if not in cache
              img = new Image();
              img.onload = () => {
                imageCache.current.set(obj.image, img);
                setImagesLoaded(prev => prev + 1);
              };
              img.src = obj.image;
              imageCache.current.set(obj.image, img); // Store immediately to prevent re-loading

              // Draw placeholder while loading
              ctx.fillStyle = '#f5f5f5';
              ctx.strokeStyle = '#e0e0e0';
              ctx.lineWidth = 2;
              ctx.setLineDash([8, 4]);
              ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
              ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
              ctx.setLineDash([]);

              // Loading indicator
              ctx.fillStyle = '#9e9e9e';
              ctx.font = '14px Inter, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('Loading...', obj.x + obj.width / 2, obj.y + obj.height / 2);
            }
          } catch (e) {
            console.error('Failed to draw image', e);
          }
        } else if (obj.isPlaceholder) {
          // Draw image placeholder
          ctx.fillStyle = '#f5f5f5';
          ctx.strokeStyle = '#e0e0e0';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
          ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
          ctx.setLineDash([]);

          // Draw image icon in center
          const iconSize = Math.min(obj.width, obj.height) * 0.3;
          const iconX = obj.x + obj.width / 2;
          const iconY = obj.y + obj.height / 2;

          ctx.strokeStyle = '#9e9e9e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          // Mountain icon
          ctx.moveTo(iconX - iconSize / 2, iconY + iconSize / 3);
          ctx.lineTo(iconX - iconSize / 4, iconY - iconSize / 6);
          ctx.lineTo(iconX, iconY + iconSize / 6);
          ctx.lineTo(iconX + iconSize / 4, iconY - iconSize / 3);
          ctx.lineTo(iconX + iconSize / 2, iconY + iconSize / 3);
          ctx.closePath();
          ctx.stroke();

          // Sun circle
          ctx.beginPath();
          ctx.arc(iconX - iconSize / 3, iconY - iconSize / 4, iconSize / 8, 0, Math.PI * 2);
          ctx.stroke();

          // "Click to add" text
          ctx.fillStyle = '#9e9e9e';
          ctx.font = `${Math.min(14, obj.width / 10)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Click to add image', iconX, iconY + iconSize / 2 + 10);
        }
        break;
    }

    ctx.restore();
  }, [strokeColor, strokeWidth, animatingIds, animationProgress]);

  const drawSelectionOverlay = useCallback((ctx) => {
    const selectedObjects = objects.filter(o => selectedIds.includes(o.id));
    if (selectedObjects.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedObjects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    const padding = 8;
    const x = minX - padding;
    const y = minY - padding;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, width, height);

    // Corner handles - small circles
    const handleRadius = 5 / zoom;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 2 / zoom;
    const handles = [
      { x: x, y: y, corner: 'tl' },
      { x: x + width, y: y, corner: 'tr' },
      { x: x, y: y + height, corner: 'bl' },
      { x: x + width, y: y + height, corner: 'br' }
    ];
    handles.forEach(h => {
      ctx.beginPath();
      ctx.arc(h.x, h.y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    });

    // Rotation handle - circle at top center
    const rotateHandleY = y - 30 / zoom;
    const rotateHandleX = x + width / 2;
    ctx.beginPath();
    ctx.arc(rotateHandleX, rotateHandleY, 8 / zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0d99ff';
    ctx.stroke();

    // Draw line connecting rotation handle to selection
    ctx.beginPath();
    ctx.moveTo(rotateHandleX, rotateHandleY);
    ctx.lineTo(rotateHandleX, y);
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [objects, selectedIds, zoom, fontsLoaded]);

  useEffect(() => { draw(); }, [draw]);

  const getCanvasPoint = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
  }, [panX, panY, zoom]);

  const getResizeHandle = useCallback((point) => {
    if (selectedIds.length === 0) return null;

    const selectedObjects = objects.filter(o => selectedIds.includes(o.id));
    if (selectedObjects.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedObjects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    const padding = 8;
    const x = minX - padding;
    const y = minY - padding;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    const handleRadius = 12 / zoom; // Hit area slightly larger than visual for easier grabbing
    const handles = [
      { x: x, y: y, corner: 'tl' },
      { x: x + width, y: y, corner: 'tr' },
      { x: x, y: y + height, corner: 'bl' },
      { x: x + width, y: y + height, corner: 'br' }
    ];

    for (const handle of handles) {
      const dist = Math.sqrt(Math.pow(point.x - handle.x, 2) + Math.pow(point.y - handle.y, 2));
      if (dist < handleRadius) {
        return {
          corner: handle.corner,
          handleX: handle.x,
          handleY: handle.y,
          startBounds: { x, y, width, height },
          originalBounds: { minX, minY, maxX, maxY }
        };
      }
    }

    return null;
  }, [selectedIds, objects, zoom]);

  // Check if point is on rotation handle
  const getRotationHandle = useCallback((point) => {
    if (selectedIds.length === 0) return null;

    const selectedObjects = objects.filter(o => selectedIds.includes(o.id));
    if (selectedObjects.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedObjects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    const padding = 8;
    const x = minX - padding;
    const y = minY - padding;
    const width = maxX - minX + padding * 2;

    // Rotation handle is at top center, 30px above
    const rotateHandleX = x + width / 2;
    const rotateHandleY = y - 30 / zoom;
    const handleRadius = 12 / zoom;

    const dist = Math.sqrt(Math.pow(point.x - rotateHandleX, 2) + Math.pow(point.y - rotateHandleY, 2));
    if (dist < handleRadius) {
      return {
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
      };
    }

    return null;
  }, [selectedIds, objects, zoom]);

  // Helper function to calculate point to line distance
  const pointToLineDistance = useCallback((point, lineStart, lineEnd) => {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }

    return Math.sqrt(Math.pow(point.x - xx, 2) + Math.pow(point.y - yy, 2));
  }, []);

  const hitTest = useCallback((point) => {
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (!obj) continue;
      const bbox = getBoundingBox(obj);
      // Increase padding for text and sticky for easier selection
      const basePadding = (obj.strokeWidth || 2) / 2 + 5;
      const padding = (obj.type === 'text' || obj.type === 'sticky') ? Math.max(basePadding, 15) : basePadding;
      if (point.x >= bbox.x - padding && point.x <= bbox.x + bbox.width + padding &&
        point.y >= bbox.y - padding && point.y <= bbox.y + bbox.height + padding) {
        return obj;
      }
    }
    return null;
  }, [objects]);

  const saveHistory = useCallback(() => {
    setHistory(prev => [...prev.slice(-199), JSON.stringify(objects)]);
    setFuture([]);
  }, [objects]);

  const updateObjects = useCallback((newObjects) => {
    setPages(prev => {
      const updated = [...prev];
      updated[currentPageIndex] = { ...updated[currentPageIndex], objects: newObjects };
      return updated;
    });
    setIsDirty(true);
  }, [currentPageIndex]);

  // Auto-straighten lines based on angle threshold
  const straightenLine = useCallback((points) => {
    if (!points || points.length < 2) return points;

    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // Threshold angles for snapping (horizontal, vertical, 45-degree diagonals)
    const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135];
    const threshold = 8; // degrees

    for (const snapAngle of snapAngles) {
      if (Math.abs(angle - snapAngle) < threshold) {
        const rad = snapAngle * (Math.PI / 180);
        const length = Math.sqrt(dx * dx + dy * dy);
        return [
          start,
          { x: start.x + length * Math.cos(rad), y: start.y + length * Math.sin(rad) }
        ];
      }
    }

    return points;
  }, []);

  // Shape recognition for hand-drawn shapes
  const recognizeShape = useCallback((points) => {
    if (!points || points.length < 8) return null; // More lenient - was 10

    const first = points[0];
    const last = points[points.length - 1];
    const distance = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2));

    // Check if shape is closed (start and end points are close) - more lenient
    const isClosed = distance < 50; // Was 30

    if (!isClosed) return null;

    // Calculate bounding box
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;
    const aspectRatio = width / height;

    // Calculate perimeter and area approximations
    let perimeter = 0;
    for (let i = 1; i < points.length; i++) {
      perimeter += Math.sqrt(
        Math.pow(points[i].x - points[i - 1].x, 2) +
        Math.pow(points[i].y - points[i - 1].y, 2)
      );
    }

    // Circularity test: 4π × area / perimeter²
    const area = width * height;
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);

    // Check corners first for better shape detection
    const corners = findCorners(points);

    // Recognize rectangle/square first (has clear corners)
    if (corners.length >= 3 && corners.length <= 5) {
      if (corners.length === 4) {
        // 4 corners = rectangle or square
        if (Math.abs(aspectRatio - 1) < 0.3) {
          // Square
          const size = Math.max(width, height);
          return {
            type: 'rect',
            x: minX,
            y: minY,
            width: size,
            height: size
          };
        } else if (aspectRatio > 0.2 && aspectRatio < 5) {
          // Rectangle
          return {
            type: 'rect',
            x: minX,
            y: minY,
            width,
            height
          };
        }
      } else if (corners.length === 3) {
        // Could be a triangle - keep as drawing for now
        return null;
      }
    }

    // Recognize circle ONLY if very circular and no corners detected
    if (circularity > 0.75 && aspectRatio > 0.85 && aspectRatio < 1.15 && corners.length <= 2) {
      return {
        type: 'ellipse',
        x: minX,
        y: minY,
        width,
        height
      };
    }

    // Recognize rectangle by low circularity (elongated shapes)
    if (circularity < 0.65 && circularity > 0.3) {
      if (Math.abs(aspectRatio - 1) < 0.3) {
        // Square-ish
        const size = Math.max(width, height);
        return {
          type: 'rect',
          x: minX,
          y: minY,
          width: size,
          height: size
        };
      } else if (aspectRatio > 0.2 && aspectRatio < 5) {
        // Rectangle
        return {
          type: 'rect',
          x: minX,
          y: minY,
          width,
          height
        };
      }
    }

    return null;
  }, []);

  // Helper to find corners in a path (sharp angle changes)
  const findCorners = (points) => {
    const corners = [];
    const angleThreshold = 25; // More sensitive - was 30 degrees
    const step = Math.max(3, Math.floor(points.length / 40)); // Adaptive step

    for (let i = step; i < points.length - step; i += step) {
      const prev = points[i - step];
      const curr = points[i];
      const next = points[i + step];

      const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
      let angleDiff = Math.abs(angle2 - angle1) * (180 / Math.PI);

      if (angleDiff > 180) angleDiff = 360 - angleDiff;

      if (angleDiff > angleThreshold) {
        // Check if not too close to existing corners
        const tooClose = corners.some(c => {
          const dist = Math.sqrt(Math.pow(c.x - curr.x, 2) + Math.pow(c.y - curr.y, 2));
          return dist < 15; // Minimum distance between corners
        });

        if (!tooClose) {
          corners.push(curr);
        }
      }
    }

    return corners;
  };

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setFuture(f => [...f, JSON.stringify(objects)]);
    setHistory(h => h.slice(0, -1));
    updateObjects(JSON.parse(history[history.length - 1]));
  }, [history, objects, updateObjects]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setHistory(h => [...h, JSON.stringify(objects)]);
    setFuture(f => f.slice(0, -1));
    updateObjects(JSON.parse(future[future.length - 1]));
  }, [future, objects, updateObjects]);

  const handlePointerDown = useCallback((e) => {
    if (isReadOnly) return;
    const point = getCanvasPoint(e);
    setStartPoint(point);

    // Close ALL toolbox panels when clicking on canvas (except MIRA panel)
    setShowElementOptions(false);
    setShowLineOptions(false);
    setShowShapeOptions(false);
    setShowHighlighterOptions(false);
    setShowShapesMenu(false);
    setShowPenOptions(false);
    setShowArrowMenu(false);
    setShowArrowOptions(false);
    setShowEraserOptions(false);
    setShowTextOptions(false);

    // Capture pointer to continue drawing even when pointer moves over other elements
    if (e.target && e.target.setPointerCapture) {
      e.target.setPointerCapture(e.pointerId);
    }

    if (tool === 'pan' || e.button === 1 || (e.button === 0 && e.spaceKey)) {
      setIsDrawing(true);
      setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
      return;
    }

    if (tool === 'eraser') {
      setIsDrawing(true);
      saveHistory();
      // Erase pixels in radius instead of deleting whole objects
      const erasedObjects = [];
      objects.forEach(obj => {
        if (obj.type === 'pencil' && obj.points) {
          // For pencil strokes, remove points within eraser radius
          const remainingPoints = obj.points.filter(p => {
            const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2));
            return dist > eraserRadius;
          });

          if (remainingPoints.length > 1) {
            erasedObjects.push({ ...obj, points: remainingPoints });
          }
          // If too few points remain, don't add the object (effectively delete it)
        } else {
          // For shapes, check if eraser overlaps with bbox
          const bbox = getBoundingBox(obj);
          const dist = Math.sqrt(
            Math.pow(Math.max(bbox.x, Math.min(point.x, bbox.x + bbox.width)) - point.x, 2) +
            Math.pow(Math.max(bbox.y, Math.min(point.y, bbox.y + bbox.height)) - point.y, 2)
          );

          if (dist > eraserRadius) {
            erasedObjects.push(obj);
          }
          // If within radius, delete the whole shape
        }
      });

      updateObjects(erasedObjects);
      return;
    }

    if (tool === 'image') {
      // Create an image placeholder in the center of the viewport
      const canvas = canvasRef.current;
      const centerX = canvas ? (canvas.width / 2 - panX) / zoom : 400;
      const centerY = canvas ? (canvas.height / 2 - panY) / zoom : 300;

      const newPlaceholder = {
        id: generateId(),
        type: 'image',
        x: centerX - 100,
        y: centerY - 75,
        width: 200,
        height: 150,
        image: null, // null means placeholder
        opacity: 1,
        isPlaceholder: true
      };

      saveHistory();
      updateObjects([...objects, newPlaceholder]);
      setSelectedIds([newPlaceholder.id]);
      setTool('select');
      return;
    }

    if (tool === 'select') {
      // Check for rotation handle first
      const rotHandle = getRotationHandle(point);
      if (rotHandle) {
        setIsRotating(true);
        setRotationCenter(rotHandle);
        setIsDrawing(true);
        return;
      }

      // Check for resize handle
      const handle = getResizeHandle(point);
      if (handle) {
        // Store original object states for proper resize calculation
        const selectedObjs = objects.filter(o => selectedIds.includes(o.id));
        const originalObjectStates = selectedObjs.map(obj => ({
          id: obj.id,
          ...JSON.parse(JSON.stringify(obj)) // Deep clone
        }));

        saveHistory();
        setResizeHandle({
          corner: handle.corner,
          originalBounds: handle.originalBounds,
          startPoint: point,
          originalObjects: originalObjectStates
        });
        setIsDrawing(true);
        return;
      }

      const hit = hitTest(point);
      if (hit) {
        if (!selectedIds.includes(hit.id)) {
          // If the hit object is part of a group, select all objects in that group
          if (hit.groupId && !e.shiftKey) {
            const groupIds = objects.filter(o => o.groupId === hit.groupId).map(o => o.id);
            setSelectedIds(groupIds);
          } else {
            setSelectedIds(e.shiftKey ? [...selectedIds, hit.id] : [hit.id]);
          }
        }
        // Save initial positions for drag calculation
        saveHistory();
        setDragStart(point);
        setShowElementOptions(true);
      } else {
        setSelectedIds([]);
        // Set startPoint for selection box drawing
        setStartPoint(point);
        setSelectionBox({ x: point.x, y: point.y, width: 0, height: 0 });
        setShowElementOptions(false);
      }
      setIsDrawing(true);
      return;
    }

    if (tool === 'text' || tool === 'sticky') {
      // Check if we clicked on an existing text/sticky to edit it
      const hit = hitTest(point);
      if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
        setTextEditing({ id: hit.id, x: hit.x, y: hit.y, type: hit.type, editing: true });
        setTextValue(hit.text || '');
      }
      // Don't select other elements - just ignore clicks on them when in text/sticky mode
      setIsDrawing(false);
      return;
    }

    // For shape/line/arrow tools, do NOT select existing elements - just draw new ones
    // Selection should only work with the select tool

    saveHistory();
    setIsDrawing(true);

    if (tool === 'pencil' || tool === 'highlighter') {
      // Add two points at the same location to create a dot if user just taps
      setCurrentPath({
        id: generateId(), type: tool === 'highlighter' ? 'highlighter' : 'pencil',
        points: [point, { x: point.x + 0.1, y: point.y + 0.1 }],
        strokeColor: tool === 'highlighter' ? highlighterColor : strokeColor,
        strokeWidth: tool === 'highlighter' ? strokeWidth * 3 : strokeWidth,
        opacity: tool === 'highlighter' ? highlighterOpacity : 1, fillColor: 'transparent'
      });
    } else if (tool === 'line' || tool === 'arrow') {
      setCurrentPath({
        id: generateId(), type: tool, points: [point, point],
        strokeColor, strokeWidth, opacity: 1, fillColor: 'transparent',
        arrowType: tool === 'arrow' ? arrowType : undefined,
        lineStyle: tool === 'arrow' ? arrowLineStyle : undefined
      });
    } else if (['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon'].includes(tool)) {
      setCurrentPath({
        id: generateId(), type: tool, x: point.x, y: point.y, width: 0, height: 0,
        strokeColor, fillColor, strokeWidth, opacity: 1,
        borderRadius: tool === 'rect' ? borderRadius : undefined
      });
    }
  }, [isReadOnly, tool, getCanvasPoint, hitTest, getResizeHandle, getRotationHandle, selectedIds, panX, panY, saveHistory, strokeColor, strokeWidth, fillColor, objects, updateObjects, arrowType, arrowLineStyle, borderRadius, highlighterColor, highlighterOpacity, eraserRadius]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawing) return;
    const point = getCanvasPoint(e);

    // Handle rotation
    if (isRotating && rotationCenter) {
      const angle = Math.atan2(point.y - rotationCenter.centerY, point.x - rotationCenter.centerX);
      const degrees = (angle * 180 / Math.PI) + 90; // +90 because handle is at top
      const normalizedDegrees = ((degrees % 360) + 360) % 360;

      // Apply rotation to selected objects
      const updatedObjects = objects.map(obj => {
        if (selectedIds.includes(obj.id)) {
          return { ...obj, rotation: Math.round(normalizedDegrees) };
        }
        return obj;
      });
      updateObjects(updatedObjects);
      setRotation(Math.round(normalizedDegrees));
      return;
    }

    // Handle resize - cursor directly controls the corner position
    if (resizeHandle) {
      const { originalBounds, corner, originalObjects } = resizeHandle;

      if (!originalObjects || originalObjects.length === 0) return;

      // The cursor position IS the new corner position (direct manipulation)
      let newMinX = originalBounds.minX;
      let newMinY = originalBounds.minY;
      let newMaxX = originalBounds.maxX;
      let newMaxY = originalBounds.maxY;

      const minSize = 20; // Minimum size

      // Set the corner being dragged to the current cursor position
      switch (corner) {
        case 'tl':
          newMinX = Math.min(point.x, originalBounds.maxX - minSize);
          newMinY = Math.min(point.y, originalBounds.maxY - minSize);
          break;
        case 'tr':
          newMaxX = Math.max(point.x, originalBounds.minX + minSize);
          newMinY = Math.min(point.y, originalBounds.maxY - minSize);
          break;
        case 'bl':
          newMinX = Math.min(point.x, originalBounds.maxX - minSize);
          newMaxY = Math.max(point.y, originalBounds.minY + minSize);
          break;
        case 'br':
          newMaxX = Math.max(point.x, originalBounds.minX + minSize);
          newMaxY = Math.max(point.y, originalBounds.minY + minSize);
          break;
      }

      const newWidth = newMaxX - newMinX;
      const newHeight = newMaxY - newMinY;
      const origWidth = originalBounds.maxX - originalBounds.minX;
      const origHeight = originalBounds.maxY - originalBounds.minY;

      // Avoid division by zero
      if (origWidth === 0 || origHeight === 0) return;

      // Create a map of original object states for quick lookup
      const originalMap = new Map(originalObjects.map(o => [o.id, o]));

      const updatedObjects = objects.map(obj => {
        if (!selectedIds.includes(obj.id)) return obj;

        // Get the ORIGINAL state of this object (not the current state)
        const origObj = originalMap.get(obj.id);
        if (!origObj) return obj;

        if (origObj.points) {
          // Scale point-based objects from their ORIGINAL positions
          const scaledPoints = origObj.points.map(p => ({
            x: newMinX + ((p.x - originalBounds.minX) / origWidth) * newWidth,
            y: newMinY + ((p.y - originalBounds.minY) / origHeight) * newHeight
          }));
          return { ...obj, points: scaledPoints };
        } else {
          // Scale positioned objects from their ORIGINAL positions
          const origBbox = getBoundingBox(origObj);
          const relX = (origBbox.x - originalBounds.minX) / origWidth;
          const relY = (origBbox.y - originalBounds.minY) / origHeight;
          const relW = origBbox.width / origWidth;
          const relH = origBbox.height / origHeight;

          return {
            ...obj,
            x: Number(newMinX + relX * newWidth) || 0,
            y: Number(newMinY + relY * newHeight) || 0,
            width: Math.max(minSize, relW * newWidth),
            height: Math.max(minSize, relH * newHeight)
          };
        }
      });

      updateObjects(updatedObjects);
      return;
    }

    // Handle panning - allow even during zoom animation for better UX
    if (tool === 'pan' || (dragStart && !currentPath && selectedIds.length === 0 && !selectionBox && !resizeHandle && !isRotating)) {
      // Stop zoom animation if user tries to pan
      if (isAnimatingZoom) {
        setIsAnimatingZoom(false);
      }
      setPanX(e.clientX - dragStart.x);
      setPanY(e.clientY - dragStart.y);
      return;
    }

    if (tool === 'eraser' && isDrawing) {
      // Track eraser path for visual feedback
      setEraserPreviewPath(prev => [...prev, point]);

      // Erase objects that intersect with eraser
      const erasedObjects = [];
      let hasChanges = false;

      objects.forEach(obj => {
        if (obj.type === 'pencil' && obj.points) {
          // For pencil strokes, split into segments that don't intersect eraser
          const newSegments = [];
          let currentSegment = [];

          obj.points.forEach((p, i) => {
            const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2));
            if (dist > eraserRadius) {
              currentSegment.push(p);
            } else {
              // Point is within eraser - save current segment and start new one
              if (currentSegment.length > 1) {
                newSegments.push(currentSegment);
              }
              currentSegment = [];
              hasChanges = true;
            }
          });

          // Don't forget the last segment
          if (currentSegment.length > 1) {
            newSegments.push(currentSegment);
          }

          // Create new objects for each segment
          newSegments.forEach((segment, idx) => {
            erasedObjects.push({
              ...obj,
              id: idx === 0 ? obj.id : generateId(),
              points: segment
            });
          });
        } else if (obj.type === 'line' || obj.type === 'arrow') {
          // For lines/arrows, check if eraser intersects the line
          if (obj.points && obj.points.length >= 2) {
            const start = obj.points[0];
            const end = obj.points[obj.points.length - 1];
            const lineIntersects = pointToLineDistance(point, start, end) < eraserRadius;
            if (!lineIntersects) {
              erasedObjects.push(obj);
            } else {
              hasChanges = true;
            }
          } else {
            erasedObjects.push(obj);
          }
        } else {
          // For shapes, check if eraser overlaps bounding box
          const bbox = getBoundingBox(obj);
          const closestX = Math.max(bbox.x, Math.min(point.x, bbox.x + bbox.width));
          const closestY = Math.max(bbox.y, Math.min(point.y, bbox.y + bbox.height));
          const dist = Math.sqrt(Math.pow(closestX - point.x, 2) + Math.pow(closestY - point.y, 2));

          if (dist > eraserRadius) {
            erasedObjects.push(obj);
          } else {
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        updateObjects(erasedObjects);
      }
      return;
    }

    if (selectionBox) {
      setSelectionBox({
        x: Math.min(startPoint.x, point.x), y: Math.min(startPoint.y, point.y),
        width: Math.abs(point.x - startPoint.x), height: Math.abs(point.y - startPoint.y)
      });
      return;
    }

    if (selectedIds.length > 0 && dragStart) {
      const dx = point.x - dragStart.x;
      const dy = point.y - dragStart.y;
      updateObjects(objects.map(obj => {
        if (!selectedIds.includes(obj.id)) return obj;
        if (obj.points) return { ...obj, points: obj.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
        // Ensure x and y are numbers before adding
        const currentX = Number(obj.x) || 0;
        const currentY = Number(obj.y) || 0;
        return { ...obj, x: currentX + dx, y: currentY + dy };
      }));
      setDragStart(point);
      return;
    }

    if (currentPath) {
      if (tool === 'pencil' || tool === 'highlighter') {
        setCurrentPath(prev => ({ ...prev, points: [...prev.points, point] }));
      } else if (tool === 'line') {
        setCurrentPath(prev => ({ ...prev, points: [prev.points[0], point] }));
      } else if (tool === 'arrow') {
        // For curved arrows, track the path to calculate control point
        if (arrowType === 'curved') {
          // Track path points during drawing
          setCurrentPath(prev => {
            const pathPoints = prev.pathPoints || [];
            return {
              ...prev,
              points: [prev.points[0], point],
              pathPoints: [...pathPoints, point] // Store the drawing path
            };
          });
        } else {
          setCurrentPath(prev => ({ ...prev, points: [prev.points[0], point] }));
        }
      } else if (['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon'].includes(tool)) {
        setCurrentPath(prev => ({
          ...prev, width: point.x - prev.x, height: e.shiftKey ? point.x - prev.x : point.y - prev.y
        }));
      }
    }
  }, [isDrawing, tool, getCanvasPoint, dragStart, currentPath, selectionBox, selectedIds, startPoint, objects, updateObjects, resizeHandle, eraserRadius, isRotating, rotationCenter, isAnimatingZoom, arrowType, zoom, panX, panY]);

  const handlePointerUp = useCallback((e) => {
    // Release pointer capture
    if (e?.target && e.target.releasePointerCapture && e.pointerId) {
      try { e.target.releasePointerCapture(e.pointerId); } catch (err) { }
    }

    // Clear eraser preview path
    setEraserPreviewPath([]);

    // Save history if we were resizing
    if (isRotating) {
      saveHistory();
      setIsRotating(false);
      setRotationCenter(null);
    }

    if (resizeHandle) {
      // History was saved at the start of resize, just clean up
      setResizeHandle(null);
    }

    if (selectionBox) {
      const selected = objects.filter(obj => {
        const bbox = getBoundingBox(obj);
        return bbox.x >= selectionBox.x && bbox.x + bbox.width <= selectionBox.x + selectionBox.width &&
          bbox.y >= selectionBox.y && bbox.y + bbox.height <= selectionBox.y + selectionBox.height;
      });
      setSelectedIds(selected.map(o => o.id));
      setSelectionBox(null);
    }

    if (currentPath) {
      let finalPath = { ...currentPath };

      // Calculate control point for curved arrows from drawn path
      if (finalPath.type === 'arrow' && finalPath.arrowType === 'curved' && finalPath.pathPoints && finalPath.pathPoints.length > 3) {
        // Use the middle point of the drawn path as control point
        const midIndex = Math.floor(finalPath.pathPoints.length / 2);
        finalPath.controlPoint = finalPath.pathPoints[midIndex];
        delete finalPath.pathPoints; // Remove temp path data
      }

      // Auto-straighten lines
      if (finalPath.type === 'line' && finalPath.points) {
        finalPath.points = straightenLine(finalPath.points);
      }

      // Shape recognition for pencil drawings
      if (finalPath.type === 'pencil' && finalPath.points && finalPath.points.length > 20) {
        const recognizedShape = recognizeShape(finalPath.points);
        if (recognizedShape) {
          // Replace pencil stroke with recognized shape
          finalPath = {
            ...finalPath,
            ...recognizedShape,
            points: undefined // Remove points for shape objects
          };
        }
      }

      if (finalPath.width < 0) { finalPath.x += finalPath.width; finalPath.width = Math.abs(finalPath.width); }
      if (finalPath.height < 0) { finalPath.y += finalPath.height; finalPath.height = Math.abs(finalPath.height); }
      const hasSubstance = finalPath.points ? finalPath.points.length > 1 : (finalPath.width > 2 || finalPath.height > 2);
      if (hasSubstance) updateObjects([...objects, finalPath]);
      setCurrentPath(null);
    }

    setIsDrawing(false);
    setDragStart(null);
    setStartPoint(null);
  }, [currentPath, selectionBox, objects, updateObjects, straightenLine, recognizeShape, resizeHandle, saveHistory]);

  const handleTextSubmit = useCallback(() => {
    if (textEditing && textValue.trim()) {
      saveHistory();

      if (textEditing.id) {
        // Editing existing text/sticky - recalculate dimensions
        const updatedObjects = objects.map(obj => {
          if (obj.id === textEditing.id) {
            if (obj.type === 'text') {
              const measured = measureText(textValue, obj.fontSize, obj.fontFamily, obj.fontWeight);
              return { ...obj, text: textValue, width: measured.width, height: measured.height };
            }
            // Auto-resize sticky notes to fit text content
            if (obj.type === 'sticky') {
              const actualFontSize = obj.fontSize || 18;
              const measured = measureText(textValue, actualFontSize, obj.fontFamily || 'Poppins', obj.fontWeight || 'normal');
              // Ensure sticky is large enough for text with generous padding
              const newWidth = Math.max(150, measured.width + 50);
              const newHeight = Math.max(150, measured.height + 70);
              return { ...obj, text: textValue, width: newWidth, height: newHeight };
            }
            return { ...obj, text: textValue };
          }
          return obj;
        });
        updateObjects(updatedObjects);
      } else {
        // Creating new text/sticky with full formatting properties
        const measured = measureText(textValue, fontSize, fontFamily, fontWeight);
        // For sticky notes, auto-size based on text content with generous padding
        const stickyWidth = Math.max(150, measured.width + 50);
        const stickyHeight = Math.max(150, measured.height + 70);
        const newObj = textEditing.type === 'sticky' ? {
          id: generateId(),
          type: 'sticky',
          x: textEditing.x,
          y: textEditing.y,
          width: stickyWidth,
          height: stickyHeight,
          text: textValue,
          fillColor: fillColor === 'transparent' ? '#ffc700' : fillColor,
          fontSize: fontSize,
          fontWeight: fontWeight,
          fontFamily: fontFamily,
          textAlign: 'left',
          opacity: 1
        } : {
          id: generateId(),
          type: 'text',
          x: textEditing.x,
          y: textEditing.y,
          width: measured.width,
          height: measured.height,
          text: textValue,
          strokeColor,
          fontSize: fontSize,
          fontWeight: fontWeight,
          fontFamily: fontFamily,
          textAlign: 'left',
          opacity: 1
        };
        updateObjects([...objects, newObj]);
      }
    }
    setTextEditing(null);
    setTextValue('');
  }, [textEditing, textValue, strokeColor, fillColor, fontSize, fontWeight, fontFamily, objects, updateObjects, saveHistory]);

  const copySelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const selectedObjects = objects.filter(o => selectedIds.includes(o.id));
    setClipboard(JSON.parse(JSON.stringify(selectedObjects)));
  }, [selectedIds, objects]);

  const pasteFromClipboard = useCallback(() => {
    if (!clipboard || clipboard.length === 0) return;
    saveHistory();
    const offset = 40; // Increased offset so pasted elements don't overlap original
    const newObjects = clipboard.map(obj => {
      const newObj = { ...obj, id: generateId() };
      // Clear any group assignment when pasting
      delete newObj.groupId;
      if (newObj.points) {
        newObj.points = newObj.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
      } else {
        newObj.x = (Number(newObj.x) || 0) + offset;
        newObj.y = (Number(newObj.y) || 0) + offset;
      }
      return newObj;
    });
    updateObjects([...objects, ...newObjects]);
    setSelectedIds(newObjects.map(o => o.id));
  }, [clipboard, objects, updateObjects, saveHistory]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    saveHistory();
    const offset = 40; // Offset so duplicates don't overlap originals
    const selectedObjects = objects.filter(o => selectedIds.includes(o.id));
    const newObjects = selectedObjects.map(obj => {
      const newObj = { ...JSON.parse(JSON.stringify(obj)), id: generateId() };
      // Clear any group assignment when duplicating
      delete newObj.groupId;
      if (newObj.points) {
        newObj.points = newObj.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
      } else {
        newObj.x = (Number(newObj.x) || 0) + offset;
        newObj.y = (Number(newObj.y) || 0) + offset;
      }
      return newObj;
    });
    updateObjects([...objects, ...newObjects]);
    setSelectedIds(newObjects.map(o => o.id));
  }, [selectedIds, objects, updateObjects, saveHistory]);

  // Group selected elements
  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    saveHistory();
    const groupId = `group-${Date.now()}`;
    const updatedObjects = objects.map(obj => {
      if (selectedIds.includes(obj.id)) {
        return { ...obj, groupId };
      }
      return obj;
    });
    updateObjects(updatedObjects);
  }, [selectedIds, objects, updateObjects, saveHistory]);

  // Ungroup selected elements
  const ungroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    saveHistory();
    const updatedObjects = objects.map(obj => {
      if (selectedIds.includes(obj.id) && obj.groupId) {
        const { groupId, ...rest } = obj;
        return rest;
      }
      return obj;
    });
    updateObjects(updatedObjects);
  }, [selectedIds, objects, updateObjects, saveHistory]);

  // Check if selected items are grouped
  const hasGroupedItems = selectedIds.length > 0 && objects.some(obj => selectedIds.includes(obj.id) && obj.groupId);
  const canGroup = selectedIds.length >= 2;

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    saveHistory();
    updateObjects(objects.filter(o => !selectedIds.includes(o.id)));
    setSelectedIds([]);
  }, [selectedIds, objects, updateObjects, saveHistory]);

  const selectAll = useCallback(() => {
    setSelectedIds(objects.map(o => o.id));
  }, [objects]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (textEditing) {
        if (e.key === 'Escape') { setTextEditing(null); setTextValue(''); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); }
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (isMod && e.key === 'c') { e.preventDefault(); copySelected(); }
      else if (isMod && e.key === 'v') { e.preventDefault(); pasteFromClipboard(); }
      else if (isMod && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
      else if (isMod && e.key === 'a') { e.preventDefault(); selectAll(); }
      else if (isMod && e.key === 'g' && !e.shiftKey) { e.preventDefault(); groupSelected(); }
      else if (isMod && e.key === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelected(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault(); saveHistory();
          updateObjects(objects.filter(o => !selectedIds.includes(o.id)));
          setSelectedIds([]);
        }
      } else if (e.key === 'Escape') { setSelectedIds([]); setTool('select'); }

      if (!isMod) {
        switch (e.key) {
          case 'v': case '1': setTool('select'); break;
          case 'p': case '2': setTool('pencil'); break;
          case 'h': setTool('highlighter'); break;
          case 'e': setTool('eraser'); break;
          case 'l': case '3': setTool('line'); break;
          case 'a': case '4': setTool('arrow'); break;
          case 'r': case '5': setTool('rect'); break;
          case 'o': case '6': setTool('ellipse'); break;
          case 'd': setTool('diamond'); break;
          case 's': setTool('sticky'); break;
          case 't': case '7': setTool('text'); break;
          case 'i': setTool('image'); break;
          case ' ': e.preventDefault(); setTool(prev => prev === 'pan' ? 'select' : 'pan'); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [textEditing, handleTextSubmit, undo, redo, selectedIds, objects, updateObjects, saveHistory, copySelected, pasteFromClipboard, duplicateSelected, selectAll]);

  const handleWheel = useCallback((e) => {
    // Stop zoom animation if user manually zooms
    if (isAnimatingZoom) {
      setIsAnimatingZoom(false);
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Use mouse position as zoom center
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate point in canvas coordinates before zoom
      const canvasX = (mouseX - panX) / zoom;
      const canvasY = (mouseY - panY) / zoom;

      // Calculate new zoom level
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(5, Math.max(0.1, zoom * zoomFactor));

      // Adjust pan to keep the mouse point stationary
      const newPanX = mouseX - canvasX * newZoom;
      const newPanY = mouseY - canvasY * newZoom;

      setZoom(newZoom);
      setPanX(newPanX);
      setPanY(newPanY);
    } else {
      setPanX(prev => prev - e.deltaX);
      setPanY(prev => prev - e.deltaY);
    }
  }, [zoom, panX, panY, isAnimatingZoom]);

  // Touch gesture handlers
  const getTouchCenter = (touches) => {
    const x = Array.from(touches).reduce((sum, t) => sum + t.clientX, 0) / touches.length;
    const y = Array.from(touches).reduce((sum, t) => sum + t.clientY, 0) / touches.length;
    return { x, y };
  };

  const getTouchDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e) => {
    const touchCount = e.touches.length;

    // 2 fingers - pinch to zoom
    if (touchCount === 2) {
      e.preventDefault();
      setTouchStartDistance(getTouchDistance(e.touches));
      setTouchStartZoom(zoom);
      const center = getTouchCenter(e.touches);
      setLastTouchCenter(center);
      return;
    }

    // 3 fingers - eraser
    if (touchCount === 3) {
      e.preventDefault();
      setTool('eraser');
      const rect = canvasRef.current.getBoundingClientRect();
      const center = getTouchCenter(e.touches);
      const point = {
        x: (center.x - rect.left - panX) / zoom,
        y: (center.y - rect.top - panY) / zoom
      };

      // Start erasing
      setIsDrawing(true);
      const erasedObjects = [];
      objects.forEach(obj => {
        if (obj.type === 'pencil' && obj.points) {
          const remainingPoints = obj.points.filter(p => {
            const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2));
            return dist > eraserRadius;
          });
          if (remainingPoints.length > 1) {
            erasedObjects.push({ ...obj, points: remainingPoints });
          }
        } else {
          const bbox = getBoundingBox(obj);
          const dist = Math.sqrt(
            Math.pow(Math.max(bbox.x, Math.min(point.x, bbox.x + bbox.width)) - point.x, 2) +
            Math.pow(Math.max(bbox.y, Math.min(point.y, bbox.y + bbox.height)) - point.y, 2)
          );
          if (dist > eraserRadius) {
            erasedObjects.push(obj);
          }
        }
      });
      if (erasedObjects.length !== objects.length) {
        saveHistory();
        updateObjects(erasedObjects);
      }
      return;
    }

    // 4-5 fingers - pan
    if (touchCount >= 4) {
      e.preventDefault();
      const center = getTouchCenter(e.touches);
      setLastTouchCenter(center);
      setIsDrawing(true);
      return;
    }

    // 1 finger - normal drawing (handled by handlePointerDown)
    if (touchCount === 1) {
      handlePointerDown(e);
    }
  }, [zoom, panX, panY, objects, eraserRadius, saveHistory, updateObjects, handlePointerDown]);

  const handleTouchMove = useCallback((e) => {
    const touchCount = e.touches.length;

    // 2 fingers - pinch zoom
    if (touchCount === 2 && touchStartDistance) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches);
      const newZoom = touchStartZoom * (currentDistance / touchStartDistance);
      const clampedZoom = Math.min(5, Math.max(0.1, newZoom));

      // Calculate zoom center
      const center = getTouchCenter(e.touches);
      const rect = canvasRef.current.getBoundingClientRect();
      const zoomPointX = (center.x - rect.left - panX) / zoom;
      const zoomPointY = (center.y - rect.top - panY) / zoom;

      // Adjust pan to keep zoom point stationary
      setPanX(center.x - rect.left - zoomPointX * clampedZoom);
      setPanY(center.y - rect.top - zoomPointY * clampedZoom);
      setZoom(clampedZoom);
      return;
    }

    // 3 fingers - eraser
    if (touchCount === 3 && isDrawing) {
      e.preventDefault();
      const rect = canvasRef.current.getBoundingClientRect();
      const center = getTouchCenter(e.touches);
      const point = {
        x: (center.x - rect.left - panX) / zoom,
        y: (center.y - rect.top - panY) / zoom
      };

      const erasedObjects = [];
      objects.forEach(obj => {
        if (obj.type === 'pencil' && obj.points) {
          const remainingPoints = obj.points.filter(p => {
            const dist = Math.sqrt(Math.pow(p.x - point.x, 2) + Math.pow(p.y - point.y, 2));
            return dist > eraserRadius;
          });
          if (remainingPoints.length > 1) {
            erasedObjects.push({ ...obj, points: remainingPoints });
          }
        } else {
          const bbox = getBoundingBox(obj);
          const dist = Math.sqrt(
            Math.pow(Math.max(bbox.x, Math.min(point.x, bbox.x + bbox.width)) - point.x, 2) +
            Math.pow(Math.max(bbox.y, Math.min(point.y, bbox.y + bbox.height)) - point.y, 2)
          );
          if (dist > eraserRadius) {
            erasedObjects.push(obj);
          }
        }
      });
      if (erasedObjects.length !== objects.length) {
        updateObjects(erasedObjects);
      }
      return;
    }

    // 4-5 fingers - pan
    if (touchCount >= 4 && lastTouchCenter) {
      e.preventDefault();
      const center = getTouchCenter(e.touches);
      const dx = center.x - lastTouchCenter.x;
      const dy = center.y - lastTouchCenter.y;
      setPanX(prev => prev + dx);
      setPanY(prev => prev + dy);
      setLastTouchCenter(center);
      return;
    }

    // 1 finger - normal drawing
    if (touchCount === 1) {
      handlePointerMove(e);
    }
  }, [touchStartDistance, touchStartZoom, lastTouchCenter, zoom, panX, panY, isDrawing, objects, eraserRadius, updateObjects, handlePointerMove]);

  const handleTouchEnd = useCallback((e) => {
    if (e.touches.length === 0) {
      setTouchStartDistance(null);
      setLastTouchCenter(null);
      setIsDrawing(false);
      handlePointerUp();
    }
  }, [handlePointerUp]);

  // Generate thumbnail from canvas
  const generateThumbnail = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    try {
      // Create a smaller thumbnail (320x240 for performance)
      const thumbnailCanvas = document.createElement('canvas');
      const thumbWidth = 320;
      const thumbHeight = 240;
      thumbnailCanvas.width = thumbWidth;
      thumbnailCanvas.height = thumbHeight;

      const ctx = thumbnailCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, thumbWidth, thumbHeight);

      return thumbnailCanvas.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      console.log('Error generating thumbnail:', err);
      return null;
    }
  }, []);

  // Capture canvas screenshot for AI vision
  const captureCanvasScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    try {
      // Create a higher quality screenshot for AI vision (800x600 for good detail)
      const screenshotCanvas = document.createElement('canvas');
      const screenshotWidth = 1024;
      const screenshotHeight = 768;
      screenshotCanvas.width = screenshotWidth;
      screenshotCanvas.height = screenshotHeight;

      const ctx = screenshotCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, screenshotWidth, screenshotHeight);

      return screenshotCanvas.toDataURL('image/png', 0.9);
    } catch (err) {
      console.log('Error capturing canvas screenshot:', err);
      return null;
    }
  }, []);

  // Animate scanning wave effect
  const startScanAnimation = useCallback(() => {
    setIsScanningCanvas(true);
    setScanProgress(0);

    const startTime = performance.now();
    const duration = 1200; // 1.2 seconds for the scan

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      setScanProgress(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Fade out
        setTimeout(() => {
          setIsScanningCanvas(false);
          setScanProgress(0);
        }, 200);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  // Auto-save with debounce
  useEffect(() => {
    if (!isDirty || !onSave) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const thumbnail = generateThumbnail();
      onSave({ pages, thumbnail, aiAnalysis });
      setIsDirty(false);
    }, 2000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [isDirty, pages, onSave, generateThumbnail, aiAnalysis]);

  // Warn user before leaving if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Force save function for immediate save
  const forceSave = useCallback(() => {
    if (!onSave) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const thumbnail = generateThumbnail();
    onSave({ pages, thumbnail, aiAnalysis });
    setIsDirty(false);
  }, [onSave, pages, generateThumbnail, aiAnalysis]);

  // Expose forceSave and isDirty to parent component
  useImperativeHandle(ref, () => ({
    forceSave,
    isDirty
  }), [forceSave, isDirty]);

  // AI Analysis functions
  const analyzeCanvas = useCallback(async () => {
    if (objects.length === 0) {
      setAiError('Canvas is empty. Add some content to analyze.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    startAILoading('MIRA is analyzing your canvas...');

    // Start scanning animation
    startScanAnimation();

    // Capture canvas screenshot for visual AI analysis
    const canvasScreenshot = captureCanvasScreenshot();

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'analyze',
          canvasScreenshot
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze canvas');
      }

      setAiAnalysis(data.aiAnalysis);
      setIsDirty(true);
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
      stopAILoading();
    }
  }, [boardId, objects.length, startScanAnimation, captureCanvasScreenshot, startAILoading, stopAILoading]);

  // Smoothly zoom and pan to fit all content
  const smoothZoomToFitContent = useCallback((newObjects = []) => {
    if (!canvasRef.current) return;

    const allObjects = [...objects, ...newObjects];
    if (allObjects.length === 0) return;

    // Calculate bounds of all content
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allObjects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    if (minX === Infinity) return;

    // Add padding
    const padding = 100;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const canvas = canvasRef.current;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Calculate target zoom to fit content
    const targetZoom = Math.min(
      canvasWidth / contentWidth,
      canvasHeight / contentHeight,
      1.5 // Don't zoom in too much
    );

    // Calculate target pan to center content
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const targetPanX = (canvasWidth / 2) - (contentCenterX * targetZoom);
    const targetPanY = (canvasHeight / 2) - (contentCenterY * targetZoom);

    // Animate smoothly to target
    const startZoom = zoom;
    const startPanX = panX;
    const startPanY = panY;
    const duration = 600; // ms
    const startTime = performance.now();

    setIsAnimatingZoom(true);

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);

      setZoom(startZoom + (targetZoom - startZoom) * eased);
      setPanX(startPanX + (targetPanX - startPanX) * eased);
      setPanY(startPanY + (targetPanY - startPanY) * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete - allow user interaction again
        setIsAnimatingZoom(false);
      }
    };

    requestAnimationFrame(animate);
  }, [objects, zoom, panX, panY]);

  // Animate newly generated objects with particle fade-in effect
  const animateNewObjects = useCallback((newObjectIds) => {
    if (!newObjectIds || newObjectIds.length === 0) return;

    // Initialize animation for these objects
    const newAnimatingIds = new Set(newObjectIds);
    setAnimatingIds(prev => new Set([...prev, ...newAnimatingIds]));

    // Initialize progress to 0 for each
    const newProgress = {};
    newObjectIds.forEach(id => { newProgress[id] = 0; });
    setAnimationProgress(prev => ({ ...prev, ...newProgress }));

    // Animate each object with staggered timing
    const duration = 800; // ms per object
    const stagger = 100; // ms between objects

    newObjectIds.forEach((id, index) => {
      const startTime = performance.now() + (index * stagger);

      const animateObject = (currentTime) => {
        const elapsed = currentTime - startTime;
        if (elapsed < 0) {
          requestAnimationFrame(animateObject);
          return;
        }

        const progress = Math.min(elapsed / duration, 1);

        setAnimationProgress(prev => ({ ...prev, [id]: progress }));

        if (progress < 1) {
          requestAnimationFrame(animateObject);
        } else {
          // Animation complete, remove from animating set
          setAnimatingIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
          });
        }
      };

      requestAnimationFrame(animateObject);
    });
  }, []);

  const sendAIMessage = useCallback(async (message) => {
    if (!message.trim()) return;

    // Check if there's a pending template
    const templateType = window.__miraTemplateType;
    if (templateType) {
      window.__miraTemplateType = null;
      window.__miraTemplatePrompt = null;
    }

    setAiLoading(true);
    setAiError(null);
    startAILoading(showAgentMode ? 'MIRA is generating your diagram...' : 'MIRA is thinking...');
    startAILoading(showAgentMode ? 'MIRA is generating your diagram...' : 'MIRA is thinking...');

    // Start scanning animation for visual processing
    startScanAnimation();

    // Capture canvas screenshot for visual AI analysis
    const canvasScreenshot = captureCanvasScreenshot();

    // Optimistically add user message
    setAiAnalysis(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: message, timestamp: new Date() }]
    }));
    setAiInput('');

    try {
      const token = localStorage.getItem('token');

      // Use 'generate' action for agent mode to create actual canvas objects
      if (showAgentMode) {
        const requestBody = { action: 'generate', message, canvasScreenshot };
        if (templateType) {
          requestBody.templateType = templateType;
        }

        const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to generate diagram');
        }

        // Update canvas with generated objects
        if (data.pages && data.pages[0]) {
          saveHistory();
          setPages(data.pages);

          // Animate new objects and zoom to fit - DON'T select them
          if (data.generatedObjects && data.generatedObjects.length > 0) {
            const newIds = data.generatedObjects.map(o => o.id);
            animateNewObjects(newIds);
            smoothZoomToFitContent(data.generatedObjects);
            setSelectedIds([]); // Clear any selection
          }
        }

        setAiAnalysis(data.aiAnalysis);
        setIsDirty(true);

        // Auto-continue if there's more content to generate
        if (data.hasMore && data.nextPrompt) {
          // Small delay before auto-continuing
          setTimeout(() => {
            continueGeneration();
          }, 1500);
        }
      } else {
        // Regular chat mode - also send screenshot for visual context
        const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ action: 'chat', message, canvasScreenshot })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to send message');
        }

        setAiAnalysis(data.aiAnalysis);
        setIsDirty(true);
      }
    } catch (error) {
      setAiError(error.message);
      // Remove the optimistic message on error
      setAiAnalysis(prev => ({
        ...prev,
        messages: prev.messages.slice(0, -1)
      }));
    } finally {
      setAiLoading(false);
    }
  }, [boardId, showAgentMode, saveHistory, setPages, animateNewObjects, smoothZoomToFitContent, startScanAnimation, captureCanvasScreenshot]);

  // Send AI message with a template type (mindmap, flowchart, planning, ideas)
  const sendAIMessageWithTemplate = useCallback(async (templateType, promptMessage) => {
    if (!promptMessage.trim()) return;

    setAiLoading(true);
    setAiError(null);

    // Add assistant message asking for content
    setAiAnalysis(prev => ({
      ...prev,
      messages: [...prev.messages, { role: 'assistant', content: promptMessage, timestamp: new Date() }]
    }));

    // Store template type for next user message
    setAiInput('');

    // Set a flag to indicate we're waiting for user content
    window.__miraTemplateType = templateType;
    window.__miraTemplatePrompt = promptMessage;

    setAiLoading(false);
  }, []);

  // Continue generation - called automatically or via button
  const continueGeneration = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    startAILoading('MIRA is continuing generation...');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'continue' })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to continue generation');
      }

      // Update canvas with new objects
      if (data.pages && data.pages[0]) {
        saveHistory();
        setPages(data.pages);

        // Animate but don't select
        if (data.generatedObjects && data.generatedObjects.length > 0) {
          const newIds = data.generatedObjects.map(o => o.id);
          animateNewObjects(newIds);
          smoothZoomToFitContent(data.generatedObjects);
          setSelectedIds([]); // Clear selection
        }
      }

      setAiAnalysis(data.aiAnalysis);
      setIsDirty(true);

      // Continue if there's more
      if (data.hasMore && data.nextPrompt) {
        setTimeout(() => {
          continueGeneration();
        }, 1500);
      }
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
      stopAILoading();
    }
  }, [boardId, saveHistory, setPages, animateNewObjects, smoothZoomToFitContent, startAILoading, stopAILoading]);

  // Restructure the canvas - clean up layout, align elements, fix spacing
  const restructureCanvas = useCallback(async () => {
    if (objects.length === 0) {
      setAiError('Canvas is empty. Add some content first.');
      return;
    }

    setAiLoading(true);
    setAiError(null);
    startAILoading('MIRA is restructuring your canvas...');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'restructure' })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to restructure canvas');
      }

      // Replace all objects with restructured version
      if (data.pages && data.pages[0]) {
        saveHistory();
        setPages(data.pages);
      }

      setAiAnalysis(data.aiAnalysis);
      setIsDirty(true);
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
      stopAILoading();
    }
  }, [boardId, objects.length, saveHistory, setPages, startAILoading, stopAILoading]);

  const clearAIHistory = useCallback(async () => {
    setAiLoading(true);
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/whiteboard/${boardId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'clear' })
      });

      setAiAnalysis({ summary: '', messages: [], notes: [], keyPoints: [] });
      setIsDirty(true);
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
    }
  }, [boardId]);

  // Load AI analysis on mount
  useEffect(() => {
    if (boardId && !aiAnalysis.summary && aiAnalysis.messages.length === 0) {
      const loadAIAnalysis = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(`/api/whiteboard/${boardId}/analyze`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.aiAnalysis) {
              setAiAnalysis(data.aiAnalysis);
            }
          }
        } catch (error) {
          console.error('Failed to load AI analysis:', error);
        }
      };
      loadAIAnalysis();
    }
  }, [boardId]);

  // Scroll to bottom of AI messages
  useEffect(() => {
    if (aiMessagesEndRef.current) {
      aiMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiAnalysis.messages]);

  // Center viewport to drawing
  const centerToDrawing = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || objects.length === 0) return;

    // Calculate bounding box of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    objects.forEach(obj => {
      const bbox = getBoundingBox(obj);
      minX = Math.min(minX, bbox.x);
      minY = Math.min(minY, bbox.y);
      maxX = Math.max(maxX, bbox.x + bbox.width);
      maxY = Math.max(maxY, bbox.y + bbox.height);
    });

    if (minX === Infinity) return;

    // Calculate center of all objects
    const objectsCenterX = (minX + maxX) / 2;
    const objectsCenterY = (minY + maxY) / 2;

    // Calculate canvas center
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Set pan to center objects in viewport with smooth animation
    setPanX(canvasCenterX - objectsCenterX * zoom);
    setPanY(canvasCenterY - objectsCenterY * zoom);
  }, [objects, zoom]);

  const addPage = useCallback(() => {
    saveHistory();
    setPages(prev => [...prev, { id: generateId(), objects: [] }]);
    setCurrentPageIndex(pages.length);
  }, [pages.length, saveHistory]);

  const deletePage = useCallback((index) => {
    // Prevent deleting the last page
    if (pages.length <= 1) {
      setConfirmModal({
        message: 'Cannot delete the last page',
        onConfirm: null // Just info, no action
      });
      return;
    }

    // Confirm deletion with custom modal
    setConfirmModal({
      message: `Delete page ${index + 1}?`,
      onConfirm: () => {
        saveHistory();
        setPages(prev => prev.filter((_, i) => i !== index));

        // Adjust current page index if needed
        if (currentPageIndex === index) {
          setCurrentPageIndex(Math.max(0, index - 1));
        } else if (currentPageIndex > index) {
          setCurrentPageIndex(prev => prev - 1);
        }
        setConfirmModal(null);
      }
    });
  }, [pages.length, currentPageIndex, saveHistory]);

  const exportToPng = useCallback(() => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const exportToJpg = useCallback(() => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
  }, []);

  const exportToSvg = useCallback(() => {
    // Create SVG from objects
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">`;
    svgContent += `<rect width="100%" height="100%" fill="#fffbf5"/>`;

    objects.forEach(obj => {
      if (obj.type === 'rect') {
        svgContent += `<rect x="${obj.x}" y="${obj.y}" width="${obj.width}" height="${obj.height}" fill="${obj.fillColor || 'none'}" stroke="${obj.strokeColor}" stroke-width="${obj.strokeWidth}" rx="8"/>`;
      } else if (obj.type === 'ellipse') {
        svgContent += `<ellipse cx="${obj.x + obj.width / 2}" cy="${obj.y + obj.height / 2}" rx="${Math.abs(obj.width / 2)}" ry="${Math.abs(obj.height / 2)}" fill="${obj.fillColor || 'none'}" stroke="${obj.strokeColor}" stroke-width="${obj.strokeWidth}"/>`;
      } else if (obj.type === 'line' && obj.points) {
        svgContent += `<line x1="${obj.points[0].x}" y1="${obj.points[0].y}" x2="${obj.points[obj.points.length - 1].x}" y2="${obj.points[obj.points.length - 1].y}" stroke="${obj.strokeColor}" stroke-width="${obj.strokeWidth}"/>`;
      }
    });

    svgContent += `</svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.svg`;
    link.href = URL.createObjectURL(blob);
    link.click();
  }, [objects]);

  const exportToPdf = useCallback(async () => {
    const canvas = canvasRef.current;
    const imgData = canvas.toDataURL('image/png');

    // Create a simple PDF using canvas as image
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.pdf`;

    // For now, just export as PNG. Full PDF would require jsPDF library
    alert('PDF export: Please install jsPDF library for full PDF support. Exporting as PNG instead.');
    link.href = imgData;
    link.click();
  }, []);

  const exportToTboard = useCallback(() => {
    const boardData = {
      version: '1.0',
      pages,
      theme: initialData?.theme || 'white',
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(boardData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `board-${Date.now()}.tboard`;
    link.href = URL.createObjectURL(blob);
    link.click();
    setShowExportMenu(false);
  }, [pages, initialData]);

  const importTboard = useCallback(() => {
    if (fileInputRef.current) {
      onFilePickerOpen?.();
      fileInputRef.current.click();
    }
    setShowExportMenu(false);
  }, [onFilePickerOpen]);

  // Insert text or sticky note at center of viewport
  const insertTextOrSticky = useCallback((type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Calculate center of viewport in canvas coordinates
    const centerX = (canvas.width / 2 - panX) / zoom;
    const centerY = (canvas.height / 2 - panY) / zoom;

    saveHistory();

    const defaultText = 'Double-click to edit';
    const measured = measureText(defaultText, fontSize, fontFamily || 'Poppins', fontWeight);

    const newObj = type === 'sticky' ? {
      id: generateId(),
      type: 'sticky',
      x: centerX - 100, // Center the 200px wide sticky
      y: centerY - 100, // Center the 200px tall sticky
      width: 200,
      height: 200,
      text: '',
      fillColor: '#ffc700',
      fontSize: fontSize,
      fontWeight: fontWeight,
      fontFamily: fontFamily || 'Poppins',
      opacity: 1
    } : {
      id: generateId(),
      type: 'text',
      x: centerX - measured.width / 2,
      y: centerY - measured.height / 2,
      width: measured.width,
      height: measured.height,
      text: defaultText,
      strokeColor: textColor,
      fontSize: fontSize,
      fontWeight: fontWeight,
      fontFamily: fontFamily || 'Poppins',
      opacity: 1
    };

    updateObjects([...objects, newObj]);
    setSelectedIds([newObj.id]);
    // Close element options and show only text options (avoid duplicate panels)
    setShowElementOptions(false);
    setShowTextOptions(true);
  }, [panX, panY, zoom, saveHistory, textColor, fontSize, fontWeight, fontFamily, objects, updateObjects]);

  // Tool button component
  const ToolButton = ({ id, icon, label, shortcut, onClick: customOnClick }) => {
    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Close ALL panels first
      setShowPenOptions(false);
      setShowHighlighterOptions(false);
      setShowLineOptions(false);
      setShowArrowMenu(false);
      setShowShapesMenu(false);
      setShowEraserOptions(false);
      setShowTextOptions(false);
      setShowShapeOptions(false);
      setShowElementOptions(false);

      if (customOnClick) {
        customOnClick();
        return;
      }

      setTool(id);

      // Show options for specific tools (only the one we clicked)
      if (id === 'pencil') setShowPenOptions(true);
      if (id === 'highlighter') setShowHighlighterOptions(true);
      if (id === 'line') setShowLineOptions(true);
      if (id === 'arrow') setShowArrowMenu(true);
      if (id === 'eraser') setShowEraserOptions(true);

      // For shape tools, show shape options
      if (['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon'].includes(id)) {
        setCurrentShapeTool(id);
        setShowShapeOptions(true);
      }

      // Insert text or sticky immediately when tool is selected
      if (id === 'text' || id === 'sticky') {
        insertTextOrSticky(id);
        setTool('select'); // Switch back to select for editing
        // Note: showTextOptions is already set in insertTextOrSticky
      }
    };

    const isShapeTool = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon'].includes(id);
    const isActive = tool === id || (isShapeTool && tool === id);

    return (
      <button
        onClick={handleClick}
        className={`relative group p-2.5 rounded-lg transition-all touch-manipulation ${isActive
            ? 'bg-[#0d99ff] text-white shadow-md'
            : 'text-gray-600 hover:bg-gray-100'
          }`}
        title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
        disabled={isReadOnly}
      >
        {icon}
        {shortcut && (
          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-50">
            {label} <span className="text-gray-400">{shortcut}</span>
          </span>
        )}
      </button>
    );
  };

  // Define closed shape types
  const CLOSED_SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon', 'sticky'];

  // Get the type of selected objects
  const getSelectedObjectTypes = useCallback(() => {
    const types = new Set();
    objects.forEach(obj => {
      if (selectedIds.includes(obj.id)) {
        types.add(obj.type);
      }
    });
    return types;
  }, [objects, selectedIds]);

  // Check if selected objects are closed shapes (can have fill)
  const selectedHasClosedShapes = useCallback(() => {
    return objects.some(obj => selectedIds.includes(obj.id) && CLOSED_SHAPES.includes(obj.type));
  }, [objects, selectedIds]);

  // Handle double-click to edit text/sticky or replace image placeholder
  const handleDoubleClick = useCallback((e) => {
    if (isReadOnly) return;
    const point = getCanvasPoint(e);
    const hit = hitTest(point);

    if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
      setTextEditing({ id: hit.id, x: hit.x, y: hit.y, type: hit.type });
      setTextValue(hit.text || '');
    } else if (hit && hit.type === 'image' && hit.isPlaceholder) {
      // Open file picker to replace placeholder with actual image
      setSelectedIds([hit.id]);
      if (fileInputRef.current) {
        onFilePickerOpen?.();
        fileInputRef.current.click();
      }
    }
  }, [isReadOnly, getCanvasPoint, hitTest, onFilePickerOpen]);

  return (
    <div className="h-full w-full relative overflow-hidden" style={{ background: '#fffbf5' }}>
      {/* MIRA Loading Overlay for initial AI analysis */}
      <MiraLoadingOverlay
        isLoading={aiLoading && !showAIPanel && (aiAnalysis?.messages?.length || 0) === 0}
        message="MIRA is analyzing your canvas..."
        fullScreen={false}
      />

      {/* Canvas */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={(e) => {
            setLastMousePos({ x: e.clientX, y: e.clientY });
            // Also store canvas point for eraser cursor
            const canvas = canvasRef.current;
            if (canvas) {
              const rect = canvas.getBoundingClientRect();
              setLastCanvasPoint({
                x: (e.clientX - rect.left - panX) / zoom,
                y: (e.clientY - rect.top - panY) / zoom
              });
            }
            handlePointerMove(e);
          }}
          onPointerUp={handlePointerUp}
          onPointerLeave={(e) => {
            // Only handle pointer leave if not captured
            if (!e.target.hasPointerCapture?.(e.pointerId)) {
              handlePointerUp(e);
            }
          }}
          onDoubleClick={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
          className="absolute inset-0 touch-none"
          style={{ cursor: tool === 'pan' ? 'grab' : tool === 'eraser' ? 'none' : tool === 'select' ? 'default' : 'crosshair' }}
        />

        {/* MIRA Scanning Wave Effect */}
        {isScanningCanvas && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Scanning wave line */}
            <div
              className="absolute left-0 right-0 h-1"
              style={{
                top: `${scanProgress * 100}%`,
                background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.6), rgba(147, 197, 253, 0.8), rgba(59, 130, 246, 0.6), transparent)',
                boxShadow: '0 0 20px rgba(59, 130, 246, 0.5), 0 0 40px rgba(59, 130, 246, 0.3), 0 0 60px rgba(59, 130, 246, 0.1)',
                opacity: 1 - (scanProgress * 0.3),
                transform: 'translateY(-50%)',
              }}
            />
            {/* Trailing glow effect */}
            <div
              className="absolute left-0 right-0"
              style={{
                top: 0,
                height: `${scanProgress * 100}%`,
                background: `linear-gradient(to bottom, transparent ${Math.max(0, 100 - 30)}%, rgba(59, 130, 246, 0.05) 100%)`,
                opacity: 1 - scanProgress,
              }}
            />
            {/* Edge glow */}
            <div
              className="absolute inset-0"
              style={{
                boxShadow: 'inset 0 0 100px rgba(59, 130, 246, 0.1)',
                opacity: 1 - scanProgress,
              }}
            />
          </div>
        )}
      </div>

      {/* FigJam-style floating toolbar */}
      <div data-toolbar className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 bg-white rounded-xl shadow-lg border border-gray-200">
        <ToolButton id="select" shortcut="V" label="Select" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l7.07 17 2.51-7.39L21 11.07 4 4z" />
          </svg>
        } />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <ToolButton id="pencil" shortcut="P" label="Pen" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
        } />

        <ToolButton id="highlighter" shortcut="H" label="Highlighter" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l-6 6v3h9l3-3" /><path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4" />
          </svg>
        } />

        <ToolButton id="eraser" shortcut="E" label="Eraser" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 20H7L2.5 15.5a2 2 0 010-2.83L9.17 6a2 2 0 012.83 0L20 14v6z" />
            <path d="M8.5 13.5L10.5 11.5M13.5 10.5L11.5 12.5" />
          </svg>
        } />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <ToolButton id="line" shortcut="L" label="Line" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="19" x2="19" y2="5" />
          </svg>
        } />

        <ToolButton id="arrow" shortcut="A" label="Arrow" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" />
          </svg>
        } />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Shapes dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowShapesMenu(!showShapesMenu)}
            className={`relative group p-2.5 rounded-lg transition-all flex items-center gap-1 ${['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon'].includes(tool)
                ? 'bg-[#0d99ff] text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
              }`}
            title="Shapes"
            disabled={isReadOnly}
          >
            {/* Show current shape icon */}
            {currentShapeTool === 'rect' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            )}
            {currentShapeTool === 'ellipse' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <ellipse cx="12" cy="12" rx="9" ry="9" />
              </svg>
            )}
            {currentShapeTool === 'diamond' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l10 10-10 10L2 12z" />
              </svg>
            )}
            {currentShapeTool === 'triangle' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3L22 21H2z" />
              </svg>
            )}
            {currentShapeTool === 'star' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
            {currentShapeTool === 'hexagon' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L21 7v10l-9 5-9-5V7l9-5z" />
              </svg>
            )}
            {currentShapeTool === 'pentagon' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l9 6.5v9L12 22l-9-4.5v-9L12 2z" />
              </svg>
            )}
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showShapesMenu && (
            <div data-panel className="property-panel absolute bottom-full mb-2 left-1/2 -translate-x-1/2 p-2 bg-white rounded-xl shadow-xl border border-gray-200 min-w-[200px]">
              <div className="text-xs font-semibold text-gray-500 mb-2 px-1">Shapes</div>
              <div className="grid grid-cols-4 gap-1">
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('rect'); setCurrentShapeTool('rect'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'rect' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Rectangle (R)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('ellipse'); setCurrentShapeTool('ellipse'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'ellipse' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Ellipse (O)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="12" rx="9" ry="9" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('diamond'); setCurrentShapeTool('diamond'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'diamond' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Diamond (D)"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l10 10-10 10L2 12z" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('triangle'); setCurrentShapeTool('triangle'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'triangle' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Triangle"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3L22 21H2z" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('star'); setCurrentShapeTool('star'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'star' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Star"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('hexagon'); setCurrentShapeTool('hexagon'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'hexagon' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Hexagon"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L21 7v10l-9 5-9-5V7l9-5z" />
                  </svg>
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeAllPanels(); setTool('pentagon'); setCurrentShapeTool('pentagon'); setShowShapeOptions(true); }}
                  className={`p-2 rounded-lg transition-all ${tool === 'pentagon' ? 'bg-[#0d99ff] text-white' : 'hover:bg-gray-100 text-gray-600'}`}
                  title="Pentagon"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l9 6.5v9L12 22l-9-4.5v-9L12 2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <ToolButton id="sticky" shortcut="S" label="Sticky Note" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h9l5-5V5a2 2 0 00-2-2zm-4 16v-4h4l-4 4z" fill="#ffc700" />
            <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h9l5-5V5a2 2 0 00-2-2zm-4 16v-4h4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        } />

        <ToolButton id="text" shortcut="T" label="Text" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="8" y1="20" x2="16" y2="20" />
          </svg>
        } />

        <ToolButton id="image" shortcut="I" label="Image" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
        } />

        <div className="w-px h-6 bg-gray-200 mx-1" />

        <ToolButton id="pan" shortcut="Space" label="Hand" icon={
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v0" /><path d="M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v2" />
            <path d="M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8" /><path d="M18 8a2 2 0 114 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L7 15" />
          </svg>
        } />
      </div>

      {/* Top-right controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        {/* Zoom controls */}
        <div className="flex items-center bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <button onClick={() => setZoom(z => Math.max(0.1, z / 1.2))} className="p-2 hover:bg-gray-50 text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="px-2 text-sm text-gray-600 min-w-[50px] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(5, z * 1.2))} className="p-2 hover:bg-gray-50 text-gray-600">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Grid toggle */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-2 rounded-lg shadow border transition-colors ${showGrid ? 'bg-[#0d99ff] text-white border-[#0d99ff]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
        </button>

        {/* Export/Import */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="p-2 bg-white rounded-lg shadow border border-gray-200 hover:bg-gray-50 text-gray-600"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>

          {showExportMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
              <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Import</div>
                <button
                  onClick={importTboard}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Board File (.tboard)
                </button>

                <div className="my-2 border-t border-gray-100"></div>

                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Export</div>
                <button
                  onClick={exportToTboard}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  Board File (.tboard)
                </button>
                <button
                  onClick={exportToPng}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                  PNG
                </button>
                <button
                  onClick={exportToJpg}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                  JPG
                </button>
                <button
                  onClick={exportToSvg}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  SVG
                </button>
                <button
                  onClick={exportToPdf}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                  PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Top-left: undo/redo + copy/paste */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-white rounded-lg shadow border border-gray-200 p-1">
          <button onClick={undo} disabled={history.length === 0 || isReadOnly} className="p-2 hover:bg-gray-50 rounded disabled:opacity-30 text-gray-600" title="Undo (Cmd+Z)">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
            </svg>
          </button>
          <button onClick={redo} disabled={future.length === 0 || isReadOnly} className="p-2 hover:bg-gray-50 rounded disabled:opacity-30 text-gray-600" title="Redo (Cmd+Y)">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" />
            </svg>
          </button>
        </div>

        {!isReadOnly && (
          <div className="flex items-center gap-1 bg-white rounded-lg shadow border border-gray-200 p-1">
            <button onClick={copySelected} disabled={selectedIds.length === 0} className="p-2 hover:bg-gray-50 rounded disabled:opacity-30 text-gray-600" title="Copy (Cmd+C)">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
            <button onClick={pasteFromClipboard} disabled={!clipboard || clipboard.length === 0} className="p-2 hover:bg-gray-50 rounded disabled:opacity-30 text-gray-600" title="Paste (Cmd+V)">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
            </button>
            <button onClick={duplicateSelected} disabled={selectedIds.length === 0} className="p-2 hover:bg-gray-50 rounded disabled:opacity-30 text-gray-600" title="Duplicate (Cmd+D)">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Pages navigation at bottom */}
      <div className="absolute bottom-6 left-6">
        <div className="flex items-center gap-2 bg-white rounded-xl shadow-lg border border-gray-200 p-2">
          {pages.map((page, index) => (
            <div key={page.id} className="relative group">
              <button
                onClick={() => setCurrentPageIndex(index)}
                className={`min-w-[60px] px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentPageIndex === index
                    ? 'bg-[#0d99ff] text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                {index + 1}
              </button>
              {!isReadOnly && pages.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePage(index);
                  }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-sm hover:bg-red-600"
                  title="Delete Page"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          {!isReadOnly && (
            <button
              onClick={addPage}
              className="w-10 h-10 rounded-lg bg-[#0d99ff] text-white hover:bg-[#0b7fd9] transition-colors flex items-center justify-center shadow-sm"
              title="Add Page"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Save status */}
      <div className="absolute bottom-6 right-6">
        <span className={`text-xs px-2 py-1 rounded ${isDirty ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
          {isDirty ? 'Saving...' : '✓ Saved'}
        </span>
      </div>

      {/* Arrow type selector and properties - bottom of screen */}
      {showArrowMenu && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px]">
          <div className="space-y-3">
            {/* Arrow Type Selection */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Arrow Type</label>
              <div className="flex items-center gap-1 p-1 bg-gray-50 rounded-lg">
                <button
                  onClick={() => setArrowType('straight')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowType === 'straight' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Straight Arrow"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <polyline points="14 6 20 12 14 18" />
                  </svg>
                  <span className="text-[10px]">Straight</span>
                </button>
                <button
                  onClick={() => setArrowType('curved')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowType === 'curved' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Curved Arrow"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 16c0-6 4-10 10-10h6" />
                    <polyline points="16 2 20 6 16 10" />
                  </svg>
                  <span className="text-[10px]">Curved</span>
                </button>
                <button
                  onClick={() => setArrowType('elbow')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowType === 'elbow' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Elbow/Flowchart Arrow"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8h8v8h8" />
                    <polyline points="16 12 20 16 16 20" />
                  </svg>
                  <span className="text-[10px]">Elbow</span>
                </button>
              </div>
            </div>

            {/* Line Style Selection */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Line Style</label>
              <div className="flex items-center gap-1 p-1 bg-gray-50 rounded-lg">
                <button
                  onClick={() => setArrowLineStyle('solid')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowLineStyle === 'solid' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Solid Line"
                >
                  <svg className="w-6 h-3" viewBox="0 0 24 6" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="0" y1="3" x2="24" y2="3" />
                  </svg>
                  <span className="text-[10px]">Solid</span>
                </button>
                <button
                  onClick={() => setArrowLineStyle('dashed')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowLineStyle === 'dashed' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Dashed Line"
                >
                  <svg className="w-6 h-3" viewBox="0 0 24 6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2">
                    <line x1="0" y1="3" x2="24" y2="3" />
                  </svg>
                  <span className="text-[10px]">Dashed</span>
                </button>
                <button
                  onClick={() => setArrowLineStyle('dotted')}
                  className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${arrowLineStyle === 'dotted' ? 'bg-[#0d99ff] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  title="Dotted Line"
                >
                  <svg className="w-6 h-3" viewBox="0 0 24 6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round">
                    <line x1="0" y1="3" x2="24" y2="3" />
                  </svg>
                  <span className="text-[10px]">Dotted</span>
                </button>
              </div>
            </div>

            {/* Stroke Width */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Width</label>
              <input
                type="range"
                min="1"
                max="10"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{strokeWidth}px</div>
            </div>

            {/* Stroke Color */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Arrow Color</label>
              <div className="grid grid-cols-5 gap-1.5">
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setStrokeColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${strokeColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pen options - bottom of screen */}
      {showPenOptions && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[250px]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Width</label>
              <input
                type="range"
                min="1"
                max="20"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{strokeWidth}px</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Color</label>
              <div className="grid grid-cols-5 gap-1.5">
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setStrokeColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${strokeColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shape options - bottom of screen */}
      {showShapeOptions && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[250px] max-w-[300px]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Width</label>
              <input
                type="range"
                min="1"
                max="10"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{strokeWidth}px</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Color</label>
              <div className="grid grid-cols-5 gap-1.5">
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setStrokeColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${strokeColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Fill Color</label>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  onClick={() => setFillColor('transparent')}
                  className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 relative ${fillColor === 'transparent' ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                    }`}
                  title="Transparent"
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-full h-0.5 bg-red-500 rotate-45"></div>
                  </div>
                </button>
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setFillColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${fillColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            {tool === 'rect' && (
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Border Radius</label>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={borderRadius}
                  onChange={(e) => setBorderRadius(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 text-center mt-1">{borderRadius}px</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Element properties - shown when elements are selected */}
      {showElementOptions && selectedIds.length > 0 && (() => {
        const selectedObjs = objects.filter(obj => selectedIds.includes(obj.id));
        const types = new Set(selectedObjs.map(obj => obj.type));
        const hasClosedShapes = selectedObjs.some(obj => CLOSED_SHAPES.includes(obj.type));
        const hasText = selectedObjs.some(obj => obj.type === 'text' || obj.type === 'sticky');
        const hasShapesWithRadius = selectedObjs.some(obj => obj.type === 'rect');
        const hasPencil = selectedObjs.some(obj => obj.type === 'pencil');
        const hasHighlighter = selectedObjs.some(obj => obj.type === 'highlighter');
        const hasLines = selectedObjs.some(obj => obj.type === 'line' || obj.type === 'arrow');

        // Get current values from first selected object
        const firstObj = selectedObjs[0];

        // Calculate dynamic position based on selection bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedObjs.forEach(obj => {
          const bbox = getBoundingBox(obj);
          minX = Math.min(minX, bbox.x);
          minY = Math.min(minY, bbox.y);
          maxX = Math.max(maxX, bbox.x + bbox.width);
          maxY = Math.max(maxY, bbox.y + bbox.height);
        });

        // Convert to screen coordinates
        const screenMinX = minX * zoom + panX;
        const screenMinY = minY * zoom + panY;
        const screenMaxX = maxX * zoom + panX;
        const screenMaxY = maxY * zoom + panY;
        const selectionCenterX = (screenMinX + screenMaxX) / 2;

        // Panel dimensions (approximate)
        const panelWidth = 320;
        const panelHeight = 400; // Approximate max height
        const padding = 16;

        // Get viewport dimensions
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

        // Calculate optimal position
        let calculatedPosition = {};

        // Try to position to the right of the selection first
        if (screenMaxX + padding + panelWidth < viewportWidth - padding) {
          // Position to the right
          calculatedPosition = {
            left: Math.max(padding, screenMaxX + padding),
            top: Math.max(padding, Math.min(screenMinY, viewportHeight - panelHeight - padding)),
          };
        }
        // Try to position to the left
        else if (screenMinX - padding - panelWidth > padding) {
          calculatedPosition = {
            left: screenMinX - padding - panelWidth,
            top: Math.max(padding, Math.min(screenMinY, viewportHeight - panelHeight - padding)),
          };
        }
        // Try to position below the selection
        else if (screenMaxY + padding + panelHeight < viewportHeight - padding) {
          calculatedPosition = {
            left: Math.max(padding, Math.min(selectionCenterX - panelWidth / 2, viewportWidth - panelWidth - padding)),
            top: screenMaxY + padding,
          };
        }
        // Try to position above the selection
        else if (screenMinY - padding - panelHeight > padding) {
          calculatedPosition = {
            left: Math.max(padding, Math.min(selectionCenterX - panelWidth / 2, viewportWidth - panelWidth - padding)),
            top: screenMinY - padding - panelHeight,
          };
        }
        // Fallback: position at a corner that doesn't overlap
        else {
          calculatedPosition = {
            right: padding,
            top: padding + 60, // Below potential toolbar
            useRight: true,
          };
        }

        // Debounce position update - delay 800ms after last change
        if (panelPositionTimeoutRef.current) {
          clearTimeout(panelPositionTimeoutRef.current);
        }

        // If no debounced position exists, set it immediately (first render)
        if (!debouncedPanelPosition) {
          // Use setTimeout with 0 to avoid setState during render
          setTimeout(() => setDebouncedPanelPosition(calculatedPosition), 0);
        } else {
          // Schedule debounced update
          panelPositionTimeoutRef.current = setTimeout(() => {
            setDebouncedPanelPosition(calculatedPosition);
          }, 800);
        }

        // Use debounced position or fallback to calculated
        const positionToUse = debouncedPanelPosition || calculatedPosition;

        const panelStyle = positionToUse.useRight
          ? {
            position: 'fixed',
            right: `${positionToUse.right}px`,
            top: `${positionToUse.top}px`,
            transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: debouncedPanelPosition ? 1 : 0,
            transform: debouncedPanelPosition ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(-10px)',
          }
          : {
            position: 'fixed',
            left: `${positionToUse.left}px`,
            top: `${positionToUse.top}px`,
            transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: debouncedPanelPosition ? 1 : 0,
            transform: debouncedPanelPosition ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(-10px)',
          };

        return (
          <div
            data-panel
            className="property-panel p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px] max-w-[320px] max-h-[calc(100vh-100px)] overflow-y-auto"
            style={panelStyle}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-start mb-2">
                <span className="text-xs font-semibold text-gray-700">
                  {selectedIds.length === 1 ? (
                    <span className="capitalize">{firstObj?.type || 'Element'}</span>
                  ) : (
                    `${selectedIds.length} Elements`
                  )}
                </span>
                <button
                  onClick={() => setShowElementOptions(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Text options - for text and sticky */}
              {hasText && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-2 block">Font Size</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="12"
                        max="72"
                        value={firstObj?.fontSize || 16}
                        onChange={(e) => {
                          const newSize = Number(e.target.value);
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                              // Recalculate text dimensions with new font size
                              const measured = measureText(obj.text, newSize, obj.fontFamily, obj.fontWeight);
                              if (obj.type === 'sticky') {
                                return {
                                  ...obj,
                                  fontSize: newSize,
                                  width: Math.max(150, measured.width + 50),
                                  height: Math.max(150, measured.height + 70)
                                };
                              }
                              return {
                                ...obj,
                                fontSize: newSize,
                                width: measured.width,
                                height: measured.height
                              };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className="flex-1"
                      />
                      <span className="text-xs text-gray-500 w-8 text-right">{firstObj?.fontSize || 16}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-2 block">Font Weight</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                              // Recalculate text dimensions with normal weight
                              const measured = measureText(obj.text, obj.fontSize, obj.fontFamily, 'normal');
                              if (obj.type === 'sticky') {
                                return {
                                  ...obj,
                                  fontWeight: 'normal',
                                  width: Math.max(150, measured.width + 50),
                                  height: Math.max(150, measured.height + 70)
                                };
                              }
                              return {
                                ...obj,
                                fontWeight: 'normal',
                                width: measured.width,
                                height: measured.height
                              };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border ${firstObj?.fontWeight !== 'bold' ? 'bg-[#0d99ff] text-white border-[#0d99ff]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                      >
                        Normal
                      </button>
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                              // Recalculate text dimensions with bold weight
                              const measured = measureText(obj.text, obj.fontSize, obj.fontFamily, 'bold');
                              if (obj.type === 'sticky') {
                                return {
                                  ...obj,
                                  fontWeight: 'bold',
                                  width: Math.max(150, measured.width + 50),
                                  height: Math.max(150, measured.height + 70)
                                };
                              }
                              return {
                                ...obj,
                                fontWeight: 'bold',
                                width: measured.width,
                                height: measured.height
                              };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 px-3 py-1.5 text-xs rounded-lg border font-bold ${firstObj?.fontWeight === 'bold' ? 'bg-[#0d99ff] text-white border-[#0d99ff]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                      >
                        Bold
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-2 block">Font Style</label>
                    <div className="grid grid-cols-3 gap-1">
                      {FONT_OPTIONS.map(font => (
                        <button
                          key={font.name}
                          onClick={() => {
                            const updatedObjects = objects.map(obj => {
                              if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                                // Recalculate text dimensions with new font family
                                const measured = measureText(obj.text, obj.fontSize, font.name, obj.fontWeight);
                                if (obj.type === 'sticky') {
                                  return {
                                    ...obj,
                                    fontFamily: font.name,
                                    width: Math.max(150, measured.width + 50),
                                    height: Math.max(150, measured.height + 70)
                                  };
                                }
                                return {
                                  ...obj,
                                  fontFamily: font.name,
                                  width: measured.width,
                                  height: measured.height
                                };
                              }
                              return obj;
                            });
                            updateObjects(updatedObjects);
                          }}
                          className={`py-1.5 px-1 rounded-lg transition-colors flex flex-col items-center ${(firstObj?.fontFamily || 'Poppins') === font.name
                              ? 'bg-[#0d99ff] text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                          <span className="text-base leading-none" style={{ fontFamily: `'${font.name}', cursive, sans-serif` }}>{font.label}</span>
                          <span className="text-[9px] mt-0.5 opacity-70">{font.displayName}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Border radius - only for rect */}
              {hasShapesWithRadius && (
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Border Radius</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={firstObj?.borderRadius || 0}
                      onChange={(e) => {
                        const newRadius = Number(e.target.value);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id) && obj.type === 'rect') {
                            return { ...obj, borderRadius: newRadius };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-500 w-8 text-right">{firstObj?.borderRadius || 0}px</span>
                  </div>
                </div>
              )}

              {/* Stroke width - for pencil, lines, shapes */}
              {(hasPencil || hasLines || hasClosedShapes) && !hasText && (
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Width</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={firstObj?.strokeWidth || 2}
                      onChange={(e) => {
                        const newWidth = Number(e.target.value);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id)) {
                            return { ...obj, strokeWidth: newWidth };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-500 w-8 text-right">{firstObj?.strokeWidth || 2}px</span>
                  </div>
                </div>
              )}

              {/* Arrow-specific options */}
              {selectedObjs.some(obj => obj.type === 'arrow') && (
                <>
                  {/* Arrow Type */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-2 block">Arrow Type</label>
                    <div className="flex gap-2">
                      {/* Straight Arrow */}
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, arrowType: 'straight' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${(firstObj?.arrowType || 'straight') === 'straight'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Straight"
                      >
                        <svg viewBox="0 0 40 24" className="w-full h-5">
                          <line x1="4" y1="12" x2="32" y2="12" stroke="currentColor" strokeWidth="2" />
                          <polygon points="32,12 26,8 26,16" fill="currentColor" />
                        </svg>
                      </button>
                      {/* Curved Arrow */}
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, arrowType: 'curved' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${firstObj?.arrowType === 'curved'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Curved"
                      >
                        <svg viewBox="0 0 40 24" className="w-full h-5">
                          <path d="M4,18 Q20,0 32,12" fill="none" stroke="currentColor" strokeWidth="2" />
                          <polygon points="34,14 28,8 26,16" fill="currentColor" />
                        </svg>
                      </button>
                      {/* Elbow Arrow */}
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, arrowType: 'elbow' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${firstObj?.arrowType === 'elbow'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Elbow"
                      >
                        <svg viewBox="0 0 40 24" className="w-full h-5">
                          <path d="M4,18 L4,12 L32,12" fill="none" stroke="currentColor" strokeWidth="2" />
                          <polygon points="32,12 26,8 26,16" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Line Style */}
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-2 block">Line Style</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, lineStyle: 'solid' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${(firstObj?.lineStyle || 'solid') === 'solid'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Solid"
                      >
                        <div className="h-0.5 w-full bg-current rounded-full"></div>
                      </button>
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, lineStyle: 'dashed' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${firstObj?.lineStyle === 'dashed'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Dashed"
                      >
                        <div className="flex gap-1 justify-center">
                          <div className="h-0.5 w-3 bg-current rounded-full"></div>
                          <div className="h-0.5 w-3 bg-current rounded-full"></div>
                          <div className="h-0.5 w-3 bg-current rounded-full"></div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && obj.type === 'arrow') {
                              return { ...obj, lineStyle: 'dotted' };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`flex-1 p-2 rounded-lg border-2 transition-all text-gray-700 ${firstObj?.lineStyle === 'dotted'
                            ? 'border-[#0d99ff] bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                          }`}
                        title="Dotted"
                      >
                        <div className="flex gap-1 justify-center">
                          <div className="h-1 w-1 bg-current rounded-full"></div>
                          <div className="h-1 w-1 bg-current rounded-full"></div>
                          <div className="h-1 w-1 bg-current rounded-full"></div>
                          <div className="h-1 w-1 bg-current rounded-full"></div>
                          <div className="h-1 w-1 bg-current rounded-full"></div>
                        </div>
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Rotation control */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Rotation</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={firstObj?.rotation || 0}
                    onChange={(e) => {
                      const newRotation = Number(e.target.value);
                      setRotation(newRotation);
                      const updatedObjects = objects.map(obj => {
                        if (selectedIds.includes(obj.id)) {
                          return { ...obj, rotation: newRotation };
                        }
                        return obj;
                      });
                      updateObjects(updatedObjects);
                    }}
                    className="flex-1"
                  />
                  <span className="text-xs text-gray-500 w-10 text-right">{firstObj?.rotation || 0}°</span>
                </div>
              </div>

              {/* Stroke/Text color */}
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">
                  {hasText ? 'Text Color' : 'Stroke Color'}
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => {
                        setStrokeColor(color);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id)) {
                            return { ...obj, strokeColor: color };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${(firstObj?.strokeColor || strokeColor) === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                        }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Fill color - only for closed shapes */}
              {hasClosedShapes && (
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-2 block">Fill Color</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    <button
                      onClick={() => {
                        setFillColor('transparent');
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id) && CLOSED_SHAPES.includes(obj.type)) {
                            return { ...obj, fillColor: 'transparent' };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 relative ${(firstObj?.fillColor || 'transparent') === 'transparent' ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                        }`}
                      title="Transparent"
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-full h-0.5 bg-red-500 rotate-45"></div>
                      </div>
                    </button>
                    {COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => {
                          setFillColor(color);
                          const updatedObjects = objects.map(obj => {
                            if (selectedIds.includes(obj.id) && CLOSED_SHAPES.includes(obj.type)) {
                              return { ...obj, fillColor: color };
                            }
                            return obj;
                          });
                          updateObjects(updatedObjects);
                        }}
                        className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${firstObj?.fillColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                          }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2 border-t border-gray-200">
                <button
                  onClick={duplicateSelected}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Duplicate
                </button>
                <button
                  onClick={deleteSelected}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-red-100 text-red-600 hover:bg-red-200 rounded-lg transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Line tool options */}
      {showLineOptions && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[250px]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Stroke Width</label>
              <input
                type="range"
                min="1"
                max="20"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{strokeWidth}px</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Color</label>
              <div className="grid grid-cols-5 gap-1.5">
                {COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setStrokeColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${strokeColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Highlighter options */}
      {showHighlighterOptions && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[250px]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Highlighter Width</label>
              <input
                type="range"
                min="10"
                max="40"
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{strokeWidth}px</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Opacity</label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={highlighterOpacity}
                onChange={(e) => setHighlighterOpacity(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{Math.round(highlighterOpacity * 100)}%</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Transparent Colors</label>
              <div className="grid grid-cols-5 gap-1.5">
                {COLORS.slice(1, 7).map(color => (
                  <button
                    key={color}
                    onClick={() => setHighlighterColor(color)}
                    className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${highlighterColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                      }`}
                    style={{ backgroundColor: color, opacity: 0.5 }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Eraser options */}
      {showEraserOptions && (
        <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[200px]">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Eraser Size</label>
              <input
                type="range"
                min="10"
                max="100"
                value={eraserRadius}
                onChange={(e) => setEraserRadius(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center mt-1">{eraserRadius}px</div>
            </div>
          </div>
        </div>
      )}

      {/* Text/Sticky options - only show when text tool is active but no text/sticky element is selected */}
      {showTextOptions && (() => {
        // Check if any text/sticky element is selected - if so, use element properties panel instead
        const hasSelectedTextOrSticky = selectedIds.length > 0 && objects.some(obj =>
          selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')
        );
        if (hasSelectedTextOrSticky) return null;

        return (
          <div data-panel className="property-panel fixed bottom-24 left-1/2 -translate-x-1/2 p-3 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">Text Options</span>
                <button onClick={() => setShowTextOptions(false)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Font Size</label>
                <input
                  type="range"
                  min="12"
                  max="72"
                  value={fontSize}
                  onChange={(e) => {
                    const newSize = Number(e.target.value);
                    setFontSize(newSize);
                    // Update selected text objects with recalculated dimensions
                    const updatedObjects = objects.map(obj => {
                      if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                        const measured = measureText(obj.text, newSize, obj.fontFamily, obj.fontWeight);
                        if (obj.type === 'sticky') {
                          return {
                            ...obj,
                            fontSize: newSize,
                            width: Math.max(150, measured.width + 50),
                            height: Math.max(150, measured.height + 70)
                          };
                        }
                        return {
                          ...obj,
                          fontSize: newSize,
                          width: measured.width,
                          height: measured.height
                        };
                      }
                      return obj;
                    });
                    updateObjects(updatedObjects);
                  }}
                  className="w-full"
                />
                <div className="text-xs text-gray-500 text-center mt-1">{fontSize}px</div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Font Weight</label>
                <div className="flex gap-2">
                  {['normal', 'bold'].map(weight => (
                    <button
                      key={weight}
                      onClick={() => {
                        setFontWeight(weight);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                            const measured = measureText(obj.text, obj.fontSize, obj.fontFamily, weight);
                            if (obj.type === 'sticky') {
                              return {
                                ...obj,
                                fontWeight: weight,
                                width: Math.max(150, measured.width + 50),
                                height: Math.max(150, measured.height + 70)
                              };
                            }
                            return {
                              ...obj,
                              fontWeight: weight,
                              width: measured.width,
                              height: measured.height
                            };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm transition-colors ${fontWeight === weight
                          ? 'bg-[#0d99ff] text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      style={{ fontWeight: weight }}
                    >
                      {weight === 'normal' ? 'Regular' : 'Bold'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Font Style</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {FONT_OPTIONS.map(font => (
                    <button
                      key={font.name}
                      onClick={() => {
                        setFontFamily(font.name);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                            const measured = measureText(obj.text, obj.fontSize, font.name, obj.fontWeight);
                            if (obj.type === 'sticky') {
                              return {
                                ...obj,
                                fontFamily: font.name,
                                width: Math.max(150, measured.width + 50),
                                height: Math.max(150, measured.height + 70)
                              };
                            }
                            return {
                              ...obj,
                              fontFamily: font.name,
                              width: measured.width,
                              height: measured.height
                            };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className={`py-2 px-1 rounded-lg transition-colors flex flex-col items-center ${fontFamily === font.name
                          ? 'bg-[#0d99ff] text-white ring-2 ring-[#0d99ff] ring-offset-1'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                      <span className="text-lg leading-none" style={{ fontFamily: `'${font.name}', cursive, sans-serif` }}>{font.label}</span>
                      <span className="text-[10px] mt-0.5 opacity-70">{font.displayName}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-2 block">Text Color</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => {
                        setTextColor(color);
                        const updatedObjects = objects.map(obj => {
                          if (selectedIds.includes(obj.id) && (obj.type === 'text' || obj.type === 'sticky')) {
                            return { ...obj, strokeColor: color };
                          }
                          return obj;
                        });
                        updateObjects(updatedObjects);
                      }}
                      className={`w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 ${textColor === color ? 'border-[#0d99ff] scale-110 shadow-md' : 'border-gray-200'
                        }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Center to drawing button */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <button
          onClick={centerToDrawing}
          className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
          title="Center to drawing"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          <span>Center</span>
        </button>
      </div>

      {/* Action buttons for touch - right side */}
      {!isReadOnly && selectedIds.length > 0 && (
        <div className="absolute top-1/2 -translate-y-1/2 right-6 flex flex-col gap-2 p-2 bg-white rounded-xl shadow-lg border border-gray-200">
          <button
            onClick={copySelected}
            className="p-3 rounded-lg hover:bg-gray-100 text-gray-700 flex flex-col items-center gap-1"
            title="Copy (Cmd+C)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            <span className="text-[10px] font-medium">Copy</span>
          </button>

          <button
            onClick={duplicateSelected}
            className="p-3 rounded-lg hover:bg-gray-100 text-gray-700 flex flex-col items-center gap-1"
            title="Duplicate (Cmd+D)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              <circle cx="15" cy="15" r="1" fill="currentColor" />
            </svg>
            <span className="text-[10px] font-medium">Duplicate</span>
          </button>

          {/* Group button - show when 2+ elements selected and not all grouped */}
          {canGroup && !hasGroupedItems && (
            <button
              onClick={groupSelected}
              className="p-3 rounded-lg hover:bg-blue-50 text-blue-600 flex flex-col items-center gap-1"
              title="Group (Cmd+G)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                <path d="M10 7h4M10 17h4M7 10v4M17 10v4" strokeDasharray="2 2" />
              </svg>
              <span className="text-[10px] font-medium">Group</span>
            </button>
          )}

          {/* Ungroup button - show when grouped elements are selected */}
          {hasGroupedItems && (
            <button
              onClick={ungroupSelected}
              className="p-3 rounded-lg hover:bg-orange-50 text-orange-600 flex flex-col items-center gap-1"
              title="Ungroup (Cmd+Shift+G)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                <path d="M12 8l-2 2m0 0l2 2m-2-2h4M12 16l-2-2m0 0l2-2m-2 2h4" />
              </svg>
              <span className="text-[10px] font-medium">Ungroup</span>
            </button>
          )}

          <button
            onClick={deleteSelected}
            className="p-3 rounded-lg hover:bg-red-50 text-red-600 flex flex-col items-center gap-1"
            title="Delete (Del)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span className="text-[10px] font-medium">Delete</span>
          </button>
        </div>
      )}

      {/* Paste button when clipboard has content - left side */}
      {!isReadOnly && clipboard && (
        <div className="absolute top-1/2 -translate-y-1/2 left-6 p-2 bg-white rounded-xl shadow-lg border border-gray-200">
          <button
            onClick={pasteFromClipboard}
            className="p-3 rounded-lg hover:bg-gray-100 text-gray-700 flex flex-col items-center gap-1"
            title="Paste (Cmd+V)"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            <span className="text-[10px] font-medium">Paste</span>
          </button>
        </div>
      )}

      {/* Custom confirmation modal */}
      {confirmModal && (
        <>
          <div 
            className="fixed inset-0 z-[999]" 
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }} 
            onClick={() => !confirmModal.onConfirm && setConfirmModal(null)} 
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 z-[1000] min-w-[320px]">
            <p className="text-gray-800 text-center mb-6">{confirmModal.message}</p>
            <div className="flex gap-3 justify-center">
              {confirmModal.onConfirm ? (
                <>
                  <button
                    onClick={() => setConfirmModal(null)}
                    className="px-6 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    className="px-6 py-2 rounded-lg bg-[#0d99ff] text-white hover:bg-[#0b7fd9] transition-colors font-medium"
                  >
                    OK
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmModal(null)}
                  className="px-6 py-2 rounded-lg bg-[#0d99ff] text-white hover:bg-[#0b7fd9] transition-colors font-medium"
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.tboard"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          if (file.name.endsWith('.tboard')) {
            const reader = new FileReader();
            reader.onload = (event) => {
              try {
                const data = JSON.parse(event.target.result);
                if (data.pages) {
                  saveHistory();
                  setPages(data.pages);
                  setCurrentPageIndex(0);
                }
              } catch (err) {
                console.error('Failed to parse board file:', err);
              }
            };
            reader.readAsText(file);
          } else {
            const reader = new FileReader();
            reader.onload = (event) => {
              const img = new Image();
              img.onload = () => {
                // Check if there's a selected placeholder to replace
                const selectedPlaceholder = objects.find(o =>
                  selectedIds.includes(o.id) && o.type === 'image' && o.isPlaceholder
                );

                if (selectedPlaceholder) {
                  // Replace placeholder with actual image
                  const aspectRatio = img.width / img.height;
                  let newWidth = selectedPlaceholder.width;
                  let newHeight = selectedPlaceholder.height;

                  // Maintain aspect ratio while fitting in placeholder bounds
                  if (newWidth / newHeight > aspectRatio) {
                    newWidth = newHeight * aspectRatio;
                  } else {
                    newHeight = newWidth / aspectRatio;
                  }

                  // Center within original placeholder bounds
                  const newX = selectedPlaceholder.x + (selectedPlaceholder.width - newWidth) / 2;
                  const newY = selectedPlaceholder.y + (selectedPlaceholder.height - newHeight) / 2;

                  saveHistory();
                  updateObjects(objects.map(o =>
                    o.id === selectedPlaceholder.id
                      ? { ...o, x: newX, y: newY, width: newWidth, height: newHeight, image: event.target.result, isPlaceholder: false }
                      : o
                  ));
                } else {
                  // Create new image object
                  const imgX = startPoint ? startPoint.x - img.width / 2 : (window.innerWidth / 2 - panX) / zoom - img.width / 2;
                  const imgY = startPoint ? startPoint.y - img.height / 2 : (window.innerHeight / 2 - panY) / zoom - img.height / 2;

                  const newObj = {
                    id: generateId(),
                    type: 'image',
                    x: imgX,
                    y: imgY,
                    width: img.width,
                    height: img.height,
                    image: event.target.result,
                    opacity: 1
                  };
                  saveHistory();
                  updateObjects([...objects, newObj]);
                }
              };
              img.src = event.target.result;
            };
            reader.readAsDataURL(file);
          }

          e.target.value = ''; // Reset input
        }}
        className="hidden"
      />

      {/* AI Analyze Button - Apple Glass Effect */}
      <div className="fixed bottom-20 right-6 z-50">
        <button
          onClick={() => setShowAIPanel(prev => !prev)}
          className={`
            group relative flex items-center gap-2 px-4 py-3 rounded-2xl
            bg-white/20
            border border-white/30
            shadow-[0_4px_24px_rgba(0,0,0,0.08)]
            hover:bg-white/30 hover:shadow-[0_8px_32px_rgba(99,102,241,0.15)]
            transition-all duration-300 ease-out
            hover:scale-[1.02] active:scale-[0.98]
            ${showAIPanel ? 'ring-2 ring-violet-400/40 bg-white/30' : ''}
          `}
          title="Analyse with MIRA"
        >
          {/* Icon */}
          <div className="relative flex items-center justify-center w-6 h-6">
            {aiLoading ? (
              <Loader size="xs" />
            ) : (
              <svg className="w-5 h-5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            )}
          </div>

          {/* Text */}
          <span className="text-sm font-medium text-gray-700">Analyse with MIRA</span>

          {/* Pulse effect when has content */}
          {aiAnalysis.messages.length > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-violet-500 rounded-full animate-pulse" />
          )}
        </button>
      </div>

      {/* AI Analysis Panel - Apple Glass Effect */}
      {showAIPanel && (
        <div
          ref={aiPanelRef}
          className="fixed bottom-20 sm:bottom-36 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-96 max-h-[calc(100vh-120px)] sm:max-h-[calc(100vh-180px)] flex flex-col
            bg-white/25
            border border-white/40
            rounded-2xl
            shadow-[0_8px_40px_rgba(0,0,0,0.1)]
            overflow-hidden
            animate-in slide-in-from-bottom-4 fade-in duration-300"
        >
          {/* Header */}
          <div className="relative px-5 py-4 border-b border-white/20 bg-white/10">
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">MIRA Canvas Analysis</h3>
                  <p className="text-xs text-gray-500">AI-powered insights</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {aiAnalysis.messages.length > 0 && (
                  <button
                    onClick={clearAIHistory}
                    className="p-2 rounded-xl hover:bg-white/40 transition-colors text-gray-400 hover:text-red-500"
                    title="Clear history"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => setShowAIPanel(false)}
                  className="p-2 rounded-xl hover:bg-white/40 transition-colors text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[120px] sm:min-h-[180px] bg-white/5">
            {aiAnalysis.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-100/80 to-purple-100/80 flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">Analyse Your Canvas</h4>
                <p className="text-xs text-gray-500 max-w-[180px] mb-4">
                  Get AI insights about your whiteboard content
                </p>
                <button
                  onClick={analyzeCanvas}
                  disabled={aiLoading || objects.length === 0}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-medium
                    shadow-md hover:shadow-lg hover:scale-[1.02]
                    active:scale-[0.98]
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                    transition-all duration-200"
                >
                  {aiLoading ? 'Analysing...' : objects.length === 0 ? 'Canvas is empty' : '✨ Analyse Canvas'}
                </button>
              </div>
            ) : (
              <>
                {aiAnalysis.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                          ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-br-md'
                          : 'bg-white/60 text-gray-800 border border-white/40 rounded-bl-md'
                        }`}
                    >
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </div>
                      <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={aiMessagesEndRef} />
              </>
            )}

            {/* Loading indicator */}
            {aiLoading && aiAnalysis.messages.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-white/60 rounded-2xl rounded-bl-md px-4 py-3 border border-white/40">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-gray-500">MIRA is thinking...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error message */}
            {aiError && (
              <div className="bg-red-50/80 border border-red-200/50 rounded-xl px-4 py-3 text-sm text-red-600">
                {aiError}
              </div>
            )}
          </div>

          {/* Key points section */}
          {aiAnalysis.keyPoints && aiAnalysis.keyPoints.length > 0 && (
            <div className="px-4 py-3 border-t border-white/20 bg-amber-50/30">
              <h4 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Key Points
              </h4>
              <ul className="space-y-1">
                {aiAnalysis.keyPoints.slice(0, 5).map((point, idx) => (
                  <li key={idx} className="text-xs text-gray-600 flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Input area */}
          <div className="p-3 sm:p-4 border-t border-white/20 bg-white/10">
            <div className="flex gap-2">
              <textarea
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => {
                  // Only send on Ctrl+Enter or Cmd+Enter, Enter adds new line
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendAIMessage(aiInput);
                  }
                }}
                placeholder={showAgentMode ? "Describe what to create...\n(Ctrl+Enter to send)" : "Ask MIRA about your canvas...\n(Ctrl+Enter to send)"}
                rows={2}
                className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl
                  bg-white/50
                  border border-white/40
                  text-sm text-gray-800 placeholder-gray-400
                  focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300/50
                  transition-all duration-200 resize-none"
              />
              <button
                onClick={() => sendAIMessage(aiInput)}
                disabled={aiLoading || !aiInput.trim()}
                className="px-4 py-2.5 rounded-xl self-end
                  bg-gradient-to-r from-violet-500 to-purple-600
                  text-white
                  shadow-md
                  hover:shadow-lg
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all duration-200"
                title="Send (Ctrl+Enter)"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>

            {/* Agent Mode toggle */}
            <div className="mt-3 pt-3 border-t border-gray-200/40">
              <button
                onClick={() => setShowAgentMode?.(prev => !prev)}
                className={`w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded-lg transition-all border ${showAgentMode
                    ? 'bg-violet-500 text-white border-violet-500 shadow-md'
                    : 'bg-white/50 hover:bg-white/70 text-gray-600 border-gray-200/60'
                  }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                {showAgentMode ? '✨ Agent Mode Active' : 'Agent Mode Off'}
              </button>

              {showAgentMode && (
                <>
                  {/* Template buttons for agent mode */}
                  <p className="mt-3 text-xs text-gray-500 font-medium">Quick Templates:</p>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => sendAIMessageWithTemplate('mindmap', 'Create a mindmap. What topic would you like me to map out?')}
                      disabled={aiLoading}
                      className="flex flex-col items-center gap-1 text-xs px-3 py-3 rounded-lg bg-gradient-to-br from-purple-50 to-violet-100 hover:from-purple-100 hover:to-violet-200 text-violet-700 transition-all border border-violet-200/60"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.5-7.5l-2.8 2.8m-5.4 5.4l-2.8 2.8m0-11l2.8 2.8m5.4 5.4l2.8 2.8" />
                      </svg>
                      Mindmap
                    </button>
                    <button
                      onClick={() => sendAIMessageWithTemplate('flowchart', 'Create a flowchart. Describe the process you want to visualize.')}
                      disabled={aiLoading}
                      className="flex flex-col items-center gap-1 text-xs px-3 py-3 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-100 hover:from-blue-100 hover:to-cyan-200 text-blue-700 transition-all border border-blue-200/60"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="6" height="6" rx="1" />
                        <rect x="15" y="3" width="6" height="6" rx="1" />
                        <rect x="9" y="15" width="6" height="6" rx="1" />
                        <path d="M6 9v3h6m6-3v3h-6m0 0v3" />
                      </svg>
                      Flowchart
                    </button>
                    <button
                      onClick={() => sendAIMessageWithTemplate('planning', 'Create a planning board. What project or tasks do you want to organize?')}
                      disabled={aiLoading}
                      className="flex flex-col items-center gap-1 text-xs px-3 py-3 rounded-lg bg-gradient-to-br from-emerald-50 to-green-100 hover:from-emerald-100 hover:to-green-200 text-emerald-700 transition-all border border-emerald-200/60"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M3 9h18M9 21V9" />
                      </svg>
                      Planning
                    </button>
                    <button
                      onClick={() => sendAIMessageWithTemplate('ideas', 'Create an ideas board. What theme do you want to brainstorm?')}
                      disabled={aiLoading}
                      className="flex flex-col items-center gap-1 text-xs px-3 py-3 rounded-lg bg-gradient-to-br from-amber-50 to-yellow-100 hover:from-amber-100 hover:to-yellow-200 text-amber-700 transition-all border border-amber-200/60"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
                        <path d="M9 21h6" />
                      </svg>
                      Ideas
                    </button>
                  </div>

                  {/* Generate More button */}
                  <button
                    onClick={continueGeneration}
                    disabled={aiLoading}
                    className="mt-3 w-full flex items-center justify-center gap-2 text-xs px-4 py-2.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition-all border border-emerald-200/60"
                  >
                    {aiLoading ? (
                      <>
                        <Loader size="xs" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                        Generate More Content
                      </>
                    )}
                  </button>
                </>
              )}

              {/* Non-agent mode buttons */}
              {!showAgentMode && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    onClick={() => sendAIMessage('Create key points and notes from this canvas')}
                    disabled={aiLoading}
                    className="flex items-center justify-center gap-2 text-xs px-3 py-2.5 rounded-lg bg-white/50 hover:bg-white/70 text-gray-600 transition-all border border-gray-200/60"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                    </svg>
                    Make Notes
                  </button>
                  <button
                    onClick={() => sendAIMessage('What improvements can be made to this canvas?')}
                    disabled={aiLoading}
                    className="flex items-center justify-center gap-2 text-xs px-3 py-2.5 rounded-lg bg-white/50 hover:bg-white/70 text-gray-600 transition-all border border-gray-200/60"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    Suggestions
                  </button>
                  <button
                    onClick={analyzeCanvas}
                    disabled={aiLoading}
                    className="flex items-center justify-center gap-2 text-xs px-3 py-2.5 rounded-lg bg-white/50 hover:bg-white/70 text-gray-600 transition-all border border-gray-200/60"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4v6h6M23 20v-6h-6" />
                      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
                    </svg>
                    Re-analyse
                  </button>
                  <button
                    onClick={restructureCanvas}
                    disabled={aiLoading || objects.length === 0}
                    className="flex items-center justify-center gap-2 text-xs px-3 py-2.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 transition-all border border-violet-200/60"
                    title="Clean up layout: align elements, fix spacing, straighten lines"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    Restructure
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Text input overlay */}
      {textEditing && (
        <div
          style={{
            position: 'absolute',
            left: `${textEditing.x * zoom + panX}px`,
            top: `${textEditing.y * zoom + panY}px`,
            zIndex: 1000
          }}
        >
          {textEditing.type === 'sticky' ? (
            <div className="w-[200px] h-[200px] bg-[#ffc700] rounded-lg shadow-xl p-3" style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <textarea
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                onBlur={handleTextSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setTextEditing(null); setTextValue(''); }
                  if (e.key === 'Enter' && e.metaKey) { handleTextSubmit(); }
                }}
                autoFocus
                className="w-full h-full bg-transparent resize-none outline-none"
                placeholder="Type something..."
                style={{ fontFamily: `'${fontFamily}', cursive, sans-serif`, fontSize: `${fontSize}px`, fontWeight: fontWeight }}
              />
            </div>
          ) : (
            <textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={handleTextSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setTextEditing(null); setTextValue(''); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleTextSubmit(); }
              }}
              autoFocus
              className="min-w-[150px] min-h-[40px] p-2 bg-white border-2 border-[#0d99ff] rounded-lg outline-none resize-none shadow-lg"
              placeholder="Type here..."
              style={{ color: strokeColor, transform: `scale(${zoom})`, transformOrigin: 'top left', fontFamily: `'${fontFamily}', cursive, sans-serif`, fontSize: `${fontSize}px`, fontWeight: fontWeight }}
            />
          )}
        </div>
      )}
    </div>
  );
});

WhiteboardCanvas.displayName = 'WhiteboardCanvas';

export default WhiteboardCanvas;
